/* Sandbox runner + auto-grader. */
window.SQ = window.SQ || {};

SQ.Sandbox = (function () {
  var worker = null, seq = 0, pending = {}, inline = null, warm = false;

  function makeWorker() {
    try {
      worker = new Worker('js/sandbox-worker.js');
      worker.onmessage = function (ev) {
        var p = pending[ev.data.id];
        warm = true;
        if (p) { clearTimeout(p.timer); delete pending[ev.data.id]; p.resolve(ev.data); }
      };
      worker.onerror = function () { useInline(); };
    } catch (e) { useInline(); }
  }

  /* Fallback when workers are unavailable (e.g. opened from file://). No time limit is possible here. */
  function useInline() {
    if (worker) { try { worker.terminate(); } catch (e) {} }
    worker = null;
    if (!inline) {
      inline = new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = 'vendor/sql-wasm.js';
        s.onload = function () { initSqlJs({ locateFile: function (f) { return 'vendor/' + f; } }).then(res, rej); };
        s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    Object.keys(pending).forEach(function (k) { var p = pending[k]; delete pending[k]; clearTimeout(p.timer); runInline(p.msg).then(p.resolve); });
  }

  function runInline(m) {
    return inline.then(function (SQL) {
      var db = new SQL.Database(), out = { id: m.id };
      try {
        db.exec(m.setup);
        var res = db.exec(m.sql), r = res.length ? res[res.length - 1] : null;
        out.result = r ? { columns: r.columns, values: r.values.slice(0, m.maxRows), total: r.values.length } : null;
        out.changes = db.getRowsModified();
        if (m.check) out.check = m.check.map(function (q) {
          try { var c = db.exec(q); c = c.length ? c[c.length - 1] : { columns: [], values: [] }; return { columns: c.columns, values: c.values }; }
          catch (e) { return { error: String(e.message || e) }; }
        });
      } catch (e) { out.error = String(e.message || e); }
      db.close();
      return out;
    });
  }

  function run(sql, opts) {
    opts = opts || {};
    var msg = { id: ++seq, setup: SQ.SANDBOX_SQL, sql: sql, check: opts.check || null, maxRows: opts.maxRows || 500 };
    if (!worker && !inline) makeWorker();
    if (!worker) return runInline(msg);
    var timeout = (SQ.Store && SQ.Store.settings().queryTimeoutMs) || 2000;
    return new Promise(function (resolve) {
      var p = { resolve: resolve, msg: msg };
      p.timer = setTimeout(function () {
        delete pending[msg.id];
        worker.terminate(); warm = false; makeWorker();
        resolve({ id: msg.id, error: 'Time limit exceeded (' + (timeout / 1000) + 's). Your query ran too long and was stopped.', timeout: true });
      }, warm ? timeout : timeout + 8000 /* the first call also loads the WASM engine */);
      pending[msg.id] = p;
      worker.postMessage(msg);
    });
  }

  return { run: run };
})();

SQ.Grader = (function () {
  /* Remove comments and string literals so keyword checks are not fooled. */
  function strip(sql) {
    return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''");
  }
  function statements(sql) {
    return strip(sql).split(';').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function kind(stmt) {
    var w = (stmt.match(/^[a-z]+/i) || [''])[0].toUpperCase();
    if (w === 'SELECT' || w === 'WITH' || w === 'VALUES' || w === 'EXPLAIN') return 'select';
    if (w === 'INSERT' || w === 'UPDATE' || w === 'DELETE' || w === 'REPLACE') return 'dml';
    if (w === 'CREATE' || w === 'ALTER' || w === 'DROP') return 'ddl';
    if (['BEGIN', 'COMMIT', 'ROLLBACK', 'END', 'SAVEPOINT', 'RELEASE'].indexOf(w) >= 0) return 'tx';
    return 'other:' + w;
  }

  /* Safety: blocked patterns (admin-configurable) and per-challenge allowed statement kinds. */
  function safety(sql, allow) {
    var s = strip(sql), up = s.toUpperCase();
    var blocked = SQ.Store.settings().blocked || [];
    for (var i = 0; i < blocked.length; i++) {
      var pat = blocked[i].trim().toUpperCase();
      if (pat && new RegExp('\\b' + pat.replace(/\s+/g, '\\s+') + '\\b').test(up))
        return 'Blocked command: “' + blocked[i] + '” is not allowed in the sandbox.';
    }
    var ok = ['select'].concat(allow || []);
    var st = statements(sql);
    if (!st.length) return 'Type a query first.';
    for (var j = 0; j < st.length; j++) {
      var k = kind(st[j]);
      if (k.indexOf('other') === 0) return 'Unknown command “' + (k.slice(6) || st[j].slice(0, 12)) + '” — check the spelling of your SQL keywords.';
      if (ok.indexOf(k) < 0) {
        var names = { dml: 'INSERT/UPDATE/DELETE', ddl: 'CREATE/ALTER/DROP', tx: 'transaction' };
        return names[k] + ' statements are not needed for this challenge — use SELECT.';
      }
    }
    if (st.length > 20) return 'Too many statements (limit 20).';
    return null;
  }

  function norm(v) {
    if (v === null || v === undefined) return '∅';
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
    return String(v);
  }
  function rowKeys(r) { return r.values.map(function (row) { return row.map(norm).join('\u0001'); }); }

  /* Try to line up the student's columns with the expected ones by name (handles different column order). */
  function alignColumns(exp, got) {
    if (!exp || !got || exp.columns.length !== got.columns.length) return got;
    var ln = function (c) { return String(c).toLowerCase().replace(/^.*\./, ''); };
    var e = exp.columns.map(ln), g = got.columns.map(ln), idx = [];
    for (var i = 0; i < e.length; i++) {
      var j = g.indexOf(e[i]);
      if (j < 0 || idx.indexOf(j) >= 0) return got;
      idx.push(j);
    }
    return { columns: idx.map(function (j) { return got.columns[j]; }), values: got.values.map(function (row) { return idx.map(function (j) { return row[j]; }); }) };
  }

  function compare(exp, got, ordered) {
    exp = exp || { columns: [], values: [] }; got = got || { columns: [], values: [] };
    if (exp.columns.length !== got.columns.length) return { ok: false, why: 'columns' };
    var tryAligned = [got, alignColumns(exp, got)];
    for (var t = 0; t < tryAligned.length; t++) {
      var g = tryAligned[t];
      var a = rowKeys(exp), b = rowKeys(g);
      if (a.length !== b.length) return { ok: false, why: 'rows', exp: a.length, got: b.length };
      if (a.join('\n') === b.join('\n')) return { ok: true };
      var as = a.slice().sort().join('\n'), bs = b.slice().sort().join('\n');
      if (as === bs) { if (!ordered) return { ok: true }; return { ok: false, why: 'order' }; }
    }
    return { ok: false, why: 'values' };
  }

  var solutionCache = {};
  function expected(ch) {
    if (solutionCache[ch.id]) return Promise.resolve(solutionCache[ch.id]);
    return SQ.Sandbox.run(ch.solution, { check: ch.check, maxRows: 5000 }).then(function (r) { solutionCache[ch.id] = r; return r; });
  }

  /* Feedback heuristics → category used by teacher analytics. */
  function diagnose(ch, sql, cmp) {
    var s = strip(sql).toUpperCase(), sol = strip(ch.solution).toUpperCase();
    var has = function (src, re) { return re.test(src); };
    if (cmp.why === 'columns') return ['columns', 'Your result has a different number of columns than expected. Check which columns the question asks for.'];
    if (cmp.why === 'order') return ['order', 'Right rows, wrong order. Check your ORDER BY (column and ASC/DESC).'];
    if (has(sol, /\bJOIN\b/) && has(s, /\bJOIN\b/) && !has(s, /\bON\b|\bUSING\b/) )
      return ['join_condition', 'Missing JOIN condition: a JOIN without ON pairs every row with every row. Add ON a.col = b.col.'];
    if (has(sol, /\bJOIN\b/) && /FROM\s+\w+(\s+\w+)?\s*,\s*\w+/.test(s) && !has(s, /\bWHERE\b/))
      return ['join_condition', 'You listed two tables but never said how they match. Add a JOIN … ON condition.'];
    if (has(sol, /\bLEFT\s+JOIN\b/) && !has(s, /\bLEFT\b/) && cmp.why === 'rows' && cmp.got < cmp.exp)
      return ['join_type', 'Some rows are missing. An INNER JOIN drops rows with no match — should this be a LEFT JOIN?'];
    if (has(sol, /\bIS\s+NULL\b/) && !has(s, /\bIS\s+NULL\b/)) return ['missing_where', 'Too many rows. To find rows with no match, filter WHERE … IS NULL.'];
    if (has(sol, /\bWHERE\b/) && !has(s, /\bWHERE\b/)) return ['missing_where', 'You returned too many rows — this question needs a WHERE filter.'];
    if (has(sol, /\bLIMIT\b/) && !has(s, /\bLIMIT\b/)) return ['missing_limit', 'Too many rows — did you forget LIMIT?'];
    if (cmp.why === 'rows') return ['row_count', 'You returned ' + cmp.got + ' row(s) but ' + cmp.exp + ' were expected. Re-check your conditions.'];
    return ['wrong_values', 'The values don’t match the expected result. Re-read the question and check your conditions and columns.'];
  }

  function classifyError(msg) {
    if (/no such column/i.test(msg)) return ['unknown_name', 'SQLite error: ' + msg + '. Check spelling — and remember text values need single quotes.'];
    if (/no such table/i.test(msg)) return ['unknown_name', 'SQLite error: ' + msg + '. Check the table name in the schema panel.'];
    if (/syntax error/i.test(msg)) return ['syntax', 'Syntax error: ' + msg + '. Check keyword spelling, commas and brackets.'];
    if (/ambiguous column/i.test(msg)) return ['ambiguous', 'SQLite error: ' + msg + '. Prefix the column with its table alias, e.g. s.name.'];
    return ['runtime', 'SQLite error: ' + msg];
  }

  /* Grade a SQL challenge. Resolves {pass, category, message, got, exp}. */
  function gradeSQL(ch, sql) {
    var block = safety(sql, ch.allow);
    if (block) return Promise.resolve({ pass: false, category: /^Unknown command/.test(block) ? 'syntax' : 'blocked', message: block });
    var up = strip(sql).toUpperCase();
    var missing = (ch.requireKeywords || []).filter(function (k) { return !new RegExp('\\b' + k + '\\b').test(up); });
    return Promise.all([expected(ch), SQ.Sandbox.run(sql, { check: ch.check, maxRows: 5000 })]).then(function (rr) {
      var exp = rr[0], got = rr[1];
      if (got.timeout) return { pass: false, category: 'timeout', message: got.error };
      if (got.error) { var ce = classifyError(got.error); return { pass: false, category: ce[0], message: ce[1] }; }
      var cmp;
      if (ch.check) {
        for (var i = 0; i < ch.check.length; i++) {
          if (got.check[i].error) return { pass: false, category: 'runtime', message: 'Checking your work failed: ' + got.check[i].error };
          cmp = compare(exp.check[i], got.check[i], true);
          if (!cmp.ok) break;
        }
        if (!cmp.ok) return { pass: false, category: 'wrong_values', message: 'The database is not in the expected state after your script. Compare the “after” table below with what the task asks for.', got: got.check[0], exp: exp.check[0] };
      } else {
        cmp = compare(exp.result, got.result, !!ch.ordered);
        if (!cmp.ok) { var d = diagnose(ch, sql, cmp); return { pass: false, category: d[0], message: d[1], got: got.result, exp: exp.result }; }
      }
      if (missing.length) return { pass: false, category: 'missing_keyword', message: 'Right result, but the task requires ' + missing.join(' and ') + '. Wrap your statements in a transaction.' };
      return { pass: true, message: 'Correct! Your result matches the expected result.', got: ch.check ? got.check[0] : got.result };
    });
  }

  function gradeOther(ch, answer) {
    if (ch.type === 'quiz') {
      var ok = answer === ch.answer;
      return { pass: ok, category: ok ? null : 'concept', message: ok ? 'Correct! ' + (ch.explain || '') : 'Not quite. ' + (ch.explainWrong || 'Re-read the question and try again.') };
    }
    if (ch.type === 'short') {
      var a = String(answer || '').trim().toLowerCase().replace(/[.!]$/, '').replace(/\s+/g, ' ');
      var ok2 = (ch.accept || []).some(function (x) { return x.toLowerCase() === a; });
      return { pass: ok2, category: ok2 ? null : 'concept', message: ok2 ? 'Correct! ' + (ch.explain || '') : 'Not quite — check spelling, or look back at the lesson.' };
    }
    if (ch.type === 'drag') {
      var wrong = ch.items.filter(function (it, i) { return answer[i] !== it.bin; }).length;
      var unplaced = ch.items.filter(function (it, i) { return answer[i] === undefined || answer[i] === null; }).length;
      if (unplaced) return { pass: false, category: 'incomplete', message: 'Place every item before submitting (' + unplaced + ' left).', noPenalty: true };
      return { pass: !wrong, category: wrong ? 'design' : null, message: wrong ? wrong + ' item(s) are in the wrong place. Wrong items are marked in red.' : 'Perfect design!' };
    }
  }

  return { gradeSQL: gradeSQL, gradeOther: gradeOther, safety: safety, strip: strip };
})();

SQ.ERROR_LABELS = {
  syntax: 'Syntax errors', unknown_name: 'Unknown table/column (often missing quotes)', columns: 'Wrong columns selected',
  order: 'Wrong ORDER BY', join_condition: 'Missing JOIN condition', join_type: 'INNER vs LEFT JOIN confusion',
  missing_where: 'Missing WHERE filter', missing_limit: 'Missing LIMIT', row_count: 'Wrong number of rows',
  wrong_values: 'Wrong values', concept: 'Concept (quiz/short answer)', design: 'Design / ER mistakes',
  blocked: 'Blocked or disallowed command', timeout: 'Time limit exceeded', ambiguous: 'Ambiguous column',
  runtime: 'Runtime error', missing_keyword: 'Missing required keyword', incomplete: 'Incomplete answer'
};
