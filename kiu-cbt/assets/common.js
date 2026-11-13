/* KIU CBT — shared helpers: API calls, CSV, downloads. Loaded by every page. */
(function (w) {
  var CFG = w.KIU_CONFIG || {};

  // Several backends (one Apps Script per Google account) behind one website: config.js BACKENDS.
  // The page uses the backend named by ?b=<id> (links made by the admin page carry it); one already
  // chosen in this browser tab is kept on refresh; with a single backend it is simply used.
  function param(n) {
    var m = (location.search + '&' + location.hash.replace(/^#/, '')).match(new RegExp('[?&]' + n + '=([^&#]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  var BK = (CFG.BACKENDS && CFG.BACKENDS.length) ? CFG.BACKENDS.filter(function (x) { return x && x.id && x.url; }) : null;
  if (BK && BK.length) {
    var want = param('b');
    if (!want) try { want = sessionStorage.getItem('kiu_backend') || ''; } catch (e) {}
    var pick = BK.filter(function (x) { return x.id === want; })[0] || (BK.length === 1 ? BK[0] : null);
    CFG.BACKEND = pick || null;
    CFG.API_URL = pick ? pick.url : '';
    if (pick) try { sessionStorage.setItem('kiu_backend', pick.id); } catch (e) {}
  }
  function needsBackend() { return !!(BK && BK.length > 1 && !CFG.BACKEND); }
  function backendParam() { return CFG.BACKEND && BK && BK.length > 1 ? 'b=' + encodeURIComponent(CFG.BACKEND.id) : ''; }
  // A list of buttons, one per backend; choosing one reloads the page on it.
  function backendChooser(el, heading) {
    el.innerHTML = '<div class="panel" style="text-align:center"><img class="crest" src="assets/logo.png" alt="KIU"><h1>' + esc(heading || 'Choose your examination centre') + '</h1>' +
      '<p class="note">Your exam link normally chooses this for you. If it did not, pick your faculty or group:</p>' +
      BK.map(function (x) { return '<p><a class="btn" style="display:inline-block;min-width:260px" href="' + esc(location.pathname + (location.search ? location.search + '&' : '?') + 'b=' + encodeURIComponent(x.id) + location.hash) + '">' + esc(x.name || x.id) + '</a></p>'; }).join('') + '</div>';
  }

  // When Google is overloaded, retry with growing, randomised waits instead of hammering it.
  // onBusy(n) is told about each retry (n > 0) and when a call gets through again (n = 0).
  var busyFns = [];
  function onBusy(fn) { busyFns.push(fn); }
  function busy(n) { busyFns.forEach(function (f) { try { f(n); } catch (e) {} }); }
  function backoff(n) { return Math.min(16000, 1000 * Math.pow(2, n - 1)) * (0.6 + Math.random() * 0.8); }

  // Not idempotent: never auto-retry these (a retry could duplicate something).
  var NO_RETRY = { createObserver:1, createAdmin:1, toggleObserver:1, toggleAdmin:1,
                   theoryUpload:1, theoryDeleteScan:1, photoUpload:1, resetCandidate:1, changePassword:1,
                   importKiu:1, saveStudents:1, resetStudentPassword:1, emailStudents:1, deleteCandidateMedia:1, ltiRedeem:1, deleteOrphanCourses:1, changeProgrammes:1 };

  function wait(ms){ return new Promise(function (res) { setTimeout(res, ms); }); }

  // POST a text/plain body (a "simple request") so the browser skips the CORS
  // preflight that Apps Script cannot answer. Idempotent actions retry on the
  // occasional Apps Script redirect / cold-start hiccup.
  function api(action, payload, opts) {
    payload = payload || {};
    payload.action = action;
    var maxTries = NO_RETRY[action] ? 1 : ((opts && opts.tries) || 5);
    function attempt(n) {
      return fetch(CFG.API_URL, { method: 'POST', redirect: 'follow', body: JSON.stringify(payload) })
        .then(function (r) { return r.text(); })
        .then(function (text) {
          var j;
          try { j = JSON.parse(text); }
          catch (e) {
            // Apps Script answers with an HTML page when it is overloaded ("too many simultaneous invocations")
            if (n < maxTries) { busy(n); return wait(backoff(n)).then(function () { return attempt(n + 1); }); }
            busy(0);
            throw new Error('Could not reach the examination service. Check your connection and try again.' + (CFG.PLATFORM === 'cloudflare' ? '' : ' (Administrator: make sure the Apps Script is deployed with “Who has access: Anyone”.)'));
          }
          if (n > 1) busy(0);
          if (j && j.error) throw new Error(j.error);
          return j;
        }, function () {
          if (n < maxTries) { busy(n); return wait(backoff(n)).then(function () { return attempt(n + 1); }); }
          busy(0);
          throw new Error('Could not reach the examination service — usually a brief network drop. Tap the button again. If it keeps happening, check your internet connection.');
        });
    }
    return attempt(1);
  }

  // Upload with progress (XHR). Still text/plain, so no preflight.
  function apiUpload(action, payload, onProgress, timeoutMs) {
    payload = payload || {}; payload.action = action;
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', CFG.API_URL, true);
      xhr.timeout = timeoutMs || 180000;
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
        xhr.upload.onload = function () { onProgress(1); };
      }
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          var j; try { j = JSON.parse(xhr.responseText); }
          catch (e) { reject(new Error('The examination service did not answer. Please try again.')); return; }
          if (j && j.error) { var se = new Error(j.error); se.server = true; reject(se); return; }
          resolve(j);
        } else if (xhr.status !== 0) { reject(new Error('Upload failed (' + xhr.status + '). Please try again.')); }
      };
      xhr.onerror = function () { reject(new Error('Upload failed — network error.')); };
      xhr.ontimeout = function () { reject(new Error('Upload timed out.')); };
      xhr.send(JSON.stringify(payload));
    });
  }

  // CSV parser (quoted fields, commas, newlines, BOM).
  function parseCSV(text) {
    text = String(text).replace(/^\uFEFF/, '');
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      if (rows[r].every(function (c) { return String(c).trim() === ''; })) continue;
      var o = {};
      head.forEach(function (h, j) { o[h] = rows[r][j] !== undefined ? String(rows[r][j]).trim() : ''; });
      out.push(o);
    }
    return out;
  }

  function toCSV(headers, rows) {
    var e = function (v) { v = (v == null ? '' : String(v)); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [headers.map(e).join(',')];
    rows.forEach(function (r) { lines.push(r.map(e).join(',')); });
    return '\uFEFF' + lines.join('\r\n');
  }

  function download(filename, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function b64ToBlob(b64, mime) {
    var bin = atob(b64), len = bin.length, arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'application/octet-stream' });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function configured() { return !!CFG.API_URL && CFG.API_URL.indexOf('PASTE_YOUR') !== 0; }
  function fmtTime(t) { if (!t) return '—'; var d = new Date(t); return isNaN(d) ? '—' : d.toLocaleString(); }
  // ---- examination times: one official time zone for everyone, wherever they are ----
  // The server sends its zone (time_zone) with every sign-in; KIU.setZone() keeps it. Exam times are written in
  // that zone with its name and UTC offset ("Fri 30 Oct, 08:00 (Kampala time, UTC+3)"), plus the reader's own
  // time when their device is in another zone. Date boxes on the admin page are read and written in it too.
  // Wording: 24-hour clock and "12:00 noon"; a deadline at midnight is written as 23:59 of the day it ends
  // ("Sat 7 Nov, 23:59"), never "12:00 AM" or "midnight of …", which people read as either day.
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ZONE = '';
  function deviceZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }
  function setZone(tz) { if (tz && validZone(tz)) ZONE = tz; }
  function zone() { return ZONE || deviceZone() || 'UTC'; }
  function validZone(tz) { try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch (e) { return false; } }
  // wall-clock parts of instant d in zone tz
  function partsIn(d, tz) {
    var o = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(d).forEach(function (x) { o[x.type] = +x.value; });
    if (o.hour === 24) o.hour = 0;
    return { y: o.year, mo: o.month, d: o.day, h: o.hour, mi: o.minute, wd: new Date(Date.UTC(o.year, o.month - 1, o.day)).getUTCDay() };
  }
  function offsetMin(d, tz) { var p = partsIn(d, tz); return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(d.getTime() / 60000) * 60000) / 60000); }
  function utcText(off) { if (!off) return 'UTC'; var a = Math.abs(off); return 'UTC' + (off < 0 ? '-' : '+') + Math.floor(a / 60) + (a % 60 ? ':' + (a % 60 < 10 ? '0' : '') + a % 60 : ''); }
  function zoneLabel(tz, d) {
    if (tz === 'UTC' || tz === 'Etc/UTC') return 'UTC';
    return String(tz).split('/').pop().replace(/_/g, ' ') + ' time, ' + utcText(offsetMin(d || new Date(), tz));
  }
  // t in zone tz (default: the official zone). kind 'by' = a deadline. opts.year adds the year.
  function fmtWhen(t, kind, opts) {
    if (!t) return ''; var d = new Date(t); if (isNaN(d)) return '';
    opts = opts || {};
    var tz = opts.tz || zone();
    var day = function (p) { return DAYS[p.wd] + ' ' + p.d + ' ' + MONTHS[p.mo - 1] + (opts.year ? ' ' + p.y : ''); };
    var p = partsIn(d, tz), out;
    if (p.h === 0 && p.mi === 0) out = kind === 'by' ? day(partsIn(new Date(d.getTime() - 43200000), tz)) + ', 23:59' : day(p) + ', 00:00';
    else if (p.h === 12 && p.mi === 0) out = day(p) + ', 12:00 noon';
    else out = day(p) + ', ' + (p.h < 10 ? '0' : '') + p.h + ':' + (p.mi < 10 ? '0' : '') + p.mi;
    return out;
  }
  // An examination time for anyone: official time with its zone, then the reader's own time if their device differs.
  // opts.local = false leaves out the reader's time (e.g. messages written on the admin page for students elsewhere).
  function fmtExam(t, kind, opts) {
    if (!t) return ''; var d = new Date(t); if (isNaN(d)) return '';
    opts = opts || {};
    var out = fmtWhen(t, kind, opts) + ' (' + zoneLabel(zone(), d) + ')';
    var mine = deviceZone();
    if (opts.local !== false && mine && offsetMin(d, mine) !== offsetMin(d, zone())) out += ' — your time: ' + fmtWhen(t, kind, { tz: mine, year: opts.year });
    return out;
  }
  // The examination window in words, three moments: "Opens at …", "Last start …" (the latest a candidate may begin)
  // and "Ends by …" (that latest start plus the duration: nobody is still writing after it). opts: tz, year, now
  // (ms; an opening time already past is left out unless opts.allOpens).
  function examWindow(opens, last, minutes, opts) {
    opts = opts || {};
    var o = { tz: opts.tz, year: opts.year }, out = [], nowMs = opts.now || Date.now();
    if (opens && (opts.allOpens || new Date(opens).getTime() > nowMs)) out.push('Opens at ' + fmtWhen(opens, 'at', o));
    if (last) {
      out.push('Last start ' + fmtWhen(last, 'by', o));
      if (+minutes > 0) out.push('Ends by ' + fmtWhen(new Date(new Date(last).getTime() + minutes * 60000).toISOString(), 'by', o));
    }
    return out;
  }
  // Is the reader's device in another time zone than the official one (at moment t)?
  function otherZone(t) { var mine = deviceZone(), d = t ? new Date(t) : new Date(); return !!mine && offsetMin(d, mine) !== offsetMin(d, zone()); }
  // "in 3 days 4 h", "in 2 h 15 min", "in 9 min" — the same for everyone, whatever their time zone.
  function fmtIn(ms) {
    var m = Math.max(0, Math.ceil(ms / 60000)), dd = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
    if (dd) return 'in ' + dd + ' day' + (dd > 1 ? 's' : '') + (hh ? ' ' + hh + ' h' : '');
    if (hh) return 'in ' + hh + ' h' + (mm ? ' ' + mm + ' min' : '');
    return 'in ' + Math.max(1, mm) + ' min';
  }
  // Date boxes (<input type="datetime-local">) hold official-zone wall time.
  function toZoneInput(iso) {
    var d = new Date(iso); if (!iso || isNaN(d)) return '';
    var p = partsIn(d, zone()), z = function (n) { return (n < 10 ? '0' : '') + n; };
    return p.y + '-' + z(p.mo) + '-' + z(p.d) + 'T' + z(p.h) + ':' + z(p.mi);
  }
  function fromZoneInput(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(String(v || '').trim()); if (!m) return '';
    var wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), tz = zone();
    var t = wall - offsetMin(new Date(wall), tz) * 60000;
    t = wall - offsetMin(new Date(t), tz) * 60000;       // second pass: right across a daylight-saving change
    return new Date(t).toISOString();
  }
  function ago(t) {
    if (!t) return ''; var s = Math.round((Date.now() - new Date(t).getTime()) / 1000);
    if (isNaN(s)) return ''; if (s < 5) return 'now'; if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago'; return Math.floor(s / 3600) + 'h ago';
  }
  function mb(bytes) { return (Number(bytes || 0) / 1048576).toFixed(1) + ' MB'; }

  w.KIU = { api: api, apiUpload: apiUpload, parseCSV: parseCSV, toCSV: toCSV, download: download, b64ToBlob: b64ToBlob,
            esc: esc, CFG: CFG, configured: configured, needsBackend: needsBackend, backendParam: backendParam, backendChooser: backendChooser,
            backends: function () { return BK || []; }, onBusy: onBusy, fmtTime: fmtTime, fmtWhen: fmtWhen, fmtExam: fmtExam, fmtIn: fmtIn, otherZone: otherZone, examWindow: examWindow,
            setZone: setZone, zone: zone, zoneLabel: zoneLabel, toZoneInput: toZoneInput, fromZoneInput: fromZoneInput, ago: ago, mb: mb, wait: wait };
})(window);
