/*
 * File rendering (PDF.js) and dual-engine OCR (manuscript §3.1, §3.3).
 *
 * - Tesseract.js runs locally (WebAssembly). Its scripts, WASM core and the
 *   English model are shipped in ./vendor so no network is needed; if the
 *   vendor folder is missing the public CDN is used instead.
 * - OCR.space is optional and only called when the examiner enables it and
 *   supplies an API key. Page images then leave the device.
 * - "Best of two" runs both and keeps the output with the higher share of
 *   dictionary words (rubric vocabulary ∪ general English).
 */
(function (root) {
  'use strict';

  var CDN = {
    pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    anthropic: null // bundled only (vendor/anthropic), no CDN build exists
  };
  var LOCAL = {
    pdf: 'vendor/pdfjs/pdf.min.js',
    pdfWorker: 'vendor/pdfjs/pdf.worker.min.js',
    tesseract: 'vendor/tesseract/tesseract.min.js',
    anthropic: 'vendor/anthropic/anthropic-sdk.min.js',
    tesseractWorker: 'vendor/tesseract/worker.min.js',
    core: 'vendor/tesseract-core',
    lang: 'vendor/lang'
  };

  // Phones and low-memory devices get smaller working images to avoid crashes.
  var LOW_MEMORY = (function () {
    try {
      var coarse = root.matchMedia && root.matchMedia('(pointer: coarse)').matches;
      var mem = root.navigator && root.navigator.deviceMemory;
      return !!(coarse || (mem && mem <= 4));
    } catch (e) { return false; }
  })();
  var LIMITS = LOW_MEMORY
    ? { store: 2200, process: 2200, pdfWidth: 1700, ppMaxSide: 2000 }
    : { store: 3000, process: 3200, pdfWidth: 2400, ppMaxSide: 2600 };

  var loaded = {};
  var usingLocal = {};

  function abs(path) { return new URL(path, document.baseURI).href; }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { s.remove(); reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadLib(name, globalName) {
    if (loaded[name]) return loaded[name];
    loaded[name] = loadScript(LOCAL[name]).then(function () { usingLocal[name] = true; })
      .catch(function (e) { if (!CDN[name]) throw e; return loadScript(CDN[name]).then(function () { usingLocal[name] = false; }); })
      .then(function () {
        if (!root[globalName]) throw new Error(globalName + ' failed to initialise');
        return root[globalName];
      });
    loaded[name].catch(function () { loaded[name] = null; });
    return loaded[name];
  }

  // ------------------------------------------------------------ rendering

  function loadPdfJs() {
    return loadLib('pdf', 'pdfjsLib').then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = usingLocal.pdf ? abs(LOCAL.pdfWorker) : CDN.pdfWorker;
      return lib;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('Canvas export failed')); }, type || 'image/jpeg', quality || 0.92);
    });
  }

  /** PDF file → array of {name, blob} page images (~200 dpi, ≤ 2400 px wide). */
  function renderPdf(file, onProgress) {
    return loadPdfJs().then(function (lib) {
      return file.arrayBuffer().then(function (buf) { return lib.getDocument({ data: buf }).promise; });
    }).then(function (pdf) {
      var pages = [];
      var chain = Promise.resolve();
      for (var i = 1; i <= pdf.numPages; i++) {
        (function (n) {
          chain = chain.then(function () { return pdf.getPage(n); }).then(function (page) {
            var vp1 = page.getViewport({ scale: 1 });
            var scale = Math.min(200 / 72, LIMITS.pdfWidth / vp1.width);
            var vp = page.getViewport({ scale: scale });
            var c = document.createElement('canvas');
            c.width = Math.round(vp.width); c.height = Math.round(vp.height);
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
              return canvasToBlob(c, 'image/jpeg', 0.92);
            }).then(function (blob) {
              pages.push({ name: file.name + ' — p' + n, blob: blob });
              if (onProgress) onProgress(n, pdf.numPages);
            });
          });
        })(i);
      }
      return chain.then(function () { return pages; });
    });
  }

  /** Image file → normalised JPEG blob (EXIF orientation applied, ≤ 3000 px). */
  function normaliseImage(file) {
    return blobToCanvas(file, 0, LIMITS.store).then(function (c) { return canvasToBlob(c, 'image/jpeg', 0.92); });
  }

  function blobToCanvas(blob, rotation, maxSide) {
    var p = typeof createImageBitmap === 'function'
      ? createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(function () { return imgFromBlob(blob); })
      : imgFromBlob(blob);
    return p.then(function (img) {
      var w = img.width, h = img.height, s = 1;
      if (maxSide && Math.max(w, h) > maxSide) s = maxSide / Math.max(w, h);
      w = Math.round(w * s); h = Math.round(h * s);
      var rot = ((rotation || 0) % 360 + 360) % 360;
      var c = document.createElement('canvas');
      c.width = rot % 180 ? h : w;
      c.height = rot % 180 ? w : h;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(rot * Math.PI / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      if (img.close) img.close();
      return c;
    });
  }

  function imgFromBlob(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Unreadable image')); };
      img.src = url;
    });
  }

  // ------------------------------------------------------------ Tesseract

  var tWorker = null;
  var tProgress = null;

  function getTesseract() {
    if (tWorker) return tWorker;
    tWorker = loadLib('tesseract', 'Tesseract').then(function (T) {
      var opts = {
        logger: function (m) { if (tProgress) tProgress(m); },
        errorHandler: function (e) { console.error('Tesseract', e); }
      };
      if (usingLocal.tesseract) {
        opts.workerPath = abs(LOCAL.tesseractWorker);
        opts.corePath = abs(LOCAL.core);
        opts.langPath = abs(LOCAL.lang);
      }
      // OEM 1 = LSTM only; matches the bundled "best_int" English model.
      return T.createWorker('eng', 1, opts);
    }).then(function (w) {
      return w.setParameters({ preserve_interword_spaces: '1' }).then(function () { return w; });
    });
    tWorker.catch(function () { tWorker = null; });
    return tWorker;
  }

  function tesseractRecognize(canvas, onProgress) {
    return getTesseract().then(function (w) {
      tProgress = onProgress || null;
      return w.recognize(canvas).then(function (res) {
        tProgress = null;
        return { engine: 'tesseract', text: res.data.text || '', confidence: res.data.confidence / 100 };
      });
    });
  }

  // ------------------------------------------------------------ OCR.space

  function ocrSpaceRecognize(canvas, key, engine) {
    if (!key) return Promise.reject(new Error('OCR.space needs an API key (Settings → OCR engine).'));
    if (!navigator.onLine) return Promise.reject(new Error('OCR.space is unavailable offline.'));
    // Free tier accepts ≤ 1 MB; shrink until the JPEG fits.
    function encode(c, q) {
      return canvasToBlob(c, 'image/jpeg', q).then(function (b) {
        if (b.size <= 950 * 1024 || q < 0.45) return b;
        if (q > 0.6) return encode(c, q - 0.15);
        var s = document.createElement('canvas');
        s.width = Math.round(c.width * 0.75); s.height = Math.round(c.height * 0.75);
        s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
        return encode(s, 0.8);
      });
    }
    return encode(canvas, 0.9).then(function (blob) {
      var fd = new FormData();
      fd.append('apikey', key);
      fd.append('language', 'eng');
      fd.append('OCREngine', String(engine || 2));
      fd.append('scale', 'true');
      fd.append('detectOrientation', 'true');
      fd.append('file', blob, 'page.jpg');
      return fetch('https://api.ocr.space/parse/image', { method: 'POST', body: fd });
    }).then(function (r) {
      if (!r.ok) throw new Error('OCR.space HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (j.IsErroredOnProcessing) throw new Error('OCR.space: ' + [].concat(j.ErrorMessage || 'processing error').join(' '));
      var text = (j.ParsedResults || []).map(function (p) { return p.ParsedText || ''; }).join('\n');
      return { engine: 'ocrspace', text: text, confidence: null };
    });
  }

  // ------------------------------------------------------------ Claude (AI handwriting reader)

  var CLAUDE_MODEL = 'claude-opus-5-5';
  var CLAUDE_SYSTEM = [
    'You transcribe photographed or scanned handwritten examination answers for a marking tool.',
    'Write out exactly what the student wrote, line by line, in reading order.',
    'Keep the student\'s own wording, spelling, grammar and punctuation. Do not correct, complete, summarise or improve anything: the transcription is used for marking, so errors must stay as written.',
    'Keep question labels such as "Q1", "Question 2" or "2(a)" at the start of the line where they appear.',
    'Leave out words the student crossed out. Where a word cannot be read, write [illegible].',
    'Output only the transcription, with no commentary, headings or formatting.'
  ].join('\n');

  function canvasToBase64Jpeg(canvas, maxSide) {
    var c = canvas;
    var s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    if (s < 1) {
      c = document.createElement('canvas');
      c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
      c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    }
    return c.toDataURL('image/jpeg', 0.88).split(',')[1];
  }

  function claudeRecognize(canvas, key) {
    if (!key) return Promise.reject(new Error('the AI handwriting reader needs an Anthropic API key (Settings → OCR engine).'));
    if (!navigator.onLine) return Promise.reject(new Error('the AI handwriting reader is unavailable offline.'));
    return loadLib('anthropic', 'AnthropicSDK').then(function (Anthropic) {
      // The key is the examiner's own and stays in this browser; requests go straight to the Claude API.
      var client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
      return client.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: CLAUDE_SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: canvasToBase64Jpeg(canvas, 2000) } },
            { type: 'text', text: 'Transcribe the handwriting on this page.' }
          ]
        }]
      }).then(function (resp) {
        if (resp.stop_reason === 'refusal') throw new Error('the AI reader declined this page' + (resp.stop_details && resp.stop_details.category ? ' (' + resp.stop_details.category + ')' : '') + '.');
        var text = resp.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
        if (resp.stop_reason === 'max_tokens') text += '\n[transcription cut off]';
        return { engine: 'claude', text: text, confidence: null };
      }).catch(function (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new Error('the Anthropic API key was rejected. Check it in Settings.');
        if (e instanceof Anthropic.PermissionDeniedError) throw new Error('this API key may not use ' + CLAUDE_MODEL + '.');
        if (e instanceof Anthropic.RateLimitError) throw new Error('the Claude API rate limit was reached. Wait a minute and re-run.');
        if (e instanceof Anthropic.APIConnectionError) throw new Error('could not reach the Claude API. Check the connection.');
        if (e instanceof Anthropic.APIError) throw new Error('Claude API error ' + (e.status || '') + ': ' + e.message);
        throw e;
      });
    });
  }

  // ------------------------------------------------------------ dispatcher

  /**
   * Recognise one preprocessed page.
   * mode: 'tesseract' | 'ocrspace' | 'best'
   * score(text) → dictionary ratio used to choose between engines.
   */
  function recognize(canvas, opts) {
    var mode = opts.mode || 'tesseract';
    var tasks = [];
    if (mode === 'tesseract' || mode === 'best') tasks.push(tesseractRecognize(canvas, opts.onProgress).catch(function (e) { return { engine: 'tesseract', error: e.message }; }));
    if (mode === 'ocrspace' || (mode === 'best' && opts.apiKey)) tasks.push(ocrSpaceRecognize(canvas, opts.apiKey, opts.ocrSpaceEngine).catch(function (e) { return { engine: 'ocrspace', error: e.message }; }));
    // The AI reader gets the original colour image: binarisation only removes cues it can use.
    if (mode === 'claude' || (mode === 'best' && opts.claudeKey)) tasks.push(claudeRecognize(opts.original || canvas, opts.claudeKey).catch(function (e) { return { engine: 'claude', error: e.message }; }));
    return Promise.all(tasks).then(function (results) {
      results.forEach(function (r) { if (!r.error) r.dictRatio = opts.score(r.text); });
      var ok = results.filter(function (r) { return !r.error; });
      if (!ok.length) throw new Error(results.map(function (r) { return r.engine + ': ' + r.error; }).join(' · '));
      // Prefer the AI transcription in best-of mode unless it is clearly worse.
      ok.sort(function (a, b) { return (b.dictRatio + (b.engine === 'claude' ? 0.1 : 0)) - (a.dictRatio + (a.engine === 'claude' ? 0.1 : 0)); });
      return { chosen: ok[0], candidates: results };
    });
  }

  function engineStatus() {
    return {
      tesseractLocal: usingLocal.tesseract,
      pdfLocal: usingLocal.pdf
    };
  }

  root.GraderOCR = {
    renderPdf: renderPdf,
    normaliseImage: normaliseImage,
    blobToCanvas: blobToCanvas,
    canvasToBlob: canvasToBlob,
    getTesseract: getTesseract,
    recognize: recognize,
    engineStatus: engineStatus,
    LOW_MEMORY: LOW_MEMORY,
    CLAUDE_MODEL: CLAUDE_MODEL,
    LIMITS: LIMITS
  };
})(typeof self !== 'undefined' ? self : this);
