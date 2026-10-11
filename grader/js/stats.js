/*
 * Agreement and classification statistics for evaluating the tool against
 * examiners (manuscript §4.6–4.7): MAE, RMSE, bias, Bland–Altman limits,
 * standardised mean difference, quadratic weighted kappa, ICC(2,1),
 * Spearman's ρ, confusion-matrix indices with Clopper–Pearson intervals,
 * Cohen's κ, McNemar's test, Wilcoxon signed-rank test, cluster bootstrap,
 * and character/word error rates.
 */
(function (root) {
  'use strict';

  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function mean(a) { return a.length ? sum(a) / a.length : NaN; }
  function variance(a) {
    if (a.length < 2) return NaN;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return s / (a.length - 1);
  }
  function sd(a) { return Math.sqrt(variance(a)); }
  function quantile(a, p) {
    if (!a.length) return NaN;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
    return s[lo] + (s[hi] - s[lo]) * (h - lo);
  }
  function median(a) { return quantile(a, 0.5); }

  function diffs(tool, ref) { return tool.map(function (t, i) { return t - ref[i]; }); }
  function mae(tool, ref) { return mean(diffs(tool, ref).map(Math.abs)); }
  function rmse(tool, ref) { return Math.sqrt(mean(diffs(tool, ref).map(function (d) { return d * d; }))); }

  function blandAltman(tool, ref) {
    var d = diffs(tool, ref), b = mean(d), s = sd(d);
    return { bias: b, sd: s, lower: b - 1.96 * s, upper: b + 1.96 * s };
  }

  // Williamson et al. (2012): (mean_machine − mean_human) / pooled SD.
  function smd(tool, ref) {
    var pooled = Math.sqrt((variance(tool) + variance(ref)) / 2);
    return pooled ? (mean(tool) - mean(ref)) / pooled : 0;
  }

  /** Quadratic weighted kappa. Marks are mapped to ordinal categories of width `step`. */
  function qwk(a, b, step) {
    step = step || 1;
    var ca = a.map(function (x) { return Math.round(x / step); });
    var cb = b.map(function (x) { return Math.round(x / step); });
    var lo = Math.min.apply(null, ca.concat(cb)), hi = Math.max.apply(null, ca.concat(cb));
    var K = hi - lo + 1, n = a.length;
    if (K < 2) return 1;
    var O = [], i, j;
    for (i = 0; i < K; i++) { O.push(new Array(K).fill(0)); }
    var ha = new Array(K).fill(0), hb = new Array(K).fill(0);
    for (i = 0; i < n; i++) { O[ca[i] - lo][cb[i] - lo]++; ha[ca[i] - lo]++; hb[cb[i] - lo]++; }
    var num = 0, den = 0;
    for (i = 0; i < K; i++) for (j = 0; j < K; j++) {
      var wgt = (i - j) * (i - j) / ((K - 1) * (K - 1));
      num += wgt * O[i][j];
      den += wgt * ha[i] * hb[j] / n;
    }
    return den ? 1 - num / den : 1;
  }

  /** ICC(2,1): two-way random effects, absolute agreement, single rater (Shrout & Fleiss). */
  function icc21(columns) {
    var k = columns.length, n = columns[0].length;
    var all = [], i, j;
    for (j = 0; j < k; j++) all = all.concat(columns[j]);
    var gm = mean(all);
    var rowMeans = [], colMeans = columns.map(mean);
    for (i = 0; i < n; i++) {
      var s = 0;
      for (j = 0; j < k; j++) s += columns[j][i];
      rowMeans.push(s / k);
    }
    var ssr = 0, ssc = 0, sst = 0;
    for (i = 0; i < n; i++) ssr += k * (rowMeans[i] - gm) * (rowMeans[i] - gm);
    for (j = 0; j < k; j++) ssc += n * (colMeans[j] - gm) * (colMeans[j] - gm);
    for (j = 0; j < k; j++) for (i = 0; i < n; i++) sst += (columns[j][i] - gm) * (columns[j][i] - gm);
    var sse = sst - ssr - ssc;
    var msr = ssr / (n - 1), msc = ssc / (k - 1), mse = sse / ((n - 1) * (k - 1));
    var den = msr + (k - 1) * mse + k * (msc - mse) / n;
    return den ? (msr - mse) / den : NaN;
  }

  function ranks(a) {
    var idx = a.map(function (v, i) { return [v, i]; }).sort(function (x, y) { return x[0] - y[0]; });
    var r = new Array(a.length), i = 0;
    while (i < idx.length) {
      var j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      var avg = (i + j) / 2 + 1;
      for (var t = i; t <= j; t++) r[idx[t][1]] = avg;
      i = j + 1;
    }
    return r;
  }

  function pearson(x, y) {
    var mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < x.length; i++) {
      sxy += (x[i] - mx) * (y[i] - my);
      sxx += (x[i] - mx) * (x[i] - mx);
      syy += (y[i] - my) * (y[i] - my);
    }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
  }

  function spearman(x, y) { return pearson(ranks(x), ranks(y)); }

  // ---- special functions

  function erfc(x) {
    // Numerical Recipes erfc approximation, |error| < 1.2e-7.
    var z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
      t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  function normalCdf(z) { return 0.5 * erfc(-z / Math.SQRT2); }
  function chi2p1(x) { return erfc(Math.sqrt(x / 2)); } // upper tail, 1 df

  function lnGamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    var ser = 1.000000000190015;
    for (var j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function betacf(a, b, x) {
    var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= 200; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 3e-12) break;
    }
    return h;
  }

  function ibeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }

  function betaInv(p, a, b) {
    var lo = 0, hi = 1;
    for (var i = 0; i < 100; i++) {
      var mid = (lo + hi) / 2;
      if (ibeta(mid, a, b) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Exact (Clopper–Pearson) 95% interval for x successes out of n. */
  function clopperPearson(x, n, alpha) {
    alpha = alpha || 0.05;
    if (!n) return [NaN, NaN];
    return [x === 0 ? 0 : betaInv(alpha / 2, x, n - x + 1), x === n ? 1 : betaInv(1 - alpha / 2, x + 1, n - x)];
  }

  // ---- classification

  function confusion(toolPass, refPass) {
    var tp = 0, fp = 0, fn = 0, tn = 0;
    for (var i = 0; i < toolPass.length; i++) {
      if (toolPass[i] && refPass[i]) tp++;
      else if (toolPass[i] && !refPass[i]) fp++;
      else if (!toolPass[i] && refPass[i]) fn++;
      else tn++;
    }
    return { tp: tp, fp: fp, fn: fn, tn: tn, n: tp + fp + fn + tn };
  }

  function classificationIndices(c) {
    function prop(x, n) { return { value: n ? x / n : NaN, ci: clopperPearson(x, n), x: x, n: n }; }
    var n = c.n;
    var po = (c.tp + c.tn) / n;
    var pe = ((c.tp + c.fp) * (c.tp + c.fn) + (c.fn + c.tn) * (c.fp + c.tn)) / (n * n);
    var kappa = pe < 1 ? (po - pe) / (1 - pe) : 1;
    var seK = Math.sqrt(po * (1 - po) / (n * (1 - pe) * (1 - pe)));
    var b = c.fp, cc = c.fn;
    var chi = b + cc ? Math.pow(Math.abs(b - cc) - 1, 2) / (b + cc) : 0;
    if (b + cc && Math.abs(b - cc) < 1) chi = 0;
    return {
      accuracy: prop(c.tp + c.tn, n),
      sensitivity: prop(c.tp, c.tp + c.fn),
      specificity: prop(c.tn, c.tn + c.fp),
      ppv: prop(c.tp, c.tp + c.fp),
      npv: prop(c.tn, c.tn + c.fn),
      f1: 2 * c.tp + c.fp + c.fn ? 2 * c.tp / (2 * c.tp + c.fp + c.fn) : NaN,
      kappa: { value: kappa, ci: [kappa - 1.96 * seK, kappa + 1.96 * seK] },
      mcnemar: { chi2: chi, p: b + cc ? chi2p1(chi) : 1 }
    };
  }

  function cohenKappa(a, b) {
    var cats = {}, n = a.length, i;
    for (i = 0; i < n; i++) { cats[a[i]] = 1; cats[b[i]] = 1; }
    var keys = Object.keys(cats), agree = 0, pe = 0;
    for (i = 0; i < n; i++) if (a[i] === b[i]) agree++;
    keys.forEach(function (k) {
      var ca = a.filter(function (x) { return String(x) === k; }).length;
      var cb = b.filter(function (x) { return String(x) === k; }).length;
      pe += (ca / n) * (cb / n);
    });
    var po = agree / n;
    return pe < 1 ? (po - pe) / (1 - pe) : 1;
  }

  /** Wilcoxon signed-rank test (normal approximation with tie correction). */
  function wilcoxon(x, y) {
    var d = [];
    for (var i = 0; i < x.length; i++) { var v = y[i] - x[i]; if (v !== 0) d.push(v); }
    var n = d.length;
    if (!n) return { n: 0, w: 0, z: 0, p: 1 };
    var r = ranks(d.map(Math.abs));
    var wplus = 0;
    for (i = 0; i < n; i++) if (d[i] > 0) wplus += r[i];
    var counts = {};
    d.forEach(function (v) { var k = Math.abs(v); counts[k] = (counts[k] || 0) + 1; });
    var tie = 0;
    Object.keys(counts).forEach(function (k) { var t = counts[k]; tie += t * t * t - t; });
    var mu = n * (n + 1) / 4;
    var sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - tie / 48);
    var z = sigma ? (wplus - mu) / sigma : 0;
    return { n: n, w: wplus, z: z, p: 2 * (1 - normalCdf(Math.abs(z))) };
  }

  // ---- bootstrap

  function rng(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /**
   * Cluster bootstrap: resample whole clusters (scripts) with replacement.
   * clusters – array of arrays of rows; fn(rows) → number.
   */
  function clusterBootstrap(clusters, fn, B, seed) {
    B = B || 2000;
    var rand = rng(seed || 12345), vals = [];
    for (var b = 0; b < B; b++) {
      var rows = [];
      for (var i = 0; i < clusters.length; i++) {
        var c = clusters[Math.floor(rand() * clusters.length)];
        for (var j = 0; j < c.length; j++) rows.push(c[j]);
      }
      var v = fn(rows);
      if (isFinite(v)) vals.push(v);
    }
    return [quantile(vals, 0.025), quantile(vals, 0.975)];
  }

  // ---- OCR error rates

  function editDistance(a, b) {
    var n = a.length, m = b.length;
    if (!n) return m;
    if (!m) return n;
    var prev = new Array(m + 1), cur = new Array(m + 1), i, j;
    for (j = 0; j <= m; j++) prev[j] = j;
    for (i = 1; i <= n; i++) {
      cur[0] = i;
      for (j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      var t = prev; prev = cur; cur = t;
    }
    return prev[m];
  }

  function errorRates(reference, hypothesis) {
    function clean(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
    var r = clean(reference), h = clean(hypothesis);
    var rw = r ? r.split(' ') : [], hw = h ? h.split(' ') : [];
    return {
      cer: r.length ? editDistance(r, h) / r.length : NaN,
      wer: rw.length ? editDistance(rw, hw) / rw.length : NaN,
      chars: r.length,
      words: rw.length
    };
  }

  function errorBands(absErrors) {
    var bands = [
      { label: '0 (exact match)', test: function (e) { return e < 1e-9; } },
      { label: '> 0 and ≤ 1', test: function (e) { return e >= 1e-9 && e <= 1 + 1e-9; } },
      { label: '> 1 and ≤ 2', test: function (e) { return e > 1 + 1e-9 && e <= 2 + 1e-9; } },
      { label: '> 2', test: function (e) { return e > 2 + 1e-9; } }
    ];
    var n = absErrors.length, cum = 0;
    return bands.map(function (b) {
      var c = absErrors.filter(b.test).length;
      cum += c;
      return { label: b.label, n: c, pct: n ? 100 * c / n : NaN, cumPct: n ? 100 * cum / n : NaN };
    });
  }

  var api = {
    sum: sum, mean: mean, variance: variance, sd: sd, median: median, quantile: quantile,
    mae: mae, rmse: rmse, blandAltman: blandAltman, smd: smd, qwk: qwk, icc21: icc21,
    ranks: ranks, pearson: pearson, spearman: spearman,
    erfc: erfc, normalCdf: normalCdf, chi2p1: chi2p1, ibeta: ibeta, betaInv: betaInv,
    clopperPearson: clopperPearson, confusion: confusion, classificationIndices: classificationIndices,
    cohenKappa: cohenKappa, wilcoxon: wilcoxon, clusterBootstrap: clusterBootstrap,
    editDistance: editDistance, errorRates: errorRates, errorBands: errorBands
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GraderStats = api;
})(typeof self !== 'undefined' ? self : this);
