/* PostgreSQL storage.
 * The server keeps the working data in memory (loaded at start-up) and, after every action, writes only
 * the rows that changed — inside one transaction — to these tables. This is a single-process design:
 * run ONE server instance per database. */
'use strict';
const { Pool } = require('pg');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('student','teacher','admin')),
  class_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at BIGINT,
  doc JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY, teacher_id TEXT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, doc JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  xp INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0, best_streak INTEGER NOT NULL DEFAULT 0,
  last_active TEXT, doc JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id TEXT, world_id TEXT, level_id TEXT, topic TEXT, ok BOOLEAN NOT NULL,
  category TEXT, seconds INTEGER, mode TEXT, query TEXT, feedback TEXT, at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS submissions_user_idx ON submissions (user_id, at);
CREATE TABLE IF NOT EXISTS badges (id TEXT PRIMARY KEY, position INTEGER NOT NULL, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS user_badges (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, badge_id TEXT NOT NULL, at BIGINT,
  PRIMARY KEY (user_id, badge_id)
);
CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, class_id TEXT, world_id TEXT, due TEXT, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, class_id TEXT, name TEXT, leader_id TEXT, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, class_id TEXT, author_id TEXT, challenge_id TEXT, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS custom_challenges (id TEXT PRIMARY KEY, level_id TEXT, author_id TEXT, published BOOLEAN, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS custom_lessons (id TEXT PRIMARY KEY, level_id TEXT, author_id TEXT, published BOOLEAN, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS hidden_content (challenge_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS drafts (key TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL
);
`;

function omit(o, keys) { const c = Object.assign({}, o); keys.forEach((k) => delete c[k]); return c; }
const J = (v) => JSON.stringify(v);
const T = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(Number(v)));

/* How each in-memory collection maps to a table. Order matters: parents before children. */
const COLLECTIONS = [
  { name: 'users', table: 'users', key: 'id',
    rows: (db) => db.users.map((u) => ({ id: u.id, username: u.username, role: u.role, class_id: u.classId || null, active: u.active !== false,
      salt: u.salt, pass_hash: u.passHash, created_at: T(u.createdAt), doc: J(omit(u, ['salt', 'passHash'])) })),
    load: (rows, db) => { db.users = rows.map((r) => Object.assign(r.doc, { salt: r.salt, passHash: r.pass_hash })); } },
  { name: 'classes', table: 'classes', key: 'id',
    rows: (db) => db.classes.map((c) => ({ id: c.id, teacher_id: c.teacherId || null, code: c.code, name: c.name, doc: J(c) })),
    load: (rows, db) => { db.classes = rows.map((r) => r.doc); } },
  { name: 'progress', table: 'progress', key: 'user_id',
    rows: (db) => Object.keys(db.progress).filter((id) => db.users.some((u) => u.id === id)).map((id) => {
      const p = db.progress[id];
      return { user_id: id, xp: Math.round(p.xp || 0), streak: p.streak || 0, best_streak: p.bestStreak || 0, last_active: p.lastActive || null, doc: J(p) };
    }),
    load: (rows, db) => { db.progress = {}; rows.forEach((r) => { db.progress[r.user_id] = r.doc; }); } },
  { name: 'submissions', table: 'submissions', key: 'id', immutable: true,
    rows: (db) => db.submissions.map((s) => ({ id: s.id, user_id: s.userId, challenge_id: s.challengeId || null, world_id: s.worldId || null,
      level_id: s.levelId || null, topic: s.topic || null, ok: !!s.ok, category: s.category || null,
      seconds: s.seconds === null || s.seconds === undefined ? null : Math.round(s.seconds), mode: s.mode || null,
      query: s.query || null, feedback: s.feedback || null, at: T(s.at) || Date.now() })),
    load: (rows, db) => { db.submissions = rows.map((r) => ({ id: r.id, userId: r.user_id, challengeId: r.challenge_id, worldId: r.world_id, levelId: r.level_id,
      topic: r.topic, ok: r.ok, category: r.category, seconds: r.seconds, mode: r.mode, query: r.query, feedback: r.feedback, at: Number(r.at) })); },
    order: 'at' },
  { name: 'badges', table: 'badges', key: 'id',
    rows: (db) => db.badges.map((b, i) => ({ id: b.id, position: i, doc: J(b) })),
    load: (rows, db) => { db.badges = rows.map((r) => r.doc); }, order: 'position' },
  { name: 'userBadges', table: 'user_badges', key: ['user_id', 'badge_id'],
    rows: (db) => db.userBadges.map((x) => ({ user_id: x.userId, badge_id: x.badgeId, at: T(x.at) })),
    load: (rows, db) => { db.userBadges = rows.map((r) => ({ userId: r.user_id, badgeId: r.badge_id, at: Number(r.at) })); } },
  { name: 'assignments', table: 'assignments', key: 'id',
    rows: (db) => db.assignments.map((a) => ({ id: a.id, class_id: a.classId, world_id: a.worldId, due: a.due, doc: J(a) })),
    load: (rows, db) => { db.assignments = rows.map((r) => r.doc); } },
  { name: 'teams', table: 'teams', key: 'id',
    rows: (db) => db.teams.map((t) => ({ id: t.id, class_id: t.classId, name: t.name, leader_id: t.leaderId || null, doc: J(t) })),
    load: (rows, db) => { db.teams = rows.map((r) => r.doc); } },
  { name: 'reviews', table: 'reviews', key: 'id',
    rows: (db) => db.reviews.map((r) => ({ id: r.id, class_id: r.classId, author_id: r.authorId, challenge_id: r.challengeId, doc: J(r) })),
    load: (rows, db) => { db.reviews = rows.map((r) => r.doc); } },
  { name: 'customChallenges', table: 'custom_challenges', key: 'id',
    rows: (db) => db.customChallenges.map((c) => ({ id: c.id, level_id: c.levelId, author_id: c.authorId, published: c.published !== false, doc: J(c) })),
    load: (rows, db) => { db.customChallenges = rows.map((r) => r.doc); } },
  { name: 'customLessons', table: 'custom_lessons', key: 'id',
    rows: (db) => db.customLessons.map((c) => ({ id: c.id, level_id: c.levelId, author_id: c.authorId, published: c.published !== false, doc: J(c) })),
    load: (rows, db) => { db.customLessons = rows.map((r) => r.doc); } },
  { name: 'hidden', table: 'hidden_content', key: 'challenge_id',
    rows: (db) => Object.keys(db.hidden).filter((k) => db.hidden[k]).map((k) => ({ challenge_id: k })),
    load: (rows, db) => { db.hidden = {}; rows.forEach((r) => { db.hidden[r.challenge_id] = true; }); } },
  { name: 'drafts', table: 'drafts', key: 'key',
    rows: (db) => Object.keys(db.drafts).map((k) => ({ key: k, doc: J(db.drafts[k]) })),
    load: (rows, db) => { db.drafts = {}; rows.forEach((r) => { db.drafts[r.key] = r.doc; }); } },
  { name: 'settings', table: 'settings', key: 'key',
    rows: (db) => [{ key: 'main', doc: J(db.settings) }],
    load: (rows, db) => { const r = rows.find((x) => x.key === 'main'); db.settings = r ? r.doc : {}; } }
];

function keyOf(c, row) { return Array.isArray(c.key) ? c.key.map((k) => row[k]).join('\u0001') : String(row[c.key]); }

class Persistence {
  constructor(url) {
    this.pool = new Pool({ connectionString: url, max: 5, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined });
    this.snapshot = {};
    this.chain = Promise.resolve();
  }
  async migrate() { await this.pool.query(SCHEMA); }

  async load() {
    const db = { version: 1 };
    for (const c of COLLECTIONS) {
      const r = await this.pool.query('SELECT * FROM ' + c.table + (c.order ? ' ORDER BY ' + c.order : ''));
      c.load(r.rows, db);
      const snap = new Map();
      for (const row of c.rows(db)) snap.set(keyOf(c, row), c.immutable ? true : J(row));
      this.snapshot[c.name] = snap;
    }
    return db;
  }

  /* Work out what changed since the last save (synchronously, so the picture is consistent). */
  diff(db) {
    const changes = [];
    for (const c of COLLECTIONS) {
      const prev = this.snapshot[c.name] || new Map(), next = new Map(), upserts = [];
      for (const row of c.rows(db)) {
        const k = keyOf(c, row), j = c.immutable ? true : J(row);
        next.set(k, j);
        if (!prev.has(k) || (!c.immutable && prev.get(k) !== j)) upserts.push(row);
      }
      const deletes = [];
      for (const k of prev.keys()) if (!next.has(k)) deletes.push(k);
      if (upserts.length || deletes.length) changes.push({ c, upserts, deletes, prev, next });
    }
    return changes;
  }

  save(db) {
    const changes = this.diff(db);
    if (!changes.length) return this.chain;
    changes.forEach((ch) => { this.snapshot[ch.c.name] = ch.next; }); /* optimistic; restored on failure */
    const job = this.chain.then(() => this.write(changes)).catch((e) => {
      changes.forEach((ch) => {
        /* make the failed rows count as changed next time */
        const s = this.snapshot[ch.c.name];
        ch.upserts.forEach((row) => s.delete(keyOf(ch.c, row)));
        ch.deletes.forEach((k) => s.set(k, ch.prev.get(k)));
      });
      throw e;
    });
    this.chain = job.catch(() => {});
    return job;
  }

  async write(changes) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const ch of changes.slice().reverse()) {          /* children first for deletes */
        if (!ch.deletes.length) continue;
        const c = ch.c;
        if (Array.isArray(c.key)) {
          for (const k of ch.deletes) { const parts = k.split('\u0001'); await client.query('DELETE FROM ' + c.table + ' WHERE ' + c.key.map((col, i) => col + ' = $' + (i + 1)).join(' AND '), parts); }
        } else {
          for (let i = 0; i < ch.deletes.length; i += 1000) await client.query('DELETE FROM ' + c.table + ' WHERE ' + c.key + ' = ANY($1)', [ch.deletes.slice(i, i + 1000)]);
        }
      }
      for (const ch of changes) {                            /* parents first for inserts */
        if (!ch.upserts.length) continue;
        const c = ch.c, cols = Object.keys(ch.upserts[0]), keys = Array.isArray(c.key) ? c.key : [c.key];
        const updates = cols.filter((col) => keys.indexOf(col) < 0);
        const conflict = ' ON CONFLICT (' + keys.join(',') + ') ' + (updates.length && !c.immutable ? 'DO UPDATE SET ' + updates.map((col) => col + ' = EXCLUDED.' + col).join(', ') : 'DO NOTHING');
        const per = Math.max(1, Math.floor(5000 / cols.length));
        for (let i = 0; i < ch.upserts.length; i += per) {
          const chunk = ch.upserts.slice(i, i + per), params = [];
          const values = chunk.map((row) => '(' + cols.map((col) => { params.push(row[col]); return '$' + params.length; }).join(',') + ')').join(',');
          await client.query('INSERT INTO ' + c.table + ' (' + cols.join(',') + ') VALUES ' + values + conflict, params);
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }

  /* sessions */
  loadSessions() { return this.pool.query('DELETE FROM sessions WHERE expires_at < $1', [Date.now()]).then(() => this.pool.query('SELECT * FROM sessions')).then((r) => r.rows); }
  addSession(hash, userId, exp) { return this.pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [hash, userId, exp]); }
  deleteSession(hash) { return this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [hash]); }
  deleteUserSessions(userId) { return this.pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]); }
  deleteAllSessions() { return this.pool.query('DELETE FROM sessions'); }
  ping() { return this.pool.query('SELECT 1'); }
  close() { return this.pool.end(); }
}

module.exports = { Persistence };
