/* KIU CBT — proctoring module
 * Camera access, identity photo, live snapshots and segmented exam recording.
 *
 * Recording works in self-contained segments (default 2 minutes). Each finished
 * segment is written to IndexedDB first, then uploaded in the background, so a
 * dropped connection or even a page reload does not lose the recording — the
 * queue resumes and uploads whatever is left.
 */
(function (w) {
  var K = w.KIU;
  var QUALITY = {
    minimal:  { w: 192, h: 144, fps: 8,  v: 64000,  a: 16000 },   // ≈ 0.6 MB / minute — for very large sittings
    low:      { w: 320, h: 240, fps: 12, v: 160000, a: 24000 },   // ≈ 1.4 MB / minute
    standard: { w: 480, h: 360, fps: 15, v: 320000, a: 32000 }    // ≈ 2.6 MB / minute
  };

  var P = {
    stream: null, opts: {}, status: 'off', camEvents: 0, events: [],
    recording: false, session: '', seq: 0, mr: null, segTimer: null, recStartedAt: 0,
    uploaded: 0, uploadedBytes: 0, pending: 0, pumping: false, fail: 0,
    lastSnapAt: 0, darkRun: 0, frame: null, snapVideo: null, ctx: null,
    onLost: null, onChange: null, mem: []
  };

  /* ---------------- events (sent to the server with each sync) ---------------- */
  function ev(name, detail) {
    P.events.push({ event: name, detail: String(detail || '').slice(0, 200), at: new Date().toISOString() });
    if (P.events.length > 60) P.events.splice(0, P.events.length - 60);
  }
  P.logEvent = ev;
  P.takeEvents = function () { var e = P.events; P.events = []; return e; };
  P.putBackEvents = function (e) { if (e && e.length) P.events = e.concat(P.events).slice(-60); };

  function changed() { if (P.onChange) try { P.onChange(P); } catch (e) {} renderFrame(); }

  /* ---------------- capability check ---------------- */
  P.support = function (needRecording) {
    if (!w.isSecureContext) return 'This page must be opened with https:// for the camera to work. Please use the official examination link.';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return 'This browser cannot use the camera. Please use the latest Google Chrome, Microsoft Edge, Firefox, or Safari.';
    if (needRecording && !w.MediaRecorder)
      return 'This browser cannot record video. Please use the latest Google Chrome, Microsoft Edge or Firefox (on iPhone/iPad: Safari 14.1 or newer).';
    return '';
  };

  /* ---------------- camera ---------------- */
  function videoTrack() { return P.stream && P.stream.getVideoTracks()[0]; }
  function live() { var t = videoTrack(); return !!(t && t.readyState === 'live'); }
  P.isLive = live;

  function friendly(err) {
    var n = err && err.name || '';
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError')
      return 'Camera access is blocked. Tap the camera or lock icon in the address bar, choose “Allow” for the camera, then tap the green button below to try again.';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError')
      return 'No camera was found on this device. Use a phone, tablet or laptop that has a working front camera.';
    if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError')
      return 'Your camera is being used by another app (for example Zoom, WhatsApp or the Camera app). Close that app, then tap the green button below to try again.';
    return 'The camera could not be started (' + (n || 'unknown error') + '). Tap “Try again”.';
  }

  P.acquire = function (opts) {
    if (opts) P.opts = opts;
    if (live()) return Promise.resolve(P.stream);
    var q = QUALITY[P.opts.quality] || QUALITY.low;
    var video = { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: q.fps, max: 24 } };
    var wantAudio = !!(P.opts.record_video && P.opts.record_audio);
    var gum = function (c) { return navigator.mediaDevices.getUserMedia(c); };
    return gum({ video: video, audio: wantAudio ? { echoCancellation: true, noiseSuppression: true } : false })
      .catch(function (err) {
        if (!wantAudio) throw err;
        // microphone refused or missing: keep going with the camera only
        return gum({ video: video, audio: false }).then(function (s) { ev('microphone_unavailable', err && err.name); return s; });
      })
      .then(function (s) { setStream(s); return s; })
      .catch(function (err) { var e = new Error(friendly(err)); e.name = err && err.name; throw e; });
  };

  function setStream(s) {
    if (P.stream && P.stream !== s) P.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
    P.stream = s;
    s.getTracks().forEach(function (t) {
      t.onended = function () {
        if (t.kind === 'video') lost('camera_stopped');
        else ev('microphone_stopped');
      };
    });
    var vt = videoTrack();
    if (vt) {
      vt.onmute = function () { ev('camera_paused'); };
      vt.onunmute = function () { ev('camera_resumed'); };
    }
    var was = P.status;
    P.status = 'on';
    if (was === 'off' && P.everOn) ev('camera_on');
    P.everOn = true;
    if (P.frame) P.attach(P.frame.querySelector('video'));
    if (P.recording && !P.mr) nextSegment();
    changed();
  }

  function lost(why) {
    if (P.status !== 'on') return;
    P.status = 'off'; P.camEvents++;
    ev('camera_off', why);
    if (P.mr && P.mr.state !== 'inactive') try { P.mr.stop(); } catch (e) {}
    changed();
    if (P.onLost) P.onLost(why);
  }
  // Some browsers never fire "ended" — poll as well.
  setInterval(function () { if (P.status === 'on' && P.stream && !live()) lost('camera_not_live'); }, 3000);

  // After the identity photo, drop to the (smaller) recording resolution.
  P.lowerResolution = function () {
    var t = videoTrack(), q = QUALITY[P.opts.quality] || QUALITY.low;
    if (t && t.applyConstraints) t.applyConstraints({ width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps, max: q.fps } }).catch(function () {});
  };

  P.attach = function (videoEl) {
    if (!videoEl || !P.stream) return;
    videoEl.muted = true; videoEl.setAttribute('muted', ''); videoEl.setAttribute('playsinline', ''); videoEl.playsInline = true;
    if (videoEl.srcObject !== P.stream) videoEl.srcObject = P.stream;
    var pr = videoEl.play(); if (pr && pr.catch) pr.catch(function () {});
  };

  P.stopCamera = function () {
    if (P.stream) P.stream.getTracks().forEach(function (t) { t.onended = null; try { t.stop(); } catch (e) {} });
    P.stream = null; P.status = 'stopped'; changed();
  };

  /* ---------------- identity photo ---------------- */
  P.capturePhoto = function (videoEl) {
    var vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh) return null;
    var scale = Math.min(1, 800 / Math.max(vw, vh));
    var c = document.createElement('canvas');
    c.width = Math.round(vw * scale); c.height = Math.round(vh * scale);
    c.getContext('2d').drawImage(videoEl, 0, 0, c.width, c.height);
    var t = document.createElement('canvas'); t.width = 160; t.height = 120;
    t.getContext('2d').drawImage(videoEl, 0, 0, 160, 120);
    var lum = luminance(t);
    return { canvas: c, image: c.toDataURL('image/jpeg', 0.85), thumb: t.toDataURL('image/jpeg', 0.7), dark: lum < 35 };
  };

  function luminance(canvas) {
    try {
      var d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, sum = 0, n = 0;
      for (var i = 0; i < d.length; i += 64) { sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
      return n ? sum / n : 255;
    } catch (e) { return 255; }
  }

  /* ---------------- live snapshots (ride along with the sync) ---------------- */
  P.snapshot = function () {
    var v = P.snapVideo;
    if (!v || !live() || !v.videoWidth) return null;
    var c = document.createElement('canvas'); c.width = 240; c.height = 180;
    c.getContext('2d').drawImage(v, 0, 0, 240, 180);
    var lum = luminance(c);
    return { data: c.toDataURL('image/jpeg', 0.6), dark: lum < 30 };
  };
  P.dueSnapshot = function () {
    var every = (P.opts.snapshot_seconds || 30) * 1000;
    if (Date.now() - P.lastSnapAt < every - 2000) return null;
    var s = P.snapshot();
    if (!s) return null;
    P.lastSnapAt = Date.now();
    if (s.dark) { P.darkRun++; if (P.darkRun === 2) { P.camEvents++; ev('camera_dark', 'camera covered or room too dark'); } }
    else { if (P.darkRun >= 2) ev('camera_clear'); P.darkRun = 0; }
    return s;
  };

  /* ---------------- recording (segments) ---------------- */
  function pickMime(hasAudio) {
    var list = hasAudio
      ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']
      : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'];
    for (var i = 0; i < list.length; i++) try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) {}
    return '';
  }

  P.startRecording = function (ctx) {
    P.ctx = ctx || P.ctx || {};
    if (!P.opts.record_video || !w.MediaRecorder || P.recording) return;
    P.recording = true;
    P.session = P.session || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    P.recStartedAt = P.recStartedAt || Date.now();
    ev('recording_started', P.session);
    nextSegment();
    P.pump();
  };

  function nextSegment() {
    if (!P.recording || !live() || P.mr) return;
    var q = QUALITY[P.opts.quality] || QUALITY.low;
    var hasAudio = P.stream.getAudioTracks().some(function (t) { return t.readyState === 'live'; });
    var mime = pickMime(hasAudio), mr;
    try {
      mr = new MediaRecorder(P.stream, mime ? { mimeType: mime, videoBitsPerSecond: q.v, audioBitsPerSecond: q.a } : { videoBitsPerSecond: q.v });
    } catch (e) {
      try { mr = new MediaRecorder(P.stream); } catch (e2) { ev('recorder_error', e2 && e2.message); P.recording = false; changed(); return; }
    }
    var chunks = [], seq = ++P.seq, started = new Date().toISOString();
    var phase = (P.ctx && P.ctx.phase) ? P.ctx.phase() : '';
    var segKey = P.session + '-' + ('00000' + seq).slice(-5), cn = 0;
    var meta = { session: P.session, seq: seq, started: started, phase: phase, token: P.ctx.token ? P.ctx.token() : '', type: String(mime || 'video/webm').split(';')[0] };
    P.curKey = segKey;
    mr.ondataavailable = function (e) {
      if (!e.data || !e.data.size) return;
      chunks.push(e.data);
      // Also keep each piece on disk, so a reload or crash mid-segment loses at most a few seconds.
      if (P.mr === mr) putChunk(segKey, ++cn, e.data, meta);
    };
    mr.onerror = function (e) { ev('recorder_error', e && e.error && e.error.name); };
    mr.onstop = function () {
      clearTimeout(P.segTimer);
      P.mr = null; P.curKey = null;
      var type = String(mr.mimeType || mime || 'video/webm').split(';')[0] || 'video/webm';
      var blob = new Blob(chunks, { type: type });
      var done = P._stopCb; P._stopCb = null;
      var saved = blob.size > 2000
        ? enqueue({ session: P.session, seq: seq, started: started, phase: phase, blob: blob, size: blob.size, token: P.ctx.token ? P.ctx.token() : '' })
        : Promise.resolve();
      saved.then(function () { return dropChunks(segKey); }).then(function () {
        P.pump();
        if (done) done();
        else if (P.recording) nextSegment();
      });
    };
    P.mr = mr;
    mr.start(2000);
    P.segTimer = setTimeout(function () { if (mr.state !== 'inactive') try { mr.stop(); } catch (e) {} }, (P.opts.segment_seconds || 120) * 1000);
    changed();
  }

  // Close the current segment and stop recording. Resolves once it is queued.
  P.stopRecording = function () {
    return new Promise(function (res) {
      var finished = false; function fin() { if (!finished) { finished = true; res(); } }
      P.recording = false;
      if (P.mr && P.mr.state !== 'inactive') {
        P._stopCb = fin;
        try { P.mr.stop(); } catch (e) { fin(); }
        setTimeout(fin, 6000);
      } else fin();
      changed();
    });
  };

  /* ---------------- durable upload queue (IndexedDB, memory fallback) ---------------- */
  var DB = null, DBtried = false;
  function idb() {
    return new Promise(function (res) {
      if (DB || DBtried) return res(DB);
      DBtried = true;
      try {
        var r = w.indexedDB.open('kiu_cbt_recordings', 2);
        r.onupgradeneeded = function () {
          var db = r.result;
          if (!db.objectStoreNames.contains('seg')) db.createObjectStore('seg', { keyPath: 'k' });
          if (!db.objectStoreNames.contains('chunk')) db.createObjectStore('chunk', { keyPath: 'id' });
        };
        r.onsuccess = function () { DB = r.result; res(DB); };
        r.onerror = function () { res(null); };
        r.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function key(it) { return it.session + '-' + ('00000' + it.seq).slice(-5); }
  function enqueue(it) {
    it.k = key(it);
    return idb().then(function (db) {
      if (!db) { P.mem.push(it); return; }
      return new Promise(function (res) {
        try {
          var tx = db.transaction('seg', 'readwrite'); tx.objectStore('seg').put(it);
          tx.oncomplete = res; tx.onerror = function () { P.mem.push(it); res(); }; tx.onabort = tx.onerror;
        } catch (e) { P.mem.push(it); res(); }
      });
    }).then(function () { P.pending++; changed(); });
  }
  function listQueue() {
    return idb().then(function (db) {
      var mem = P.mem.slice();
      if (!db) return mem;
      return new Promise(function (res) {
        try {
          var out = [], rq = db.transaction('seg', 'readonly').objectStore('seg').openCursor();
          rq.onsuccess = function () { var c = rq.result; if (c) { out.push(c.value); c.continue(); } else res(out.concat(mem)); };
          rq.onerror = function () { res(mem); };
        } catch (e) { res(mem); }
      });
    }).then(function (items) { return items.sort(function (a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : 0; }); });
  }
  function removeItem(k) {
    P.mem = P.mem.filter(function (x) { return x.k !== k; });
    return idb().then(function (db) {
      if (!db) return;
      return new Promise(function (res) {
        try { var tx = db.transaction('seg', 'readwrite'); tx.objectStore('seg').delete(k); tx.oncomplete = res; tx.onerror = res; } catch (e) { res(); }
      });
    });
  }
  // Pieces of the segment being recorded right now (see nextSegment).
  function putChunk(segKey, n, data, meta) {
    idb().then(function (db) {
      if (!db) return;
      try {
        db.transaction('chunk', 'readwrite').objectStore('chunk')
          .put({ id: segKey + '#' + ('00000' + n).slice(-5), seg: segKey, n: n, data: data, meta: n === 1 ? meta : null });
      } catch (e) {}
    });
  }
  function allChunks() {
    return idb().then(function (db) {
      if (!db) return [];
      return new Promise(function (res) {
        try {
          var out = [], rq = db.transaction('chunk', 'readonly').objectStore('chunk').openCursor();
          rq.onsuccess = function () { var c = rq.result; if (c) { out.push(c.value); c.continue(); } else res(out); };
          rq.onerror = function () { res([]); };
        } catch (e) { res([]); }
      });
    });
  }
  function dropChunks(segKey) {
    return allChunks().then(function (list) {
      var ids = list.filter(function (c) { return c.seg === segKey; }).map(function (c) { return c.id; });
      if (!ids.length) return;
      return idb().then(function (db) {
        return new Promise(function (res) {
          try { var tx = db.transaction('chunk', 'readwrite'), st = tx.objectStore('chunk'); ids.forEach(function (id) { st.delete(id); }); tx.oncomplete = res; tx.onerror = res; } catch (e) { res(); }
        });
      });
    });
  }
  // A segment interrupted by a reload, crash or closed tab: rebuild it from its saved pieces and queue it.
  var recovering = null;
  function recoverChunks() {
    if (recovering) return recovering;
    recovering = allChunks().then(function (list) {
      var groups = {};
      list.forEach(function (c) { if (c.seg !== P.curKey) (groups[c.seg] = groups[c.seg] || []).push(c); });
      return Object.keys(groups).reduce(function (p, segKey) {
        return p.then(function () {
          var g = groups[segKey].sort(function (a, b) { return a.n - b.n; });
          var first = g[0];
          if (!first || first.n !== 1 || !first.meta) return dropChunks(segKey);   // no header piece: unusable
          var blob = new Blob(g.map(function (c) { return c.data; }), { type: first.meta.type || 'video/webm' });
          var it = { session: first.meta.session, seq: first.meta.seq, started: first.meta.started, phase: first.meta.phase, token: first.meta.token, blob: blob, size: blob.size, recovered: true };
          return (blob.size > 2000 ? enqueue(it) : Promise.resolve()).then(function () { return dropChunks(segKey); });
        });
      }, Promise.resolve());
    }).then(function () { recovering = null; }, function () { recovering = null; });
    return recovering;
  }

  function toDataUrl(blob) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(blob); });
  }

  P.pump = function () {
    if (P.pumping) return;
    P.pumping = true;
    recoverChunks().then(function loop() {
      listQueue().then(function (items) {
        P.pending = items.length; changed();
        if (!items.length) { P.pumping = false; return; }
        var it = items[0];
        var token = it.token || (P.ctx && P.ctx.token ? P.ctx.token() : '');
        return toDataUrl(it.blob).then(function (data) {
          return K.apiUpload('recUpload', { token: token, session: it.session, seq: it.seq, started: it.started, phase: it.phase, data: data }, null, 300000);
        }).then(function () {
          P.uploaded++; P.uploadedBytes += it.size || 0; P.fail = 0; it.serverFails = 0;
          return removeItem(it.k).then(loop);
        }, function (err) {
          P.fail++;
          // A definite "no" from the server (expired session, bad data) will never succeed: drop it after 2 tries.
          if (err && err.server) {
            it.serverFails = (it.serverFails || 0) + 1;
            if (it.serverFails >= 2 || /expired|not authorised/i.test(err.message)) { ev('recording_segment_rejected', err.message); return removeItem(it.k).then(loop); }
          }
          if (P.fail === 3) ev('recording_upload_retrying', err && err.message);
          changed();
          setTimeout(loop, Math.min(60000, 3000 * Math.pow(2, Math.min(P.fail, 4))));
        });
      }).catch(function () { P.pumping = false; });
    });
  };

  // Wait until every queued segment is uploaded (or maxMs passes).
  P.flush = function (onProgress, maxMs) {
    var t0 = Date.now();
    P.pump();
    return new Promise(function (res) {
      (function check() {
        listQueue().then(function (items) {
          if (onProgress) onProgress(items.length);
          if (!items.length || Date.now() - t0 > (maxMs || 120000)) return res(items.length);
          if (!P.pumping) P.pump();
          setTimeout(check, 1500);
        });
      })();
    });
  };
  P.pendingCount = function () { return recoverChunks().then(listQueue).then(function (i) { return i.length; }); };

  /* ---------------- the on-screen camera frame ---------------- */
  P.mountFrame = function () {
    if (!P.frame) {
      var f = document.createElement('div');
      f.className = 'camframe';
      f.setAttribute('aria-label', 'Your camera');
      f.innerHTML = '<video autoplay muted playsinline></video>' +
        '<div class="cf-bar"><span class="rec"><i></i><span class="cf-lbl">REC</span></span><span class="cf-up"></span></div>';
      document.body.appendChild(f);
      P.frame = f;
      setInterval(renderFrame, 1000);
    }
    P.frame.classList.remove('hidden');
    document.body.classList.add('has-camframe');
    var v = P.frame.querySelector('video');
    P.snapVideo = v;
    P.attach(v);
    renderFrame();
  };
  P.hideFrame = function () { if (P.frame) P.frame.classList.add('hidden'); document.body.classList.remove('has-camframe'); };

  function clock(s) { s = Math.max(0, Math.floor(s)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ':' : '') + (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss; }
  function renderFrame() {
    if (!P.frame) return;
    var on = P.status === 'on' && live();
    P.frame.classList.toggle('off', !on);
    var lbl = P.frame.querySelector('.cf-lbl'), up = P.frame.querySelector('.cf-up');
    if (!on) lbl.textContent = 'CAMERA OFF';
    else if (P.recording) lbl.textContent = 'REC ' + clock((Date.now() - P.recStartedAt) / 1000);
    else lbl.textContent = P.opts.record_video ? 'CAMERA ON' : 'LIVE';
    up.textContent = P.pending > 0 ? ('↑ ' + P.pending + ' to send') : (P.uploaded ? '✓ saved' : '');
  }

  w.KIUProctor = P;
})(window);
