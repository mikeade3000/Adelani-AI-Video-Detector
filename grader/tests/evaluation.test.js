'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../js/evaluation.js');

test('CSV round trip with quotes and commas', () => {
  const rows = [['a', 'b,c', 'say "hi"'], ['1', '', 'x\ny']];
  assert.deepStrictEqual(E.parseCsv(E.toCsv(rows)), rows);
});

test('reference is built from two examiners, adjudicated when they differ by > 20%', () => {
  const csv = 'script,question,max,tool,examiner1,examiner2,examiner3\nS1,Q1,5,3,3,4,\nS1,Q2,5,2,1,4,3\n';
  const r = E.readMarks(csv);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.rows[0].reference, 3.5);
  assert.strictEqual(r.rows[1].reference, 3);
  assert.ok(r.hasBaseline);
});

test('full evaluation produces criteria, confusion matrices and bands', () => {
  let csv = 'script,question,max,tool,reference,examiner1,examiner2\n';
  const marks = [5, 4, 3.5, 2, 1, 0, 4.5, 3, 2.5, 1.5];
  for (let s = 0; s < 10; s++) for (let q = 1; q <= 4; q++) {
    const ref = marks[(s + q) % marks.length];
    const tool = Math.max(0, Math.min(5, ref + ((s * q) % 3 === 0 ? 0.5 : (s + q) % 4 === 0 ? -0.5 : 0)));
    csv += `S${s},Q${q},5,${tool},${ref},${ref},${Math.min(5, ref + (q === 2 ? 0.5 : 0))}\n`;
  }
  const d = E.readMarks(csv);
  const R = E.evaluate(d.rows, d.hasBaseline, { passPct: 50, B: 300 });
  assert.strictEqual(R.tool.n, 40);
  assert.strictEqual(R.tool.scripts, 10);
  assert.ok(R.tool.qwk > 0.8);
  assert.ok(R.human);
  assert.strictEqual(R.decisions.script.cm.n, 10);
  assert.strictEqual(R.decisions.response.cm.n, 40);
  assert.ok(R.tool.maeCI[0] <= R.tool.mae && R.tool.mae <= R.tool.maeCI[1]);
  assert.strictEqual(R.tool.bands.reduce((s, b) => s + b.n, 0), 40);
  assert.ok(R.criteria.length >= 6);
});

test('missing columns are reported', () => {
  const r = E.readMarks('script,question\nS1,Q1\n');
  assert.ok(r.errors.length >= 2);
});
