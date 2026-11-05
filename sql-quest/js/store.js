/* Data access layer. Works on one in-memory "db" object holding all platform data the current
 * user may see. It does not persist anything itself: js/backend.js loads the db (from localStorage
 * in browser-only mode, or from the server API), and the server keeps it in PostgreSQL.
 * This file is shared by the browser and the Node.js server. */
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
  var db = null, currentId = null;

  var DEFAULT_SETTINGS = {
    platformName: 'SQL Quest', lives: 3, hintCost: 5, speedBonusPct: 10, accuracyBonusPct: 20,
    retryPenaltyPct: 50, queryTimeoutMs: 2000, bossTimeMultiplier: 1, showDemoAccounts: true,
    allowStudentSignup: true, reviewXP: 15,
    blocked: ['DROP DATABASE', 'DROP TABLE', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'LOAD_EXTENSION', 'TRUNCATE']
  };
  var COLLECTIONS = { users: [], classes: [], progress: {}, submissions: [], userBadges: [], badges: null, settings: {}, customLessons: [],
    customChallenges: [], hidden: {}, reviews: [], teams: [], assignments: [], drafts: {} };

  function uid(p) {
    var r = '';
    try { var a = new Uint8Array(8); (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto).getRandomValues(a); for (var i = 0; i < a.length; i++) r += (a[i] % 36).toString(36); }
    catch (e) { r = Math.random().toString(36).slice(2, 10); }
    return (p || 'id') + '_' + r + Date.now().toString(36).slice(-4);
  }
  function today(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  /* Browser-only mode password hash (salted, iterated SHA-256). The server uses scrypt instead. */
  function hashLocal(salt, pw) { var h = salt + ':' + pw; for (var i = 0; i < 200; i++) h = SQ.sha256(salt + h); return 'sha$' + h; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function blank() {
    var b = { version: 1 };
    Object.keys(COLLECTIONS).forEach(function (k) { b[k] = clone(COLLECTIONS[k] || []); });
    b.badges = clone(SQ.DEFAULT_BADGES); b.settings = clone(DEFAULT_SETTINGS);
    return b;
  }
  /* Attach a db object (fills in anything missing so partial server views are safe to read). */
  function attach(d, meId) {
    d = d || {};
    Object.keys(COLLECTIONS).forEach(function (k) { if (d[k] === undefined || d[k] === null) d[k] = k === 'badges' ? clone(SQ.DEFAULT_BADGES) : clone(COLLECTIONS[k]); });
    d.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings);
    d.version = 1;
    db = d;
    if (meId !== undefined) currentId = meId;
    return db;
  }

  function newProgress() { return { xp: 0, completed: {}, bosses: {}, streak: 0, bestStreak: 0, lastActive: null, hints: {}, lessons: {}, firstTry: 0, speed: 0, retries: {}, fails: {}, opened: {}, reviewsGiven: 0, teamMissions: 0, activeDays: [] }; }
  function pickAvatar(s) { var a = ['🦊', '🐼', '🦉', '🐯', '🐙', '🦄', '🐸', '🐨', '🦁', '🐧', '🐲', '🐝']; var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return a[h % a.length]; }
  function user(id) { return db.users.find(function (u) { return u.id === id; }); }
  function current() { var u = currentId && user(currentId); return u && u.active ? u : null; }
  function progress(id) {
    if (!db.progress[id]) db.progress[id] = newProgress();
    var p = db.progress[id], np = newProgress();
    Object.keys(np).forEach(function (k) { if (p[k] === undefined) p[k] = np[k]; });
    var y = new Date(); y.setDate(y.getDate() - 1);
    if (p.streak && (!p.lastActive || p.lastActive < today(y))) p.streak = 0; /* a missed day breaks the streak */
    return p;
  }
  function joinCode() {
    var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s;
    do { s = ''; for (var i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]; s = s.slice(0, 3) + '-' + s.slice(3); }
    while (db.classes.some(function (x) { return x.code === s; }));
    return s;
  }
  function touchStreak(userId) {
    var p = progress(userId), t = today();
    if (p.lastActive === t) return false;
    var y = new Date(); y.setDate(y.getDate() - 1);
    p.streak = p.lastActive === today(y) ? p.streak + 1 : 1;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
    p.lastActive = t;
    p.activeDays = (p.activeDays || []).concat([t]).slice(-60);
    return true;
  }
  function logSubmission(s) {
    s.id = uid('sub'); s.at = s.at || Date.now();
    db.submissions.push(s);
    return s;
  }

  return {
    attach: attach, blank: blank, raw: function () { return db; }, save: function () {}, uid: uid, today: today, clone: clone,
    hashLocal: hashLocal, pickAvatar: pickAvatar, joinCode: joinCode, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    settings: function () { return db.settings; }, users: function () { return db.users; }, user: user, current: current,
    currentId: function () { return currentId; }, setCurrent: function (id) { currentId = id; },
    progress: progress, classes: function () { return db.classes; }, newProgress: newProgress,
    touchStreak: touchStreak, logSubmission: logSubmission
  };
})();
