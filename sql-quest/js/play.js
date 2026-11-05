/* Gameplay: challenge player, practice flow with lives & hints, boss battles, team missions. */
window.SQ = window.SQ || {};

SQ.Player = (function () {
  var U = SQ.UI, S = SQ.Store, E = SQ.Engine, esc = U.esc;
  var KW = 'SELECT|FROM|WHERE|AND|OR|NOT|IN|IS|NULL|LIKE|BETWEEN|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|ASC|DESC|AS|ON|JOIN|INNER|LEFT|RIGHT|OUTER|FULL|CROSS|USING|DISTINCT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|DEFAULT|CHECK|INTEGER|TEXT|REAL|BEGIN|COMMIT|ROLLBACK|TRANSACTION|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END|UNION|ALL|EXISTS|WITH|DROP|ALTER|EXPLAIN|QUERY|PLAN|GRANT|REVOKE';
  var TOKEN = new RegExp("(--[^\\n]*)|('(?:[^']|'')*'?)|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b(?:" + KW + ")\\b)", 'gi');
  function highlight(code) {
    var out = '', last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(code))) {
      out += esc(code.slice(last, m.index));
      var cls = m[1] ? 'hl-cmt' : m[2] ? 'hl-str' : m[3] ? 'hl-num' : 'hl-kw';
      out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
      last = TOKEN.lastIndex;
    }
    return out + esc(code.slice(last)) + '\n';
  }

  var schemaP = null;
  function schema() {
    if (!schemaP) schemaP = SQ.Sandbox.run("SELECT m.name, p.name, p.type, p.pk, (SELECT COUNT(*) FROM pragma_foreign_key_list(m.name) f WHERE f.\"from\" = p.name) FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type = 'table' ORDER BY m.rowid, p.cid;");
    return schemaP;
  }
  function schemaPanel(el) {
    schema().then(function (r) {
      if (!r.result) return;
      var t = {}, order = [];
      r.result.values.forEach(function (v) { if (!t[v[0]]) { t[v[0]] = []; order.push(v[0]); } t[v[0]].push(v); });
      el.innerHTML = '<h4 style="margin:14px 0 8px">🗂️ Sandbox schema</h4>' + order.map(function (name, i) {
        return '<details ' + (i < 2 ? 'open' : '') + '><summary>' + name + ' <button class="btn ghost sm" data-peek="' + name + '" type="button" style="padding:0 6px">👁 rows</button></summary><ul>' + t[name].map(function (c) {
          return '<li><span>' + (c[3] ? '<span class="k">🔑 </span>' : c[4] ? '<span class="k" style="color:var(--brand)">🔗 </span>' : '') + c[1] + '</span><span class="t">' + c[2] + (c[3] ? ' · PK' : c[4] ? ' · FK' : '') + '</span></li>';
        }).join('') + '</ul></details>';
      }).join('');
      U.$all('[data-peek]', el).forEach(function (b) {
        b.onclick = function (e) {
          e.preventDefault(); e.stopPropagation();
          SQ.Sandbox.run('SELECT * FROM ' + b.dataset.peek + ' LIMIT 25;').then(function (res) {
            U.modal('<div class="card-head"><h3>' + esc(b.dataset.peek) + '</h3><button class="btn sm" data-close>Close</button></div>' + U.resultTable(res.result, 25), { wide: true });
          });
        };
      });
    });
  }

  /* Mount a challenge into `el`.
   * opts: { mode: 'practice'|'boss'|'team', onPass(info), onWrong(res), hints: bool, initial: string,
   *         canSubmit: bool, extraButtons: html, onDraft(sql) } */
  function mount(el, ch, opts) {
    opts = opts || {};
    var start = Date.now(), wrong = 0, locked = false, hintsShown = 0, busy = false;
    var me = S.current(), prog = S.progress(me.id);
    var already = prog.hints[ch.id] || 0;
    var isSQL = ch.type === 'query' || ch.type === 'fix';
    var promptHtml = ch.custom ? U.md(ch.prompt) : ch.prompt;
    var hintsHtml = (opts.hints !== false && ch.hints && ch.hints.length) ?
      '<div id="hints"></div><button class="btn sm" id="hint-btn" type="button" style="margin-top:10px">💡 Get a hint <span class="muted">(−' + S.settings().hintCost + ' XP)</span></button>' : '';
    var head = '<span class="type-tag">' + SQ.typeIcon(ch.type) + ' ' + SQ.typeName(ch.type) + '</span><h2 style="margin:6px 0 10px">' + esc(ch.title) + '</h2><div class="prompt">' + promptHtml + '</div>';

    if (isSQL) {
      el.innerHTML = '<div class="play"><div class="card">' + head + hintsHtml + '<div class="schema" id="schema"></div></div>' +
        '<div class="grid" style="gap:12px"><div class="editor"><div class="editor-bar"><span>sandbox.sql — fresh database every run</span><span class="hide-sm">Ctrl+Enter = Run</span></div><div class="editor-area"><pre id="hl" aria-hidden="true"></pre><textarea id="sql" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="-- Write your SQL here" aria-label="SQL editor"></textarea></div></div>' +
        '<div class="btn-row"><button class="btn" id="run" type="button">▶ Run</button><button class="btn primary" id="submit" type="button">✔ Submit answer</button>' +
        (ch.starter ? '<button class="btn ghost" id="reset" type="button">↺ Reset</button>' : '') + (opts.extraButtons || '') + '</div>' +
        '<div id="fb"></div><div id="out"></div></div></div>';
      var ta = U.$('#sql', el), hl = U.$('#hl', el);
      ta.value = opts.initial !== undefined ? opts.initial : (ch.starter || '');
      var sync = function () { hl.innerHTML = highlight(ta.value); hl.scrollTop = ta.scrollTop; if (opts.onDraft) opts.onDraft(ta.value); };
      var grow = function () { ta.style.height = 'auto'; ta.style.height = Math.max(170, ta.scrollHeight + 4) + 'px'; };
      ta.addEventListener('input', function () { sync(); grow(); });
      ta.addEventListener('scroll', function () { hl.scrollTop = ta.scrollTop; });
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') { e.preventDefault(); var s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); sync(); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (e.shiftKey) submitSQL(); else runSQL(); }
      });
      sync(); setTimeout(grow, 0);
      schemaPanel(U.$('#schema', el));
      U.$('#run', el).onclick = runSQL;
      U.$('#submit', el).onclick = submitSQL;
      var rs = U.$('#reset', el); if (rs) rs.onclick = function () { ta.value = ch.starter; sync(); grow(); };
      if (opts.canSubmit === false) { U.$('#submit', el).disabled = true; U.$('#submit', el).title = 'Only the team leader can submit'; }
    } else {
      el.innerHTML = '<div class="card" style="max-width:860px;margin:0 auto">' + head + '<div id="ui" style="margin-top:14px"></div>' +
        '<div class="btn-row" style="margin-top:16px"><button class="btn primary" id="submit" type="button">✔ Check answer</button>' + (opts.extraButtons || '') + '</div><div id="fb"></div>' + hintsHtml + '</div>';
      buildOther(U.$('#ui', el));
      U.$('#submit', el).onclick = submitOther;
    }

    var hb = U.$('#hint-btn', el);
    function showHints(n) {
      var box = U.$('#hints', el); if (!box) return;
      box.innerHTML = ch.hints.slice(0, n).map(function (h, i) { return '<div class="hint-box">💡 <b>Hint ' + (i + 1) + ':</b> ' + esc(h) + '</div>'; }).join('');
      if (n >= ch.hints.length && hb) hb.classList.add('hidden');
    }
    if (hb) {
      if (already) { hintsShown = Math.min(already, ch.hints.length); showHints(hintsShown); }
      hb.onclick = function () {
        if (hintsShown >= ch.hints.length) return;
        var cost = E.spendHint(me.id, ch.id); hintsShown++; showHints(hintsShown);
        U.toast('Hint unlocked (−' + cost + ' XP)'); SQ.App.refreshShell();
      };
    }

    function feedback(kind, html) {
      U.$('#fb', el).innerHTML = '<div class="feedback ' + kind + '"><span class="fi">' + (kind === 'good' ? '✅' : kind === 'bad' ? '❌' : 'ℹ️') + '</span><div>' + html + '</div></div>';
    }
    function log(res, query) {
      var f = E.find(ch.id) || {};
      S.logSubmission({ userId: me.id, challengeId: ch.id, worldId: f.world ? f.world.id : null, levelId: f.level ? f.level.id : null, topic: ch.topic,
        ok: !!res.pass, category: res.pass ? null : res.category, feedback: res.message, query: query ? String(query).slice(0, 1500) : null,
        seconds: Math.round((Date.now() - start) / 1000), mode: opts.mode });
    }
    function done(res, query) {
      if (res.pass) {
        locked = true;
        U.$all('#submit,#run', el).forEach(function (b) { b.disabled = true; });
        opts.onPass && opts.onPass({ wrong: wrong, seconds: Math.round((Date.now() - start) / 1000), query: query, usedJoin: query ? /\bJOIN\b/i.test(SQ.Grader.strip(query)) : false });
      } else if (!res.noPenalty) {
        wrong++;
        opts.onWrong && opts.onWrong(res);
      }
    }

    function runSQL() {
      if (busy) return;
      var sql = ta.value, block = SQ.Grader.safety(sql, ch.allow);
      if (block) return feedback('bad', esc(block));
      busy = true; U.$('#out', el).innerHTML = '<small>Running…</small>';
      SQ.Sandbox.run(sql, { check: ch.check }).then(function (r) {
        busy = false;
        if (r.error) { U.$('#out', el).innerHTML = ''; return feedback('bad', esc(r.error)); }
        U.$('#fb', el).innerHTML = '';
        var html = '<h4 style="margin:4px 0 6px">Your result</h4>' + U.resultTable(r.result);
        if (ch.check && r.check && r.check[0] && !r.check[0].error) html += '<h4 style="margin:12px 0 6px">Database after your script</h4>' + U.resultTable(r.check[0]);
        if (r.changes && !r.result) html = '<div class="feedback info"><span class="fi">ℹ️</span><div>' + r.changes + ' row(s) changed.</div></div>' + html;
        U.$('#out', el).innerHTML = html;
      });
    }
    function submitSQL() {
      if (busy || locked) return;
      var sql = ta.value;
      busy = true; feedback('info', 'Grading…');
      SQ.Grader.gradeSQL(ch, sql).then(function (res) {
        busy = false;
        if (res.category !== 'blocked' || true) log(res, sql);
        if (res.pass) { feedback('good', '<b>Correct!</b> ' + esc(res.message)); U.$('#out', el).innerHTML = res.got ? '<h4 style="margin:4px 0 6px">Your result</h4>' + U.resultTable(res.got) : ''; }
        else {
          feedback('bad', '<b>Not yet.</b> ' + esc(res.message));
          var out = '';
          if (res.got) out += '<h4 style="margin:4px 0 6px">Your result</h4>' + U.resultTable(res.got, 15);
          if (res.exp) out += '<p class="muted" style="margin-top:8px">Expected: <b>' + res.exp.values.length + '</b> row(s) with ' + res.exp.columns.length + ' column(s).</p>';
          U.$('#out', el).innerHTML = out;
        }
        done(res, sql);
      });
    }

    /* quiz / short / drag */
    var choice = null, placement = [];
    function buildOther(ui) {
      if (ch.type === 'quiz') {
        ui.innerHTML = '<div class="options">' + ch.options.map(function (o, i) { return '<button type="button" class="option" data-i="' + i + '"><span class="letter">' + 'ABCDEF'[i] + '</span><span>' + esc(o) + '</span></button>'; }).join('') + '</div>';
        U.$all('.option', ui).forEach(function (b) { b.onclick = function () { if (locked) return; choice = +b.dataset.i; U.$all('.option', ui).forEach(function (x) { x.classList.remove('sel', 'wrong'); }); b.classList.add('sel'); }; });
      } else if (ch.type === 'short') {
        ui.innerHTML = '<input type="text" id="short" placeholder="Type your answer" autocomplete="off" style="max-width:420px">';
        U.$('#short', ui).addEventListener('keydown', function (e) { if (e.key === 'Enter') submitOther(); });
      } else if (ch.type === 'drag') {
        var order = ch.items.map(function (_, i) { return i; });
        var seed = 0; for (var k = 0; k < ch.id.length; k++) seed = (seed * 31 + ch.id.charCodeAt(k)) >>> 0;
        order.sort(function (a, b) { return ((a * 7919 + seed) % 97) - ((b * 7919 + seed) % 97); });
        var entityish = /entity|relationship|\(/i;
        ui.innerHTML = '<label>Items — drag into a box below</label><div class="dnd-pool" data-bin="-1">' + order.map(function (i) { return '<span class="chip" draggable="true" data-item="' + i + '" tabindex="0">' + esc(ch.items[i].label) + '</span>'; }).join('') + '</div>' +
          '<div class="bins">' + ch.bins.map(function (b, i) { return '<div class="bin ' + (/relationship/i.test(b) ? 'rel' : '') + '" data-bin="' + i + '"><h4>' + esc(b) + '</h4><div class="bin-items"></div></div>'; }).join('') + '</div>';
        var picked = null;
        function place(item, bin) {
          if (locked) return;
          var chip = U.$('[data-item="' + item + '"]', ui);
          var target = bin < 0 ? U.$('.dnd-pool', ui) : U.$('.bin[data-bin="' + bin + '"] .bin-items', ui);
          target.appendChild(chip); placement[item] = bin < 0 ? null : bin;
          chip.classList.remove('picked', 'wrong', 'right');
        }
        U.$all('.chip', ui).forEach(function (c) {
          c.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', c.dataset.item); c.classList.add('dragging'); });
          c.addEventListener('dragend', function () { c.classList.remove('dragging'); });
          c.addEventListener('click', function (e) {
            e.stopPropagation(); if (locked) return;
            var host = c.closest('[data-bin]');
            if (picked !== null && picked !== c.dataset.item && !(host.dataset.bin === '-1' && placement[+picked] == null)) { place(+picked, +host.dataset.bin); picked = null; return; }
            U.$all('.chip', ui).forEach(function (x) { x.classList.remove('picked'); }); picked = picked === c.dataset.item ? null : c.dataset.item; if (picked !== null) c.classList.add('picked'); });
          c.addEventListener('keydown', function (e) { var n = parseInt(e.key, 10); if (n >= 1 && n <= ch.bins.length) place(+c.dataset.item, n - 1); if (e.key === '0') place(+c.dataset.item, -1); });
        });
        U.$all('[data-bin]', ui).forEach(function (b) {
          b.addEventListener('dragover', function (e) { e.preventDefault(); b.classList.add('over'); });
          b.addEventListener('dragleave', function () { b.classList.remove('over'); });
          b.addEventListener('drop', function (e) { e.preventDefault(); b.classList.remove('over'); place(+e.dataTransfer.getData('text/plain'), +b.dataset.bin); });
          b.addEventListener('click', function () { if (picked !== null) { place(+picked, +b.dataset.bin); picked = null; } });
        });
        ui.insertAdjacentHTML('beforeend', '<small style="display:block;margin-top:8px">Keyboard: focus an item and press 1–' + ch.bins.length + ' to place it, 0 to return it.</small>');
      }
    }
    function submitOther() {
      if (locked) return;
      var ans = ch.type === 'quiz' ? choice : ch.type === 'short' ? U.$('#short', el).value : placement;
      if (ch.type === 'quiz' && choice === null) return feedback('info', 'Choose an option first.');
      if (ch.type === 'short' && !String(ans).trim()) return feedback('info', 'Type an answer first.');
      var res = SQ.Grader.gradeOther(ch, ans);
      if (!res.noPenalty) log(res, ch.type === 'short' ? ans : null);
      feedback(res.pass ? 'good' : res.noPenalty ? 'info' : 'bad', esc(res.message));
      if (ch.type === 'quiz') { var b = U.$('.option[data-i="' + choice + '"]', el); b.classList.remove('sel'); b.classList.add(res.pass ? 'right' : 'wrong'); }
      if (ch.type === 'drag' && !res.noPenalty) ch.items.forEach(function (it, i) { var c = U.$('[data-item="' + i + '"]', el); c.classList.toggle('wrong', placement[i] !== it.bin); c.classList.toggle('right', placement[i] === it.bin); });
      done(res, null);
    }

    return {
      lock: function () { locked = true; U.$all('#submit,#run', el).forEach(function (b) { b.disabled = true; }); },
      unlock: function () { locked = false; wrong = 0; start = Date.now(); U.$all('#submit,#run', el).forEach(function (b) { b.disabled = opts.canSubmit === false && b.id === 'submit'; }); U.$('#fb', el).innerHTML = ''; },
      value: function () { return ta ? ta.value : null; }
    };
  }

  function rewardModal(r, title, actions) {
    var rows = [];
    if (r.base !== undefined) rows.push(['Base XP', '+' + r.base]);
    if (r.speed) rows.push(['⚡ Speed bonus', '+' + r.speed]);
    if (r.accuracy) rows.push(['🎯 Accuracy bonus (no mistakes)', '+' + r.accuracy]);
    if (r.timeBonus) rows.push(['⏱️ Time bonus', '+' + r.timeBonus]);
    if (r.livesBonus) rows.push(['❤️ Lives remaining bonus', '+' + r.livesBonus]);
    if (r.penalty) rows.push(['↺ Retry after losing all lives', String(r.penalty), 'neg']);
    var html = '<div class="reward"><div class="big-ico">' + (r.levelUp ? '🆙' : '🎉') + '</div><h2 style="margin:8px 0 0">' + esc(title) + '</h2><div class="xp-total">+' + r.total + ' XP</div>' +
      (r.levelUp ? '<div class="tag xp" style="font-size:.95rem">Level up! You are now level ' + r.levelUp.level + ' — ' + esc(r.levelUp.title) + '</div>' : '') +
      '<div class="breakdown">' + rows.map(function (x) { return '<div class="' + (x[2] || '') + '"><span>' + x[0] + '</span><b>' + x[1] + '</b></div>'; }).join('') + '</div>' +
      (r.newBadges || []).map(function (b) { return '<div class="new-badge"><span class="bi">' + b.icon + '</span><div><b>New badge: ' + esc(b.name) + '</b><br><small>' + esc(b.desc) + '</small></div></div>'; }).join('') +
      '<div class="btn-row" style="justify-content:center;margin-top:18px">' + actions + '</div></div>';
    U.confetti();
    return U.modal(html, { sticky: false });
  }

  return { mount: mount, rewardModal: rewardModal, highlight: highlight };
})();

/* ───────── Practice route ───────── */
(function () {
  var U = SQ.UI, S = SQ.Store, E = SQ.Engine, A = SQ.App, esc = U.esc;

  function nextAfter(f, me) {
    var w = f.world, li = w.levels.indexOf(f.level), ci = f.level.challenges.indexOf(f.ch);
    if (ci < f.level.challenges.length - 1) return { href: '#/play/' + f.level.challenges[ci + 1].id, label: 'Next challenge →' };
    if (li < w.levels.length - 1) return { href: '#/lesson/' + w.levels[li + 1].id, label: 'Next lesson →' };
    return { href: '#/boss/' + w.id, label: '⚔️ Face the boss →' };
  }

  A.route('/play/:id', null, function (p, me) {
    var f = E.find(p.id);
    if (!f) return A.view('<div class="card empty">Challenge not found.</div>');
    if (f.boss) return A.go('#/boss/' + f.world.id);
    if (f.team) return A.go('#/team');
    var idx = f.world.levels.indexOf(f.level);
    if (!E.levelUnlocked(me.id, f.world, idx)) return A.view('<div class="card empty"><span class="big">🔒</span><h2>Locked</h2><p>Finish the previous level first.</p><a class="btn" href="#/map">Back to map</a></div>');
    var st = S.settings(), prog = S.progress(me.id), lives = st.lives, done = !!prog.completed[f.ch.id];
    var nx = nextAfter(f, me);
    A.view('<div class="wc-' + f.world.id + '"><div class="crumbs"><a href="#/map">Worlds</a> › ' + esc(f.world.name) + ' › <a href="#/lesson/' + f.level.id + '">' + esc(f.level.title) + '</a></div>' +
      '<div class="play-head"><div class="btn-row">' + U.hearts(lives, st.lives).replace('class="hearts"', 'class="hearts" id="hearts"') +
      '<span class="tag xp">+' + (f.ch.xp || 20) + ' XP</span><span class="tag hide-sm">⏱️ Par ' + (f.ch.par || 60) + 's</span>' + (done ? '<span class="tag good">✓ Completed — replay for practice (no XP)</span>' : '') + (prog.retries[f.ch.id] && !done ? '<span class="tag warn">Retry: reward −' + st.retryPenaltyPct + '%</span>' : '') + '</div>' +
      '<div class="btn-row"><a class="btn sm" href="#/lesson/' + f.level.id + '">📖 Lesson</a><a class="btn sm" href="' + nx.href + '">Skip →</a></div></div><div id="stage"></div></div>');
    var player = SQ.Player.mount(U.$('#stage'), f.ch, {
      mode: 'practice',
      onWrong: function () {
        lives--;
        U.$('#hearts').outerHTML = U.hearts(lives, st.lives).replace('class="hearts"', 'class="hearts" id="hearts"');
        if (lives <= 0) {
          player.lock();
          var m = U.modal('<div class="reward"><div class="big-ico">💔</div><h2>Out of lives!</h2><p>Review the lesson, then try again. A retry earns ' + (100 - st.retryPenaltyPct) + '% of the normal XP.</p><div class="btn-row" style="justify-content:center"><a class="btn" href="#/lesson/' + f.level.id + '" data-close>📖 Review lesson</a><button class="btn primary" id="retry">↺ Retry challenge</button></div></div>', { sticky: true });
          U.$('#retry', m.el).onclick = function () {
            if (!done) { prog.retries[f.ch.id] = true; S.save(); }
            m.close(); lives = st.lives; U.$('#hearts').outerHTML = U.hearts(lives, st.lives).replace('class="hearts"', 'class="hearts" id="hearts"'); player.unlock();
          };
        }
      },
      onPass: function (info) {
        if (done) { U.toast('Correct! (Replay — no extra XP)'); setTimeout(function () { U.modal('<div class="reward"><div class="big-ico">✅</div><h2>Nice practice!</h2><p>You already earned XP for this challenge.</p><div class="btn-row" style="justify-content:center"><a class="btn" href="#/map" data-close>Map</a><a class="btn primary" href="' + nx.href + '" data-close>' + nx.label + '</a></div></div>'); }, 400); return; }
        var r = E.award(me.id, f.ch, info);
        if (info.query) { prog.completed[f.ch.id].query = info.query; S.save(); }
        A.refreshShell();
        setTimeout(function () { SQ.Player.rewardModal(r, 'Challenge complete!', '<a class="btn" href="#/map" data-close>World map</a><a class="btn primary" href="' + nx.href + '" data-close>' + nx.label + '</a>'); }, 450);
      }
    });
  });

  /* ───────── Boss battle ───────── */
  A.route('/boss/:wid', null, function (p, me) {
    var w = E.world(p.wid);
    if (!w) return A.view('<div class="card empty">World not found.</div>');
    if (!E.bossUnlocked(me.id, w)) return A.view('<div class="card empty"><span class="big">🔒</span><h2>The boss is sleeping</h2><p>Complete every level in ' + esc(w.name) + ' to wake it.</p><a class="btn" href="#/map">Back to map</a></div>');
    var st = S.settings(), prog = S.progress(me.id), limit = Math.round(w.boss.timeLimit * st.bossTimeMultiplier);
    var monsters = { w1: '🗿', w2: '🦁', w3: '🐉', w4: '🧙', w5: '🐲' };
    A.view('<div class="wc-' + w.id + '" style="max-width:760px;margin:0 auto"><div class="crumbs"><a href="#/map">Worlds</a> › ' + esc(w.name) + ' › Boss</div><div class="card boss-hero"><div class="monster">' + monsters[w.id] + '</div><span class="type-tag">⚔️ Boss battle · World ' + w.num + '</span><h1 style="margin:6px 0">' + esc(w.boss.title) + '</h1>' +
      '<p class="muted">Answer all ' + w.boss.challenges.length + ' questions before time runs out. A wrong answer costs a life. No hints!</p>' +
      '<div class="btn-row" style="justify-content:center;margin:14px 0"><span class="pill">⏱️ ' + Math.floor(limit / 60) + ':' + String(limit % 60).padStart(2, '0') + '</span><span class="pill">' + U.hearts(st.lives, st.lives) + '</span><span class="pill xp">+' + w.boss.xp + ' XP + bonuses</span></div>' +
      (prog.bosses[w.id] ? '<p><span class="tag good">✓ Already defeated — replay for practice</span></p>' : '') +
      '<button class="btn primary lg" id="fight">⚔️ Start battle</button></div></div>');
    U.$('#fight').onclick = function () { battle(w, me, limit); };
  });

  function battle(w, me, limit) {
    var st = S.settings(), prog = S.progress(me.id), lives = st.lives, qi = 0, left = limit, over = false, t0 = Date.now();
    A.view('<div class="wc-' + w.id + '"><div class="card" style="margin-bottom:14px;padding:12px 16px"><div class="play-head" style="margin:0"><div><b>⚔️ ' + esc(w.boss.title) + '</b><div class="boss-steps" id="steps" style="justify-content:flex-start"></div></div>' +
      '<div class="btn-row"><span id="bh"></span><span class="timer" id="timer"></span></div></div><div class="bar thin" style="margin-top:10px"><span id="tbar" style="width:100%;background:var(--wc)"></span></div></div><div id="stage"></div></div>');
    function hud() {
      U.$('#bh').innerHTML = U.hearts(lives, st.lives);
      U.$('#steps').innerHTML = w.boss.challenges.map(function (_, i) { return '<span class="' + (i < qi ? 'done' : i === qi ? 'cur' : '') + '"></span>'; }).join('');
    }
    function tick() {
      if (over) return;
      left = Math.max(0, limit - Math.floor((Date.now() - t0) / 1000));
      var tm = U.$('#timer'); if (!tm) return;
      tm.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      tm.classList.toggle('low', left <= 30);
      U.$('#tbar').style.width = (100 * left / limit) + '%';
      if (left <= 0) end(false, 'Time ran out!');
    }
    var iv = setInterval(tick, 250);
    A.onCleanup(function () { clearInterval(iv); over = true; });
    function show() {
      hud();
      var ch = w.boss.challenges[qi];
      SQ.Player.mount(U.$('#stage'), ch, {
        mode: 'boss', hints: false,
        onWrong: function () { lives--; hud(); if (lives <= 0) end(false, 'You ran out of lives!'); },
        onPass: function () { qi++; hud(); if (qi >= w.boss.challenges.length) end(true); else setTimeout(function () { if (!over) show(); }, 900); }
      });
    }
    function end(win, why) {
      if (over) return; over = true; clearInterval(iv);
      var stage = U.$('#stage');
      if (!win) {
        stage.innerHTML = '';
        var m = U.modal('<div class="reward"><div class="big-ico">💀</div><h2>Defeated</h2><p>' + esc(why) + ' Review the world’s lessons and try again — the boss resets with full lives and time.</p><div class="btn-row" style="justify-content:center"><a class="btn" href="#/map" data-close>World map</a><button class="btn primary" id="again">↺ Try again</button></div></div>', { sticky: true });
        U.$('#again', m.el).onclick = function () { m.close(); battle(w, me, limit); };
        return;
      }
      var info = { lives: lives, timeLeft: left, timeLimit: limit, seconds: Math.round((Date.now() - t0) / 1000) };
      S.logSubmission({ userId: me.id, challengeId: w.boss.id, worldId: w.id, topic: 'boss', ok: true, seconds: info.seconds, mode: 'boss' });
      stage.innerHTML = '<div class="card boss-hero"><div class="monster">🏆</div><h1>' + esc(w.boss.title) + ' defeated!</h1></div>';
      if (prog.bosses[w.id] || me.role !== 'student') { U.modal('<div class="reward"><div class="big-ico">🏆</div><h2>Victory!</h2><p>' + (me.role !== 'student' ? 'Preview complete (staff accounts do not earn XP).' : 'You already conquered this boss — great practice!') + '</p><div class="btn-row" style="justify-content:center"><a class="btn primary" href="#/map" data-close>World map</a></div></div>'); U.confetti(); return; }
      var r = E.awardBoss(me.id, w, info); A.refreshShell();
      var nextW = SQ.WORLDS[w.num];
      SQ.Player.rewardModal(r, 'Boss defeated! ' + (nextW ? nextW.name + ' unlocked!' : 'You conquered every world!'), '<a class="btn" href="#/map" data-close>World map</a>' + (nextW ? '<a class="btn primary" href="#/lesson/' + nextW.id + 'l1" data-close>Enter ' + esc(nextW.name) + ' →</a>' : '<a class="btn primary" href="#/badges" data-close>See badges</a>'));
    }
    tick(); show();
  }

  /* ───────── Team missions ───────── */
  A.route('/team', ['student'], function (p, me) {
    var db = S.raw();
    var team = db.teams.find(function (t) { return t.memberIds.indexOf(me.id) >= 0; });
    if (!team) return A.view('<div class="page-head"><div><h1>Team missions</h1></div></div><div class="card empty"><span class="big">🤝</span><h2>You are not in a team yet</h2><p>Your teacher creates teams and picks a team leader. Team missions give every member XP.</p></div>');
    var isLeader = team.leaderId === me.id;
    A.view('<div class="page-head"><div><h1>Team missions</h1><p>Work together: anyone can draft and save the team’s query; the <b>team leader</b> submits the final answer.</p></div></div>' +
      '<div class="split" style="margin-bottom:16px"><div class="card"><h3>🤝 ' + esc(team.name) + '</h3><div class="list">' + team.memberIds.map(function (id) { var u = S.user(id); return u ? '<div class="list-item"><span class="avatar">' + esc(u.avatar) + '</span><span class="grow">' + esc(u.displayName) + (id === me.id ? ' <span class="tag brand">You</span>' : '') + '</span>' + (id === team.leaderId ? '<span class="tag xp">👑 Team leader</span>' : '<span class="tag">Team member</span>') + '</div>' : ''; }).join('') + '</div></div>' +
      '<div class="card"><h3>Missions</h3><div class="list">' + SQ.TEAM_MISSIONS.map(function (m) { var d = team.done[m.id]; return '<a class="list-item" href="#/team/' + m.id + '" style="color:var(--ink)"><span class="badge-mini" style="background:var(--brand-soft)">🎯</span><span class="grow"><b>' + esc(m.title) + '</b><br><small>+' + m.xp + ' XP for every member</small></span>' + (d ? '<span class="tag good">✓ Done</span>' : '<span class="btn sm primary">Open</span>') + '</a>'; }).join('') + '</div></div></div>' +
      '<div class="card"><small>' + (isLeader ? '👑 You are the team leader — you submit final answers.' : 'Only ' + esc((S.user(team.leaderId) || {}).displayName || 'the leader') + ' can submit. Save a draft so your leader can see your idea.') + '</small></div>');
  });
  A.route('/team/:mid', ['student'], function (p, me) {
    var db = S.raw(), m = SQ.TEAM_MISSIONS.find(function (x) { return x.id === p.mid; });
    var team = db.teams.find(function (t) { return t.memberIds.indexOf(me.id) >= 0; });
    if (!m || !team) return A.go('#/team');
    var key = team.id + ':' + m.id, isLeader = team.leaderId === me.id, draft = db.drafts[key];
    A.view('<div class="crumbs"><a href="#/team">Team missions</a> › ' + esc(m.title) + '</div><div class="play-head"><div class="btn-row"><span class="tag xp">+' + m.xp + ' XP each</span>' + (team.done[m.id] ? '<span class="tag good">✓ Completed by your team</span>' : '') + '</div>' +
      '<small id="draftinfo">' + (draft ? 'Team draft saved by ' + esc((S.user(draft.by) || {}).displayName) + ' · ' + U.timeAgo(draft.at) : 'No team draft yet') + '</small></div><div id="stage"></div>');
    var current = draft ? draft.sql : '';
    SQ.Player.mount(U.$('#stage'), m, {
      mode: 'team', initial: current, canSubmit: isLeader && !team.done[m.id],
      extraButtons: '<button class="btn" id="save-draft" type="button">💾 Save team draft</button>',
      onDraft: function (v) { current = v; },
      onPass: function (info) {
        team.done[m.id] = { at: Date.now(), by: me.id };
        var badges = [];
        team.memberIds.forEach(function (id) { var pr = S.progress(id); pr.xp += m.xp; pr.teamMissions++; var nb = E.checkBadges(id); if (id === me.id) badges = nb; });
        S.touchStreak(me.id); S.save(); A.refreshShell();
        setTimeout(function () { SQ.Player.rewardModal({ base: m.xp, total: m.xp, newBadges: badges }, 'Team mission complete! Everyone earned XP.', '<a class="btn primary" href="#/team" data-close>Back to team</a>'); }, 450);
      }
    });
    U.$('#save-draft').onclick = function () { db.drafts[key] = { sql: current, by: me.id, at: Date.now() }; S.save(); U.$('#draftinfo').textContent = 'Team draft saved by you · just now'; U.toast('Draft saved for your team'); };
  });
})();
