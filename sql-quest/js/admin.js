/* Admin: manage users & roles, content visibility, badges, platform settings, backups. */
window.SQ = window.SQ || {};

SQ.Admin = (function () {
  var U = SQ.UI, S = SQ.Store, E = SQ.Engine, A = SQ.App, esc = U.esc;
  var AD = ['admin'];

  function home(me) {
    var db = S.raw(), users = S.users();
    var count = function (r) { return users.filter(function (u) { return u.role === r; }).length; };
    var today = S.today(), activeToday = users.filter(function (u) { return S.progress(u.id).lastActive === today; }).length;
    var recent = db.submissions.slice(-8).reverse();
    A.view('<div class="page-head"><div><h1>Platform overview</h1><p>Manage users, roles, content, badges and settings.</p></div></div>' +
      '<div class="grid g4 keep2" style="margin-bottom:16px"><div class="card stat"><span class="label">Students</span><span class="value">' + count('student') + '</span></div><div class="card stat"><span class="label">Teachers</span><span class="value">' + count('teacher') + '</span></div><div class="card stat"><span class="label">Classes</span><span class="value">' + db.classes.length + '</span></div><div class="card stat"><span class="label">Active today</span><span class="value">' + activeToday + '</span></div></div>' +
      '<div class="grid g2"><div class="card"><h3>Quick actions</h3><div class="list">' +
        '<a class="list-item" href="#/admin/users" style="color:var(--ink)"><span class="badge-mini">👥</span><span class="grow"><b>Users & roles</b><br><small>Create teachers, change roles, reset passwords</small></span>→</a>' +
        '<a class="list-item" href="#/admin/content" style="color:var(--ink)"><span class="badge-mini">📚</span><span class="grow"><b>Content</b><br><small>' + E.allChallenges(true).length + ' challenges across 5 worlds</small></span>→</a>' +
        '<a class="list-item" href="#/admin/badges" style="color:var(--ink)"><span class="badge-mini">🏅</span><span class="grow"><b>Badges</b><br><small>' + db.badges.length + ' badges configured</small></span>→</a>' +
        '<a class="list-item" href="#/admin/settings" style="color:var(--ink)"><span class="badge-mini">⚙️</span><span class="grow"><b>Settings & safety</b><br><small>Lives, hint cost, time limits, blocked commands, backups</small></span>→</a></div></div>' +
      '<div class="card"><h3>Recent activity</h3><div class="list">' + (recent.length ? recent.map(function (s) { var u = S.user(s.userId); var f = E.find(s.challengeId); return '<div class="list-item"><span class="tag ' + (s.ok ? 'good' : 'bad') + '">' + (s.ok ? 'Pass' : 'Fail') + '</span><span class="grow">' + esc(u ? u.displayName : '?') + ' · <small>' + esc(f ? f.ch.title || f.world.boss.title : s.challengeId) + '</small></span><small>' + U.timeAgo(s.at) + '</small></div>'; }).join('') : '<p class="muted">No activity yet.</p>') + '</div></div></div>');
  }

  A.route('/admin/users', AD, function (p, me) {
    var q = '', roleF = '';
    function draw() {
      var list = S.users().filter(function (u) { return (!roleF || u.role === roleF) && (!q || (u.username + ' ' + u.displayName).toLowerCase().indexOf(q) >= 0); });
      U.$('#ut').innerHTML = list.map(function (u) {
        var cls = u.classId && S.classes().find(function (c) { return c.id === u.classId; });
        return '<tr><td><span style="display:inline-flex;gap:8px;align-items:center"><span class="avatar" style="width:28px;height:28px;font-size:.95rem">' + esc(u.avatar) + '</span><span><b>' + esc(u.displayName) + '</b><br><small>@' + esc(u.username) + '</small></span></span></td>' +
          '<td><select data-role="' + u.id + '" style="width:auto;padding:5px 8px"' + (u.id === me.id ? ' disabled' : '') + '>' + ['student', 'teacher', 'admin'].map(function (r) { return '<option' + (u.role === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></td>' +
          '<td class="hide-sm">' + (cls ? esc(cls.name) : '<span class="muted">—</span>') + '</td><td class="num">' + S.progress(u.id).xp + '</td>' +
          '<td>' + (u.active ? '<span class="tag good">Active</span>' : '<span class="tag bad">Disabled</span>') + '</td>' +
          '<td style="text-align:right">' + (u.id === me.id ? '<small>you</small>' : '<button class="btn sm" data-pw="' + u.id + '">Reset password</button> <button class="btn sm" data-act="' + u.id + '">' + (u.active ? 'Disable' : 'Enable') + '</button> <button class="btn sm danger" data-del="' + u.id + '">Delete</button>') + '</td></tr>';
      }).join('') || '<tr><td colspan="6" class="empty">No users match.</td></tr>';
      U.$all('[data-role]').forEach(function (s) { s.onchange = function () { S.user(s.dataset.role).role = s.value; S.save(); U.toast('Role updated to ' + s.value); }; });
      U.$all('[data-pw]').forEach(function (b) { b.onclick = function () { U.prompt('Reset password', 'New password (min 6 characters)', 'text').then(function (v) { if (v === null) return; try { S.setPassword(b.dataset.pw, v); U.toast('Password reset'); } catch (e) { U.toast(e.message); } }); }; });
      U.$all('[data-act]').forEach(function (b) { b.onclick = function () { var u = S.user(b.dataset.act); u.active = !u.active; S.save(); draw(); }; });
      U.$all('[data-del]').forEach(function (b) { b.onclick = function () { U.confirm('Delete this user and all their progress?', 'Delete', true).then(function (ok) { if (!ok) return; var db = S.raw(), id = b.dataset.del; db.users = db.users.filter(function (u) { return u.id !== id; }); delete db.progress[id]; db.submissions = db.submissions.filter(function (s) { return s.userId !== id; }); db.userBadges = db.userBadges.filter(function (x) { return x.userId !== id; }); db.teams.forEach(function (t) { t.memberIds = t.memberIds.filter(function (m) { return m !== id; }); }); S.save(); draw(); }); }; });
    }
    A.view('<div class="page-head"><div><h1>Users & roles</h1><p>Each user has one role. The app checks it on every page (role-based access control).</p></div><button class="btn primary" id="newu">+ Create user</button></div>' +
      '<div class="btn-row" style="margin-bottom:12px"><input type="search" id="q" placeholder="Search users…" style="max-width:280px"><select id="rf" style="width:auto"><option value="">All roles</option><option>student</option><option>teacher</option><option>admin</option></select></div>' +
      '<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th class="hide-sm">Class</th><th class="num">XP</th><th>Status</th><th></th></tr></thead><tbody id="ut"></tbody></table></div>');
    U.$('#q').oninput = function () { q = this.value.toLowerCase(); draw(); };
    U.$('#rf').onchange = function () { roleF = this.value; draw(); };
    U.$('#newu').onclick = function () {
      var m = U.modal('<h3>Create user</h3><form id="nu"><div id="nue"></div><div class="field"><label>Display name</label><input type="text" id="nu-d" required></div><div class="field"><label>Username</label><input type="text" id="nu-u" required></div><div class="field"><label>Temporary password</label><input type="text" id="nu-p" required minlength="6"></div><div class="field"><label>Role</label><select id="nu-r"><option>student</option><option selected>teacher</option><option>admin</option></select></div><div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Create</button></div></form>');
      U.$('#nu', m.el).onsubmit = function (e) {
        e.preventDefault();
        try { S.createUser({ displayName: U.$('#nu-d').value, username: U.$('#nu-u').value, password: U.$('#nu-p').value, role: U.$('#nu-r').value }); m.close(); U.toast('User created'); draw(); }
        catch (er) { U.$('#nue').innerHTML = '<div class="form-error">' + esc(er.message) + '</div>'; }
      };
    };
    draw();
  });

  A.route('/admin/content', AD, function (p, me) {
    var db = S.raw();
    A.view('<div class="page-head"><div><h1>Content</h1><p>Hide or publish any challenge. Teachers’ custom challenges are marked “Custom”.</p></div><a class="btn" href="#/teach/content">Lesson & challenge editor →</a></div>' +
      SQ.WORLDS.map(function (w) {
        return '<div class="card wc-' + w.id + '" style="margin-bottom:14px;border-top:4px solid var(--wc)"><h3>' + w.icon + ' World ' + w.num + ': ' + esc(w.name) + '</h3><div class="table-wrap"><table><thead><tr><th>Challenge</th><th>Type</th><th>Level</th><th class="num">XP</th><th>Visible</th></tr></thead><tbody>' +
          E.allChallenges(true).filter(function (x) { return x.world.id === w.id; }).map(function (x) {
            var c = x.ch, vis = !db.hidden[c.id] && c.published !== false;
            return '<tr><td><b>' + esc(c.title) + '</b>' + (c.custom ? ' <span class="tag brand">Custom</span>' : '') + '</td><td>' + SQ.typeIcon(c.type) + ' ' + SQ.typeName(c.type) + '</td><td>' + esc(x.level.title) + '</td><td class="num">' + c.xp + '</td><td><label class="check" style="margin:0"><input type="checkbox" data-vis="' + c.id + '"' + (vis ? ' checked' : '') + '> ' + (vis ? 'Published' : 'Hidden') + '</label></td></tr>';
          }).join('') + '<tr><td><b>⚔️ ' + esc(w.boss.title) + '</b></td><td>Boss battle</td><td>—</td><td class="num">' + w.boss.xp + '</td><td><span class="tag">Always on</span></td></tr></tbody></table></div></div>';
      }).join(''));
    U.$all('[data-vis]').forEach(function (cb) {
      cb.onchange = function () {
        var id = cb.dataset.vis, cc = db.customChallenges.find(function (c) { return c.id === id; });
        if (cc) cc.published = cb.checked; else if (cb.checked) delete db.hidden[id]; else db.hidden[id] = true;
        S.save(); cb.parentNode.lastChild.textContent = cb.checked ? ' Published' : ' Hidden';
      };
    });
  });

  A.route('/admin/badges', AD, function (p, me) {
    var db = S.raw();
    function ruleText(r) { return { firstType: 'First ' + r.value + ' challenge', join: 'Uses a JOIN', bosses: r.value + ' boss(es) defeated', streak: r.value + '-day streak', firstTry: r.value + ' first-try passes', speed: r.value + ' speed bonuses', xp: r.value + ' XP', reviews: r.value + ' peer review(s)', team: r.value + ' team mission(s)', completed: r.value + ' challenges completed' }[r.type] || r.type; }
    A.view('<div class="page-head"><div><h1>Badges</h1><p>Edit names, icons and descriptions, disable badges or add new milestone badges.</p></div><button class="btn primary" id="addb">+ New badge</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Icon</th><th>Name</th><th>Description</th><th>Rule</th><th class="num">Earned by</th><th>Enabled</th></tr></thead><tbody>' +
      db.badges.map(function (b, i) {
        return '<tr><td><input type="text" data-f="icon" data-i="' + i + '" value="' + esc(b.icon) + '" style="width:56px;text-align:center"></td><td><input type="text" data-f="name" data-i="' + i + '" value="' + esc(b.name) + '" style="min-width:140px"></td><td><input type="text" data-f="desc" data-i="' + i + '" value="' + esc(b.desc) + '" style="min-width:220px"></td><td><small>' + esc(ruleText(b.rule)) + '</small></td><td class="num">' + db.userBadges.filter(function (x) { return x.badgeId === b.id; }).length + '</td><td><input type="checkbox" data-en="' + i + '"' + (b.disabled ? '' : ' checked') + ' style="width:18px;height:18px;accent-color:var(--brand)"></td></tr>';
      }).join('') + '</tbody></table></div><p class="muted" style="margin-top:8px">Changes save automatically.</p>');
    U.$all('[data-f]').forEach(function (inp) { inp.onchange = function () { db.badges[+inp.dataset.i][inp.dataset.f] = inp.value.slice(0, inp.dataset.f === 'desc' ? 140 : 40); S.save(); U.toast('Badge saved'); }; });
    U.$all('[data-en]').forEach(function (cb) { cb.onchange = function () { db.badges[+cb.dataset.en].disabled = !cb.checked; S.save(); }; });
    U.$('#addb').onclick = function () {
      var m = U.modal('<h3>New badge</h3><form id="nb"><div class="grid g2"><div class="field"><label>Icon (emoji)</label><input type="text" id="nb-i" value="🏆" required maxlength="4"></div><div class="field"><label>Name</label><input type="text" id="nb-n" required maxlength="40"></div></div><div class="field"><label>Description</label><input type="text" id="nb-d" required maxlength="140"></div>' +
        '<div class="grid g2"><div class="field"><label>Awarded when</label><select id="nb-t"><option value="xp">XP reaches</option><option value="completed">Challenges completed reaches</option><option value="streak">Best streak reaches</option><option value="bosses">Bosses defeated reaches</option><option value="firstTry">First-try passes reaches</option><option value="reviews">Peer reviews given reaches</option></select></div><div class="field"><label>Value</label><input type="number" id="nb-v" min="1" value="1000" required></div></div>' +
        '<div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add badge</button></div></form>');
      U.$('#nb', m.el).onsubmit = function (e) {
        e.preventDefault();
        db.badges.push({ id: S.uid('b'), icon: U.$('#nb-i').value, name: U.$('#nb-n').value.trim(), desc: U.$('#nb-d').value.trim(), rule: { type: U.$('#nb-t').value, value: +U.$('#nb-v').value } });
        S.save(); S.users().forEach(function (u) { if (u.role === 'student') E.checkBadges(u.id); }); m.close(); A.render();
      };
    };
  });

  A.route('/admin/settings', AD, function (p, me) {
    var st = S.settings();
    var num = function (id, label, val, min, max, help) { return '<div class="field"><label for="' + id + '">' + label + '</label><input type="number" id="' + id + '" min="' + min + '" max="' + max + '" value="' + val + '">' + (help ? '<small>' + help + '</small>' : '') + '</div>'; };
    A.view('<div class="page-head"><div><h1>Settings</h1><p>Game rules, safety limits and data management.</p></div></div><form id="sf" class="grid g2">' +
      '<div class="card"><h3>🎮 Game rules</h3><div class="field"><label>Platform name</label><input type="text" id="s-name" maxlength="40" value="' + esc(st.platformName) + '"></div><div class="grid g2">' +
      num('s-lives', 'Lives per challenge / boss', st.lives, 1, 10) + num('s-hint', 'Hint cost (XP)', st.hintCost, 0, 100) +
      num('s-speed', 'Speed bonus (%)', st.speedBonusPct, 0, 100) + num('s-acc', 'Accuracy bonus (%)', st.accuracyBonusPct, 0, 100) +
      num('s-retry', 'Retry penalty (%)', st.retryPenaltyPct, 0, 100, 'After losing all lives') + num('s-review', 'Peer review XP', st.reviewXP, 0, 100) + '</div>' +
      '<div class="field"><label for="s-boss">Boss time multiplier</label><input type="number" id="s-boss" min="0.5" max="3" step="0.25" value="' + st.bossTimeMultiplier + '"><small>1 = default time limits; 1.5 gives 50% more time.</small></div></div>' +
      '<div class="card"><h3>🛡️ Safety & access</h3>' + num('s-timeout', 'Query time limit (ms)', st.queryTimeoutMs, 500, 10000, 'Runaway queries are stopped after this time.') +
      '<div class="field"><label for="s-blocked">Blocked commands (one per line)</label><textarea id="s-blocked" style="font-family:var(--mono)">' + esc(st.blocked.join('\n')) + '</textarea><small>Always rejected in the sandbox before running.</small></div>' +
      '<div class="field"><label class="check"><input type="checkbox" id="s-signup"' + (st.allowStudentSignup ? ' checked' : '') + '> Allow students to sign up</label></div>' +
      '<div class="field"><label class="check"><input type="checkbox" id="s-demo"' + (st.showDemoAccounts ? ' checked' : '') + '> Show demo accounts on the login page</label><small>Turn this off and change demo passwords before going live.</small></div></div>' +
      '<div style="grid-column:1/-1"><button class="btn primary lg">Save settings</button></div></form>' +
      '<div class="card" style="margin-top:16px"><h3>💾 Data</h3><p class="muted">All data lives in this browser. Export a backup regularly, or import one on another device.</p><div class="btn-row"><button class="btn" id="exp">⬇ Export backup (JSON)</button><label class="btn" style="margin:0">⬆ Import backup<input type="file" id="imp" accept="application/json" class="hidden"></label><button class="btn danger" id="reset">Reset platform to demo data</button></div></div>');
    U.$('#sf').onsubmit = function (e) {
      e.preventDefault();
      var n = function (id, d) { var v = parseFloat(U.$(id).value); return isNaN(v) ? d : v; };
      Object.assign(st, { platformName: U.$('#s-name').value.trim() || 'SQL Quest', lives: n('#s-lives', 3), hintCost: n('#s-hint', 5), speedBonusPct: n('#s-speed', 10), accuracyBonusPct: n('#s-acc', 20),
        retryPenaltyPct: n('#s-retry', 50), reviewXP: n('#s-review', 15), bossTimeMultiplier: n('#s-boss', 1), queryTimeoutMs: n('#s-timeout', 2000),
        blocked: U.$('#s-blocked').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean), allowStudentSignup: U.$('#s-signup').checked, showDemoAccounts: U.$('#s-demo').checked });
      S.save(); U.toast('Settings saved'); A.refreshShell();
    };
    U.$('#exp').onclick = function () {
      var blob = new Blob([JSON.stringify(S.raw(), null, 1)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sqlquest-backup-' + S.today() + '.json'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    U.$('#imp').onchange = function () {
      var f = this.files[0]; if (!f) return;
      f.text().then(function (txt) {
        var d; try { d = JSON.parse(txt); } catch (e) { return U.toast('That file is not valid JSON.'); }
        if (!d || d.version !== 1 || !Array.isArray(d.users)) return U.toast('That is not a SQL Quest backup.');
        U.confirm('Replace ALL current data with this backup?', 'Import', true).then(function (ok) { if (!ok) return; localStorage.setItem('sqlquest_v1', JSON.stringify(d)); location.reload(); });
      });
    };
    U.$('#reset').onclick = function () { U.confirm('Erase everything and restore the demo data?', 'Reset', true).then(function (ok) { if (ok) { S.resetAll(); E.finishSeed(); A.go('#/login'); } }); };
  });

  return { home: home };
})();
