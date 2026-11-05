/* SQL Quest server.
 *   GET  /api/health        liveness + database check
 *   GET  /api/state         the data the signed-in user may see
 *   POST /api/act/:name     run one action (all changes go through js/actions.js, checked here)
 *   GET  /api/export        full backup (admins only)
 * It also serves the game's web files from ../sql-quest, with answers removed from js/content.js. */
'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SQ, CLIENT_DIR, publicContentJs } = require('./shared');
const { Persistence } = require('./persist');
const view = require('./view');
const sandbox = require('./sandbox');

const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const COOKIE = 'sq_session';
const caps = { server: true, allowReset: process.env.ALLOW_DEMO_RESET === 'true' };
const log = (...a) => console.log(new Date().toISOString(), ...a);

if (!DATABASE_URL) { console.error('DATABASE_URL is not set. Example: postgres://user:password@localhost:5432/sqlquest'); process.exit(1); }

/* ───────── passwords (scrypt; browser-version hashes are accepted once and upgraded) ───────── */
function hash(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, passHash: 'scrypt$' + crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function verify(u, pw) {
  if (!u.passHash || typeof pw !== 'string') return false;
  if (u.passHash.indexOf('scrypt$') === 0) {
    const want = Buffer.from(u.passHash.slice(7), 'hex'), got = crypto.scryptSync(pw, u.salt, 64);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }
  const legacy = u.passHash.indexOf('sha$') === 0 ? u.passHash : 'sha$' + u.passHash; /* from a browser-only backup */
  if (SQ.Store.hashLocal(u.salt, pw) !== legacy) return false;
  Object.assign(u, hash(pw));
  return true;
}

/* ───────── sessions ───────── */
const sessions = new Map(); /* sha256(token) → { userId, exp } */
const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
function readCookie(req) {
  const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.indexOf(COOKIE + '=') === 0);
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}
function sessionUser(req) {
  const t = readCookie(req); if (!t) return null;
  const s = sessions.get(tokenHash(t));
  if (!s || s.exp < Date.now()) return null;
  return s.userId;
}
function setCookie(req, res, value, maxAge) {
  const secure = process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && req.secure);
  res.append('Set-Cookie', COOKIE + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secure ? '; Secure' : ''));
}

/* ───────── rate limiting for login / sign-up ───────── */
const attempts = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(), a = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  a.push(now); attempts.set(key, a);
  return a.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of attempts) if (!v.some((t) => now - t < 3600e3)) attempts.delete(k); }, 600e3).unref();

const ephemeral = {};
let store;

async function bootstrap() {
  store = new Persistence(DATABASE_URL);
  await store.migrate();
  const db = await store.load();
  SQ.Store.attach(db.users.length ? db : SQ.Store.blank(), null);
  if (!db.users.length) {
    const ctx = { hash, verify, login() {}, logout() {}, ephemeral: {}, caps };
    if (process.env.SEED_DEMO === 'true') {
      SQ.Actions.seedDemo(ctx);
      log('Seeded DEMO data. Demo logins: admin/admin123, teacher/teacher123, student/student123 — do not use in production.');
    } else {
      const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
      let password = process.env.ADMIN_PASSWORD;
      if (!password) { password = crypto.randomBytes(9).toString('base64url'); log('No ADMIN_PASSWORD set. Generated one-time admin password:', password); }
      const h = hash(password), S = SQ.Store;
      const u = { id: S.uid('u'), username, displayName: 'Administrator', role: 'admin', salt: h.salt, passHash: h.passHash, classId: null, active: true, createdAt: Date.now(), avatar: '🛡️' };
      S.raw().users.push(u); S.raw().progress[u.id] = S.newProgress();
      S.settings().showDemoAccounts = false;
      log('Created admin account "' + username + '".');
    }
    await store.save(SQ.Store.raw());
  }
  for (const s of await store.loadSessions()) sessions.set(s.token_hash, { userId: s.user_id, exp: Number(s.expires_at) });
  sandbox.warmUp();
}

/* ───────── app ───────── */
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  });
  next();
});
app.use('/api', express.json({ limit: '20mb' }));

app.get('/api/health', async (req, res) => {
  try { await store.ping(); res.json({ app: 'sqlquest', ok: true }); } catch (e) { res.status(503).json({ app: 'sqlquest', ok: false, error: 'Database unavailable' }); }
});
app.get('/api/state', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ state: view.build(sessionUser(req), caps) }); });

app.post('/api/act/:name', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.get('X-Requested-With') !== 'sqlquest') return res.status(403).json({ error: 'Forbidden.' });
  const name = req.params.name, payload = req.body && typeof req.body === 'object' ? req.body : {};
  const ip = req.ip || 'unknown';
  if ((name === 'login' || name === 'register') && (limited('ip:' + ip, 30, 15 * 60e3) || (payload.username && limited('u:' + String(payload.username).toLowerCase(), 10, 15 * 60e3)))) {
    return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
  }
  let userId = sessionUser(req);
  const currentToken = readCookie(req);
  const effects = { login: null, logout: false, revoke: [], revokeAll: false };
  const ctx = {
    userId, hash, verify, ephemeral, caps,
    login(id) { effects.login = id; },
    logout() { effects.logout = true; },
    revoke(id) { effects.revoke.push(id); },
    revokeAll() { effects.revokeAll = true; }
  };
  let result;
  try {
    result = await SQ.Actions.run(name, payload, ctx);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) log('Action error', name, e);
    try { await store.save(SQ.Store.raw()); } catch (_) { /* nothing to save */ }
    return res.status(status).json({ error: e.expose ? e.message : 'Something went wrong on the server.', state: view.build(userId, caps) });
  }
  try {
    await store.save(SQ.Store.raw());
  } catch (e) {
    log('Save failed', name, e);
    return res.status(500).json({ error: 'Could not save your change. Please try again.' });
  }
  try {
    if (effects.revokeAll) { sessions.clear(); await store.deleteAllSessions(); }
    for (const id of effects.revoke) { for (const [k, s] of sessions) if (s.userId === id) sessions.delete(k); await store.deleteUserSessions(id); }
    if (effects.logout || effects.login) {
      if (currentToken) { const h = tokenHash(currentToken); sessions.delete(h); await store.deleteSession(h); }
      if (!effects.login) setCookie(req, res, '', 0);
      userId = null;
    }
    if (effects.login) {
      const token = crypto.randomBytes(32).toString('hex'), exp = Date.now() + SESSION_DAYS * 864e5;
      await store.addSession(tokenHash(token), effects.login, exp);
      sessions.set(tokenHash(token), { userId: effects.login, exp });
      setCookie(req, res, token, SESSION_DAYS * 86400);
      userId = effects.login;
    }
  } catch (e) { log('Session error', e); }
  res.json({ result, state: view.build(userId, caps) });
});

app.get('/api/export', (req, res) => {
  const me = SQ.Store.user(sessionUser(req));
  if (!me || me.role !== 'admin' || !me.active) return res.status(403).json({ error: 'Admins only.' });
  res.set('Cache-Control', 'no-store');
  res.json({ data: SQ.Store.raw() });
});

/* web files */
const indexHtml = fs.readFileSync(path.join(CLIENT_DIR, 'index.html'), 'utf8').replace('<script src="js/content.js"></script>', '<script>window.SQ_SERVER = 1;</script>\n  <script src="js/content.js"></script>');
app.get(['/', '/index.html'], (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(indexHtml); });
app.get('/js/content.js', (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('application/javascript').send(publicContentJs()); });
app.use(express.static(CLIENT_DIR, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (/\.(js|css|html)$/.test(p)) res.set('Cache-Control', 'no-cache'); } }));
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => { res.status(err.status && err.status < 500 ? err.status : 400).json({ error: err.type === 'entity.too.large' ? 'That upload is too large.' : 'Bad request.' }); });

let server;
bootstrap().then(() => {
  server = app.listen(PORT, () => log('SQL Quest server listening on port ' + PORT + ' (sandbox workers: ' + sandbox.SIZE + ')'));
}).catch((e) => { console.error('Start-up failed:', e.message); process.exit(1); });

function stop() { log('Shutting down…'); if (server) server.close(); store.chain.finally(() => Promise.all([store.close(), sandbox.shutdown()]).finally(() => process.exit(0))); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

module.exports = app;
