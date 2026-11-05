/* Actions: every change to platform data goes through one of these functions.
 * The SAME file runs in the browser (browser-only mode) and on the Node.js server, so the rules —
 * role checks, grading, XP, unlocking — are identical in both. On the server it is the only way
 * to change data, which makes the server the authority.
 *
 * run(name, payload, ctx) → Promise<result>
 * ctx: { userId, hash(pw) → {salt, passHash}, verify(user, pw) → bool, login(userId), logout(),
 *        ephemeral: {}, caps: { allowReset: bool, server: bool } }
 */
window.SQ = window.SQ || {};

SQ.Actions = (function () {
  var S = SQ.Store, E = SQ.Engine;

  function fail(msg, status) { var e = new Error(msg); e.status = status || 400; e.expose = true; throw e; }
  function str(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 200); }
  function num(v, lo, hi, d) { v = Number(v); if (!isFinite(v)) return d; return Math.max(lo, Math.min(hi, v)); }
  function db() { return S.raw(); }
  function ownsClass(me, c) { return c && (me.role === 'admin' || c.teacherId === me.id); }
  function classOf(id) { return db().classes.find(function (c) { return c.id === id; }); }
  function levelExists(id) { return SQ.WORLDS.some(function (w) { return w.levels.some(function (l) { return l.id === id; }); }); }
  function normCode(code) { code = str(code, 20).toUpperCase(); if (code.length === 6 && code.indexOf('-') < 0) code = code.slice(0, 3) + '-' + code.slice(3); return code; }

  /* ───────── users ───────── */
  function makeUser(o, c) {
    var uname = str(o.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,24}$/.test(uname)) fail('Username must be 3–24 letters, numbers, dots, dashes or underscores.');
    if (db().users.some(function (u) { return u.username === uname; })) fail('That username is taken.');
    if (!o.password || String(o.password).length < 6) fail('Password must be at least 6 characters.');
    if (String(o.password).length > 200) fail('Password is too long.');
    var role = ['student', 'teacher', 'admin'].indexOf(o.role) >= 0 ? o.role : 'student';
    var h = c.hash(String(o.password));
    var u = { id: S.uid('u'), username: uname, displayName: str(o.displayName || uname, 40) || uname, role: role,
      salt: h.salt, passHash: h.passHash, classId: null, active: true, createdAt: Date.now(), avatar: str(o.avatar, 8) || S.pickAvatar(uname) };
    db().users.push(u);
    db().progress[u.id] = S.newProgress();
    return u;
  }

  /* ───────── grading helpers ───────── */
  function shape(r) { return r ? { rows: r.values.length, cols: r.columns.length } : null; }
  function publicResult(res, ch, answer) {
    var out = { pass: !!res.pass, message: res.message, category: res.category || null, noPenalty: !!res.noPenalty };
    if (res.got) out.got = { columns: res.got.columns, values: res.got.values.slice(0, 50), total: res.got.values.length };
    if (res.exp && !res.pass) out.exp = shape(res.exp);
    if (ch.type === 'drag' && !res.noPenalty) out.marks = ch.items.map(function (it, i) { return answer[i] === it.bin; });
    if (res.pass && ch.explain) out.explain = ch.explain;
    return out;
  }
  function grade(ch, answer) {
    if (ch.type === 'query' || ch.type === 'fix') return SQ.Grader.gradeSQL(ch, String(answer || '').slice(0, 5000));
    if (ch.type === 'drag') { answer = Array.isArray(answer) ? answer.slice(0, ch.items.length).map(function (v) { return v === null || v === undefined ? null : Number(v); }) : []; }
    if (ch.type === 'quiz') answer = answer === null || answer === undefined ? null : Number(answer);
    return Promise.resolve(SQ.Grader.gradeOther(ch, answer));
  }
  function cleanAnswer(ch, answer) {
    if (ch.type === 'drag') return Array.isArray(answer) ? answer.map(function (v) { return v === null || v === undefined ? null : Number(v); }) : [];
    if (ch.type === 'quiz') return answer === null || answer === undefined ? null : Number(answer);
    return answer;
  }
  function log(me, ch, f, res, answer, mode, seconds) {
    S.logSubmission({ userId: me.id, challengeId: ch.id, worldId: f && f.world ? f.world.id : null, levelId: f && f.level ? f.level.id : null, topic: ch.topic,
      ok: !!res.pass, category: res.pass ? null : res.category, feedback: String(res.message || '').slice(0, 300),
      query: typeof answer === 'string' ? answer.slice(0, 1500) : null, seconds: seconds, mode: mode });
  }

  var A = {};
  function def(name, roles, fn) { A[name] = { roles: roles, fn: fn }; }
  var ANY = ['student', 'teacher', 'admin'], STAFF = ['teacher', 'admin'], ADMIN = ['admin'], STUDENT = ['student'];

  /* ───────── public ───────── */
  def('register', null, function (p, c) {
    if (!S.settings().allowStudentSignup) fail('Sign-up is currently disabled. Ask your teacher or administrator for an account.');
    var u = makeUser({ username: p.username, password: p.password, displayName: p.displayName, role: 'student' }, c);
    var warn = null;
    if (str(p.code)) { var cl = db().classes.find(function (x) { return x.code === normCode(p.code); }); if (cl) u.classId = cl.id; else warn = 'Account created, but no class has that join code.'; }
    c.login(u.id);
    return { userId: u.id, warning: warn };
  });
  def('login', null, function (p, c) {
    var u = db().users.find(function (x) { return x.username === str(p.username, 40).toLowerCase(); });
    if (!u || !c.verify(u, String(p.password || ''))) fail('Wrong username or password.', 401);
    if (!u.active) fail('This account has been deactivated. Contact your administrator.', 403);
    c.login(u.id);
    return { userId: u.id };
  });

  /* ───────── any signed-in user ───────── */
  def('logout', null, function (p, c) { c.logout(); return {}; });
  def('updateProfile', ANY, function (p, c, me) {
    if (p.displayName !== undefined) me.displayName = str(p.displayName, 40) || me.displayName;
    if (p.avatar !== undefined) me.avatar = str(p.avatar, 8) || me.avatar;
    return {};
  });
  def('changePassword', ANY, function (p, c, me) {
    if (!c.verify(me, String(p.oldPassword || ''))) fail('Current password is wrong.');
    if (!p.newPassword || String(p.newPassword).length < 6) fail('Password must be at least 6 characters.');
    var h = c.hash(String(p.newPassword)); me.salt = h.salt; me.passHash = h.passHash;
    return {};
  });

  /* ───────── students ───────── */
  def('joinClass', STUDENT, function (p, c, me) {
    var cl = db().classes.find(function (x) { return x.code === normCode(p.code); });
    if (!cl) fail('No class found with that code.');
    me.classId = cl.id; return { name: cl.name };
  });
  def('lessonRead', ANY, function (p, c, me) { if (!levelExists(p.levelId)) fail('Unknown lesson.'); S.progress(me.id).lessons[p.levelId] = true; return {}; });
  def('openChallenge', ANY, function (p, c, me) { if (!E.find(p.id)) fail('Unknown challenge.'); S.progress(me.id).opened[p.id] = Date.now(); return {}; });
  def('hint', ANY, function (p, c, me) {
    var f = E.find(p.id); if (!f) fail('Unknown challenge.');
    var hints = f.ch.hints || [], pr = S.progress(me.id), have = pr.hints[p.id] || 0, cost = 0;
    if (p.buy) {
      if (f.boss) fail('No hints in boss battles!');
      if (have >= hints.length) fail('No more hints for this challenge.');
      cost = S.settings().hintCost; pr.hints[p.id] = have + 1; pr.xp = Math.max(0, pr.xp - cost); have++;
    }
    return { hints: hints.slice(0, have), total: hints.length, cost: cost };
  });

  def('submit', ANY, function (p, c, me) {
    var f = E.find(p.id); if (!f) fail('Unknown challenge.');
    if (f.boss) fail('Boss questions are answered in the boss battle.');
    if (f.team) fail('Team missions are submitted from the team page.');
    if (!E.levelUnlocked(me.id, f.world, f.world.levels.indexOf(f.level))) fail('This level is locked.', 403);
    var ch = f.ch, answer = cleanAnswer(ch, p.answer);
    return grade(ch, answer).then(function (res) {
      var pr = S.progress(me.id), opened = pr.opened[ch.id] || Date.now(), seconds = Math.max(1, Math.round((Date.now() - opened) / 1000));
      var out = publicResult(res, ch, answer);
      if (!res.noPenalty) log(me, ch, f, res, answer, 'practice', seconds);
      if (res.pass) {
        if (pr.completed[ch.id]) out.replay = true;
        else {
          var usedJoin = typeof answer === 'string' && /\bJOIN\b/i.test(SQ.Grader.strip(answer));
          out.reward = E.award(me.id, ch, { wrong: pr.fails[ch.id] || 0, seconds: seconds, usedJoin: usedJoin });
          if (typeof answer === 'string') pr.completed[ch.id].query = answer.slice(0, 1500);
        }
      } else if (!res.noPenalty) {
        pr.fails[ch.id] = (pr.fails[ch.id] || 0) + 1;
        if (pr.fails[ch.id] % S.settings().lives === 0 && !pr.completed[ch.id]) pr.retries[ch.id] = true; /* lost all lives → retry earns less */
      }
      return out;
    });
  });

  /* Boss battles: the session (time, lives, current question) lives on the server/backend, not the page. */
  def('bossStart', ANY, function (p, c, me) {
    var w = E.world(p.worldId); if (!w) fail('Unknown world.');
    if (!E.bossUnlocked(me.id, w)) fail('Complete every level in this world first.', 403);
    var limit = Math.round(w.boss.timeLimit * S.settings().bossTimeMultiplier);
    c.ephemeral['boss:' + me.id] = { worldId: w.id, start: Date.now(), limit: limit, lives: S.settings().lives, qi: 0 };
    return { limit: limit, lives: S.settings().lives, total: w.boss.challenges.length };
  });
  def('bossAnswer', ANY, function (p, c, me) {
    var key = 'boss:' + me.id, b = c.ephemeral[key];
    if (!b) fail('No boss battle in progress. Start the battle again.');
    var w = E.world(b.worldId), elapsed = (Date.now() - b.start) / 1000;
    if (elapsed > b.limit + 5) { delete c.ephemeral[key]; return { over: true, win: false, why: 'Time ran out!' }; }
    var ch = w.boss.challenges[b.qi], answer = cleanAnswer(ch, p.answer);
    return grade(ch, answer).then(function (res) {
      if (c.ephemeral[key] !== b) fail('This battle has ended.');
      var out = publicResult(res, ch, answer);
      if (!res.noPenalty) log(me, ch, { world: w }, res, answer, 'boss', Math.round(elapsed));
      if (res.pass) b.qi++; else if (!res.noPenalty) b.lives--;
      out.qi = b.qi; out.lives = b.lives; out.timeLeft = Math.max(0, Math.round(b.limit - elapsed));
      if (b.lives <= 0) { delete c.ephemeral[key]; out.over = true; out.win = false; out.why = 'You ran out of lives!'; }
      else if (b.qi >= w.boss.challenges.length) {
        delete c.ephemeral[key]; out.over = true; out.win = true;
        S.logSubmission({ userId: me.id, challengeId: w.boss.id, worldId: w.id, topic: 'boss', ok: true, seconds: Math.round(elapsed), mode: 'boss' });
        var pr = S.progress(me.id);
        if (me.role !== 'student') out.preview = true;
        else if (pr.bosses[w.id]) out.replay = true;
        else out.reward = E.awardBoss(me.id, w, { lives: b.lives, timeLeft: out.timeLeft, timeLimit: b.limit, seconds: Math.round(elapsed) });
      }
      return out;
    });
  });

  /* Peer review */
  def('reviewShare', STUDENT, function (p, c, me) {
    if (!me.classId) fail('Join a class first.');
    var done = S.progress(me.id).completed[p.challengeId];
    if (!done || !done.query) fail('Solve that challenge first.');
    db().reviews.push({ id: S.uid('r'), classId: me.classId, authorId: me.id, challengeId: p.challengeId, query: done.query, note: str(p.note, 140), createdAt: Date.now(), reviews: [] });
    return {};
  });
  def('reviewSubmit', STUDENT, function (p, c, me) {
    var r = db().reviews.find(function (x) { return x.id === p.reviewId; });
    if (!r || r.classId !== me.classId) fail('Review not found.', 404);
    if (r.authorId === me.id) fail('You cannot review your own query.');
    if (r.reviews.some(function (x) { return x.reviewerId === me.id; })) fail('You already reviewed this query.');
    var rating = Math.round(num(p.rating, 0, 5, 0)); if (rating < 1) fail('Pick a star rating.');
    var comment = str(p.comment, 500); if (!comment) fail('Write some feedback.');
    r.reviews.push({ reviewerId: me.id, rating: rating, comment: comment, at: Date.now() });
    var pr = S.progress(me.id); pr.reviewsGiven++;
    var xp = S.settings().reviewXP, nb = E.grantXP(me.id, xp); S.touchStreak(me.id);
    return { xp: xp, newBadges: nb };
  });

  /* Team missions */
  function myTeam(me) { return db().teams.find(function (t) { return t.memberIds.indexOf(me.id) >= 0; }); }
  def('teamDraft', STUDENT, function (p, c, me) {
    var t = myTeam(me); if (!t) fail('You are not in a team.');
    if (!SQ.TEAM_MISSIONS.some(function (m) { return m.id === p.missionId; })) fail('Unknown mission.');
    db().drafts[t.id + ':' + p.missionId] = { sql: String(p.sql || '').slice(0, 5000), by: me.id, at: Date.now() };
    return {};
  });
  def('teamSubmit', STUDENT, function (p, c, me) {
    var t = myTeam(me); if (!t) fail('You are not in a team.');
    if (t.leaderId !== me.id) fail('Only the team leader can submit.', 403);
    var m = SQ.TEAM_MISSIONS.find(function (x) { return x.id === p.missionId; }); if (!m) fail('Unknown mission.');
    if (t.done[m.id]) fail('Your team already completed this mission.');
    var sql = String(p.answer || '');
    return grade(m, sql).then(function (res) {
      var out = publicResult(res, m, sql);
      log(me, m, E.find(m.id), res, sql, 'team', null);
      if (res.pass && !t.done[m.id]) {
        t.done[m.id] = { at: Date.now(), by: me.id };
        t.memberIds.forEach(function (id) { var pr = S.progress(id); pr.xp += m.xp; pr.teamMissions++; var nb = E.checkBadges(id); if (id === me.id) out.reward = { base: m.xp, total: m.xp, newBadges: nb }; });
        S.touchStreak(me.id);
      }
      return out;
    });
  });

  /* ───────── teachers ───────── */
  def('classCreate', STAFF, function (p, c, me) {
    var name = str(p.name, 60); if (!name) fail('Give the class a name.');
    var cl = { id: S.uid('c'), name: name, teacherId: me.id, code: S.joinCode(), createdAt: Date.now() };
    db().classes.push(cl); return { id: cl.id, code: cl.code };
  });
  def('classRegen', STAFF, function (p, c, me) { var cl = classOf(p.id); if (!ownsClass(me, cl)) fail('Class not found.', 404); cl.code = S.joinCode(); return { code: cl.code }; });
  def('classDelete', STAFF, function (p, c, me) {
    var cl = classOf(p.id); if (!ownsClass(me, cl)) fail('Class not found.', 404);
    var d = db();
    d.users.forEach(function (u) { if (u.classId === cl.id) u.classId = null; });
    d.classes = d.classes.filter(function (x) { return x.id !== cl.id; });
    d.assignments = d.assignments.filter(function (a) { return a.classId !== cl.id; });
    d.teams = d.teams.filter(function (t) { return t.classId !== cl.id; });
    d.reviews = d.reviews.filter(function (r) { return r.classId !== cl.id; });
    return {};
  });
  def('classRemoveStudent', STAFF, function (p, c, me) {
    var u = S.user(p.userId); if (!u || !ownsClass(me, classOf(u.classId))) fail('Student not found.', 404);
    db().teams.forEach(function (t) { if (t.classId === u.classId) { t.memberIds = t.memberIds.filter(function (m) { return m !== u.id; }); if (t.leaderId === u.id) t.leaderId = t.memberIds[0] || null; } });
    u.classId = null; return {};
  });
  def('assignmentAdd', STAFF, function (p, c, me) {
    if (!ownsClass(me, classOf(p.classId))) fail('Class not found.', 404);
    if (!E.world(p.worldId)) fail('Unknown world.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.due || ''))) fail('Pick a due date.');
    db().assignments.push({ id: S.uid('a'), classId: p.classId, worldId: p.worldId, due: p.due, note: str(p.note, 140), unlock: !!p.unlock, createdAt: Date.now() });
    return {};
  });
  def('assignmentDelete', STAFF, function (p, c, me) {
    var a = db().assignments.find(function (x) { return x.id === p.id; }); if (!a || !ownsClass(me, classOf(a.classId))) fail('Assignment not found.', 404);
    db().assignments = db().assignments.filter(function (x) { return x.id !== p.id; }); return {};
  });
  def('teamCreate', STAFF, function (p, c, me) {
    if (!ownsClass(me, classOf(p.classId))) fail('Class not found.', 404);
    var name = str(p.name, 40); if (!name) fail('Give the team a name.');
    var ids = (Array.isArray(p.memberIds) ? p.memberIds : []).filter(function (id) { var u = S.user(id); return u && u.role === 'student' && u.classId === p.classId; });
    ids = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
    if (ids.length < 2) fail('Pick at least two members.');
    db().teams.forEach(function (t) { t.memberIds = t.memberIds.filter(function (id) { return ids.indexOf(id) < 0; }); if (ids.indexOf(t.leaderId) >= 0) t.leaderId = t.memberIds[0] || null; });
    db().teams.push({ id: S.uid('t'), classId: p.classId, name: name, memberIds: ids, leaderId: ids[0], done: {} });
    return {};
  });
  def('teamDelete', STAFF, function (p, c, me) {
    var t = db().teams.find(function (x) { return x.id === p.id; }); if (!t || !ownsClass(me, classOf(t.classId))) fail('Team not found.', 404);
    db().teams = db().teams.filter(function (x) { return x.id !== p.id; }); return {};
  });
  def('teamLeader', STAFF, function (p, c, me) {
    var t = db().teams.find(function (x) { return x.id === p.teamId; }); if (!t || !ownsClass(me, classOf(t.classId))) fail('Team not found.', 404);
    if (t.memberIds.indexOf(p.userId) < 0) fail('That student is not in the team.');
    t.leaderId = p.userId; return {};
  });

  function ownsContent(me, x) { return x && (me.role === 'admin' || x.authorId === me.id); }
  def('challengeSave', STAFF, function (p, c, me) {
    var d = db(), t = p.type;
    if (['query', 'fix', 'quiz', 'short'].indexOf(t) < 0) fail('Unknown challenge type.');
    if (!levelExists(p.levelId)) fail('Pick a level.');
    var o = { type: t, levelId: p.levelId, title: str(p.title, 60), prompt: str(p.prompt, 2000), xp: Math.round(num(p.xp, 5, 200, 20)), par: Math.round(num(p.par, 10, 900, 60)),
      topic: SQ.TOPICS[p.topic] ? p.topic : 'select', hints: (Array.isArray(p.hints) ? p.hints : []).map(function (h) { return str(h, 300); }).filter(Boolean).slice(0, 5),
      explain: str(p.explain, 300), published: p.published !== false, custom: true };
    if (!o.title || !o.prompt) fail('Title and question are required.');
    if (t === 'query' || t === 'fix') {
      o.solution = str(p.solution, 3000); o.ordered = !!p.ordered; if (t === 'fix') o.starter = String(p.starter || '').slice(0, 3000);
      if (!o.solution) fail('A model solution is required.');
      var bad = SQ.Grader.safety(o.solution, []); if (bad) fail('The solution must be a SELECT query: ' + bad);
    } else if (t === 'quiz') {
      o.options = (Array.isArray(p.options) ? p.options : []).map(function (x) { return str(x, 200); }).filter(Boolean).slice(0, 6);
      o.answer = Math.round(num(p.answer, 0, 5, 0));
      if (o.options.length < 2) fail('Give at least two options.'); if (o.answer >= o.options.length) fail('The correct option is empty.');
    } else {
      o.accept = (Array.isArray(p.accept) ? p.accept : []).map(function (x) { return str(x, 80).toLowerCase(); }).filter(Boolean).slice(0, 20);
      if (!o.accept.length) fail('Give at least one accepted answer.');
    }
    var check = o.solution ? SQ.Sandbox.run(o.solution) : Promise.resolve({});
    return check.then(function (r) {
      if (r.error) fail('Solution error: ' + r.error);
      if (p.id) {
        var ex = d.customChallenges.find(function (x) { return x.id === p.id; }); if (!ownsContent(me, ex)) fail('Challenge not found.', 404);
        Object.keys(ex).forEach(function (k) { if (['id', 'authorId', 'createdAt'].indexOf(k) < 0) delete ex[k]; });
        Object.assign(ex, o); return { id: ex.id };
      }
      o.id = S.uid('cc'); o.authorId = me.id; o.createdAt = Date.now(); d.customChallenges.push(o); return { id: o.id };
    });
  });
  def('challengeDelete', STAFF, function (p, c, me) {
    var ex = db().customChallenges.find(function (x) { return x.id === p.id; }); if (!ownsContent(me, ex)) fail('Challenge not found.', 404);
    db().customChallenges = db().customChallenges.filter(function (x) { return x.id !== p.id; }); return {};
  });
  def('lessonSave', STAFF, function (p, c, me) {
    if (!levelExists(p.levelId)) fail('Pick a level.');
    var o = { levelId: p.levelId, title: str(p.title, 80), body: str(p.body, 8000), example: str(p.example, 2000), published: p.published !== false, custom: true };
    if (!o.title || !o.body) fail('Title and lesson text are required.');
    if (o.example && SQ.Grader.safety(o.example, [])) fail('The example must be a SELECT query.');
    if (p.id) {
      var ex = db().customLessons.find(function (x) { return x.id === p.id; }); if (!ownsContent(me, ex)) fail('Lesson not found.', 404);
      Object.assign(ex, o); return { id: ex.id };
    }
    o.id = S.uid('cl'); o.authorId = me.id; db().customLessons.push(o); return { id: o.id };
  });
  def('lessonDelete', STAFF, function (p, c, me) {
    var ex = db().customLessons.find(function (x) { return x.id === p.id; }); if (!ownsContent(me, ex)) fail('Lesson not found.', 404);
    db().customLessons = db().customLessons.filter(function (x) { return x.id !== p.id; }); return {};
  });

  /* ───────── admins ───────── */
  function otherUser(me, id) { var u = S.user(id); if (!u) fail('User not found.', 404); if (u.id === me.id) fail('You cannot do that to your own account.'); return u; }
  def('userCreate', ADMIN, function (p, c) { var u = makeUser(p, c); return { id: u.id }; });
  def('userRole', ADMIN, function (p, c, me) { var u = otherUser(me, p.id); if (['student', 'teacher', 'admin'].indexOf(p.role) < 0) fail('Unknown role.'); u.role = p.role; return {}; });
  def('userActive', ADMIN, function (p, c, me) { var u = otherUser(me, p.id); u.active = !!p.active; if (!u.active && c.revoke) c.revoke(u.id); return {}; });
  def('userPassword', ADMIN, function (p, c, me) {
    var u = S.user(p.id); if (!u) fail('User not found.', 404);
    if (!p.password || String(p.password).length < 6) fail('Password must be at least 6 characters.');
    var h = c.hash(String(p.password)); u.salt = h.salt; u.passHash = h.passHash; if (c.revoke && u.id !== me.id) c.revoke(u.id); return {};
  });
  def('userDelete', ADMIN, function (p, c, me) {
    var u = otherUser(me, p.id), d = db(), id = u.id;
    d.users = d.users.filter(function (x) { return x.id !== id; }); delete d.progress[id];
    d.submissions = d.submissions.filter(function (s) { return s.userId !== id; });
    d.userBadges = d.userBadges.filter(function (x) { return x.userId !== id; });
    d.teams.forEach(function (t) { t.memberIds = t.memberIds.filter(function (m) { return m !== id; }); if (t.leaderId === id) t.leaderId = t.memberIds[0] || null; });
    d.reviews = d.reviews.filter(function (r) { return r.authorId !== id; });
    d.classes.forEach(function (cl) { if (cl.teacherId === id) cl.teacherId = me.id; });
    if (c.revoke) c.revoke(id);
    return {};
  });
  def('contentVisibility', ADMIN, function (p) {
    var d = db(), cc = d.customChallenges.find(function (x) { return x.id === p.id; });
    if (cc) cc.published = !!p.visible;
    else if (E.find(p.id)) { if (p.visible) delete d.hidden[p.id]; else d.hidden[p.id] = true; }
    else fail('Challenge not found.', 404);
    return {};
  });
  def('badgeUpdate', ADMIN, function (p) {
    var b = db().badges.find(function (x) { return x.id === p.id; }); if (!b) fail('Badge not found.', 404);
    if (p.icon !== undefined) b.icon = str(p.icon, 8) || b.icon;
    if (p.name !== undefined) b.name = str(p.name, 40) || b.name;
    if (p.desc !== undefined) b.desc = str(p.desc, 140);
    if (p.enabled !== undefined) b.disabled = !p.enabled;
    return {};
  });
  def('badgeAdd', ADMIN, function (p) {
    var types = ['xp', 'completed', 'streak', 'bosses', 'firstTry', 'reviews'];
    if (types.indexOf(p.type) < 0) fail('Unknown rule.');
    var b = { id: S.uid('b'), icon: str(p.icon, 8) || '🏆', name: str(p.name, 40), desc: str(p.desc, 140), rule: { type: p.type, value: Math.round(num(p.value, 1, 1e6, 1)) } };
    if (!b.name) fail('Give the badge a name.');
    db().badges.push(b);
    S.users().forEach(function (u) { if (u.role === 'student') E.checkBadges(u.id); });
    return {};
  });
  def('settingsSave', ADMIN, function (p) {
    var st = S.settings();
    if (p.platformName !== undefined) st.platformName = str(p.platformName, 40) || 'SQL Quest';
    [['lives', 1, 10], ['hintCost', 0, 100], ['speedBonusPct', 0, 100], ['accuracyBonusPct', 0, 100], ['retryPenaltyPct', 0, 100], ['reviewXP', 0, 100],
     ['bossTimeMultiplier', 0.5, 3], ['queryTimeoutMs', 500, 10000]].forEach(function (k) { if (p[k[0]] !== undefined) st[k[0]] = num(p[k[0]], k[1], k[2], st[k[0]]); });
    st.lives = Math.round(st.lives);
    if (Array.isArray(p.blocked)) st.blocked = p.blocked.map(function (x) { return str(x, 40); }).filter(Boolean).slice(0, 40);
    if (p.allowStudentSignup !== undefined) st.allowStudentSignup = !!p.allowStudentSignup;
    if (p.showDemoAccounts !== undefined) st.showDemoAccounts = !!p.showDemoAccounts;
    return {};
  });
  def('importData', ADMIN, function (p, c, me) {
    var d = p.data;
    if (!d || d.version !== 1 || !Array.isArray(d.users) || typeof d.progress !== 'object') fail('That is not a SQL Quest backup.');
    if (!d.users.some(function (u) { return u.role === 'admin' && u.active !== false; })) fail('The backup has no active admin account.');
    S.attach(S.clone(d));
    if (c.revokeAll) c.revokeAll();
    c.logout();
    return { imported: true };
  });
  def('resetPlatform', ADMIN, function (p, c) {
    if (!c.caps.allowReset) fail('Reset is disabled on this server (set ALLOW_DEMO_RESET=true to enable).', 403);
    S.attach(S.blank());
    A.seedDemo(c);
    if (c.revokeAll) c.revokeAll();
    c.logout();
    return {};
  });

  /* ───────── demo data (simulated class history so dashboards have data) ───────── */
  A.seedDemo = function (c) {
    var d = db();
    var admin = makeUser({ username: 'admin', password: 'admin123', displayName: 'Platform Admin', role: 'admin', avatar: '🛡️' }, c);
    var t = makeUser({ username: 'teacher', password: 'teacher123', displayName: 'Ms. Okoro', role: 'teacher', avatar: '🧑‍🏫' }, c);
    var c1 = { id: S.uid('c'), name: 'CSC 201 — Group A', teacherId: t.id, code: 'DBQ-201', createdAt: Date.now() };
    var c2 = { id: S.uid('c'), name: 'CSC 201 — Group B', teacherId: t.id, code: 'DBQ-202', createdAt: Date.now() };
    d.classes.push(c1, c2);
    d.assignments.push({ id: S.uid('a'), classId: c1.id, worldId: 'w2', due: S.today(new Date(Date.now() + 5 * 864e5)), note: 'Finish Query Canyon before Friday’s lab.', createdAt: Date.now() });
    d.assignments.push({ id: S.uid('a'), classId: c1.id, worldId: 'w3', due: S.today(new Date(Date.now() + 12 * 864e5)), note: 'Joins practice for the mid-term.', createdAt: Date.now() });
    var demo = [['student', 'Ada Student', c1, 8], ['amaka', 'Amaka O.', c1, 22], ['tunde', 'Tunde B.', c1, 14], ['zainab', 'Zainab M.', c1, 30],
      ['chinedu', 'Chinedu E.', c1, 6], ['fatima', 'Fatima B.', c1, 17], ['grace', 'Grace A.', c2, 12], ['ibrahim', 'Ibrahim S.', c2, 25],
      ['ngozi', 'Ngozi N.', c2, 4], ['samuel', 'Samuel A.', c2, 10]];
    d._seedPlan = demo.map(function (x) { var u = makeUser({ username: x[0], password: 'student123', displayName: x[1] }, c); u.classId = x[2].id; return { userId: u.id, steps: x[3] }; });
    d._seedTeam = { id: S.uid('t'), classId: c1.id, name: 'Query Queens & Kings', memberIds: [], leaderId: null, done: {} };
    d.teams.push(d._seedTeam);
    d.settings.showDemoAccounts = true;
    E.finishSeed();
    return admin;
  };

  /* ───────── runner ───────── */
  function run(name, payload, ctx) {
    var a = Object.prototype.hasOwnProperty.call(A, name) && A[name];
    if (!a || typeof a !== 'object' || !a.fn) return Promise.reject(Object.assign(new Error('Unknown action.'), { status: 404, expose: true }));
    try {
      var me = ctx.userId ? S.user(ctx.userId) : null;
      if (me && !me.active) me = null;
      if (a.roles) {
        if (!me) fail('Please log in.', 401);
        if (a.roles.indexOf(me.role) < 0) fail('Your role cannot do that.', 403);
      }
      return Promise.resolve(a.fn(payload || {}, ctx, me));
    } catch (e) { return Promise.reject(e); }
  }

  return { run: run, seedDemo: A.seedDemo, list: function () { return Object.keys(A).filter(function (k) { return A[k] && A[k].fn; }); } };
})();
