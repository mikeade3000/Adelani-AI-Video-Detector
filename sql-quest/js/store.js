/* Data layer. All platform data (users, classes, progress, submissions, badges, content, settings)
 * is stored in the browser's localStorage under one key. Swap this module for REST calls to move
 * to a shared server backend — the rest of the app only talks to SQ.Store. */
window.SQ = window.SQ || {};

/* Compact SHA-256 (public-domain style implementation) — used to hash salted passwords. */
SQ.sha256 = function (ascii) {
  function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
  var mp = Math.pow, maxWord = mp(2, 32), result = '', words = [], i, j;
  ascii = unescape(encodeURIComponent(ascii));
  var bitLen = ascii.length * 8, hash = [], k = [], primeCounter = 0, isComposite = {};
  for (var c = 2; primeCounter < 64; c++) {
    if (!isComposite[c]) {
      for (i = 0; i < 313; i += c) isComposite[i] = c;
      hash[primeCounter] = (mp(c, .5) * maxWord) | 0;
      k[primeCounter++] = (mp(c, 1 / 3) * maxWord) | 0;
    }
  }
  hash = hash.slice(0, 8);
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++) { j = ascii.charCodeAt(i); words[i >> 2] |= j << ((3 - i) % 4) * 8; }
  words[words.length] = ((bitLen / maxWord) | 0); words[words.length] = bitLen;
  for (j = 0; j < words.length;) {
    var w = words.slice(j, j += 16), oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
      var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
        (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
      var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(t1 + t2) | 0].concat(hash); hash[4] = (hash[4] + t1) | 0;
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); }
  return result;
};

SQ.Store = (function () {
  var KEY = 'sqlquest_v1', SESSION = 'sqlquest_session';
  var db = null;

  var DEFAULT_SETTINGS = {
    platformName: 'SQL Quest', lives: 3, hintCost: 5, speedBonusPct: 10, accuracyBonusPct: 20,
    retryPenaltyPct: 50, queryTimeoutMs: 2000, bossTimeMultiplier: 1, showDemoAccounts: true,
    allowStudentSignup: true, reviewXP: 15,
    blocked: ['DROP DATABASE', 'DROP TABLE', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'LOAD_EXTENSION', 'TRUNCATE']
  };

  function uid(p) { return (p || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }
  function today(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hashPw(salt, pw) { var h = salt + ':' + pw; for (var i = 0; i < 200; i++) h = SQ.sha256(salt + h); return h; }

  function blank() {
    return { version: 1, users: [], classes: [], progress: {}, submissions: [], userBadges: [], badges: JSON.parse(JSON.stringify(SQ.DEFAULT_BADGES)),
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), customLessons: [], customChallenges: [], hidden: {},
      reviews: [], teams: [], assignments: [], drafts: {} };
  }

  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db || db.version !== 1) { db = blank(); seed(); save(); }
    db.settings = Object.assign({}, DEFAULT_SETTINGS, db.settings);
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('Could not save', e); } }

  /* ───────── users & auth ───────── */
  function createUser(o) {
    var uname = String(o.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,24}$/.test(uname)) throw new Error('Username must be 3–24 letters, numbers, dots, dashes or underscores.');
    if (db.users.some(function (u) { return u.username === uname; })) throw new Error('That username is taken.');
    if (!o.password || o.password.length < 6) throw new Error('Password must be at least 6 characters.');
    var salt = uid('s');
    var u = { id: uid('u'), username: uname, displayName: (o.displayName || uname).trim().slice(0, 40), role: o.role || 'student',
      salt: salt, passHash: hashPw(salt, o.password), classId: null, active: true, createdAt: Date.now(), avatar: o.avatar || pickAvatar(uname) };
    db.users.push(u);
    db.progress[u.id] = newProgress();
    save();
    return u;
  }
  function pickAvatar(s) { var a = ['🦊', '🐼', '🦉', '🐯', '🐙', '🦄', '🐸', '🐨', '🦁', '🐧', '🐲', '🐝']; var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return a[h % a.length]; }
  function newProgress() { return { xp: 0, completed: {}, bosses: {}, streak: 0, bestStreak: 0, lastActive: null, hints: {}, lessons: {}, firstTry: 0, speed: 0, retries: {}, reviewsGiven: 0, teamMissions: 0, activeDays: [] }; }
  function login(username, password) {
    var u = db.users.find(function (x) { return x.username === String(username).trim().toLowerCase(); });
    if (!u || u.passHash !== hashPw(u.salt, password)) throw new Error('Wrong username or password.');
    if (!u.active) throw new Error('This account has been deactivated. Contact your administrator.');
    sessionSet(u.id);
    return u;
  }
  function setPassword(userId, pw) {
    if (!pw || pw.length < 6) throw new Error('Password must be at least 6 characters.');
    var u = user(userId); u.salt = uid('s'); u.passHash = hashPw(u.salt, pw); save();
  }
  function sessionSet(id) { try { if (id) localStorage.setItem(SESSION, id); else localStorage.removeItem(SESSION); } catch (e) {} }
  function current() { var id; try { id = localStorage.getItem(SESSION); } catch (e) {} var u = id && user(id); return u && u.active ? u : null; }
  function user(id) { return db.users.find(function (u) { return u.id === id; }); }
  function progress(id) {
    if (!db.progress[id]) db.progress[id] = newProgress();
    var p = db.progress[id], y = new Date(); y.setDate(y.getDate() - 1);
    if (p.streak && (!p.lastActive || p.lastActive < today(y))) p.streak = 0; /* a missed day breaks the streak */
    return p;
  }

  /* ───────── classes ───────── */
  function joinCode() { var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = ''; for (var i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]; return s.slice(0, 3) + '-' + s.slice(3); }
  function createClass(teacherId, name) {
    if (!name || !name.trim()) throw new Error('Give the class a name.');
    var c = { id: uid('c'), name: name.trim().slice(0, 60), teacherId: teacherId, code: joinCode(), createdAt: Date.now() };
    db.classes.push(c); save(); return c;
  }
  function joinClass(userId, code) {
    code = String(code || '').trim().toUpperCase();
    if (code.length === 6 && code.indexOf('-') < 0) code = code.slice(0, 3) + '-' + code.slice(3);
    var c = db.classes.find(function (x) { return x.code === code; });
    if (!c) throw new Error('No class found with that code.');
    user(userId).classId = c.id; save(); return c;
  }

  /* ───────── activity ───────── */
  function touchStreak(userId) {
    var p = progress(userId), t = today();
    if (p.lastActive === t) return false;
    var y = new Date(); y.setDate(y.getDate() - 1);
    p.streak = p.lastActive === today(y) ? p.streak + 1 : 1;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
    p.lastActive = t;
    p.activeDays = (p.activeDays || []).concat([t]).slice(-60);
    save(); return true;
  }
  function logSubmission(s) {
    s.id = uid('sub'); s.at = s.at || Date.now();
    db.submissions.push(s);
    if (db.submissions.length > 8000) db.submissions.splice(0, db.submissions.length - 8000);
    save(); return s;
  }

  /* ───────── demo seed ───────── */
  function seed() {
    var admin = createUser({ username: 'admin', password: 'admin123', displayName: 'Platform Admin', role: 'admin', avatar: '🛡️' });
    var t = createUser({ username: 'teacher', password: 'teacher123', displayName: 'Ms. Okoro', role: 'teacher', avatar: '🧑‍🏫' });
    var c1 = createClass(t.id, 'CSC 201 — Group A'); c1.code = 'DBQ-201';
    var c2 = createClass(t.id, 'CSC 201 — Group B'); c2.code = 'DBQ-202';
    db.assignments.push({ id: uid('a'), classId: c1.id, worldId: 'w2', due: today(new Date(Date.now() + 5 * 864e5)), note: 'Finish Query Canyon before Friday’s lab.', createdAt: Date.now() });
    db.assignments.push({ id: uid('a'), classId: c1.id, worldId: 'w3', due: today(new Date(Date.now() + 12 * 864e5)), note: 'Joins practice for the mid-term.', createdAt: Date.now() });
    var demo = [
      ['student', 'Ada Student', c1, 8], ['amaka', 'Amaka O.', c1, 22], ['tunde', 'Tunde B.', c1, 14], ['zainab', 'Zainab M.', c1, 30],
      ['chinedu', 'Chinedu E.', c1, 6], ['fatima', 'Fatima B.', c1, 17], ['grace', 'Grace A.', c2, 12], ['ibrahim', 'Ibrahim S.', c2, 25],
      ['ngozi', 'Ngozi N.', c2, 4], ['samuel', 'Samuel A.', c2, 10]
    ];
    db._seedPlan = demo.map(function (d) {
      var u = createUser({ username: d[0], password: 'student123', displayName: d[1] });
      u.classId = d[2].id;
      return { userId: u.id, steps: d[3] };
    });
    var team = { id: uid('t'), classId: c1.id, name: 'Query Queens & Kings', memberIds: [], leaderId: null, done: {} };
    db._seedTeam = team;
    db.teams.push(team);
  }

  function resetAll() { try { localStorage.removeItem(KEY); localStorage.removeItem(SESSION); } catch (e) {} load(); }

  load();

  return {
    raw: function () { return db; }, save: save, uid: uid, today: today,
    settings: function () { return db.settings; },
    users: function () { return db.users; }, user: user, current: current, createUser: createUser, login: login,
    logout: function () { sessionSet(null); }, setPassword: setPassword, sessionSet: sessionSet,
    progress: progress, classes: function () { return db.classes; }, createClass: createClass, joinClass: joinClass,
    touchStreak: touchStreak, logSubmission: logSubmission, resetAll: resetAll, newProgress: newProgress
  };
})();
