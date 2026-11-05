/* Teacher tools: classes & join codes, teams, assignments, analytics, lesson/challenge editor. */
window.SQ = window.SQ || {};

SQ.Teacher = (function () {
  var U = SQ.UI, S = SQ.Store, E = SQ.Engine, A = SQ.App, esc = U.esc;
  var T = ['teacher', 'admin'];

  function myClasses(me) { return S.classes().filter(function (c) { return me.role === 'admin' || c.teacherId === me.id; }); }
  function overallRate(an) { var t = 0, p = 0; an.subs.forEach(function (s) { t++; if (s.ok) p++; }); return t ? Math.round(100 * p / t) : 0; }

  function home(me) {
    var cls = myClasses(me);
    var allStudents = 0, totalSubs = 0;
    var cards = cls.map(function (c) {
      var an = E.classAnalytics(c.id); allStudents += an.students.length; totalSubs += an.subs.length;
      var avg = an.students.length ? Math.round(an.students.reduce(function (s, u) { return s + S.progress(u.id).xp; }, 0) / an.students.length) : 0;
      var topErr = Object.keys(an.errors).sort(function (a, b) { return an.errors[b] - an.errors[a]; })[0];
      return '<div class="card"><div class="card-head"><h3>🏫 ' + esc(c.name) + '</h3><span class="tag brand" title="Join code">' + esc(c.code) + '</span></div>' +
        '<div class="grid g3 keep2"><div class="stat"><span class="label">Students</span><span class="value">' + an.students.length + '</span></div><div class="stat"><span class="label">Avg XP</span><span class="value">' + avg + '</span></div><div class="stat"><span class="label">Pass rate</span><span class="value">' + overallRate(an) + '%</span></div></div>' +
        (topErr ? '<p style="margin-top:10px"><span class="tag warn">Most common error</span> ' + esc(SQ.ERROR_LABELS[topErr] || topErr) + '</p>' : '') +
        '<div class="btn-row" style="margin-top:10px"><a class="btn sm" href="#/teach/class/' + c.id + '">Manage class</a><a class="btn sm primary" href="#/teach/analytics/' + c.id + '">Analytics</a></div></div>';
    }).join('');
    A.view('<div class="page-head"><div><h1>Welcome, ' + esc(me.displayName) + '</h1><p>Track your classes, spot weak topics and create content.</p></div><div class="btn-row"><button class="btn primary" id="newc">+ New class</button><a class="btn" href="#/teach/content/new">+ New challenge</a></div></div>' +
      '<div class="grid g4 keep2" style="margin-bottom:16px"><div class="card stat"><span class="label">Classes</span><span class="value">' + cls.length + '</span></div><div class="card stat"><span class="label">Students</span><span class="value">' + allStudents + '</span></div><div class="card stat"><span class="label">Submissions</span><span class="value">' + totalSubs + '</span></div><div class="card stat"><span class="label">Custom challenges</span><span class="value">' + S.raw().customChallenges.filter(function (c) { return c.authorId === me.id; }).length + '</span></div></div>' +
      (cls.length ? '<div class="grid g2">' + cards + '</div>' : '<div class="card empty"><span class="big">🏫</span>Create your first class and share its join code with students.</div>'));
    U.$('#newc').onclick = newClass;
  }

  function newClass() {
    U.prompt('Create a class', 'Class name').then(function (n) {
      if (n === null) return;
      try { var c = S.createClass(S.current().id, n); U.toast('Class created — join code ' + c.code); A.go('#/teach/class/' + c.id); } catch (e) { U.toast(e.message); }
    });
  }

  A.route('/teach/classes', T, function (p, me) {
    var cls = myClasses(me);
    A.view('<div class="page-head"><div><h1>Classes</h1><p>Students join with the code. Share it on the board or in your class group.</p></div><button class="btn primary" id="newc">+ New class</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Class</th><th>Join code</th><th class="num">Students</th><th class="num">Teams</th><th></th></tr></thead><tbody>' +
      (cls.length ? cls.map(function (c) { var n = S.users().filter(function (u) { return u.classId === c.id; }).length; return '<tr><td><b>' + esc(c.name) + '</b></td><td><code>' + esc(c.code) + '</code></td><td class="num">' + n + '</td><td class="num">' + S.raw().teams.filter(function (t) { return t.classId === c.id; }).length + '</td><td style="text-align:right"><a class="btn sm" href="#/teach/class/' + c.id + '">Manage</a> <a class="btn sm" href="#/teach/analytics/' + c.id + '">Analytics</a></td></tr>'; }).join('') : '<tr><td colspan="5" class="empty">No classes yet.</td></tr>') +
      '</tbody></table></div>');
    U.$('#newc').onclick = newClass;
  });

  A.route('/teach/class/:id', T, function (p, me) {
    var db = S.raw(), c = db.classes.find(function (x) { return x.id === p.id; });
    if (!c || (me.role !== 'admin' && c.teacherId !== me.id)) return A.view('<div class="card empty">Class not found.</div>');
    var tab = 'students';
    function draw() {
      var students = S.users().filter(function (u) { return u.role === 'student' && u.classId === c.id; });
      var html = '';
      if (tab === 'students') {
        html = '<div class="table-wrap"><table><thead><tr><th>Student</th><th class="num">XP</th><th class="num">Level</th><th>Progress</th><th class="hide-sm">Weak topics</th><th class="hide-sm">Last active</th><th></th></tr></thead><tbody>' +
          (students.length ? students.map(function (u) {
            var pr = S.progress(u.id), done = Object.keys(pr.completed).length, total = E.allChallenges().length;
            var weak = E.weakTopics(u.id);
            return '<tr><td><span style="display:inline-flex;gap:8px;align-items:center"><span class="avatar" style="width:28px;height:28px;font-size:.95rem">' + esc(u.avatar) + '</span><span><b>' + esc(u.displayName) + '</b><br><small>@' + esc(u.username) + '</small></span></span></td><td class="num">' + pr.xp + '</td><td class="num">' + E.levelInfo(pr.xp).level + '</td>' +
              '<td style="min-width:140px"><div class="bar thin"><span style="width:' + Math.round(100 * done / total) + '%"></span></div><small>' + done + '/' + total + ' · ' + Object.keys(pr.bosses).length + ' bosses</small></td>' +
              '<td class="hide-sm">' + (weak.length ? weak.slice(0, 2).map(function (w) { return '<span class="tag warn">' + esc(w.label) + ' ' + w.rate + '%</span>'; }).join(' ') : '<span class="muted">—</span>') + '</td>' +
              '<td class="hide-sm">' + (pr.lastActive || '—') + '</td><td><button class="btn sm danger" data-rm="' + u.id + '">Remove</button></td></tr>';
          }).join('') : '<tr><td colspan="7" class="empty">No students yet — share the code <b>' + esc(c.code) + '</b>.</td></tr>') + '</tbody></table></div>';
      } else if (tab === 'assign') {
        var as = db.assignments.filter(function (a) { return a.classId === c.id; });
        html = '<div class="split"><div class="card"><h3>Current assignments</h3>' + (as.length ? '<div class="list">' + as.map(function (a) {
          var w = E.world(a.worldId), doneN = students.filter(function (u) { return E.worldProgress(u.id, w).pct === 100; }).length;
          return '<div class="list-item"><span class="world-ico wc-' + w.id + '" style="width:38px;height:38px">' + w.icon + '</span><div class="grow"><b>' + esc(w.name) + '</b> <span class="tag">Due ' + esc(a.due) + '</span>' + (a.unlock ? ' <span class="tag brand">Unlocked for class</span>' : '') + '<br><small>' + esc(a.note || '') + ' · ' + doneN + '/' + students.length + ' finished</small></div><button class="btn sm danger" data-del-a="' + a.id + '">Delete</button></div>';
        }).join('') + '</div>' : '<p class="muted">No assignments yet.</p>') + '</div>' +
          '<div class="card"><h3>Assign a world</h3><form id="af"><div class="field"><label>World</label><select id="af-w">' + SQ.WORLDS.map(function (w) { return '<option value="' + w.id + '">World ' + w.num + ': ' + w.name + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label>Due date</label><input type="date" id="af-d" required value="' + S.today(new Date(Date.now() + 7 * 864e5)) + '"></div><div class="field"><label>Note to students</label><input type="text" id="af-n" maxlength="140"></div>' +
          '<div class="field"><label class="check"><input type="checkbox" id="af-u"> Unlock this world now (skip earlier bosses)</label></div><button class="btn primary">Assign</button></form></div></div>';
      } else if (tab === 'teams') {
        var teams = db.teams.filter(function (t) { return t.classId === c.id; });
        html = '<div class="split"><div class="grid">' + (teams.length ? teams.map(function (t) {
          return '<div class="card"><div class="card-head"><h3>🤝 ' + esc(t.name) + '</h3><button class="btn sm danger" data-del-t="' + t.id + '">Delete</button></div><div class="list">' + t.memberIds.map(function (id) { var u = S.user(id); return u ? '<div class="list-item"><span class="avatar">' + esc(u.avatar) + '</span><span class="grow">' + esc(u.displayName) + '</span>' + (id === t.leaderId ? '<span class="tag xp">👑 Leader</span>' : '<button class="btn sm" data-lead="' + t.id + ':' + id + '">Make leader</button>') + '</div>' : ''; }).join('') + '</div><small>Missions done: ' + Object.keys(t.done).length + '/' + SQ.TEAM_MISSIONS.length + '</small></div>';
        }).join('') : '<div class="card empty">No teams yet.</div>') + '</div>' +
          '<div class="card"><h3>Create a team</h3><form id="tf"><div class="field"><label>Team name</label><input type="text" id="tf-n" required maxlength="40"></div><label>Members (first ticked becomes leader)</label><div style="max-height:260px;overflow:auto;margin-bottom:12px">' +
          students.map(function (u) { return '<label class="check" style="margin:6px 0"><input type="checkbox" value="' + u.id + '"> ' + esc(u.displayName) + '</label>'; }).join('') + '</div><button class="btn primary">Create team</button></form></div></div>';
      }
      U.$('#cv').innerHTML = html; bind();
    }
    function bind() {
      U.$all('[data-rm]').forEach(function (b) { b.onclick = function () { U.confirm('Remove this student from the class?', 'Remove', true).then(function (ok) { if (ok) { S.user(b.dataset.rm).classId = null; S.save(); draw(); } }); }; });
      var af = U.$('#af'); if (af) af.onsubmit = function (e) { e.preventDefault(); db.assignments.push({ id: S.uid('a'), classId: c.id, worldId: U.$('#af-w').value, due: U.$('#af-d').value, note: U.$('#af-n').value.trim(), unlock: U.$('#af-u').checked, createdAt: Date.now() }); S.save(); U.toast('World assigned'); draw(); };
      U.$all('[data-del-a]').forEach(function (b) { b.onclick = function () { db.assignments = db.assignments.filter(function (a) { return a.id !== b.dataset.delA; }); S.save(); draw(); }; });
      var tf = U.$('#tf'); if (tf) tf.onsubmit = function (e) {
        e.preventDefault();
        var ids = U.$all('input[type=checkbox]:checked', tf).map(function (i) { return i.value; });
        if (ids.length < 2) return U.toast('Pick at least two members.');
        db.teams.forEach(function (t) { t.memberIds = t.memberIds.filter(function (id) { return ids.indexOf(id) < 0; }); });
        db.teams.push({ id: S.uid('t'), classId: c.id, name: U.$('#tf-n').value.trim(), memberIds: ids, leaderId: ids[0], done: {} }); S.save(); draw();
      };
      U.$all('[data-del-t]').forEach(function (b) { b.onclick = function () { db.teams = db.teams.filter(function (t) { return t.id !== b.dataset.delT; }); S.save(); draw(); }; });
      U.$all('[data-lead]').forEach(function (b) { b.onclick = function () { var x = b.dataset.lead.split(':'); db.teams.find(function (t) { return t.id === x[0]; }).leaderId = x[1]; S.save(); draw(); }; });
    }
    A.view('<div class="crumbs"><a href="#/teach/classes">Classes</a> › ' + esc(c.name) + '</div><div class="page-head"><div><h1>' + esc(c.name) + '</h1><p>Join code: <code style="font-size:1.05rem">' + esc(c.code) + '</code> <button class="btn sm ghost" id="copy">📋 Copy</button> <button class="btn sm ghost" id="regen">↻ New code</button></p></div><div class="btn-row"><a class="btn primary" href="#/teach/analytics/' + c.id + '">📊 Analytics</a><button class="btn danger" id="delc">Delete class</button></div></div>' +
      U.tabs('ct', [['students', 'Students'], ['assign', 'Assignments'], ['teams', 'Teams']], tab) + '<div id="cv"></div>');
    U.$all('#ct button').forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; U.$all('#ct button').forEach(function (x) { x.classList.toggle('active', x === b); }); draw(); }; });
    U.$('#copy').onclick = function () { try { navigator.clipboard.writeText(c.code); U.toast('Copied ' + c.code); } catch (e) { U.toast(c.code); } };
    U.$('#regen').onclick = function () { var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = ''; for (var i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]; c.code = s.slice(0, 3) + '-' + s.slice(3); S.save(); A.render(); };
    U.$('#delc').onclick = function () { U.confirm('Delete this class? Students stay registered but leave the class.', 'Delete', true).then(function (ok) { if (!ok) return; S.users().forEach(function (u) { if (u.classId === c.id) u.classId = null; }); db.classes = db.classes.filter(function (x) { return x.id !== c.id; }); S.save(); A.go('#/teach/classes'); }); };
    draw();
  });

  /* Analytics */
  A.route('/teach/analytics', T, function (p, me) { var c = myClasses(me)[0]; if (c) A.go('#/teach/analytics/' + c.id); else A.view('<div class="card empty">Create a class first.</div>'); });
  A.route('/teach/analytics/:id', T, function (p, me) {
    var cls = myClasses(me), c = cls.find(function (x) { return x.id === p.id; });
    if (!c) return A.view('<div class="card empty">Class not found.</div>');
    var an = E.classAnalytics(c.id);
    var avgXP = an.students.length ? Math.round(an.students.reduce(function (s, u) { return s + S.progress(u.id).xp; }, 0) / an.students.length) : 0;
    var errs = Object.keys(an.errors).sort(function (a, b) { return an.errors[b] - an.errors[a]; }).slice(0, 8)
      .map(function (k) { return { label: SQ.ERROR_LABELS[k] || k, value: an.errors[k], display: String(an.errors[k]) }; });
    var worldRates = SQ.WORLDS.map(function (w) { var x = an.perWorld[w.id]; return { label: 'W' + w.num + ' ' + w.name, value: x ? Math.round(100 * x.pass / x.tries) : 0, display: x ? Math.round(100 * x.pass / x.tries) + '%' : '—' }; });
    var levelTimes = [];
    SQ.WORLDS.forEach(function (w) { w.levels.forEach(function (l, i) { var x = an.perLevel[l.id]; if (x) levelTimes.push({ label: 'W' + w.num + '.' + (i + 1) + ' ' + l.title, value: Math.round(x.total / x.n), display: fmtS(Math.round(x.total / x.n)) }); }); });
    var topics = Object.keys(an.topics).filter(function (k) { return SQ.TOPICS[k]; }).map(function (k) { var x = an.topics[k]; return { label: SQ.TOPICS[k], value: Math.round(100 * x.pass / x.tries), display: Math.round(100 * x.pass / x.tries) + '%', tries: x.tries }; }).sort(function (a, b) { return a.value - b.value; });
    var struggling = an.students.map(function (u) { var subs = an.subs.filter(function (s) { return s.userId === u.id; }), f = subs.filter(function (s) { return !s.ok; }).length; return { u: u, fails: f, rate: subs.length ? Math.round(100 * (subs.length - f) / subs.length) : null, weak: E.weakTopics(u.id) }; })
      .filter(function (x) { return x.rate !== null; }).sort(function (a, b) { return a.rate - b.rate; }).slice(0, 5);
    A.view('<div class="page-head"><div><h1>Class analytics</h1><p>Common errors, time per level and pass rates help you target weak topics.</p></div><select id="pick" style="width:auto">' + cls.map(function (x) { return '<option value="' + x.id + '"' + (x.id === c.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="grid g4 keep2" style="margin-bottom:16px"><div class="card stat"><span class="label">Students</span><span class="value">' + an.students.length + '</span></div><div class="card stat"><span class="label">Average XP</span><span class="value">' + avgXP + '</span></div><div class="card stat"><span class="label">Overall pass rate</span><span class="value">' + overallRate(an) + '%</span><span class="sub">of all attempts</span></div><div class="card stat"><span class="label">Attempts</span><span class="value">' + an.subs.length + '</span></div></div>' +
      '<div class="grid g2"><div class="card"><h3>❌ Most common errors</h3><p class="muted" style="margin-top:-4px">Number of failed attempts by auto-grader diagnosis.</p>' + U.hbars(errs.map(function (e) { e.color = 'var(--bad)'; return e; })) + '</div>' +
      '<div class="card"><h3>✅ Pass rate by world</h3><p class="muted" style="margin-top:-4px">Share of attempts that passed.</p>' + U.hbars(worldRates, { max: 100 }) + '</div>' +
      '<div class="card"><h3>⏱️ Average time to pass, per level</h3>' + U.hbars(levelTimes.map(function (x) { x.color = 'var(--w5)'; return x; })) + '</div>' +
      '<div class="card"><h3>🎯 Weakest topics</h3><p class="muted" style="margin-top:-4px">Lowest pass rate first — consider re-teaching these.</p>' + U.hbars(topics.slice(0, 7).map(function (x) { x.color = x.value < 60 ? 'var(--warn)' : 'var(--good)'; return x; }), { max: 100 }) + '</div></div>' +
      '<div class="card" style="margin-top:16px"><h3>🆘 Students who may need help</h3><div class="table-wrap"><table><thead><tr><th>Student</th><th class="num">Pass rate</th><th class="num">Failed attempts</th><th>Weak topics</th></tr></thead><tbody>' +
      (struggling.length ? struggling.map(function (x) { return '<tr><td>' + esc(x.u.avatar) + ' ' + esc(x.u.displayName) + '</td><td class="num">' + x.rate + '%</td><td class="num">' + x.fails + '</td><td>' + (x.weak.map(function (w) { return '<span class="tag warn">' + esc(w.label) + '</span>'; }).join(' ') || '—') + '</td></tr>'; }).join('') : '<tr><td colspan="4" class="empty">No attempts yet.</td></tr>') + '</tbody></table></div></div>');
    U.$('#pick').onchange = function () { A.go('#/teach/analytics/' + this.value); };
  });
  function fmtS(s) { return s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's'; }

  /* Content (lessons & challenges) */
  function levelOptions(sel) {
    return SQ.WORLDS.map(function (w) { return '<optgroup label="World ' + w.num + ': ' + w.name + '">' + w.levels.map(function (l) { return '<option value="' + l.id + '"' + (l.id === sel ? ' selected' : '') + '>' + esc(l.title) + '</option>'; }).join('') + '</optgroup>'; }).join('');
  }
  function levelName(id) { var r = ''; SQ.WORLDS.forEach(function (w) { w.levels.forEach(function (l) { if (l.id === id) r = 'W' + w.num + ' · ' + l.title; }); }); return r; }

  A.route('/teach/content', T, function (p, me) {
    var db = S.raw();
    var mine = function (x) { return me.role === 'admin' || x.authorId === me.id; };
    var chs = db.customChallenges.filter(mine), ls = db.customLessons.filter(mine);
    A.view('<div class="page-head"><div><h1>Content</h1><p>Create lessons and challenges. They appear inside the chosen level for every student.</p></div><div class="btn-row"><a class="btn primary" href="#/teach/content/new">+ New challenge</a><a class="btn" href="#/teach/lesson/new">+ New lesson</a></div></div>' +
      '<div class="card" style="margin-bottom:16px"><h3>Your challenges</h3><div class="table-wrap"><table><thead><tr><th>Title</th><th>Type</th><th>Level</th><th class="num">XP</th><th>Status</th><th></th></tr></thead><tbody>' +
      (chs.length ? chs.map(function (c) { return '<tr><td><b>' + esc(c.title) + '</b></td><td>' + SQ.typeIcon(c.type) + ' ' + SQ.typeName(c.type) + '</td><td>' + esc(levelName(c.levelId)) + '</td><td class="num">' + c.xp + '</td><td>' + (c.published === false ? '<span class="tag">Draft</span>' : '<span class="tag good">Published</span>') + '</td><td style="text-align:right"><a class="btn sm" href="#/play/' + c.id + '">Preview</a> <a class="btn sm" href="#/teach/content/' + c.id + '">Edit</a> <button class="btn sm danger" data-delc="' + c.id + '">Delete</button></td></tr>'; }).join('') : '<tr><td colspan="6" class="empty">No custom challenges yet.</td></tr>') +
      '</tbody></table></div></div>' +
      '<div class="card"><h3>Your lessons</h3><div class="table-wrap"><table><thead><tr><th>Title</th><th>Level</th><th>Status</th><th></th></tr></thead><tbody>' +
      (ls.length ? ls.map(function (l) { return '<tr><td><b>' + esc(l.title) + '</b></td><td>' + esc(levelName(l.levelId)) + '</td><td>' + (l.published === false ? '<span class="tag">Draft</span>' : '<span class="tag good">Published</span>') + '</td><td style="text-align:right"><a class="btn sm" href="#/lesson/' + l.levelId + '">Preview</a> <a class="btn sm" href="#/teach/lesson/' + l.id + '">Edit</a> <button class="btn sm danger" data-dell="' + l.id + '">Delete</button></td></tr>'; }).join('') : '<tr><td colspan="4" class="empty">No custom lessons yet.</td></tr>') +
      '</tbody></table></div></div>');
    U.$all('[data-delc]').forEach(function (b) { b.onclick = function () { U.confirm('Delete this challenge?', 'Delete', true).then(function (ok) { if (ok) { db.customChallenges = db.customChallenges.filter(function (c) { return c.id !== b.dataset.delc; }); S.save(); A.render(); } }); }; });
    U.$all('[data-dell]').forEach(function (b) { b.onclick = function () { U.confirm('Delete this lesson?', 'Delete', true).then(function (ok) { if (ok) { db.customLessons = db.customLessons.filter(function (c) { return c.id !== b.dataset.dell; }); S.save(); A.render(); } }); }; });
  });

  A.route('/teach/content/:id', T, function (p, me) {
    var db = S.raw(), isNew = p.id === 'new';
    var c = isNew ? { type: 'query', title: '', prompt: '', xp: 30, par: 90, levelId: 'w2l1', hints: [], options: ['', '', '', ''], answer: 0, accept: [], topic: 'select', published: true } : db.customChallenges.find(function (x) { return x.id === p.id; });
    if (!c || (!isNew && me.role !== 'admin' && c.authorId !== me.id)) return A.view('<div class="card empty">Challenge not found.</div>');
    A.view('<div class="crumbs"><a href="#/teach/content">Content</a> › ' + (isNew ? 'New challenge' : esc(c.title)) + '</div><h1>' + (isNew ? 'New challenge' : 'Edit challenge') + '</h1>' +
      '<form id="cf" class="split"><div class="card"><div class="grid g2"><div class="field"><label>Type</label><select id="f-type">' + ['query', 'fix', 'quiz', 'short'].map(function (t) { return '<option value="' + t + '"' + (c.type === t ? ' selected' : '') + '>' + SQ.typeName(t) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>Level</label><select id="f-level">' + levelOptions(c.levelId) + '</select></div></div>' +
      '<div class="field"><label>Title</label><input type="text" id="f-title" required maxlength="60" value="' + esc(c.title) + '"></div>' +
      '<div class="field"><label>Question / instructions <small>(supports **bold** and `code`)</small></label><textarea id="f-prompt" required>' + esc(c.prompt) + '</textarea></div>' +
      '<div id="sqlf"><div class="field" id="starter-f"><label>Broken starter query (shown to students)</label><textarea id="f-starter" style="font-family:var(--mono)">' + esc(c.starter || '') + '</textarea></div>' +
      '<div class="field"><label>Model solution (students’ results are compared with its result)</label><textarea id="f-sol" style="font-family:var(--mono)">' + esc(c.solution || '') + '</textarea></div>' +
      '<div class="field"><label class="check"><input type="checkbox" id="f-ord"' + (c.ordered ? ' checked' : '') + '> Row order matters (question asks for sorting)</label></div>' +
      '<div class="btn-row"><button type="button" class="btn sm" id="test">▶ Test solution in sandbox</button></div><div id="test-out" style="margin-top:10px"></div></div>' +
      '<div id="quizf"><label>Options (select the correct one)</label>' + [0, 1, 2, 3].map(function (i) { return '<div class="btn-row" style="margin-bottom:8px;flex-wrap:nowrap"><input type="radio" name="ans" value="' + i + '"' + (c.answer === i ? ' checked' : '') + ' style="width:18px;height:18px;accent-color:var(--brand)"><input type="text" class="opt" value="' + esc((c.options || [])[i] || '') + '" placeholder="Option ' + 'ABCD'[i] + '"></div>'; }).join('') + '</div>' +
      '<div id="shortf" class="field"><label>Accepted answers (comma separated, not case sensitive)</label><input type="text" id="f-accept" value="' + esc((c.accept || []).join(', ')) + '"></div>' +
      '<div class="field"><label>Explanation shown after a correct answer (optional)</label><input type="text" id="f-explain" value="' + esc(c.explain || '') + '"></div>' +
      '</div><div class="card"><div class="grid g2"><div class="field"><label>XP</label><input type="number" id="f-xp" min="5" max="200" value="' + c.xp + '"></div><div class="field"><label>Par time (seconds)</label><input type="number" id="f-par" min="10" max="900" value="' + (c.par || 90) + '"></div></div>' +
      '<div class="field"><label>Topic (for analytics)</label><select id="f-topic">' + Object.keys(SQ.TOPICS).map(function (k) { return '<option value="' + k + '"' + (c.topic === k ? ' selected' : '') + '>' + SQ.TOPICS[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>Hints (one per line)</label><textarea id="f-hints">' + esc((c.hints || []).join('\n')) + '</textarea></div>' +
      '<div class="field"><label class="check"><input type="checkbox" id="f-pub"' + (c.published !== false ? ' checked' : '') + '> Published (visible to students)</label></div>' +
      '<div id="ferr"></div><button class="btn primary lg" style="width:100%">Save challenge</button></div></form>');
    function toggle() {
      var t = U.$('#f-type').value;
      U.$('#sqlf').classList.toggle('hidden', t !== 'query' && t !== 'fix');
      U.$('#starter-f').classList.toggle('hidden', t !== 'fix');
      U.$('#quizf').classList.toggle('hidden', t !== 'quiz');
      U.$('#shortf').classList.toggle('hidden', t !== 'short');
    }
    U.$('#f-type').onchange = toggle; toggle();
    U.$('#test').onclick = function () {
      var sql = U.$('#f-sol').value, out = U.$('#test-out');
      var block = SQ.Grader.safety(sql, []); if (block) { out.innerHTML = '<div class="feedback bad">' + esc(block) + '</div>'; return; }
      SQ.Sandbox.run(sql).then(function (r) { out.innerHTML = r.error ? '<div class="feedback bad">' + esc(r.error) + '</div>' : U.resultTable(r.result, 15); });
    };
    U.$('#cf').onsubmit = function (e) {
      e.preventDefault();
      var t = U.$('#f-type').value, err = null;
      var o = { type: t, levelId: U.$('#f-level').value, title: U.$('#f-title').value.trim(), prompt: U.$('#f-prompt').value.trim(), xp: Math.max(5, Math.min(200, +U.$('#f-xp').value || 20)),
        par: Math.max(10, +U.$('#f-par').value || 60), topic: U.$('#f-topic').value, hints: U.$('#f-hints').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
        explain: U.$('#f-explain').value.trim(), published: U.$('#f-pub').checked, custom: true };
      if (t === 'query' || t === 'fix') {
        o.solution = U.$('#f-sol').value.trim(); o.ordered = U.$('#f-ord').checked; if (t === 'fix') o.starter = U.$('#f-starter').value;
        if (!o.solution) err = 'A model solution is required.'; else if (SQ.Grader.safety(o.solution, [])) err = 'The solution must be a SELECT query: ' + SQ.Grader.safety(o.solution, []);
      } else if (t === 'quiz') {
        o.options = U.$all('.opt').map(function (i) { return i.value.trim(); }).filter(Boolean);
        var r = document.querySelector('input[name=ans]:checked'); o.answer = r ? +r.value : 0;
        if (o.options.length < 2) err = 'Give at least two options.'; else if (o.answer >= o.options.length) err = 'The correct option is empty.';
      } else {
        o.accept = U.$('#f-accept').value.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
        if (!o.accept.length) err = 'Give at least one accepted answer.';
      }
      if (err) { U.$('#ferr').innerHTML = '<div class="form-error">' + esc(err) + '</div>'; return; }
      var finish = function () {
        if (isNew) { o.id = S.uid('cc'); o.authorId = me.id; o.createdAt = Date.now(); db.customChallenges.push(o); }
        else Object.assign(c, o);
        S.save(); U.toast('Challenge saved'); A.go('#/teach/content');
      };
      if (o.solution) SQ.Sandbox.run(o.solution).then(function (r) { if (r.error) U.$('#ferr').innerHTML = '<div class="form-error">Solution error: ' + esc(r.error) + '</div>'; else finish(); });
      else finish();
    };
  });

  A.route('/teach/lesson/:id', T, function (p, me) {
    var db = S.raw(), isNew = p.id === 'new';
    var l = isNew ? { title: '', body: '', example: '', levelId: 'w2l1', published: true } : db.customLessons.find(function (x) { return x.id === p.id; });
    if (!l || (!isNew && me.role !== 'admin' && l.authorId !== me.id)) return A.view('<div class="card empty">Lesson not found.</div>');
    A.view('<div class="crumbs"><a href="#/teach/content">Content</a> › ' + (isNew ? 'New lesson' : esc(l.title)) + '</div><h1>' + (isNew ? 'New lesson' : 'Edit lesson') + '</h1>' +
      '<form id="lf" class="split"><div class="card"><div class="field"><label>Level</label><select id="l-level">' + levelOptions(l.levelId) + '</select></div>' +
      '<div class="field"><label>Title</label><input type="text" id="l-title" required maxlength="80" value="' + esc(l.title) + '"></div>' +
      '<div class="field"><label>Lesson text <small>(blank line = new paragraph · **bold** · `code` · - bullet · ```code block```)</small></label><textarea id="l-body" required style="min-height:220px">' + esc(l.body) + '</textarea></div>' +
      '<div class="field"><label>Example query students can run (optional)</label><textarea id="l-ex" style="font-family:var(--mono);min-height:70px">' + esc(l.example || '') + '</textarea></div>' +
      '<div class="field"><label class="check"><input type="checkbox" id="l-pub"' + (l.published !== false ? ' checked' : '') + '> Published</label></div><button class="btn primary">Save lesson</button></div>' +
      '<div class="card"><span class="type-tag">Live preview</span><h2 id="pv-t" style="margin-top:6px"></h2><div id="pv" class="lesson-body"></div></div></form>');
    function pv() { U.$('#pv-t').textContent = U.$('#l-title').value; U.$('#pv').innerHTML = U.md(U.$('#l-body').value) + (U.$('#l-ex').value ? '<pre>' + esc(U.$('#l-ex').value) + '</pre>' : ''); }
    ['#l-title', '#l-body', '#l-ex'].forEach(function (s) { U.$(s).addEventListener('input', pv); }); pv();
    U.$('#lf').onsubmit = function (e) {
      e.preventDefault();
      var o = { levelId: U.$('#l-level').value, title: U.$('#l-title').value.trim(), body: U.$('#l-body').value, example: U.$('#l-ex').value.trim(), published: U.$('#l-pub').checked, custom: true };
      if (o.example && SQ.Grader.safety(o.example, [])) { U.toast('Example must be a SELECT query.'); return; }
      if (isNew) { o.id = S.uid('cl'); o.authorId = me.id; db.customLessons.push(o); } else Object.assign(l, o);
      S.save(); U.toast('Lesson saved'); A.go('#/teach/content');
    };
  });

  return { home: home };
})();
