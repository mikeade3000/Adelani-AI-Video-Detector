/* End-to-end API tests. They start a real server against a THROWAWAY PostgreSQL database.
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/sqlquest_test npm test
 * WARNING: the test database is wiped (DROP SCHEMA public CASCADE) before the run. */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const { Client } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
let proc;

async function wipe() {
  const c = new Client({ connectionString: DB }); await c.connect();
  try { await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); } finally { await c.end(); }
}
function startServer() {
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
      env: Object.assign({}, process.env, { DATABASE_URL: DB, PORT: String(PORT), SEED_DEMO: 'true', ALLOW_DEMO_RESET: 'false' }), stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; if (/listening/.test(out)) resolve(); });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('exit', (code) => reject(new Error('server exited ' + code + '\n' + out)));
  });
}
function stopServer() { return new Promise((r) => { proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill('SIGTERM'); }); }

class Agent {
  constructor() { this.cookie = ''; }
  async req(method, url, body, headers) {
    const r = await fetch(BASE + url, { method, headers: Object.assign({ 'Content-Type': 'application/json', 'X-Requested-With': 'sqlquest', Cookie: this.cookie }, headers || {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    let j = {}; try { j = await r.json(); } catch (e) { /* not json */ }
    return { status: r.status, body: j };
  }
  act(name, p) { return this.req('POST', '/api/act/' + name, p || {}); }
  state() { return this.req('GET', '/api/state'); }
  async login(u, p) { const r = await this.act('login', { username: u, password: p }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r; }
}

before(async () => {
  if (!DB) throw new Error('Set TEST_DATABASE_URL to a throwaway database to run these tests.');
  await wipe(); await startServer();
});
after(async () => { if (proc) await stopServer(); });

test('health endpoint and answer-free content', async () => {
  const h = await (await fetch(BASE + '/api/health')).json();
  assert.equal(h.app, 'sqlquest'); assert.equal(h.ok, true);
  const js = await (await fetch(BASE + '/js/content.js')).text();
  assert.ok(js.includes('Data Village'));
  assert.ok(!/"solution"|"accept"|"answer"|"hints"/.test(js), 'served content must not contain answers or hints');
  assert.ok(!/"bin"/.test(js), 'drag-and-drop answers must be removed');
  const html = await (await fetch(BASE + '/')).text();
  assert.ok(html.includes('window.SQ_SERVER = 1'));
});

test('login, wrong password, and no secrets in state', async () => {
  const a = new Agent();
  const bad = await a.act('login', { username: 'student', password: 'nope' });
  assert.equal(bad.status, 401);
  await a.login('student', 'student123');
  const s = (await a.state()).body.state;
  assert.ok(s.meId);
  const txt = JSON.stringify(s);
  assert.ok(!/passHash|"salt"/.test(txt), 'no password data');
  const me = s.db.users.find((u) => u.id === s.meId);
  assert.equal(me.username, 'student');
  const others = s.db.users.filter((u) => u.id !== s.meId);
  assert.ok(others.length > 0 && others.every((u) => u.username === undefined), 'classmates do not expose usernames');
  assert.ok(s.db.submissions.every((x) => x.userId === s.meId), 'students only see their own submissions');
});

test('actions require the X-Requested-With header (CSRF guard)', async () => {
  const a = new Agent(); await a.login('student', 'student123');
  const r = await a.req('POST', '/api/act/lessonRead', { levelId: 'w2l2' }, { 'X-Requested-With': '' });
  assert.equal(r.status, 403);
});

test('role-based access control', async () => {
  const a = new Agent(); await a.login('student', 'student123');
  for (const [name, p] of [['userRole', { id: 'x', role: 'admin' }], ['settingsSave', { lives: 99 }], ['classCreate', { name: 'Hack' }], ['importData', { data: {} }]]) {
    const r = await a.act(name, p); assert.equal(r.status, 403, name);
  }
  const anon = new Agent();
  assert.equal((await anon.act('submit', { id: 'w1l1c1', answer: 2 })).status, 401);
  assert.equal((await a.act('noSuchAction', {})).status, 404);
  assert.equal((await a.act('__proto__', {})).status, 404);
  const ex = await a.req('GET', '/api/export'); assert.equal(ex.status, 403);
});

test('server-side grading, XP and locked levels', async () => {
  const a = new Agent(); await a.login('student', 'student123');
  const before = (await a.state()).body.state;
  const xp0 = before.db.progress[before.meId].xp;
  /* wrong answer */
  await a.act('openChallenge', { id: 'w2l2c1' });
  const wrong = await a.act('submit', { id: 'w2l2c1', answer: 'SELECT name, gpa FROM students WHERE gpa >= 3.5;' });
  assert.equal(wrong.status, 200); assert.equal(wrong.body.result.pass, false);
  assert.deepEqual(wrong.body.result.exp, { rows: 3, cols: 2 });
  /* right answer, different row order + column order is accepted */
  const ok = await a.act('submit', { id: 'w2l2c1', answer: 'SELECT gpa, name FROM students WHERE age >= 20 AND gpa >= 3.5 ORDER BY name;' });
  assert.equal(ok.body.result.pass, true, ok.body.result.message);
  assert.ok(ok.body.result.reward.total > 0);
  assert.equal(ok.body.result.reward.accuracy, 0, 'one mistake → no accuracy bonus');
  const xp1 = ok.body.state.db.progress[before.meId].xp;
  assert.equal(xp1, xp0 + ok.body.result.reward.total);
  /* replay earns nothing */
  const again = await a.act('submit', { id: 'w2l2c1', answer: 'SELECT name, gpa FROM students WHERE gpa >= 3.5 AND age >= 20;' });
  assert.equal(again.body.result.replay, true);
  assert.equal(again.body.state.db.progress[before.meId].xp, xp1);
  /* locked level */
  const locked = await a.act('submit', { id: 'w4l1c2', answer: 2 });
  assert.equal(locked.status, 403);
  /* sandbox safety */
  const drop = await a.act('submit', { id: 'w2l3c1', answer: 'DROP TABLE students;' });
  assert.equal(drop.status, 403, 'w2l3 is still locked');
});

test('quiz, hints cost XP and are only revealed when bought', async () => {
  const a = new Agent(); await a.login('student', 'student123');
  const h0 = (await a.act('hint', { id: 'w2l2c2' })).body.result;
  assert.equal(h0.hints.length, 0); assert.equal(h0.total, 1);
  const s0 = (await a.state()).body.state, xp0 = s0.db.progress[s0.meId].xp;
  const h1 = await a.act('hint', { id: 'w2l2c2', buy: true });
  assert.equal(h1.body.result.hints.length, 1);
  assert.equal(h1.body.state.db.progress[s0.meId].xp, xp0 - 5);
  const q = await a.act('submit', { id: 'w2l2c2', answer: 1 });
  assert.equal(q.body.result.pass, true);
});

test('timeouts and blocked commands in the server sandbox', async () => {
  const a = new Agent(); await a.login('zainab', 'student123');
  const loop = await a.act('submit', { id: 'w1l2c1', answer: 'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT n, n FROM r;' });
  assert.equal(loop.body.result.pass, false);
  assert.ok(['timeout', 'runtime'].includes(loop.body.result.category), loop.body.result.message);
  const drop = await a.act('submit', { id: 'w1l2c1', answer: 'DROP TABLE students;' });
  assert.equal(drop.body.result.category, 'blocked');
  const slow = await a.act('submit', { id: 'w1l2c1', answer: 'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n < 500000000) SELECT count(*), 1 FROM r;' });
  assert.equal(slow.body.result.category, 'timeout', slow.body.result.message);
  const after = await a.act('submit', { id: 'w1l2c1', answer: 'SELECT name, city FROM students;' });
  assert.equal(after.body.result.pass, true, 'sandbox recovers after a killed query');
});

test('boss battle is run by the server', async () => {
  const a = new Agent(); await a.login('zainab', 'student123');
  const early = await a.act('bossAnswer', { answer: 'x' });
  assert.equal(early.status, 400);
  const st = await a.act('bossStart', { worldId: 'w5' });
  assert.equal(st.status, 200); assert.equal(st.body.result.total, 4);
  const w1 = await a.act('bossAnswer', { answer: 'BEGIN; UPDATE accounts SET balance = balance - 2500 WHERE id = 3; UPDATE accounts SET balance = balance + 2500 WHERE id = 1;' });
  assert.equal(w1.body.result.pass, false); assert.equal(w1.body.result.lives, 2);
  const answers = ['BEGIN; UPDATE accounts SET balance = balance - 2500 WHERE id = 3; UPDATE accounts SET balance = balance + 2500 WHERE id = 1; COMMIT;',
    'CREATE INDEX i ON enrollments(course_id);', 1, 1];
  let last;
  for (const ans of answers) { last = await a.act('bossAnswer', { answer: ans }); assert.equal(last.body.result.pass, true, last.body.result.message); }
  assert.equal(last.body.result.win, true);
  assert.ok(last.body.result.reward.total > 0);
  assert.ok(last.body.result.reward.newBadges.some((b) => b.id === 'grand_master'));
  const locked = new Agent(); await locked.login('ngozi', 'student123');
  assert.equal((await locked.act('bossStart', { worldId: 'w5' })).status, 403);
});

test('peer review is anonymous and earns XP once', async () => {
  const author = new Agent(); await author.login('tunde', 'student123');
  const own = (await author.state()).body.state;
  assert.ok(own.db.reviews.some((r) => r.authorId === own.meId), 'the author sees their own shared query');
  const t = new Agent(); await t.login('fatima', 'student123');
  const s = (await t.state()).body.state;
  const rv = s.db.reviews.find((r) => r.authorId !== s.meId);
  assert.ok(rv, 'a shared query exists'); assert.equal(rv.authorId, null); assert.match(rv.authorLabel, /^Classmate #\d+$/);
  const a = new Agent(); await a.login('amaka', 'student123');
  const s2 = (await a.state()).body.state;
  const r1 = await a.act('reviewSubmit', { reviewId: s2.db.reviews[0].id, rating: 4, comment: 'Clear and correct.' });
  assert.equal(r1.status, 200); assert.equal(r1.body.result.xp, 15);
  assert.equal((await a.act('reviewSubmit', { reviewId: s2.db.reviews[0].id, rating: 5, comment: 'Again' })).status, 400);
});

test('team missions: only the leader submits, every member gets XP', async () => {
  const leader = new Agent(); await leader.login('amaka', 'student123');
  const member = new Agent(); await member.login('student', 'student123');
  const sql = 'SELECT s.name, d.name, s.gpa FROM students s JOIN departments d ON d.id = s.dept_id WHERE s.gpa > 3.3 ORDER BY s.gpa DESC;';
  assert.equal((await member.act('teamSubmit', { missionId: 'tm1', answer: sql })).status, 403);
  assert.equal((await member.act('teamDraft', { missionId: 'tm1', sql })).status, 200);
  const ms0 = (await member.state()).body.state, xp0 = ms0.db.progress[ms0.meId].xp;
  const r = await leader.act('teamSubmit', { missionId: 'tm1', answer: sql });
  assert.equal(r.body.result.pass, true, r.body.result.message);
  const ms1 = (await member.state()).body.state;
  assert.equal(ms1.db.progress[ms1.meId].xp, xp0 + 60);
});

test('teacher tools and ownership checks', async () => {
  const t = new Agent(); await t.login('teacher', 'teacher123');
  const s = (await t.state()).body.state;
  assert.ok(s.db.submissions.length > 0, 'teacher sees class submissions for analytics');
  const c = await t.act('classCreate', { name: 'Evening class' });
  assert.match(c.body.result.code, /^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  const ch = await t.act('challengeSave', { type: 'query', levelId: 'w2l1', title: 'Kano', prompt: 'List Kano students', solution: "SELECT name FROM students WHERE city = 'Kano'", xp: 25, par: 60, topic: 'where' });
  assert.equal(ch.status, 200);
  const bad = await t.act('challengeSave', { type: 'query', levelId: 'w2l1', title: 'x', prompt: 'x', solution: 'DROP TABLE students' });
  assert.equal(bad.status, 400);
  /* students get the custom challenge without its solution, and it is graded on the server */
  const st = new Agent(); await st.login('student', 'student123');
  const ss = (await st.state()).body.state;
  const cc = ss.db.customChallenges.find((x) => x.id === ch.body.result.id);
  assert.ok(cc && cc.solution === undefined);
  const g = await st.act('submit', { id: cc.id, answer: "SELECT name FROM students WHERE city = 'Kano'" });
  assert.equal(g.body.result.pass, true);
  /* another teacher cannot touch it */
  const admin = new Agent(); await admin.login('admin', 'admin123');
  await admin.act('userCreate', { username: 'teacher2', password: 'secret12', displayName: 'T2', role: 'teacher' });
  const t2 = new Agent(); await t2.login('teacher2', 'secret12');
  assert.equal((await t2.act('challengeDelete', { id: cc.id })).status, 404);
  assert.equal((await t2.act('classRegen', { id: s.db.classes[0].id })).status, 404);
});

test('admin: disable user revokes sessions; reset disabled by default', async () => {
  const admin = new Agent(); await admin.login('admin', 'admin123');
  const victim = new Agent(); await victim.login('samuel', 'student123');
  const id = (await victim.state()).body.state.meId;
  assert.equal((await admin.act('userActive', { id, active: false })).status, 200);
  const after = (await victim.state()).body.state;
  assert.equal(after.meId, null, 'disabled user is signed out');
  assert.equal((await victim.act('login', { username: 'samuel', password: 'student123' })).status, 403);
  assert.equal((await admin.act('resetPlatform', {})).status, 403);
  const exp = await admin.req('GET', '/api/export');
  assert.equal(exp.status, 200); assert.ok(exp.body.data.users.length >= 12);
});

test('data and sessions survive a server restart', async () => {
  const a = new Agent(); await a.login('student', 'student123');
  const xp = (await a.state()).body.state.db.progress[(await a.state()).body.state.meId].xp;
  await stopServer(); await startServer();
  const s = (await a.state()).body.state;
  assert.ok(s.meId, 'session cookie still valid after restart');
  assert.equal(s.db.progress[s.meId].xp, xp, 'XP persisted in PostgreSQL');
});

test('login rate limiting', async () => {
  const a = new Agent(); let last;
  for (let i = 0; i < 12; i++) last = await a.act('login', { username: 'fatima', password: 'wrong' + i });
  assert.equal(last.status, 429);
});
