/*! © 2026 Michael Adelani Adewusi · Adelani Super Intelligent Agents. All rights reserved. No part or section of this application may be copied. */
// Cloudflare D1 (SQLite) storage for accounts, sessions, usage and login throttling.
// Tables are created on first use, so no separate migration step is needed.
import { hashPassword, passwordProblem, normEmail, validEmail } from './security.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
     password_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0,
     monthly_limit INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, created_by TEXT, last_login_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL,
     month TEXT NOT NULL, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS usage_user_month ON usage(user_id, month, kind)`,
  `CREATE TABLE IF NOT EXISTS login_failures (
     key TEXT PRIMARY KEY, count INTEGER NOT NULL, first INTEGER NOT NULL, until INTEGER NOT NULL)`
];

const readyByDb = new WeakMap();

/** Create tables and, when there are no accounts yet, the first super admin from secrets. */
export function ensureReady(env) {
  let ready = readyByDb.get(env.DB);
  if (!ready) {
    ready = (async () => {
      await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
      if (n > 0) return { setupNeeded: false };
      const email = normEmail(env.SUPERADMIN_EMAIL);
      const password = env.SUPERADMIN_PASSWORD;
      if (!email || !password) { console.warn('[setup] No accounts yet: set the SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD secrets.'); return { setupNeeded: true }; }
      if (!validEmail(email) || passwordProblem(password)) { console.warn('[setup] SUPERADMIN_EMAIL or SUPERADMIN_PASSWORD is invalid (password: 10+ characters, letters and numbers).'); return { setupNeeded: true }; }
      await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, name, role, password_hash, must_change, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
        .bind(crypto.randomUUID(), email, 'Administrator', 'superadmin', await hashPassword(password), new Date().toISOString()).run();
      console.log('[setup] Super admin account created for ' + email + '.');
      return { setupNeeded: false };
    })().catch(err => { readyByDb.delete(env.DB); throw err; });
    readyByDb.set(env.DB, ready);
  }
  return ready;
}

export const month = (d = new Date()) => new Date(d).toISOString().slice(0, 7);

export function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, disabled: !!u.disabled,
    mustChangePassword: !!u.must_change, monthlyPageLimit: u.monthly_limit || 0,
    createdAt: u.created_at, lastLoginAt: u.last_login_at || null
  };
}
