/*! © 2026 Michael Adelani Adewusi · Adelani Super Intelligent Agents. All rights reserved. No part or section of this application may be copied. */
// Handwritten Theory Grader — Cloudflare Worker.
// /api/* is handled here (sign-in, super-admin user management, AI reading and
// marking); every other path is the browser app, served from static assets.
import { ensureReady, month, publicUser } from './db.js';
import {
  hashPassword, verifyPassword, passwordProblem, temporaryPassword,
  randomToken, sha256Hex, normEmail, validEmail
} from './security.js';
import * as ai from './ai.js';

const ROLES = ['superadmin', 'lecturer'];
const COOKIE = 'grader_sid';
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY = 20 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin'
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...API_HEADERS, ...headers } });
}

function cookie(env, token, maxAgeSec) {
  const secure = env.COOKIE_SECURE !== 'false';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}` + (secure ? '; Secure' : '');
}

function readCookie(request) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([A-Za-z0-9_-]+)'));
  return m ? m[1] : null;
}

async function body(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, 'File too large (limit 20 MB).');
  try { return await request.json(); } catch { throw new HttpError(400, 'Invalid request body.'); }
}

// A throwaway hash so unknown e-mails take as long to reject as wrong passwords.
let dummyHash = null;
const getDummyHash = async () => dummyHash || (dummyHash = await hashPassword(randomToken()));

// ------------------------------------------------------------------ sessions

async function loadUser(request, env) {
  const token = readCookie(request);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT s.hash, s.created_at AS s_created, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ?'
  ).bind(hash).first();
  if (!row || row.disabled || now - row.last_seen > SESSION_IDLE_MS || now - row.s_created > SESSION_MAX_MS) return null;
  if (now - row.last_seen > 60 * 1000) await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE hash = ?').bind(now, hash).run();
  return { user: row, sessionHash: hash };
}

async function startSession(env, user) {
  const token = randomToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)').bind(await sha256Hex(token), user.id, now, now),
    env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(new Date(now).toISOString(), user.id),
    env.DB.prepare('DELETE FROM sessions WHERE last_seen < ? OR created_at < ?').bind(now - SESSION_IDLE_MS, now - SESSION_MAX_MS)
  ]);
  return cookie(env, token, Math.floor(SESSION_MAX_MS / 1000));
}

function endUserSessions(env, userId, exceptHash) {
  return exceptHash
    ? env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND hash != ?').bind(userId, exceptHash).run()
    : env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

// ------------------------------------------------------------------ handlers

async function login(request, env) {
  const b = await body(request);
  const email = normEmail(b.email);
  const password = String(b.password || '');
  const key = (request.headers.get('CF-Connecting-IP') || 'local') + '|' + email;
  const now = Date.now();
  const f = await env.DB.prepare('SELECT * FROM login_failures WHERE key = ?').bind(key).first();
  if (f && f.until > now) throw new HttpError(429, 'Too many failed attempts. Try again in ' + Math.ceil((f.until - now) / 60000) + ' minute(s).');
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  const passwordOk = (await verifyPassword(password, user ? user.password_hash : await getDummyHash())) && !!user;
  // Only reveal that an account is disabled to someone who knows its password.
  if (passwordOk && user.disabled) throw new HttpError(403, 'This account is disabled. Contact the administrator.');
  if (!passwordOk) {
    // 5 failures within 15 minutes lock this e-mail from this address for 15 minutes.
    const fresh = !f || now - f.first > 15 * 60 * 1000;
    const count = fresh ? 1 : f.count + 1;
    await env.DB.prepare('INSERT INTO login_failures (key, count, first, until) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, first = excluded.first, until = excluded.until')
      .bind(key, count, fresh ? now : f.first, count >= 5 ? now + 15 * 60 * 1000 : 0).run();
    throw new HttpError(401, 'Wrong e-mail or password.');
  }
  if (f) await env.DB.prepare('DELETE FROM login_failures WHERE key = ?').bind(key).run();
  const setCookie = await startSession(env, user);
  return json({ user: publicUser(user) }, 200, { 'Set-Cookie': setCookie });
}

async function pagesThisMonth(env, userId) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM usage WHERE user_id = ? AND month = ? AND kind = 'read'").bind(userId, month()).first();
  return r.n;
}

async function record(env, userId, kind, usage) {
  const now = new Date();
  await env.DB.prepare('INSERT INTO usage (user_id, kind, at, month, input, output) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(userId, kind, now.toISOString(), month(now), (usage && usage.input_tokens) || 0, (usage && usage.output_tokens) || 0).run();
}

async function superAdminsLeft(env, excludeId) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin' AND disabled = 0 AND id != ?").bind(excludeId).first();
  return r.n;
}

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif)$/;
const b64ok = s => typeof s === 'string' && s.length > 100 && s.length < MAX_BODY && /^[A-Za-z0-9+/=]+$/.test(s.slice(0, 2000));

async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  // CSRF defence on top of SameSite=Strict cookies.
  if (method !== 'GET' && request.headers.get('X-Requested-With') !== 'grader') throw new HttpError(403, 'Missing request header.');

  const setup = await ensureReady(env);
  const aiEnabled = !!env.ANTHROPIC_API_KEY;

  if (path === '/api/health' && method === 'GET') return json({ ok: true, ai: aiEnabled, setupNeeded: setup.setupNeeded });
  if (path === '/api/auth/login' && method === 'POST') return login(request, env);
  if (path === '/api/auth/logout' && method === 'POST') {
    const token = readCookie(request);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(await sha256Hex(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(env, '', 0) });
  }

  // ---- everything below needs a signed-in user
  const session = await loadUser(request, env);
  if (!session) throw new HttpError(401, 'Please sign in.');
  const me = session.user;
  if (me.must_change && !/^\/api\/(me|auth\/)/.test(path)) throw new HttpError(403, 'Change your temporary password first.', { code: 'must_change_password' });

  if (path === '/api/me' && method === 'GET') {
    return json({
      user: publicUser(me),
      ai: { enabled: aiEnabled, model: env.CLAUDE_MODEL || ai.DEFAULT_MODEL },
      usage: { pagesThisMonth: await pagesThisMonth(env, me.id), monthlyPageLimit: me.monthly_limit || 0 }
    });
  }

  if (path === '/api/auth/password' && method === 'POST') {
    const { current, next } = await body(request);
    if (!(await verifyPassword(String(current || ''), me.password_hash))) throw new HttpError(400, 'Current password is wrong.');
    const problem = passwordProblem(next);
    if (problem) throw new HttpError(400, problem);
    if (next === current) throw new HttpError(400, 'Choose a password different from the current one.');
    await env.DB.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').bind(await hashPassword(next), me.id).run();
    await endUserSessions(env, me.id, session.sessionHash); // sign out other devices
    return json({ user: publicUser({ ...me, must_change: 0 }) });
  }

  // ---- super admin
  if (path.startsWith('/api/admin/')) {
    if (me.role !== 'superadmin') throw new HttpError(403, 'Super admin only.');

    if (path === '/api/admin/users' && method === 'GET') {
      const users = (await env.DB.prepare('SELECT * FROM users ORDER BY created_at').all()).results;
      const counts = (await env.DB.prepare('SELECT user_id, kind, COUNT(*) AS n FROM usage WHERE month = ? GROUP BY user_id, kind').bind(month()).all()).results;
      const count = (id, kind) => (counts.find(c => c.user_id === id && c.kind === kind) || { n: 0 }).n;
      return json({ users: users.map(u => ({ ...publicUser(u), pagesThisMonth: count(u.id, 'read'), gradesThisMonth: count(u.id, 'grade') })) });
    }

    if (path === '/api/admin/users' && method === 'POST') {
      const b = await body(request);
      const email = normEmail(b.email);
      if (!validEmail(email)) throw new HttpError(400, 'Enter a valid e-mail address.');
      if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) throw new HttpError(409, 'An account with this e-mail already exists.');
      const role = ROLES.includes(b.role) ? b.role : 'lecturer';
      const name = String(b.name || '').trim().slice(0, 100) || email.split('@')[0];
      let password = b.password ? String(b.password) : '';
      let generated = false;
      if (password) { const p = passwordProblem(password); if (p) throw new HttpError(400, p); } else { password = temporaryPassword(); generated = true; }
      const user = {
        id: crypto.randomUUID(), email, name, role, password_hash: await hashPassword(password), must_change: 1, disabled: 0,
        monthly_limit: Math.max(0, parseInt(b.monthlyPageLimit, 10) || 0), created_at: new Date().toISOString(), created_by: me.id
      };
      await env.DB.prepare('INSERT INTO users (id, email, name, role, password_hash, must_change, disabled, monthly_limit, created_at, created_by) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)')
        .bind(user.id, email, name, role, user.password_hash, user.monthly_limit, user.created_at, me.id).run();
      // The temporary password is returned once for the admin to pass on; only its hash is stored.
      return json({ user: publicUser(user), temporaryPassword: generated ? password : undefined }, 201);
    }

    const m = path.match(/^\/api\/admin\/users\/([0-9a-f-]{36})$/);
    if (m) {
      const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(m[1]).first();
      if (!u) throw new HttpError(404, 'User not found.');

      if (method === 'PATCH') {
        const b = await body(request);
        if (b.name !== undefined) u.name = String(b.name).trim().slice(0, 100) || u.name;
        if (b.monthlyPageLimit !== undefined) u.monthly_limit = Math.max(0, parseInt(b.monthlyPageLimit, 10) || 0);
        if (b.role !== undefined) {
          if (!ROLES.includes(b.role)) throw new HttpError(400, 'Unknown role.');
          if (u.role === 'superadmin' && b.role !== 'superadmin' && !(await superAdminsLeft(env, u.id))) throw new HttpError(400, 'There must be at least one active super admin.');
          u.role = b.role;
        }
        let endSessions = false;
        if (b.disabled !== undefined) {
          if (b.disabled && u.id === me.id) throw new HttpError(400, 'You cannot disable your own account.');
          if (b.disabled && u.role === 'superadmin' && !(await superAdminsLeft(env, u.id))) throw new HttpError(400, 'There must be at least one active super admin.');
          u.disabled = b.disabled ? 1 : 0;
          endSessions = !!b.disabled;
        }
        let temporary;
        if (b.resetPassword) {
          temporary = temporaryPassword();
          u.password_hash = await hashPassword(temporary);
          u.must_change = 1;
          endSessions = true;
        }
        await env.DB.prepare('UPDATE users SET name = ?, role = ?, disabled = ?, monthly_limit = ?, password_hash = ?, must_change = ? WHERE id = ?')
          .bind(u.name, u.role, u.disabled, u.monthly_limit, u.password_hash, u.must_change, u.id).run();
        if (endSessions) await endUserSessions(env, u.id, u.id === me.id ? session.sessionHash : undefined);
        return json({ user: publicUser(u), temporaryPassword: temporary });
      }

      if (method === 'DELETE') {
        if (u.id === me.id) throw new HttpError(400, 'You cannot delete your own account.');
        if (u.role === 'superadmin' && !(await superAdminsLeft(env, u.id))) throw new HttpError(400, 'There must be at least one active super admin.');
        await env.DB.batch([
          env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
          env.DB.prepare('DELETE FROM users WHERE id = ?').bind(u.id)
        ]);
        return json({ ok: true });
      }
    }
    throw new HttpError(404, 'Not found.');
  }

  // ---- AI
  if (path.startsWith('/api/ai/') && method === 'POST') {
    if (!aiEnabled) throw new HttpError(503, 'AI reading is not configured on this server (the ANTHROPIC_API_KEY secret is missing).');
    ai.configure(env);

    if (path === '/api/ai/read') {
      const { image, mediaType } = await body(request);
      if (!IMAGE_TYPES.test(mediaType || '') || !b64ok(image)) throw new HttpError(400, 'Send a JPEG, PNG or WebP page image.');
      const limit = me.monthly_limit || 0;
      if (limit && (await pagesThisMonth(env, me.id)) >= limit) throw new HttpError(429, `Monthly limit of ${limit} AI-read pages reached. Ask the administrator to raise it.`);
      const out = await ai.readPage({ imageBase64: image, mediaType });
      ctx.waitUntil(record(env, me.id, 'read', out.usage));
      return json({ transcription: out.transcription, readable: out.readable, legibility: out.legibility, notes: out.notes });
    }

    if (path === '/api/ai/grade') {
      const { question, answer, step } = await body(request);
      const q = question || {};
      const max = Number(q.max);
      if (!(max > 0 && max <= 1000) || typeof q.model !== 'string' || typeof answer !== 'string') throw new HttpError(400, 'Send the question (with max mark and model answer) and the answer text.');
      if (answer.length > 30000 || q.model.length > 30000) throw new HttpError(400, 'Answer or model answer is too long.');
      const groups = Array.isArray(q.keywordGroups) ? q.keywordGroups.filter(Array.isArray).map(g => g.map(String).slice(0, 20)).slice(0, 40) : [];
      const out = await ai.gradeAnswer({
        question: { label: String(q.label || '').slice(0, 20), title: String(q.title || '').slice(0, 300), max, model: q.model, keywordGroups: groups },
        answer, step: [0, 0.25, 0.5, 1].includes(Number(step)) ? Number(step) : 0.5
      });
      ctx.waitUntil(record(env, me.id, 'grade', out.usage));
      return json({ mark: out.mark, criteria: out.criteria, rationale: out.rationale, feedback: out.feedback, confidence: out.confidence });
    }

    if (path === '/api/ai/rubric') {
      const { file, mediaType, filename, text } = await body(request);
      if (text !== undefined) {
        if (typeof text !== 'string' || text.trim().length < 20 || text.length > 200000) throw new HttpError(400, 'Paste the marking guide text (at least a few lines).');
      } else if (!b64ok(file) || typeof mediaType !== 'string') throw new HttpError(400, 'Upload a PDF, Word (.docx), photo or text file.');
      const out = await ai.rubricFromGuide({ fileBase64: file, mediaType, filename, text });
      ctx.waitUntil(record(env, me.id, 'rubric', out.usage));
      return json({ rubricText: out.rubricText, questions: out.questions, warnings: out.warnings });
    }
  }

  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request); // the browser app
    try {
      return await handleApi(request, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      if (e instanceof ai.AIError) return json({ error: e.message }, e.status);
      console.error(e && e.stack || e);
      return json({ error: 'Unexpected server error.' }, 500);
    }
  }
};
