'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../js/preprocess.js');

function page(w, h) {
  // light-grey paper with a faint dark stroke and salt noise
  const g = new Uint8ClampedArray(w * h).fill(200);
  for (let x = 5; x < w - 5; x++) g[Math.floor(h / 2) * w + x] = 120;
  for (let i = 0; i < g.length; i += 97) g[i] = 0;
  return g;
}

test('median filter removes isolated speckle but keeps the stroke', () => {
  const w = 40, h = 20;
  const g = page(w, h);
  const m = P.median(g, w, h, 1);
  assert.strictEqual(m[97], 200);
  // a 1-px line is thin; its median survives only if neighbours agree, so check stroke via a thicker one
  const g2 = new Uint8ClampedArray(w * h).fill(200);
  for (let y = 9; y <= 11; y++) for (let x = 5; x < 35; x++) g2[y * w + x] = 50;
  assert.strictEqual(P.median(g2, w, h, 1)[10 * w + 20], 50);
});

test('contrast stretch widens the grey range', () => {
  const g = new Uint8ClampedArray(1000);
  for (let i = 0; i < g.length; i++) g[i] = 100 + (i % 50);
  const s = P.contrastStretch(g, 1);
  assert.ok(Math.min(...s) < 20 && Math.max(...s) > 235);
});

test('Otsu separates ink from paper', () => {
  const g = new Uint8ClampedArray(200);
  for (let i = 0; i < 200; i++) g[i] = i < 40 ? 30 : 210;
  const t = P.otsuThreshold(g);
  assert.ok(t >= 30 && t < 210);
  const b = P.binarizeOtsu(g);
  assert.strictEqual(b[0], 0);
  assert.strictEqual(b[100], 255);
});

test('adaptive threshold copes with a lighting gradient', () => {
  const w = 120, h = 40, g = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = 90 + x; // dark left, bright right
  for (let x = 10; x < 110; x++) for (let y = 19; y <= 21; y++) g[y * w + x] -= 60; // ink line
  const b = P.binarizeAdaptive(g, w, h, 0.12);
  assert.strictEqual(b[20 * w + 15], 0);
  assert.strictEqual(b[20 * w + 100], 0);
  assert.strictEqual(b[5 * w + 15], 255);
  assert.strictEqual(b[5 * w + 100], 255);
});

test('closing bridges a one-pixel gap in a stroke', () => {
  const w = 20, h = 9, g = new Uint8ClampedArray(w * h).fill(255);
  for (let x = 2; x < 18; x++) if (x !== 10) for (let y = 3; y <= 5; y++) g[y * w + x] = 0;
  const c = P.closeInk(g, w, h, 1);
  assert.strictEqual(c[4 * w + 10], 0);
});

test('full pipeline keeps dimensions', () => {
  const w = 50, h = 30;
  const out = P.processGray(page(w, h), w, h, { binarize: 'adaptive' });
  assert.strictEqual(out.length, w * h);
});

test('ink-only greyscale fades pale blue rules but keeps dark ink', () => {
  // paper, pale-blue rule, dark-blue ink
  const rgba = new Uint8ClampedArray([245, 243, 236, 255, 150, 180, 225, 255, 27, 42, 110, 255]);
  const g = P.inkGray(rgba, 3, 1);
  assert.ok(g[1] > 215, 'rule should be near paper: ' + g[1]);
  assert.ok(g[2] < 120, 'ink should stay dark: ' + g[2]);
});

test('horizontal rule removal keeps strokes that cross the line', () => {
  const w = 200, h = 9, g = new Uint8ClampedArray(w * h).fill(255);
  for (let x = 0; x < w; x++) g[4 * w + x] = 0;            // ruled line
  for (let y = 0; y < h; y++) g[y * w + 100] = 0;          // vertical stroke crossing it
  const out = P.removeHorizontalLines(g, w, h);
  assert.strictEqual(out[4 * w + 20], 255);
  assert.strictEqual(out[4 * w + 100], 0);
});
