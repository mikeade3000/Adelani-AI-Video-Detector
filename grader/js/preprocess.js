/*
 * "Handwriting boost" image preprocessing (manuscript §3.2):
 * greyscale → median filter → contrast stretch → sharpen →
 * optional binarisation (Otsu or adaptive) → optional morphological closing.
 *
 * Functions work on a single-channel Uint8ClampedArray `g` of size w × h, so
 * they can be unit-tested without a canvas.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    enabled: true,
    median: 1,        // filter radius: 0 (off), 1 (3×3), 2 (5×5)
    contrast: 0.8,    // 0..1 strength of percentile contrast stretch
    sharpen: 0.6,     // 0..2 unsharp-mask amount
    binarize: 'off',  // 'off' | 'otsu' | 'adaptive'
    adaptiveK: 0.12,  // adaptive threshold offset (fraction of local mean)
    closing: 1,       // closing iterations (only after binarisation)
    maxSide: 2600,    // downscale very large pages
    minWidth: 1400    // upscale small images (helps Tesseract on phone shots)
  };

  function toGray(rgba, w, h) {
    var g = new Uint8ClampedArray(w * h);
    for (var i = 0, p = 0; i < g.length; i++, p += 4) {
      g[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
    }
    return g;
  }

  function median(g, w, h, r) {
    if (!r) return g;
    var out = new Uint8ClampedArray(g.length);
    var hist = new Int32Array(256);
    var area = (2 * r + 1) * (2 * r + 1), half = (area + 1) >> 1;
    for (var y = 0; y < h; y++) {
      hist.fill(0);
      var x, dy, dx, yy, xx;
      // initialise histogram for x = 0 (clamp at borders)
      for (dy = -r; dy <= r; dy++) {
        yy = Math.min(h - 1, Math.max(0, y + dy));
        for (dx = -r; dx <= r; dx++) {
          xx = Math.min(w - 1, Math.max(0, dx));
          hist[g[yy * w + xx]]++;
        }
      }
      for (x = 0; x < w; x++) {
        var c = 0, v = 0;
        while (v < 256) { c += hist[v]; if (c >= half) break; v++; }
        out[y * w + x] = v;
        if (x + 1 < w) {
          var xo = Math.max(0, x - r), xn = Math.min(w - 1, x + r + 1);
          for (dy = -r; dy <= r; dy++) {
            yy = Math.min(h - 1, Math.max(0, y + dy));
            hist[g[yy * w + xo]]--;
            hist[g[yy * w + xn]]++;
          }
        }
      }
    }
    return out;
  }

  function contrastStretch(g, strength) {
    if (!strength) return g;
    var hist = new Int32Array(256), i;
    for (i = 0; i < g.length; i++) hist[g[i]]++;
    var lo = 0, hi = 255, acc = 0, n = g.length;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.01) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.01) { hi = i; break; } }
    if (hi - lo < 10) return g;
    var out = new Uint8ClampedArray(g.length), scale = 255 / (hi - lo);
    for (i = 0; i < g.length; i++) {
      var s = (g[i] - lo) * scale;
      out[i] = g[i] + (s - g[i]) * strength;
    }
    return out;
  }

  function boxBlur(g, w, h) {
    var out = new Uint8ClampedArray(g.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var s = 0;
        for (var dy = -1; dy <= 1; dy++) {
          var yy = Math.min(h - 1, Math.max(0, y + dy));
          for (var dx = -1; dx <= 1; dx++) s += g[yy * w + Math.min(w - 1, Math.max(0, x + dx))];
        }
        out[y * w + x] = s / 9;
      }
    }
    return out;
  }

  function sharpen(g, w, h, amount) {
    if (!amount) return g;
    var b = boxBlur(g, w, h), out = new Uint8ClampedArray(g.length);
    for (var i = 0; i < g.length; i++) out[i] = g[i] + amount * (g[i] - b[i]);
    return out;
  }

  function otsuThreshold(g) {
    var hist = new Float64Array(256), i;
    for (i = 0; i < g.length; i++) hist[g[i]]++;
    var total = g.length, sumAll = 0;
    for (i = 0; i < 256; i++) sumAll += i * hist[i];
    var sumB = 0, wB = 0, best = 0, thr = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sumAll - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return thr;
  }

  function binarizeOtsu(g) {
    var t = otsuThreshold(g), out = new Uint8ClampedArray(g.length);
    for (var i = 0; i < g.length; i++) out[i] = g[i] > t ? 255 : 0;
    return out;
  }

  // Local-mean threshold using an integral image; copes with uneven lighting.
  function binarizeAdaptive(g, w, h, k) {
    var W = w + 1, integ = new Float64Array(W * (h + 1)), x, y;
    for (y = 1; y <= h; y++) {
      var row = 0;
      for (x = 1; x <= w; x++) {
        row += g[(y - 1) * w + (x - 1)];
        integ[y * W + x] = integ[(y - 1) * W + x] + row;
      }
    }
    var r = Math.max(7, Math.round(Math.min(w, h) / 40));
    var out = new Uint8ClampedArray(g.length);
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        var s = integ[y1 * W + x1] - integ[y0 * W + x1] - integ[y1 * W + x0] + integ[y0 * W + x0];
        var m = s / ((y1 - y0) * (x1 - x0));
        out[y * w + x] = g[y * w + x] < m * (1 - k) ? 0 : 255;
      }
    }
    return out;
  }

  // Ink is black (0). Dilating ink = min filter; eroding ink = max filter.
  function minMax(g, w, h, useMin) {
    var out = new Uint8ClampedArray(g.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var v = useMin ? 255 : 0;
        for (var dy = -1; dy <= 1; dy++) {
          var yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            var p = g[yy * w + xx];
            if (useMin ? p < v : p > v) v = p;
          }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  }

  function closeInk(g, w, h, iterations) {
    for (var i = 0; i < iterations; i++) g = minMax(g, w, h, true);
    for (i = 0; i < iterations; i++) g = minMax(g, w, h, false);
    return g;
  }

  function processGray(g, w, h, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    g = median(g, w, h, o.median | 0);
    g = contrastStretch(g, +o.contrast);
    g = sharpen(g, w, h, +o.sharpen);
    if (o.binarize === 'otsu') g = binarizeOtsu(g);
    else if (o.binarize === 'adaptive') g = binarizeAdaptive(g, w, h, +o.adaptiveK);
    if (o.binarize !== 'off' && o.closing > 0) g = closeInk(g, w, h, o.closing | 0);
    return g;
  }

  /** Browser helper: source canvas → new preprocessed canvas. */
  function processCanvas(src, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var w = src.width, h = src.height;
    var scale = 1;
    if (Math.max(w, h) > o.maxSide) scale = o.maxSide / Math.max(w, h);
    else if (w < o.minWidth) scale = Math.min(2, o.minWidth / w);
    var W = Math.round(w * scale), H = Math.round(h * scale);
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, W, H);
    if (!o.enabled) return c;
    var img = ctx.getImageData(0, 0, W, H);
    var g = processGray(toGray(img.data, W, H), W, H, o);
    for (var i = 0, p = 0; i < g.length; i++, p += 4) {
      img.data[p] = img.data[p + 1] = img.data[p + 2] = g[i];
      img.data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  var api = {
    DEFAULTS: DEFAULTS, toGray: toGray, median: median, contrastStretch: contrastStretch,
    sharpen: sharpen, otsuThreshold: otsuThreshold, binarizeOtsu: binarizeOtsu,
    binarizeAdaptive: binarizeAdaptive, closeInk: closeInk, processGray: processGray,
    processCanvas: processCanvas
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GraderPreprocess = api;
})(typeof self !== 'undefined' ? self : this);
