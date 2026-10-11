'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../js/stats.js');

const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('script-level confusion indices reproduce Table 7 of the manuscript', () => {
  const c = { tp: 20, fp: 3, fn: 1, tn: 16, n: 40 };
  const ix = S.classificationIndices(c);
  close(ix.accuracy.value, 0.90);
  close(ix.sensitivity.value, 0.95);
  close(ix.specificity.value, 0.84);
  close(ix.ppv.value, 0.87);
  close(ix.npv.value, 0.94);
  close(ix.f1, 0.91);
  close(ix.kappa.value, 0.80);
  close(ix.accuracy.ci[0], 0.76); close(ix.accuracy.ci[1], 0.97);
  close(ix.sensitivity.ci[0], 0.76); close(ix.sensitivity.ci[1], 1.00);
  close(ix.specificity.ci[0], 0.60); close(ix.specificity.ci[1], 0.97);
  close(ix.mcnemar.chi2, 0.25);
  close(ix.mcnemar.p, 0.62);
});

test('response-level confusion indices reproduce Table 7 of the manuscript', () => {
  const ix = S.classificationIndices({ tp: 85, fp: 14, fn: 7, tn: 54, n: 160 });
  close(ix.accuracy.value, 0.87);
  close(ix.sensitivity.value, 0.92);
  close(ix.specificity.value, 0.79);
  close(ix.kappa.value, 0.73);
  close(ix.mcnemar.chi2, 1.71);
  close(ix.mcnemar.p, 0.19);
});

test('ICC(2,1) matches the Shrout & Fleiss worked example', () => {
  // Shrout & Fleiss (1979) table 2, 6 targets × 4 judges: ICC(2,1) = 0.29.
  const judges = [[9, 6, 8, 7, 10, 6], [2, 1, 4, 1, 5, 2], [5, 3, 6, 2, 6, 4], [8, 2, 8, 6, 9, 7]];
  close(S.icc21(judges), 0.29);
});

test('QWK is 1 for identical marks and lower for disagreement', () => {
  const a = [0, 1, 2, 3, 4, 5, 2.5, 3.5];
  assert.strictEqual(S.qwk(a, a, 0.5), 1);
  const b = [0, 1.5, 2, 3, 4.5, 5, 2, 3.5];
  const k = S.qwk(a, b, 0.5);
  assert.ok(k < 1 && k > 0.8, String(k));
});

test('Spearman handles ties and perfect monotonic data', () => {
  close(S.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  close(S.spearman([1, 2, 2, 3], [3, 2, 2, 1]), -1);
});

test('Bland–Altman, MAE and SMD', () => {
  const ref = [1, 2, 3, 4, 5];
  const tool = [1.5, 2.5, 3.5, 4.5, 5.5];
  close(S.mae(tool, ref), 0.5);
  const ba = S.blandAltman(tool, ref);
  close(ba.bias, 0.5); close(ba.lower, 0.5); close(ba.upper, 0.5);
  assert.ok(S.smd(tool, ref) > 0);
});

test('Wilcoxon detects a consistent drop in marking time', () => {
  const hand = [12, 13, 11, 14, 12.5, 15, 10, 13.5, 12, 11.5];
  const tool = [6, 6.5, 5, 7, 6, 7.5, 4.5, 6, 5.5, 6];
  const w = S.wilcoxon(hand, tool);
  assert.ok(w.p < 0.01);
  assert.ok(w.z < 0);
});

test('CER and WER', () => {
  const r = S.errorRates('store the information', 'stere the informaten');
  close(r.cer, 3 / 21);
  close(r.wer, 2 / 3);
});

test('cluster bootstrap returns an interval around the estimate', () => {
  const clusters = Array.from({ length: 20 }, (_, i) => [{ e: i % 3 }, { e: (i + 1) % 3 }]);
  const ci = S.clusterBootstrap(clusters, rows => S.mean(rows.map(r => r.e)), 500, 7);
  assert.ok(ci[0] < 1 && ci[1] > 0.9);
});

test('error bands', () => {
  const b = S.errorBands([0, 0.5, 1, 1.5, 3]);
  assert.deepStrictEqual(b.map(x => x.n), [1, 2, 1, 1]);
  close(b[3].cumPct, 100);
});
