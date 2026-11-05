/* Core app: UI helpers, router with role-based access control, shell, auth and student screens. */
window.SQ = window.SQ || {};

/* ───────────────────────── UI helpers ───────────────────────── */
SQ.UI = (function () {
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* Markdown-lite for teacher-authored text: escapes HTML first, then **bold**, `code`, ```blocks```, - lists, paragraphs. */
  function md(src) {
    var blocks = [];
    var s = esc(src || '').replace(/```(?:sql)?\n?([\s\S]*?)```/g, function (_, c) { blocks.push('<pre>' + c.replace(/\n$/, '') + '</pre>'); return '\u0000' + (blocks.length - 1) + '\u0000'; });
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<i>$2</i>');
    var out = s.split(/\n{2,}/).map(function (para) {
      para = para.trim(); if (!para) return '';
      if (/^\u0000\d+\u0000$/.test(para)) return para;
      if (/^[-*] /m.test(para) && para.split('\n').every(function (l) { return /^[-*] /.test(l); }))
        return '<ul>' + para.split('\n').map(function (l) { return '<li>' + l.slice(2) + '</li>'; }).join('') + '</ul>';
      return '<p>' + para.replace(/\n/g, '<br>') + '</p>';
    }).join('');
    return out.replace(/\u0000(\d+)\u0000/g, function (_, i) { return blocks[+i]; });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function toast(msg, ms) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(function () { t.remove(); }, ms || 2800);
  }
  function modal(html, opts) {
    opts = opts || {};
    var back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = '<div class="modal ' + (opts.wide ? 'wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(back);
    function close() { back.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); }
    function onKey(e) { if (e.key === 'Escape' && !opts.sticky) close(); }
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', function (e) { if (e.target === back && !opts.sticky) close(); });
    $all('[data-close]', back).forEach(function (b) { b.addEventListener('click', close); });
    var f = back.querySelector('input,textarea,select,.btn.primary'); if (f) setTimeout(function () { f.focus(); }, 30);
    return { el: back, close: close };
  }
  function confirmBox(msg, okLabel, danger) {
    return new Promise(function (res) {
      var m = modal('<h3>' + esc(msg) + '</h3><div class="btn-row" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-close>Cancel</button><button class="btn ' + (danger ? 'danger solid' : 'primary') + '" id="cb-ok">' + esc(okLabel || 'OK') + '</button></div>', { onClose: function () { res(false); } });
      $('#cb-ok', m.el).onclick = function () { m.el.remove(); res(true); };
    });
  }
  function promptBox(title, label, type) {
    return new Promise(function (res) {
      var m = modal('<h3>' + esc(title) + '</h3><form id="pb"><div class="field"><label>' + esc(label) + '</label><input type="' + (type || 'text') + '" id="pb-v" required></div><div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>', { onClose: function () { res(null); } });
      $('#pb', m.el).onsubmit = function (e) { e.preventDefault(); var v = $('#pb-v', m.el).value; m.el.remove(); res(v); };
    });
  }
  function confetti() {
    var c = document.createElement('div'); c.className = 'confetti';
    var cols = ['#5b4bdb', '#e8930c', '#16a34a', '#d14b9d', '#3b82c4', '#f7c948'];
    for (var i = 0; i < 70; i++) {
      var p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%'; p.style.background = cols[i % cols.length];
      p.style.animationDelay = Math.random() * .5 + 's'; p.style.animationDuration = 1.4 + Math.random() * 1.2 + 's';
      c.appendChild(p);
    }
    document.body.appendChild(c); setTimeout(function () { c.remove(); }, 3200);
  }
  function resultTable(r, limit) {
    if (!r) return '<div class="feedback info"><span class="fi">ℹ️</span><div>Statement ran. No rows were returned.</div></div>';
    limit = limit || 50;
    var rows = r.values.slice(0, limit);
    return '<div class="table-wrap"><table class="result-table"><thead><tr>' + r.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.map(function (row) { return '<tr>' + row.map(function (v) { return v === null ? '<td class="null">NULL</td>' : '<td>' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="' + r.columns.length + '" class="null">0 rows</td></tr>') +
      '</tbody></table></div><small>' + (r.total !== undefined ? r.total : r.values.length) + ' row(s)' + ((r.total || r.values.length) > limit ? ' — showing first ' + limit : '') + '</small>';
  }
  /* Horizontal bar chart (single series): one hue, values as text labels, hover titles. */
  function hbars(items, opts) {
    opts = opts || {};
    if (!items.length) return '<div class="empty"><span class="big">📊</span>No data yet.</div>';
    var max = opts.max || Math.max.apply(null, items.map(function (i) { return i.value; })) || 1;
    return '<div class="hbars" role="list">' + items.map(function (i) {
      var pct = Math.max(0, Math.min(100, 100 * i.value / max));
      return '<div class="hbar" role="listitem" title="' + esc(i.label + ': ' + i.display) + '"><span class="lab">' + esc(i.label) + '</span><span class="track"><span class="fill" style="width:' + pct + '%;' + (i.color ? 'background:' + i.color : '') + '"></span></span><span class="val">' + esc(i.display) + '</span></div>';
    }).join('') + '</div>';
  }
  function timeAgo(t) {
    if (!t) return 'never';
    var s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function tabs(id, list, active) {
    return '<div class="tabs" id="' + id + '" role="tablist">' + list.map(function (t) { return '<button role="tab" data-tab="' + t[0] + '" class="' + (t[0] === active ? 'active' : '') + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>';
  }
  function hearts(n, max) { var s = ''; for (var i = 0; i < max; i++) s += '<span class="' + (i < n ? '' : 'lost') + '">❤️</span>'; return '<span class="hearts" aria-label="' + n + ' of ' + max + ' lives">' + s + '</span>'; }
  return { esc: esc, md: md, $: $, $all: $all, toast: toast, modal: modal, confirm: confirmBox, prompt: promptBox, confetti: confetti, resultTable: resultTable, hbars: hbars, timeAgo: timeAgo, tabs: tabs, hearts: hearts };
})();

/* ───────────────────────── App / router ───────────────────────── */
SQ.App = (function () {
  var U = SQ.UI, S = SQ.Store, E = SQ.Engine, esc = U.esc;
  var routes = [];
  var cleanup = null;

  function route(pattern, roles, fn) {
    var keys = [];
    var re = new RegExp('^' + pattern.replace(/:(\w+)/g, function (_, k) { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ re: re, keys: keys, roles: roles, fn: fn });
  }
  function go(h) { if (location.hash === h) render(); else location.hash = h; }
  function onCleanup(fn) { cleanup = fn; }

  /* Every navigation is checked against the user's role (role-based access control). */
  function render() {
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    U.$all('.modal-back, .dropdown').forEach(function (m) { m.remove(); });
    var path = (location.hash || '#/').slice(1) || '/';
    var me = S.current();
    if (!me && !/^\/(login|register)$/.test(path)) { location.hash = '#/login'; return; }
    if (me && /^\/(login|register|)$/.test(path)) path = '/home';
    if (me && path === '/') path = '/home';
    for (var i = 0; i < routes.length; i++) {
      var m = path.match(routes[i].re);
      if (m) {
        if (routes[i].roles && (!me || routes[i].roles.indexOf(me.role) < 0)) { shell(me); view(denied()); return; }
        var params = {}; routes[i].keys.forEach(function (k, j) { params[k] = decodeURIComponent(m[j + 1]); });
        shell(me);
        window.scrollTo(0, 0);
        routes[i].fn(params, me);
        return;
      }
    }
    shell(me); view('<div class="card empty"><span class="big">🧭</span><h2>Page not found</h2><a class="btn" href="#/home">Go home</a></div>');
  }
  function denied() { return '<div class="card empty"><span class="big">🔒</span><h2>Access denied</h2><p>Your role does not have access to this page.</p><a class="btn" href="#/home">Go home</a></div>'; }
  function view(html) { U.$('#view').innerHTML = html; }

  var NAV = {
    student: [['#/home', 'Home'], ['#/map', 'Worlds'], ['#/leaderboard', 'Leaderboard'], ['#/badges', 'Badges'], ['#/review', 'Peer review'], ['#/team', 'Team']],
    teacher: [['#/home', 'Dashboard'], ['#/teach/classes', 'Classes'], ['#/teach/analytics', 'Analytics'], ['#/teach/content', 'Content'], ['#/map', 'Worlds'], ['#/leaderboard', 'Leaderboard']],
    admin: [['#/home', 'Overview'], ['#/admin/users', 'Users'], ['#/admin/content', 'Content'], ['#/admin/badges', 'Badges'], ['#/admin/settings', 'Settings'], ['#/map', 'Worlds']]
  };
  function shell(me) {
    var tb = U.$('#topbar');
    var name = esc(S.settings().platformName);
    if (!me) { tb.innerHTML = '<div class="topbar-in"><a class="brand" href="#/login"><span class="brand-logo">🗄️</span>' + name + '</a><span style="flex:1"></span>' + themeBtn() + '</div>'; bindTheme(); return; }
    var hash = location.hash.split('/').slice(0, 3).join('/');
    var p = S.progress(me.id), li = E.levelInfo(p.xp);
    var nav = NAV[me.role].map(function (n) { var act = location.hash === n[0] || (n[0] !== '#/home' && location.hash.indexOf(n[0]) === 0) || (n[0] === '#/map' && /#\/(world|lesson|play|boss)/.test(location.hash)); return '<a href="' + n[0] + '" class="' + (act ? 'active' : '') + '">' + n[1] + '</a>'; }).join('');
    tb.innerHTML = '<div class="topbar-in"><a class="brand" href="#/home"><span class="brand-logo">🗄️</span><span class="hide-sm">' + name + '</span></a>' +
      '<nav class="nav" aria-label="Main">' + nav + '</nav><div class="userchip">' +
      (me.role === 'student' ? '<span class="pill streak" title="Daily streak">🔥 ' + p.streak + '</span><span class="pill xp hide-sm" title="Level ' + li.level + '">⭐ ' + p.xp + ' XP</span>' : '<span class="pill role hide-sm">' + me.role + '</span>') +
      '<button class="menu-btn" id="menu-btn" aria-label="Account menu"><span class="avatar">' + esc(me.avatar) + '</span></button></div></div>';
    U.$('#menu-btn').onclick = function (e) {
      e.stopPropagation();
      var d = U.$('.dropdown'); if (d) { d.remove(); return; }
      d = document.createElement('div'); d.className = 'dropdown';
      d.innerHTML = '<div style="padding:8px 12px"><b>' + esc(me.displayName) + '</b><br><small>@' + esc(me.username) + ' · ' + me.role + '</small></div>' +
        '<a href="#/profile">👤 Profile & settings</a>' + (me.role === 'student' ? '<a href="#/badges">🏅 My badges</a>' : '') +
        '<button id="theme-dd">🌓 Toggle dark mode</button><button id="logout">🚪 Log out</button>';
      document.body.appendChild(d);
      U.$('#logout').onclick = function () { S.logout(); d.remove(); go('#/login'); };
      U.$('#theme-dd').onclick = function () { toggleTheme(); d.remove(); };
      setTimeout(function () { document.addEventListener('click', function h() { d.remove(); document.removeEventListener('click', h); }); }, 0);
    };
  }
  function themeBtn() { return '<button class="btn ghost sm" id="theme-btn" aria-label="Toggle dark mode">🌓</button>'; }
  function bindTheme() { var b = U.$('#theme-btn'); if (b) b.onclick = toggleTheme; }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    var next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('sqlquest_theme', next); } catch (e) {}
  }

  function start() {
    try { var t = localStorage.getItem('sqlquest_theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}
    E.finishSeed();
    window.addEventListener('hashchange', render);
    render();
  }

  return { route: route, go: go, render: render, view: view, start: start, onCleanup: onCleanup, refreshShell: function () { shell(S.current()); } };
})();

/* ───────────────────────── Auth screens ───────────────────────── */
(function () {
  var U = SQ.UI, S = SQ.Store, A = SQ.App, esc = U.esc;

  function authPage(mode) {
    var st = S.settings();
    var demo = st.showDemoAccounts ? '<div style="margin-top:18px"><label>Try a demo account</label><div class="demo-list">' +
      [['student', 'student123', 'Student'], ['teacher', 'teacher123', 'Teacher'], ['admin', 'admin123', 'Admin']].map(function (d) {
        return '<button type="button" data-u="' + d[0] + '" data-p="' + d[1] + '"><b>' + d[2] + '</b><small>' + d[0] + ' / ' + d[1] + '</small></button>';
      }).join('') + '</div></div>' : '';
    var form = mode === 'login' ?
      '<h2>Welcome back 👋</h2><p class="muted">Log in to continue your quest.</p><form id="auth-form"><div id="err"></div>' +
      '<div class="field"><label for="u">Username</label><input type="text" id="u" autocomplete="username" required></div>' +
      '<div class="field"><label for="p">Password</label><input type="password" id="p" autocomplete="current-password" required></div>' +
      '<button class="btn primary lg" style="width:100%">Log in</button></form>' +
      (st.allowStudentSignup ? '<p style="margin-top:14px;text-align:center">New here? <a href="#/register">Create a student account</a></p>' : '') + demo
      :
      '<h2>Join the quest 🚀</h2><p class="muted">Create a student account. Teachers get accounts from an administrator.</p><form id="auth-form"><div id="err"></div>' +
      '<div class="field"><label for="dn">Display name</label><input type="text" id="dn" maxlength="40" required></div>' +
      '<div class="field"><label for="u">Username</label><input type="text" id="u" autocomplete="username" required></div>' +
      '<div class="field"><label for="p">Password (min 6 characters)</label><input type="password" id="p" autocomplete="new-password" required minlength="6"></div>' +
      '<div class="field"><label for="code">Class join code (optional)</label><input type="text" id="code" placeholder="e.g. DBQ-201"></div>' +
      '<button class="btn primary lg" style="width:100%">Create account</button></form><p style="margin-top:14px;text-align:center">Already have an account? <a href="#/login">Log in</a></p>';
    A.view('<div class="auth"><div class="auth-hero"><span class="tag brand">Database learning, gamified</span><h1 style="margin-top:12px">Learn databases<br>by playing.</h1>' +
      '<p class="lead">Short lessons, real SQL challenges in a safe sandbox, instant feedback, boss battles and badges — across five worlds from tables to transactions.</p>' +
      '<div class="loop"><span>📖 Learn</span><span>🎮 Practise</span><span>✅ Instant feedback</span><span>⭐ Earn XP</span><span>🔓 Unlock</span></div>' +
      '<div class="grid g3 hide-sm" style="max-width:520px">' + SQ.WORLDS.slice(0, 3).map(function (w) { return '<div class="card flat wc-' + w.id + '" style="padding:12px"><span style="font-size:1.5rem">' + w.icon + '</span><br><b>' + w.name + '</b><br><small>' + w.focus + '</small></div>'; }).join('') + '</div></div>' +
      '<div class="card" style="padding:26px">' + form + '</div></div>');
    U.$all('.demo-list button').forEach(function (b) { b.onclick = function () { U.$('#u').value = b.dataset.u; U.$('#p').value = b.dataset.p; U.$('#auth-form').requestSubmit(); }; });
    U.$('#auth-form').onsubmit = function (e) {
      e.preventDefault();
      try {
        if (mode === 'login') S.login(U.$('#u').value, U.$('#p').value);
        else {
          if (!st.allowStudentSignup) throw new Error('Sign-up is currently disabled.');
          var u = S.createUser({ username: U.$('#u').value, password: U.$('#p').value, displayName: U.$('#dn').value });
          if (U.$('#code').value.trim()) { try { S.joinClass(u.id, U.$('#code').value); } catch (er) { U.toast('Account created, but: ' + er.message); } }
          S.login(U.$('#u').value, U.$('#p').value);
        }
        A.go('#/home');
      } catch (err) { U.$('#err').innerHTML = '<div class="form-error">' + esc(err.message) + '</div>'; }
    };
  }
  A.route('/login', null, function () { authPage('login'); });
  A.route('/register', null, function () { authPage('register'); });
})();

/* ───────────────────────── Student screens ───────────────────────── */
(function () {
  var U = SQ.UI, S = SQ.Store, E = SQ.Engine, A = SQ.App, esc = U.esc;

  A.route('/home', null, function (p, me) {
    if (me.role === 'teacher') return SQ.Teacher.home(me);
    if (me.role === 'admin') return SQ.Admin.home(me);
    studentHome(me);
  });

  function studentHome(me) {
    var p = S.progress(me.id), li = E.levelInfo(p.xp), next = E.nextStep(me.id), db = S.raw();
    var cls = me.classId && db.classes.find(function (c) { return c.id === me.classId; });
    var badges = E.userBadges(me.id).sort(function (a, b) { return b.at - a.at; });
    var weak = E.weakTopics(me.id);
    var assigns = cls ? db.assignments.filter(function (a) { return a.classId === cls.id; }) : [];
    var lb = E.leaderboard(cls ? cls.id : null), myRank = lb.findIndex(function (r) { return r.user.id === me.id; }) + 1;
    var practisedToday = p.lastActive === S.today();
    var nextHtml = next ? '<div class="next-card"><small>Up next · ' + esc(next.world.name) + '</small><div style="font:700 1.1rem var(--font-head);margin:4px 0 10px">' +
      (next.kind === 'lesson' ? '📖 Lesson: ' + esc(next.level.title) : next.kind === 'boss' ? '⚔️ Boss battle: ' + esc(next.world.boss.title) : '🎯 ' + esc(next.ch.title)) +
      '</div><a class="btn" href="' + next.href + '">Continue quest →</a></div>' : '<div class="next-card"><b>🏆 All worlds complete!</b><br><a class="btn" href="#/leaderboard" style="margin-top:8px">See the leaderboard</a></div>';

    A.view(
      '<div class="card hero"><div class="hero-row"><div><p class="muted" style="margin:0">Level ' + li.level + ' · ' + li.title + '</p><h1>Welcome back, ' + esc(me.displayName.split(' ')[0]) + '!</h1>' +
      '<p style="margin:0">' + (practisedToday ? '🔥 You practised today — streak safe at ' + p.streak + ' day' + (p.streak === 1 ? '' : 's') + '.' : (p.streak ? '🔥 Complete a challenge today to keep your ' + p.streak + '-day streak!' : '🔥 Complete a challenge today to start a streak!')) + '</p></div>' + nextHtml + '</div></div>' +
      '<div class="grid g4 keep2" style="margin-top:16px">' +
        '<div class="card stat"><span class="label">Total XP</span><span class="value" style="color:var(--xp)">' + p.xp + '</span><div class="bar xp thin" style="margin-top:6px"><span style="width:' + li.pct + '%"></span></div><span class="sub">' + (li.next - p.xp) + ' XP to level ' + (li.level + 1) + '</span></div>' +
        '<div class="card stat"><span class="label">Streak</span><span class="value">🔥 ' + p.streak + '</span><span class="sub">Best: ' + p.bestStreak + ' days</span></div>' +
        '<div class="card stat"><span class="label">Badges</span><span class="value">🏅 ' + badges.length + '</span><span class="sub">of ' + db.badges.filter(function (b) { return !b.disabled; }).length + ' available</span></div>' +
        '<div class="card stat"><span class="label">' + (cls ? 'Class rank' : 'Global rank') + '</span><span class="value">#' + (myRank || '–') + '</span><span class="sub">of ' + lb.length + ' players</span></div>' +
      '</div>' +
      '<div class="split" style="margin-top:16px"><div class="grid">' +
        '<div class="card"><div class="card-head"><h3>🗺️ Your worlds</h3><a href="#/map">Open map →</a></div>' +
        E.worlds().map(function (w) {
          var wp = E.worldProgress(me.id, w), un = E.worldUnlocked(me.id, w);
          return '<div class="world-row wc-' + w.id + '"><span class="world-ico">' + (un ? w.icon : '🔒') + '</span><div><b>World ' + w.num + ': ' + w.name + '</b> <small>· ' + w.topics + '</small><div class="bar thin" style="margin-top:6px"><span style="width:' + wp.pct + '%"></span></div></div><span class="tag ' + (wp.pct === 100 ? 'good' : '') + '">' + (un ? wp.pct + '%' : 'Locked') + '</span></div>';
        }).join('') + '</div>' +
        '<div class="card"><h3>📊 Progress dashboard</h3><div class="grid g3 keep2">' +
          '<div class="stat"><span class="label">Challenges</span><span class="value">' + Object.keys(p.completed).length + '</span></div>' +
          '<div class="stat"><span class="label">Bosses beaten</span><span class="value">' + Object.keys(p.bosses).length + '/5</span></div>' +
          '<div class="stat"><span class="label">First-try passes</span><span class="value">' + p.firstTry + '</span></div></div>' +
          '<h4 style="margin-top:14px">Topics to work on</h4>' + (weak.length ? U.hbars(weak.map(function (w) { return { label: w.label, value: w.rate, display: w.rate + '%', color: 'var(--warn)' }; }), { max: 100 }) + '<small>Pass rate per topic, from your attempts.</small>' : '<p class="muted">No weak topics yet — keep it up! 💪</p>') +
        '</div>' +
      '</div><div class="grid">' +
        (cls ? '' : '<div class="card"><h3>🏫 Join your class</h3><p class="muted">Enter the code from your teacher to see assignments and the class leaderboard.</p><form id="join" class="btn-row"><input type="text" id="jc" placeholder="DBQ-201" style="flex:1;min-width:120px"><button class="btn primary">Join</button></form></div>') +
        (assigns.length ? '<div class="card"><h3>📌 Assignments</h3><div class="list">' + assigns.map(function (a) {
          var w = E.world(a.worldId), wp = E.worldProgress(me.id, w);
          return '<div class="list-item"><span class="world-ico wc-' + w.id + '" style="width:36px;height:36px">' + w.icon + '</span><div class="grow"><b>' + esc(w.name) + '</b><br><small>' + esc(a.note || '') + '</small></div><div style="text-align:right"><span class="tag ' + (wp.pct === 100 ? 'good' : 'warn') + '">' + (wp.pct === 100 ? 'Done' : 'Due ' + esc(a.due)) + '</span></div></div>';
        }).join('') + '</div></div>' : '') +
        '<div class="card"><div class="card-head"><h3>🏆 ' + (cls ? esc(cls.name) : 'Leaderboard') + '</h3><a href="#/leaderboard">All →</a></div><div class="list">' +
          lb.slice(0, 5).map(function (r, i) { return '<div class="list-item" style="' + (r.user.id === me.id ? 'background:var(--brand-soft);border-radius:10px;padding-inline:8px' : '') + '"><span class="rank">' + (i + 1) + '</span><span class="avatar">' + esc(r.user.avatar) + '</span><span class="grow">' + esc(r.user.displayName) + '</span><b style="color:var(--xp)">' + r.xp + '</b></div>'; }).join('') + '</div></div>' +
        '<div class="card"><div class="card-head"><h3>🏅 Recent badges</h3><a href="#/badges">All →</a></div>' + (badges.length ? '<div class="btn-row">' + badges.slice(0, 6).map(function (b) { return '<span class="badge-mini" title="' + esc(b.name + ' — ' + b.desc) + '">' + b.icon + '</span>'; }).join('') + '</div>' : '<p class="muted">Pass your first challenge to earn a badge.</p>') + '</div>' +
      '</div></div>');
    var j = U.$('#join');
    if (j) j.onsubmit = function (e) { e.preventDefault(); try { var c = S.joinClass(me.id, U.$('#jc').value); U.toast('Joined ' + c.name + '!'); A.render(); } catch (er) { U.toast(er.message); } };
  }

  /* World map */
  A.route('/map', null, function (p, me) {
    var prog = S.progress(me.id);
    A.view('<div class="page-head"><div><h1>World map</h1><p>Each world ends with a timed boss battle. Beat it to unlock the next world.</p></div>' + (me.role !== 'student' ? '<span class="tag brand">Preview mode — everything unlocked</span>' : '') + '</div>' +
      '<div class="grid g2">' + E.worlds().map(function (w) {
        var un = E.worldUnlocked(me.id, w), wp = E.worldProgress(me.id, w);
        return '<div class="card world-card wc-' + w.id + ' ' + (un ? '' : 'locked') + '"><div class="wtitle"><span class="world-ico">' + w.icon + '</span><div style="flex:1"><small>WORLD ' + w.num + ' · ' + esc(w.focus.toUpperCase()) + '</small><h2 style="margin:0">' + esc(w.name) + '</h2></div><span class="tag">' + (un ? wp.done + '/' + wp.total : '🔒 Locked') + '</span></div>' +
          '<p class="muted" style="margin:0">' + esc(w.topics) + '</p><div class="bar thin" style="margin-top:10px"><span style="width:' + wp.pct + '%;background:var(--wc)"></span></div>' +
          '<div class="path">' + w.levels.map(function (l, i) {
            var lu = E.levelUnlocked(me.id, w, i), done = E.levelDone(prog, l);
            return '<div class="node ' + (done ? 'done ' : '') + (lu ? '' : 'locked') + '"><a class="dot" href="#/lesson/' + l.id + '" style="text-decoration:none">' + (done ? '✓' : (i + 1)) + '</a><div><a href="#/lesson/' + l.id + '" style="color:var(--ink);font-weight:600">' + esc(l.title) + '</a><div class="subnodes" style="margin-top:4px">' +
              '<a href="#/lesson/' + l.id + '" class="' + (prog.lessons[l.id] ? 'done' : '') + '">📖 Lesson</a>' +
              l.challenges.map(function (c) { return '<a href="#/play/' + c.id + '" class="' + (prog.completed[c.id] ? 'done' : '') + '">' + typeIcon(c.type) + ' ' + esc(c.title) + '</a>'; }).join('') + '</div></div><span>' + (lu ? '' : '🔒') + '</span></div>';
          }).join('') +
          '<a class="node boss ' + (prog.bosses[w.id] ? 'done ' : '') + (E.bossUnlocked(me.id, w) ? '' : 'locked') + '" href="#/boss/' + w.id + '"><span class="dot">' + (prog.bosses[w.id] ? '✓' : '⚔️') + '</span><div><b>Boss: ' + esc(w.boss.title) + '</b><br><small>' + w.boss.challenges.length + ' questions · ' + Math.round(w.boss.timeLimit * S.settings().bossTimeMultiplier / 60) + ' min · +' + w.boss.xp + ' XP</small></div><span>' + (E.bossUnlocked(me.id, w) ? '→' : '🔒') + '</span></a>' +
          '</div></div>';
      }).join('') + '</div>');
  });
  function typeIcon(t) { return { query: '⌨️', fix: '🛠️', quiz: '❓', short: '✍️', drag: '🧩' }[t] || '•'; }
  SQ.typeIcon = typeIcon;
  SQ.typeName = function (t) { return { query: 'Write a query', fix: 'Fix the query', quiz: 'Multiple choice', short: 'Short answer', drag: 'Drag & drop' }[t] || t; };

  /* Lesson */
  A.route('/lesson/:id', null, function (p, me) {
    var w, l, idx;
    E.worlds().forEach(function (ww) { ww.levels.forEach(function (ll, i) { if (ll.id === p.id) { w = ww; l = ll; idx = i; } }); });
    if (!l) return A.view('<div class="card empty">Lesson not found.</div>');
    if (!E.levelUnlocked(me.id, w, idx)) return A.view('<div class="card empty"><span class="big">🔒</span><h2>Locked</h2><p>Finish the previous level first.</p><a class="btn" href="#/map">Back to map</a></div>');
    var prog = S.progress(me.id);
    A.view('<div class="lesson wc-' + w.id + '"><div class="crumbs"><a href="#/map">Worlds</a> › ' + esc(w.name) + ' › Level ' + (idx + 1) + '</div>' +
      l.lessons.map(function (ls, i) {
        var body = ls.custom ? U.md(ls.body) : ls.body;
        return '<div class="card" style="margin-bottom:16px"><span class="type-tag">📖 Lesson' + (ls.custom ? ' · added by your teacher' : '') + '</span><h1 style="margin-top:6px">' + esc(ls.title || l.title) + '</h1><div class="lesson-body">' + body + '</div>' +
          (ls.example ? '<h3 style="margin-top:16px">Try it</h3><pre>' + esc(ls.example) + '</pre><button class="btn sm" data-try="' + i + '">▶ Run example</button><div id="try-' + i + '" style="margin-top:10px"></div>' : '') + '</div>';
      }).join('') +
      '<div class="card"><h3>Practise it</h3><div class="list">' + l.challenges.map(function (c) {
        return '<a class="list-item" href="#/play/' + c.id + '" style="color:var(--ink)"><span class="badge-mini" style="background:var(--brand-soft)">' + typeIcon(c.type) + '</span><span class="grow"><b>' + esc(c.title) + '</b><br><small>' + SQ.typeName(c.type) + ' · ' + (c.xp || 20) + ' XP</small></span>' + (prog.completed[c.id] ? '<span class="tag good">✓ Done</span>' : '<span class="btn sm primary">Start</span>') + '</a>';
      }).join('') + '</div></div></div>');
    if (!prog.lessons[l.id]) { prog.lessons[l.id] = true; S.save(); }
    U.$all('[data-try]').forEach(function (b) {
      b.onclick = function () {
        var i = +b.dataset.try, out = U.$('#try-' + i);
        out.innerHTML = '<small>Running…</small>';
        SQ.Sandbox.run(l.lessons[i].example).then(function (r) { out.innerHTML = r.error ? '<div class="feedback bad">' + esc(r.error) + '</div>' : U.resultTable(r.result, 20); });
      };
    });
  });

  /* Leaderboard */
  A.route('/leaderboard', null, function (p, me) {
    var db = S.raw();
    var myClass = me.classId && db.classes.find(function (c) { return c.id === me.classId; });
    var classes = me.role === 'teacher' ? db.classes.filter(function (c) { return c.teacherId === me.id; }) : me.role === 'admin' ? db.classes : (myClass ? [myClass] : []);
    var tabsList = classes.map(function (c) { return [c.id, c.name]; }).concat([['global', 'Global']]);
    var active = tabsList[0][0];
    function draw() {
      var rows = E.leaderboard(active === 'global' ? null : active);
      var top = rows.slice(0, 3), medals = ['🥇', '🥈', '🥉'];
      var order = [1, 0, 2];
      U.$('#lb').innerHTML = (top.length >= 3 ? '<div class="podium">' + order.map(function (i) { var r = top[i]; return '<div class="p' + (i + 1) + '"><div class="medal">' + medals[i] + '</div><span class="avatar lg" style="margin:6px auto">' + esc(r.user.avatar) + '</span><div class="nm">' + esc(r.user.displayName) + '</div><div style="color:var(--xp);font-weight:700">' + r.xp + ' XP</div><small>Level ' + r.level + '</small></div>'; }).join('') + '</div>' : '') +
        '<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th class="num">Level</th><th class="num">XP</th><th class="num hide-sm">Streak</th><th class="num hide-sm">Badges</th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (r, i) { return '<tr class="' + (r.user.id === me.id ? 'me' : '') + '"><td><span class="rank">' + (i + 1) + '</span></td><td><span style="display:inline-flex;gap:8px;align-items:center"><span class="avatar" style="width:28px;height:28px;font-size:.95rem">' + esc(r.user.avatar) + '</span>' + esc(r.user.displayName) + (r.user.id === me.id ? ' <span class="tag brand">You</span>' : '') + '</span></td><td class="num">' + r.level + '</td><td class="num"><b>' + r.xp + '</b></td><td class="num hide-sm">🔥 ' + r.streak + '</td><td class="num hide-sm">' + r.badges + '</td></tr>'; }).join('') : '<tr><td colspan="6" class="empty">No players yet.</td></tr>') +
        '</tbody></table></div>';
    }
    A.view('<div class="page-head"><div><h1>Leaderboard</h1><p>Class and global rankings by XP.</p></div></div>' + U.tabs('lbt', tabsList, active) + '<div id="lb"></div>');
    U.$all('#lbt button').forEach(function (b) { b.onclick = function () { active = b.dataset.tab; U.$all('#lbt button').forEach(function (x) { x.classList.toggle('active', x === b); }); draw(); }; });
    draw();
  });

  /* Badges */
  A.route('/badges', ['student'], function (p, me) {
    var mine = {}; E.userBadges(me.id).forEach(function (b) { mine[b.id] = b; });
    var all = S.raw().badges.filter(function (b) { return !b.disabled; });
    A.view('<div class="page-head"><div><h1>Badges</h1><p>' + Object.keys(mine).length + ' of ' + all.length + ' earned. Milestones unlock badges automatically.</p></div></div><div class="badge-grid">' +
      all.map(function (b) { var got = mine[b.id]; return '<div class="card badge-card ' + (got ? '' : 'locked') + '"><span class="bi">' + b.icon + '</span><b>' + esc(b.name) + '</b><br><small>' + esc(b.desc) + '</small><br>' + (got ? '<span class="tag good" style="margin-top:8px">Earned ' + new Date(got.at).toLocaleDateString() + '</span>' : '<span class="tag" style="margin-top:8px">🔒 Locked</span>') + '</div>'; }).join('') + '</div>');
  });

  /* Profile */
  A.route('/profile', null, function (p, me) {
    var prog = S.progress(me.id), li = E.levelInfo(prog.xp), db = S.raw();
    var cls = me.classId && db.classes.find(function (c) { return c.id === me.classId; });
    var days = '', set = {}; (prog.activeDays || []).forEach(function (d) { set[d] = 1; });
    for (var i = 27; i >= 0; i--) { var d = new Date(); d.setDate(d.getDate() - i); var k = S.today(d); days += '<span class="' + (set[k] ? 'on' : '') + '" title="' + k + '"></span>'; }
    var avatars = ['🦊', '🐼', '🦉', '🐯', '🐙', '🦄', '🐸', '🐨', '🦁', '🐧', '🐲', '🐝', '🧑‍🏫', '🛡️', '🤖', '👩‍💻', '👨‍💻', '🧙'];
    A.view('<div class="page-head"><div><h1>Profile & settings</h1></div></div><div class="split"><div class="grid">' +
      '<div class="card"><div style="display:flex;gap:16px;align-items:center"><span class="avatar lg">' + esc(me.avatar) + '</span><div><h2 style="margin:0">' + esc(me.displayName) + '</h2><small>@' + esc(me.username) + ' · <span class="tag brand">' + me.role + '</span>' + (cls ? ' · ' + esc(cls.name) : '') + '</small></div></div>' +
      (me.role === 'student' ? '<div class="grid g3 keep2" style="margin-top:16px"><div class="stat"><span class="label">Level</span><span class="value">' + li.level + '</span><span class="sub">' + li.title + '</span></div><div class="stat"><span class="label">XP</span><span class="value">' + prog.xp + '</span></div><div class="stat"><span class="label">Best streak</span><span class="value">' + prog.bestStreak + '</span></div></div>' +
        '<h4 style="margin-top:14px">Activity — last 4 weeks</h4><div class="days">' + days + '</div>' : '') + '</div>' +
      (me.role === 'student' ? '<div class="card"><h3>Completed by world</h3>' + U.hbars(E.worlds().map(function (w) { var wp = E.worldProgress(me.id, w); return { label: w.name, value: wp.pct, display: wp.done + '/' + wp.total, color: 'var(--' + w.id + ')' }; }), { max: 100 }) + '</div>' : '') +
      '</div><div class="grid">' +
      '<div class="card"><h3>Edit profile</h3><form id="pf"><div class="field"><label>Display name</label><input type="text" id="pf-dn" maxlength="40" value="' + esc(me.displayName) + '"></div><div class="field"><label>Avatar</label><div class="btn-row" id="avs">' + avatars.map(function (a) { return '<button type="button" class="btn sm ' + (a === me.avatar ? 'primary' : '') + '" data-av="' + a + '">' + a + '</button>'; }).join('') + '</div></div><button class="btn primary">Save</button></form></div>' +
      (me.role === 'student' ? '<div class="card"><h3>Class</h3>' + (cls ? '<p>You are in <b>' + esc(cls.name) + '</b>.</p>' : '<p class="muted">You are not in a class yet.</p>') + '<form id="jf" class="btn-row"><input type="text" id="jf-c" placeholder="Join code" style="flex:1;min-width:120px"><button class="btn">' + (cls ? 'Switch class' : 'Join') + '</button></form></div>' : '') +
      '<div class="card"><h3>Change password</h3><form id="pw"><div class="field"><label>Current password</label><input type="password" id="pw-o" required></div><div class="field"><label>New password</label><input type="password" id="pw-n" minlength="6" required></div><button class="btn">Update password</button></form></div>' +
      '</div></div>');
    var av = me.avatar;
    U.$all('#avs button').forEach(function (b) { b.onclick = function () { av = b.dataset.av; U.$all('#avs button').forEach(function (x) { x.classList.toggle('primary', x === b); }); }; });
    U.$('#pf').onsubmit = function (e) { e.preventDefault(); me.displayName = U.$('#pf-dn').value.trim().slice(0, 40) || me.displayName; me.avatar = av; S.save(); U.toast('Profile saved'); A.render(); };
    var jf = U.$('#jf'); if (jf) jf.onsubmit = function (e) { e.preventDefault(); try { var c = S.joinClass(me.id, U.$('#jf-c').value); U.toast('Joined ' + c.name); A.render(); } catch (er) { U.toast(er.message); } };
    U.$('#pw').onsubmit = function (e) {
      e.preventDefault();
      try { S.login(me.username, U.$('#pw-o').value); S.setPassword(me.id, U.$('#pw-n').value); U.toast('Password updated'); e.target.reset(); }
      catch (er) { U.toast(er.message === 'Wrong username or password.' ? 'Current password is wrong.' : er.message); }
    };
  });

  /* Peer review (students share a passed query; classmates review it anonymously for bonus XP). */
  A.route('/review', ['student'], function (p, me) {
    var db = S.raw(), prog = S.progress(me.id), tab = p.tab || 'review';
    function anon(uid) { var i = S.users().filter(function (u) { return u.classId === me.classId; }).findIndex(function (u) { return u.id === uid; }); return 'Classmate #' + (i + 1); }
    function draw() {
      var out = '';
      if (!me.classId) out = '<div class="card empty"><span class="big">🏫</span>Join a class to use peer review.</div>';
      else if (tab === 'review') {
        var pool = db.reviews.filter(function (r) { return r.classId === me.classId && r.authorId !== me.id; });
        out = pool.length ? '<div class="grid g2">' + pool.map(function (r) {
          var f = E.find(r.challengeId), mine = r.reviews.find(function (x) { return x.reviewerId === me.id; });
          return '<div class="card"><div class="card-head"><h3>' + esc(f ? f.ch.title : r.challengeId) + '</h3><small>' + anon(r.authorId) + ' · ' + U.timeAgo(r.createdAt) + '</small></div>' +
            (f ? '<small class="muted">' + f.ch.prompt.replace(/<[^>]+>/g, '') + '</small>' : '') + '<div class="code-snip">' + esc(r.query) + '</div>' + (r.note ? '<p>💬 “' + esc(r.note) + '”</p>' : '') +
            (mine ? '<div class="feedback good"><span class="fi">✅</span><div>You reviewed this (' + '★'.repeat(mine.rating) + '): ' + esc(mine.comment) + '</div></div>' :
              '<form data-rv="' + r.id + '"><label>Rating</label><div class="stars" data-stars>' + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-n="' + n + '">★</button>'; }).join('') + '</div><div class="field" style="margin-top:8px"><label>Feedback</label><textarea required maxlength="500" placeholder="What is good? What could be clearer or simpler?"></textarea></div><button class="btn primary sm">Submit review (+' + S.settings().reviewXP + ' XP)</button></form>') + '</div>';
        }).join('') + '</div>' : '<div class="card empty"><span class="big">🧐</span>No classmate queries waiting for review.</div>';
      } else if (tab === 'share') {
        var passed = Object.keys(prog.completed).map(function (id) { var f = E.find(id); return f && (f.ch.type === 'query' || f.ch.type === 'fix') && prog.completed[id].query ? f : null; }).filter(Boolean);
        out = '<div class="card" style="max-width:640px"><h3>Share a solved query for review</h3><p class="muted">Classmates see your query anonymously and give feedback. Only queries you choose to share are visible.</p>' +
          (passed.length ? '<form id="share"><div class="field"><label>Challenge</label><select id="sh-c">' + passed.map(function (f) { return '<option value="' + f.ch.id + '">' + esc(f.world.name + ' — ' + f.ch.title) + '</option>'; }).join('') + '</select></div><div class="field"><label>Your query</label><div class="code-snip" id="sh-q"></div></div><div class="field"><label>Question for reviewers (optional)</label><input type="text" id="sh-n" maxlength="140"></div><button class="btn primary">Share</button></form>' : '<p>Solve a SQL challenge first — your passing query can then be shared.</p>') + '</div>';
      } else {
        var mineList = db.reviews.filter(function (r) { return r.authorId === me.id; });
        out = mineList.length ? '<div class="grid g2">' + mineList.map(function (r) {
          var f = E.find(r.challengeId);
          return '<div class="card"><h3>' + esc(f ? f.ch.title : '') + '</h3><div class="code-snip">' + esc(r.query) + '</div>' + (r.reviews.length ? r.reviews.map(function (x) { return '<div class="list-item"><span>' + '★'.repeat(x.rating) + '</span><span class="grow">' + esc(x.comment) + '</span></div>'; }).join('') : '<p class="muted">No reviews yet.</p>') + '</div>';
        }).join('') + '</div>' : '<div class="card empty">You have not shared any queries yet.</div>';
      }
      U.$('#rv').innerHTML = out;
      bind();
    }
    function bind() {
      U.$all('[data-stars]').forEach(function (st) {
        st.dataset.v = 0;
        U.$all('button', st).forEach(function (b) { b.onclick = function () { st.dataset.v = b.dataset.n; U.$all('button', st).forEach(function (x) { x.classList.toggle('on', +x.dataset.n <= +b.dataset.n); }); }; });
      });
      U.$all('[data-rv]').forEach(function (f) {
        f.onsubmit = function (e) {
          e.preventDefault();
          var rating = +U.$('[data-stars]', f).dataset.v; if (!rating) return U.toast('Pick a star rating.');
          var r = db.reviews.find(function (x) { return x.id === f.dataset.rv; });
          r.reviews.push({ reviewerId: me.id, rating: rating, comment: U.$('textarea', f).value.trim().slice(0, 500), at: Date.now() });
          prog.reviewsGiven++; var nb = E.grantXP(me.id, S.settings().reviewXP); S.touchStreak(me.id);
          U.toast('+' + S.settings().reviewXP + ' XP for reviewing!' + (nb.length ? ' New badge: ' + nb.map(function (b) { return b.icon + ' ' + b.name; }).join(', ') : ''));
          A.refreshShell(); draw();
        };
      });
      var sh = U.$('#share');
      if (sh) {
        var upd = function () { U.$('#sh-q').textContent = prog.completed[U.$('#sh-c').value].query; };
        U.$('#sh-c').onchange = upd; upd();
        sh.onsubmit = function (e) {
          e.preventDefault(); var cid = U.$('#sh-c').value;
          db.reviews.push({ id: S.uid('r'), classId: me.classId, authorId: me.id, challengeId: cid, query: prog.completed[cid].query, note: U.$('#sh-n').value.trim(), createdAt: Date.now(), reviews: [] });
          S.save(); U.toast('Shared with your class'); tab = 'mine'; U.$all('#rvt button').forEach(function (x) { x.classList.toggle('active', x.dataset.tab === tab); }); draw();
        };
      }
    }
    A.view('<div class="page-head"><div><h1>Peer review</h1><p>Review a classmate’s query and earn bonus XP. Feedback is anonymous.</p></div></div>' + U.tabs('rvt', [['review', 'Review classmates'], ['share', 'Share a query'], ['mine', 'My shared queries']], tab) + '<div id="rv"></div>');
    U.$all('#rvt button').forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; U.$all('#rvt button').forEach(function (x) { x.classList.toggle('active', x === b); }); draw(); }; });
    draw();
  });
})();
