// Accounts and sessions: scrypt password hashes, random session tokens stored
// only as SHA-256 hashes, HttpOnly SameSite=Strict cookies, login throttling.
import crypto from 'node:crypto';

export const ROLES = ['superadmin', 'lecturer'];
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;      // sign out after 12 h without use
const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;    // and after 7 days regardless
const COOKIE = 'grader_sid';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('base64') + '$' + hash.toString('base64');
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}

// A throwaway hash so unknown e-mails take as long to reject as wrong passwords.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers.';
  return null;
}

export function temporaryPassword() {
  // 14 chars from an unambiguous alphabet, always with letters and digits.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out;
  do {
    out = Array.from(crypto.randomBytes(14), b => alphabet[b % alphabet.length]).join('');
  } while (passwordProblem(out));
  return out;
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
export const normEmail = e => String(e || '').trim().toLowerCase();
export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

export function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, disabled: !!u.disabled,
    mustChangePassword: !!u.mustChangePassword, monthlyPageLimit: u.monthlyPageLimit || 0,
    createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null
  };
}

export function createAuth(store, { secureCookies }) {
  const { db } = store;
  const failures = new Map(); // key -> {count, until}

  function bootstrapSuperAdmin(email, password) {
    if (db.users.length) return null;
    if (!email || !password) return 'No accounts exist yet. Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD and restart to create the super admin.';
    email = normEmail(email);
    if (!validEmail(email)) return 'SUPERADMIN_EMAIL is not a valid e-mail address.';
    const problem = passwordProblem(password);
    if (problem) return 'SUPERADMIN_PASSWORD: ' + problem;
    db.users.push({
      id: crypto.randomUUID(), email, name: 'Administrator', role: 'superadmin',
      passwordHash: hashPassword(password), mustChangePassword: false, createdAt: new Date().toISOString()
    });
    store.save();
    return 'created';
  }

  function cookieHeader(token, maxAgeSec) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}` + (secureCookies ? '; Secure' : '');
  }

  function readCookie(req) {
    const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([A-Za-z0-9_-]+)'));
    return m ? m[1] : null;
  }

  function startSession(res, user) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    db.sessions.push({ hash: sha256(token), userId: user.id, createdAt: now, lastSeen: now });
    user.lastLoginAt = new Date(now).toISOString();
    store.save();
    res.setHeader('Set-Cookie', cookieHeader(token, Math.floor(SESSION_MAX_MS / 1000)));
  }

  function endSession(req, res) {
    const token = readCookie(req);
    if (token) {
      const h = sha256(token);
      db.sessions = db.sessions.filter(s => s.hash !== h);
      store.save();
    }
    res.setHeader('Set-Cookie', cookieHeader('', 0));
  }

  function endUserSessions(userId, exceptHash) {
    db.sessions = db.sessions.filter(s => s.userId !== userId || s.hash === exceptHash);
    store.save();
  }

  // Attaches req.user / req.sessionHash when a valid session cookie is present.
  function loadUser(req, res, next) {
    const token = readCookie(req);
    if (token) {
      const h = sha256(token);
      const now = Date.now();
      const s = db.sessions.find(x => x.hash === h);
      if (s && now - s.lastSeen < SESSION_IDLE_MS && now - s.createdAt < SESSION_MAX_MS) {
        const u = db.users.find(x => x.id === s.userId);
        if (u && !u.disabled) {
          req.user = u;
          req.sessionHash = h;
          if (now - s.lastSeen > 60 * 1000) { s.lastSeen = now; store.save(); }
        }
      }
    }
    next();
  }

  function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    // Until a temporary password is changed, only the password and session endpoints work.
    if (req.user.mustChangePassword && !/^\/api\/(me|auth\/)/.test(req.originalUrl)) {
      return res.status(403).json({ error: 'Change your temporary password first.', code: 'must_change_password' });
    }
    next();
  }

  function requireSuperAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'superadmin') return res.status(403).json({ error: 'Super admin only.' });
    next();
  }

  function throttleKey(req, email) { return (req.ip || '') + '|' + email; }

  function login(req, res) {
    const email = normEmail(req.body && req.body.email);
    const password = String((req.body && req.body.password) || '');
    const key = throttleKey(req, email);
    const f = failures.get(key);
    if (f && f.until > Date.now()) {
      return res.status(429).json({ error: 'Too many failed attempts. Try again in ' + Math.ceil((f.until - Date.now()) / 60000) + ' minute(s).' });
    }
    const user = db.users.find(u => u.email === email);
    const passwordOk = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH) && !!user;
    // Only reveal that an account is disabled to someone who knows its password.
    if (passwordOk && user.disabled) return res.status(403).json({ error: 'This account is disabled. Contact the administrator.' });
    if (!passwordOk) {
      // 5 failures within 15 minutes lock this e-mail from this address for 15 minutes.
      const now = Date.now();
      let cur = failures.get(key);
      if (!cur || now - cur.first > 15 * 60 * 1000) cur = { count: 0, first: now, until: 0 };
      cur.count++;
      if (cur.count >= 5) cur.until = now + 15 * 60 * 1000;
      failures.set(key, cur);
      if (failures.size > 10000) failures.delete(failures.keys().next().value);
      return res.status(401).json({ error: 'Wrong e-mail or password.' });
    }
    failures.delete(key);
    startSession(res, user);
    res.json({ user: publicUser(user) });
  }

  return { bootstrapSuperAdmin, loadUser, requireUser, requireSuperAdmin, login, endSession, endUserSessions, startSession };
}
