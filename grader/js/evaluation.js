/*
 * Evaluation of tool marks against examiners (manuscript §4.3–4.7, Tables 5–8).
 * Pure data functions; rendering lives in app.js.
 */
(function (root) {
  'use strict';

  var S = root.GraderStats || (typeof require === 'function' ? require('./stats.js') : null);

  function parseCsv(text) {
    var rows = [], row = [], field = '', q = false, s = String(text || '');
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (q) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(function (x) { return x.trim() !== ''; })) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(function (x) { return x.trim() !== ''; })) rows.push(row);
    return rows;
  }

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n') + '\n'; }

  function num(v) {
    if (v === undefined || v === null) return null;
    var s = String(v).trim();
    if (!s) return null;
    var n = parseFloat(s.replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  /** CSV text → {rows, errors, hasBaseline}. */
  function readMarks(text) {
    var table = parseCsv(text);
    var errors = [];
    if (table.length < 2) return { rows: [], errors: ['Paste a CSV with a header row and at least one data row.'], hasBaseline: false };
    var head = table[0].map(function (h) { return h.trim().toLowerCase().replace(/\s+/g, '_'); });
    function col() {
      for (var i = 0; i < arguments.length; i++) { var k = head.indexOf(arguments[i]); if (k >= 0) return k; }
      return -1;
    }
    var ci = {
      script: col('script', 'script_id', 'student', 'candidate'),
      question: col('question', 'q', 'question_id'),
      max: col('max', 'max_mark', 'maximum'),
      tool: col('tool', 'tool_mark', 'suggested', 'machine'),
      reference: col('reference', 'ref', 'reference_mark', 'human'),
      e1: col('examiner1', 'examiner_1', 'e1', 'rater1'),
      e2: col('examiner2', 'examiner_2', 'e2', 'rater2'),
      e3: col('examiner3', 'examiner_3', 'e3', 'adjudicator')
    };
    if (ci.script < 0) errors.push('Missing column "script".');
    if (ci.tool < 0) errors.push('Missing column "tool".');
    if (ci.max < 0) errors.push('Missing column "max".');
    if (ci.reference < 0 && (ci.e1 < 0 || ci.e2 < 0)) errors.push('Need a "reference" column, or "examiner1" and "examiner2".');
    if (errors.length) return { rows: [], errors: errors, hasBaseline: false };
    var rows = [];
    table.slice(1).forEach(function (r, i) {
      var get = function (k) { return ci[k] >= 0 ? r[ci[k]] : undefined; };
      var row = {
        script: String(get('script') || '').trim(),
        question: String(get('question') || String(i + 1)).trim(),
        max: num(get('max')), tool: num(get('tool')), reference: num(get('reference')),
        e1: num(get('e1')), e2: num(get('e2')), e3: num(get('e3'))
      };
      if (row.reference === null && row.e1 !== null && row.e2 !== null && row.max) {
        row.reference = Math.abs(row.e1 - row.e2) > 0.2 * row.max && row.e3 !== null ? row.e3 : (row.e1 + row.e2) / 2;
        row.adjudicated = Math.abs(row.e1 - row.e2) > 0.2 * row.max;
      }
      if (!row.script || row.max === null || row.tool === null || row.reference === null) {
        errors.push('Row ' + (i + 2) + ' skipped (missing script, max, tool or reference).');
        return;
      }
      rows.push(row);
    });
    var hasBaseline = rows.length > 0 && rows.every(function (r) { return r.e1 !== null && r.e2 !== null; });
    return { rows: rows, errors: errors, hasBaseline: hasBaseline };
  }

  function markStep(values) {
    var steps = [1, 0.5, 0.25];
    for (var i = 0; i < steps.length; i++) {
      var st = steps[i];
      if (values.every(function (v) { return Math.abs(v / st - Math.round(v / st)) < 1e-6; })) return st;
    }
    return 0.25;
  }

  function groupByScript(rows) {
    var map = new Map();
    rows.forEach(function (r) { if (!map.has(r.script)) map.set(r.script, []); map.get(r.script).push(r); });
    return Array.from(map.values());
  }

  function totals(clusters, a, b) {
    return clusters.map(function (c) {
      return {
        script: c[0].script,
        a: c.reduce(function (s, r) { return s + r[a]; }, 0),
        b: c.reduce(function (s, r) { return s + r[b]; }, 0),
        max: c.reduce(function (s, r) { return s + r.max; }, 0)
      };
    });
  }

  /** Agreement metrics for marks in field a (e.g. tool) against field b (e.g. reference). */
  function agreement(rows, a, b, opts) {
    var A = rows.map(function (r) { return r[a]; }), B = rows.map(function (r) { return r[b]; });
    var step = markStep(A.concat(B));
    var clusters = groupByScript(rows);
    var tot = totals(clusters, a, b);
    var boot = opts.B > 0;
    function maeOf(rs) { return S.mae(rs.map(function (r) { return r[a]; }), rs.map(function (r) { return r[b]; })); }
    function qwkOf(rs) { return S.qwk(rs.map(function (r) { return r[a]; }), rs.map(function (r) { return r[b]; }), step); }
    function iccOf(rs) { return S.icc21([rs.map(function (r) { return r[a]; }), rs.map(function (r) { return r[b]; })]); }

    var ba = S.blandAltman(A, B);
    var abs = A.map(function (x, i) { return Math.abs(x - B[i]); });
    var maePct = S.mean(rows.map(function (r) { return Math.abs(r[a] - r[b]) / r.max * 100; }));
    var rhoTot = S.spearman(tot.map(function (t) { return t.a; }), tot.map(function (t) { return t.b; }));

    var out = {
      n: rows.length,
      scripts: clusters.length,
      step: step,
      mae: S.mae(A, B),
      maePct: maePct,
      rmse: S.rmse(A, B),
      bias: ba.bias,
      sdDiff: ba.sd,
      loa: [ba.lower, ba.upper],
      smd: S.smd(A, B),
      qwk: S.qwk(A, B, step),
      icc: S.icc21([A, B]),
      rho: rhoTot,
      abs: abs,
      points: A.map(function (x, i) { return [(x + B[i]) / 2, x - B[i]]; }),
      bands: S.errorBands(abs),
      totals: tot
    };
    if (boot) {
      out.maeCI = S.clusterBootstrap(clusters, maeOf, opts.B, 11);
      out.qwkCI = S.clusterBootstrap(clusters, qwkOf, opts.B, 12);
      out.iccCI = S.clusterBootstrap(clusters, iccOf, opts.B, 13);
      // ρ on script totals: each resampled cluster contributes one (a, b) total pair.
      var pairs = tot.map(function (t) { return [{ a: t.a, b: t.b }]; });
      out.rhoCI = S.clusterBootstrap(pairs, function (rs) {
        return S.spearman(rs.map(function (r) { return r.a; }), rs.map(function (r) { return r.b; }));
      }, opts.B, 14);
    }
    return out;
  }

  function decisions(rows, a, b, passPct) {
    var p = passPct / 100;
    var clusters = groupByScript(rows);
    var tot = totals(clusters, a, b);
    var scriptCm = S.confusion(tot.map(function (t) { return t.a >= p * t.max - 1e-9; }), tot.map(function (t) { return t.b >= p * t.max - 1e-9; }));
    var respCm = S.confusion(rows.map(function (r) { return r[a] >= p * r.max - 1e-9; }), rows.map(function (r) { return r[b] >= p * r.max - 1e-9; }));
    return {
      script: { cm: scriptCm, ix: S.classificationIndices(scriptCm) },
      response: { cm: respCm, ix: S.classificationIndices(respCm) }
    };
  }

  function evaluate(rows, hasBaseline, opts) {
    opts = Object.assign({ passPct: 50, B: 2000 }, opts || {});
    var tool = agreement(rows, 'tool', 'reference', opts);
    var human = hasBaseline ? agreement(rows, 'e1', 'e2', opts) : null;
    var dec = decisions(rows, 'tool', 'reference', opts.passPct);
    var criteria = [
      { name: 'MAE ≤ 10% of the maximum mark', met: tool.maePct <= 10, value: tool.maePct.toFixed(1) + '%' },
      { name: '|Standardised mean difference| ≤ 0.15', met: Math.abs(tool.smd) <= 0.15, value: tool.smd.toFixed(2) },
      { name: 'QWK ≥ 0.70', met: tool.qwk >= 0.70, value: tool.qwk.toFixed(2) }
    ];
    if (human) criteria.push({ name: 'QWK no more than 0.10 below human–human', met: human.qwk - tool.qwk <= 0.10, value: (human.qwk - tool.qwk).toFixed(2) + ' below' });
    criteria.push({ name: 'ICC(2,1) ≥ 0.75', met: tool.icc >= 0.75, value: tool.icc.toFixed(2) });
    criteria.push({ name: 'Script-level Cohen\'s κ ≥ 0.61', met: dec.script.ix.kappa.value >= 0.61, value: dec.script.ix.kappa.value.toFixed(2) });
    return { tool: tool, human: human, decisions: dec, criteria: criteria, passPct: opts.passPct };
  }

  var api = { parseCsv: parseCsv, toCsv: toCsv, readMarks: readMarks, agreement: agreement, decisions: decisions, evaluate: evaluate, markStep: markStep };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GraderEvaluation = api;
})(typeof self !== 'undefined' ? self : this);
