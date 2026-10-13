/*
 * Handwritten Theory Grader — application controller.
 * Workflow (manuscript §3.1): upload → render/check → preprocess + OCR →
 * rubric scoring → examiner review and confirmation of every mark.
 */
(function () {
  'use strict';

  const G = window.GraderScoring;
  const S = window.GraderStats;
  const P = window.GraderPreprocess;
  const O = window.GraderOCR;
  const ST = window.GraderStore;
  const E = window.GraderEvaluation;

  // ------------------------------------------------------------ defaults

  const SAMPLE_RUBRIC = `# Sample rubric — 4 prose questions × 5 marks = 20 marks.
# Lines starting with # are comments.

Q1 [5] Explain the CIA triad in information security
Model: The CIA triad describes the three goals of information security.
Confidentiality means information is kept secret and only authorised users
can access it, for example through encryption and access control.
Integrity means data is accurate and has not been altered or modified without
authorisation, which can be checked with hashing. Availability means systems
and data are accessible to authorised users when they are needed, supported by
backups and redundancy.
Keywords:
- confidentiality | secrecy | privacy
- integrity | unaltered | accurate
- availability | accessible | available
- authorised | authorized | unauthorised | unauthorized
- encrypt* | access control | hash*

Q2 [5] Describe the chain of custody in a digital forensic investigation
Model: The chain of custody is a documented record of everyone who collected,
handled, transferred and stored digital evidence, with dates and times. It
shows the evidence was not tampered with, so it remains admissible in court.
Investigators label and seal evidence, create a forensic image, and verify it
with a hash value.
Keywords:
- chain of custody | custody
- document* | record | log
- evidence
- tamper* | altered | integrity
- admissible | court
- hash* | forensic image | imaging

Q3 [5] Outline the phases of ethical hacking
Model: Ethical hacking follows phases. Reconnaissance gathers information about
the target. Scanning identifies open ports, services and vulnerabilities.
Gaining access exploits a vulnerability. Maintaining access keeps a foothold in
the system. Covering tracks removes evidence, and the ethical hacker then writes
a report for the organisation with permission and authorisation.
Keywords:
- reconnaissance | footprinting | information gathering
- scanning | scan
- gaining access | exploit*
- maintaining access
- covering tracks | clearing tracks
- report* | permission

Q4 [5] What is phishing and how can it be prevented?
Model: Phishing is a social engineering attack in which an attacker sends a fake
email or message that pretends to come from a trusted source, to trick users into
revealing passwords or clicking malicious links. It can be prevented by user
awareness training, checking the sender and links, email filtering and
multi-factor authentication.
Keywords:
- social engineering
- email | message
- fake | pretend* | trusted | impersonat*
- password* | credentials
- link* | attachment*
- training | awareness | education
- multi factor | two factor | authentication | filter*
`;

  const DEFAULT_SETTINGS = {
    w: 0.5, theta: 0.8, tau: 0.1, step: 0.5, removeStopwords: true, stem: true,
    passPct: 50, bandPct: 10, segMode: 'strict',
    engine: 'tesseract', ocrSpaceEngine: '2',
    subs: G.DEFAULT_SUBSTITUTIONS,
    pp: Object.assign({}, P.DEFAULTS)
  };

  // ------------------------------------------------------------ state

  let state = ST.loadState();
  if (!state || state.version !== 1) {
    state = { version: 1, rubricText: SAMPLE_RUBRIC, settings: clone(DEFAULT_SETTINGS), scripts: [], selectedId: null, cerPairs: [], evalCsv: '', timeCsv: '' };
  }
  state.settings = Object.assign(clone(DEFAULT_SETTINGS), state.settings || {});
  state.settings.pp = Object.assign({}, P.DEFAULTS, state.settings.pp || {});
  state.cerPairs = state.cerPairs || [];

  let apiKey = ST.getPref('ocrspaceKey', '') || '';
  let rubric = { questions: [], errors: [], warnings: [] };
  let subsMap = {};
  let vocab = {};
  let busy = false;
  let stopRequested = false;
  let currentTab = 'rubric';
  let viewer = { pageIdx: 0, zoom: 1 };
  let timerStart = null;
  const urlCache = new Map();
  const cardUpdaters = new Map();

  // ------------------------------------------------------------ helpers

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function $(id) { return document.getElementById(id); }
  function uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function fmt(x, d) { return x === null || x === undefined || !isFinite(x) ? '–' : Number(x).toFixed(d === undefined ? 2 : d); }
  function fmtMark(x) { return x === null || x === undefined || !isFinite(x) ? '–' : String(Math.round(x * 100) / 100); }
  function ci(a) { return a ? '(' + fmt(a[0]) + '–' + fmt(a[1]) + ')' : ''; }
  function pct(x, d) { return isFinite(x) ? (x * 100).toFixed(d === undefined ? 1 : d) + '%' : '–'; }
  function mmss(ms) { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (k === 'style') n.style.cssText = v;
        else if (k === 'value') n.value = v;
        else if (k in n && typeof v !== 'string') n[k] = v;
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    kids.flat(Infinity).forEach(c => { if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : String(c)); });
    return n;
  }

  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 3200);
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!ST.saveState(state)) toast('Could not save to browser storage — export the session to keep your work.');
    }, 300);
  }

  function download(name, text, type) {
    const blob = text instanceof Blob ? text : new Blob([text], { type: type || 'text/plain' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function blobUrl(id) {
    if (urlCache.has(id)) return urlCache.get(id);
    const b = await ST.getBlob(id);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urlCache.set(id, u);
    return u;
  }
  function dropUrl(id) { if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); } }

  function scoringOpts() {
    const s = state.settings;
    return { w: +s.w, theta: +s.theta, tau: +s.tau, step: +s.step, removeStopwords: !!s.removeStopwords, stem: !!s.stem };
  }

  function selected() { return state.scripts.find(s => s.id === state.selectedId) || null; }
  function qById(id) { return rubric.questions.find(q => q.id === id); }
  function maxTotal() { return rubric.questions.reduce((t, q) => t + q.max, 0); }

  function effective(a) { return a.final !== null && a.final !== undefined ? a.final : (a.result ? a.result.suggested : 0); }

  function scriptTotals(s) {
    let sug = 0, fin = 0, tool = 0;
    rubric.questions.forEach(q => {
      const a = s.answers && s.answers[q.id];
      if (!a || !a.result) return;
      sug += a.result.suggested;
      fin += effective(a);
      tool += a.originalSuggested !== undefined && a.originalSuggested !== null ? a.originalSuggested : a.result.suggested;
    });
    const max = maxTotal();
    const pass = state.settings.passPct / 100 * max;
    const band = state.settings.bandPct / 100 * max;
    return { suggested: sug, final: fin, tool: tool, max: max, pass: fin >= pass - 1e-9, nearPass: Math.abs(sug - pass) <= band + 1e-9, passMark: pass };
  }

  // ------------------------------------------------------------ rubric

  function applyRubric() {
    rubric = G.parseRubric(state.rubricText);
    subsMap = G.parseSubstitutions(state.settings.subs);
    vocab = G.rubricVocabulary(rubric, subsMap);
    state.scripts.forEach(ensureAnswers);
    rescoreAll();
  }

  function renderRubric() {
    const msgs = $('rubricMessages');
    msgs.innerHTML = '';
    if (rubric.errors.length) msgs.append(el('div', { class: 'notice err' }, el('strong', { text: 'Fix before marking:' }), el('ul', null, rubric.errors.map(e => el('li', { text: e })))));
    if (rubric.warnings.length) msgs.append(el('div', { class: 'notice warn' }, el('ul', null, rubric.warnings.map(e => el('li', { text: e })))));
    $('rubricTotal').textContent = rubric.questions.length + ' question' + (rubric.questions.length === 1 ? '' : 's') + ' · ' + fmtMark(maxTotal()) + ' marks';
    const pv = $('rubricPreview');
    pv.innerHTML = '';
    rubric.questions.forEach(q => {
      pv.append(el('div', { class: 'q-preview' },
        el('div', { class: 'row spread' }, el('strong', { text: q.label + (q.title ? ' — ' + q.title : '') }), el('span', { class: 'badge blue', text: fmtMark(q.max) + ' marks' })),
        el('div', { class: 'model', text: q.model || '(no model answer)' }),
        el('div', null, q.keywordGroups.length
          ? q.keywordGroups.map((g, i) => el('span', { class: 'chip', title: 'Keyword group ' + (i + 1) }, g.join(' | ')))
          : el('span', { class: 'small muted', text: 'No keyword groups — similarity only.' }))
      ));
    });
  }

  // ------------------------------------------------------------ answers & scoring

  function blankAnswer() {
    return { text: '', ocrText: '', textEdited: false, result: null, originalSuggested: null, final: null, status: 'pending', reason: '' };
  }

  function ensureAnswers(s) {
    s.answers = s.answers || {};
    if (s.status !== 'review' && s.status !== 'confirmed') return;
    rubric.questions.forEach(q => { if (!s.answers[q.id]) s.answers[q.id] = blankAnswer(); });
  }

  function scoreText(text, q) {
    const info = text.trim() ? { dictRatio: G.dictionaryRatio(text, vocab, subsMap) } : null;
    return G.scoreResponse(text, q, scoringOpts(), subsMap, info);
  }

  function scoreAnswer(a, q) {
    a.result = scoreText(a.text, q);
    a.originalSuggested = a.textEdited ? scoreText(a.ocrText, q).suggested : a.result.suggested;
  }

  function rescoreAll() {
    state.scripts.forEach(s => {
      if (s.status !== 'review') return; // confirmed scripts are frozen
      rubric.questions.forEach(q => { const a = s.answers[q.id]; if (a) scoreAnswer(a, q); });
    });
  }

  /** Build per-question answers from page OCR text (assigned pages + marker segmentation). */
  function compileScript(s) {
    const ids = rubric.questions.map(q => q.id);
    const assigned = {};
    const auto = [];
    s.pages.forEach(p => {
      const t = p.ocr ? p.ocr.text : '';
      if (p.assign && p.assign !== 'auto' && ids.includes(p.assign)) assigned[p.assign] = (assigned[p.assign] ? assigned[p.assign] + '\n' : '') + t;
      else auto.push(t);
    });
    const seg = G.segmentAnswers(auto.join('\n'), ids, state.settings.segMode);
    s.answers = {};
    rubric.questions.forEach(q => {
      const text = [assigned[q.id], seg.answers[q.id]].filter(Boolean).join('\n').trim();
      const a = blankAnswer();
      a.text = a.ocrText = text;
      scoreAnswer(a, q);
      s.answers[q.id] = a;
    });
    s.unassigned = seg.unassigned;
    s.markersFound = seg.markersFound;
  }

  // ------------------------------------------------------------ privacy & status

  function renderPrivacy() {
    const b = $('privacyBadge');
    if (state.settings.engine === 'tesseract') {
      b.className = 'badge green';
      b.textContent = '● Offline OCR · scripts stay on this device';
    } else {
      b.className = 'badge amber';
      b.textContent = '● Cloud OCR on · page images are sent to OCR.space';
    }
    const n = $('netBadge');
    n.className = 'badge ' + (navigator.onLine ? 'grey' : 'blue');
    n.textContent = navigator.onLine ? 'online' : 'offline';
    $('engineLabel').textContent = 'Engine: ' + { tesseract: 'Tesseract.js (offline)', ocrspace: 'OCR.space (cloud)', best: 'best of Tesseract.js + OCR.space' }[state.settings.engine] +
      (state.settings.pp.enabled ? ' · handwriting boost on' : ' · preprocessing off');
    $('cloudFields').classList.toggle('hidden', state.settings.engine === 'tesseract');
  }

  // ------------------------------------------------------------ uploads

  async function addFiles(files) {
    files = Array.from(files).filter(f => /^image\//.test(f.type) || /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!files.length) { toast('Only JPG, PNG, WebP or PDF files are accepted.'); return; }
    const mode = $('groupMode').value;
    const groups = new Map();
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    files.forEach(f => {
      let key;
      if (mode === 'single') key = 'Script ' + (state.scripts.length + 1);
      else if (mode === 'prefix') key = f.name.replace(/\.[^.]+$/, '').split(/[_\-\s]/)[0] || f.name;
      else key = f.name.replace(/\.[^.]+$/, '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    });
    setProgress(0, 'Reading files…');
    let done = 0;
    for (const [name, list] of groups) {
      const s = { id: uid('s'), name: name, created: Date.now(), pages: [], status: 'new', answers: {}, unassigned: '', timeMs: 0 };
      for (const f of list) {
        try {
          const pages = /\.pdf$/i.test(f.name) || f.type === 'application/pdf'
            ? await O.renderPdf(f, (n, t) => setProgress(done / files.length, 'Rendering ' + f.name + ' page ' + n + ' of ' + t + '…'))
            : [{ name: f.name, blob: await O.normaliseImage(f) }];
          for (const pg of pages) {
            const id = uid('p');
            await ST.putBlob(id, pg.blob);
            s.pages.push({ id: id, name: pg.name, rotation: 0, assign: 'auto', ocr: null });
          }
        } catch (e) {
          console.error(e);
          toast('Could not read ' + f.name + ': ' + e.message, 6000);
        }
        done++;
        setProgress(done / files.length, 'Read ' + done + ' of ' + files.length + ' files');
      }
      if (s.pages.length) state.scripts.push(s);
    }
    setProgress(1, 'Files added. Check each page, then run OCR.');
    save();
    renderScripts();
    updateCounts();
  }

  async function addPhotoToScript(s, file) {
    if (!file) return;
    try {
      const blob = await O.normaliseImage(file);
      const id = uid('p');
      await ST.putBlob(id, blob);
      s.pages.push({ id: id, name: 'photo ' + (s.pages.length + 1), rotation: 0, assign: 'auto', ocr: null });
      if (s.status === 'review') s.status = 'new';
      if (!state.scripts.includes(s)) state.scripts.push(s);
      save(); renderScripts(); updateCounts();
      toast('Page ' + s.pages.length + ' added to ' + s.name + '. Use "📷 + page" on its card for the next page.');
    } catch (e) {
      toast('Could not read the photo: ' + e.message, 6000);
    }
  }

  function newCameraScript(file) {
    const n = state.scripts.length + 1;
    const s = { id: uid('s'), name: 'Script ' + String(n).padStart(2, '0'), created: Date.now(), pages: [], status: 'new', answers: {}, unassigned: '', timeMs: 0 };
    return addPhotoToScript(s, file);
  }

  function setProgress(frac, text) {
    $('progressBar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    if (text !== undefined) $('progressText').textContent = text;
  }

  // ------------------------------------------------------------ processing

  async function processScripts(list, force) {
    if (busy) return;
    if (rubric.errors.length || !rubric.questions.length) { toast('Fix the rubric first (tab 1).'); switchTab('rubric'); return; }
    if (state.settings.engine !== 'tesseract' && !apiKey) { toast('Enter an OCR.space API key in Settings, or switch to Tesseract.js.'); switchTab('settings'); return; }
    busy = true;
    stopRequested = false;
    $('stopBtn').disabled = false;
    $('processAllBtn').disabled = true;
    const pages = [];
    list.forEach(s => s.pages.forEach(p => { if (force || !p.ocr) pages.push([s, p]); }));
    const total = Math.max(1, pages.length);
    let n = 0;
    try {
      for (const s of list) {
        const todo = s.pages.filter(p => force || !p.ocr);
        if (todo.length) { s.status = 'processing'; renderScripts(); }
        for (const p of todo) {
          if (stopRequested) break;
          const label = s.name + ' · page ' + (s.pages.indexOf(p) + 1);
          setProgress(n / total, label + ': preprocessing…');
          await new Promise(r => setTimeout(r, 30));
          try {
            const blob = await ST.getBlob(p.id);
            if (!blob) throw new Error('page image is missing (reload the file)');
            const canvas = await O.blobToCanvas(blob, p.rotation, O.LIMITS.process);
            const pc = P.processCanvas(canvas, Object.assign({}, state.settings.pp, { maxSide: Math.min(state.settings.pp.maxSide || 2600, O.LIMITS.ppMaxSide) }));
            const pb = await O.canvasToBlob(pc, 'image/jpeg', 0.85);
            dropUrl(p.id + ':proc');
            await ST.putBlob(p.id + ':proc', pb);
            setProgress(n / total, label + ': recognising text…');
            const res = await O.recognize(pc, {
              mode: state.settings.engine,
              apiKey: apiKey,
              ocrSpaceEngine: state.settings.ocrSpaceEngine,
              score: t => G.dictionaryRatio(t, vocab, subsMap),
              onProgress: m => {
                if (m.status === 'recognizing text') setProgress((n + m.progress) / total, label + ': recognising text ' + Math.round(m.progress * 100) + '%');
                else if (m.status) setProgress(n / total, label + ': ' + m.status + (m.progress ? ' ' + Math.round(m.progress * 100) + '%' : ''));
              }
            });
            p.ocr = {
              text: res.chosen.text, engine: res.chosen.engine, dictRatio: res.chosen.dictRatio,
              candidates: res.candidates.map(c => ({ engine: c.engine, dictRatio: c.dictRatio, error: c.error || null, text: c.text || '' }))
            };
            p.error = null;
          } catch (e) {
            console.error(e);
            p.error = e.message;
            toast(label + ': ' + e.message, 7000);
          }
          n++;
          setProgress(n / total);
          save();
        }
        const finished = s.pages.every(p => p.ocr);
        if (finished) {
          compileScript(s);
          s.status = 'review';
          if (!state.selectedId) state.selectedId = s.id;
        } else if (s.status === 'processing') s.status = 'new';
        renderScripts();
        if (stopRequested) break;
      }
      setProgress(1, stopRequested ? 'Stopped.' : 'Done. Open the Review tab to check and confirm marks.');
    } finally {
      busy = false;
      $('stopBtn').disabled = true;
      $('processAllBtn').disabled = false;
      save();
      renderScripts();
      updateCounts();
    }
  }

  // ------------------------------------------------------------ scripts tab

  function statusBadge(s) {
    const map = { new: ['grey', 'not processed'], processing: ['blue', 'processing…'], review: ['amber', 'awaiting review'], confirmed: ['green', 'confirmed'] };
    const m = map[s.status] || map.new;
    return el('span', { class: 'badge ' + m[0], text: m[1] });
  }

  function renderScripts() {
    const box = $('scriptList');
    box.innerHTML = '';
    if (!state.scripts.length) {
      box.append(el('div', { class: 'card muted', text: 'No scripts yet. Upload scans above, or click "Add demo script" to try the workflow.' }));
      return;
    }
    const qOpts = [['auto', 'auto (split on Q markers)']].concat(rubric.questions.map(q => [q.id, 'all ' + q.label]));
    state.scripts.forEach((s, si) => {
      const nameInput = el('input', { type: 'text', value: s.name, 'aria-label': 'Script name', onchange: e => { s.name = e.target.value.trim() || s.name; save(); updateScriptSelect(); } });
      const pages = el('div', { class: 'pages' });
      s.pages.forEach((p, pi) => {
        const img = el('img', { alt: p.name, loading: 'lazy', onclick: () => openPage(s, pi) });
        blobUrl(p.id).then(u => { if (u) img.src = u; });
        img.style.transform = 'rotate(' + p.rotation + 'deg)';
        const sel = el('select', { 'aria-label': 'Question for this page', disabled: s.status === 'confirmed', onchange: e => { p.assign = e.target.value; if (s.status === 'review') { compileScript(s); toast('Answers rebuilt from OCR text.'); } save(); } },
          qOpts.map(([v, t]) => el('option', { value: v, text: t, selected: p.assign === v })));
        const ocrInfo = p.ocr
          ? el('span', { class: 'badge ' + (p.ocr.dictRatio >= 0.75 ? 'green' : p.ocr.dictRatio >= 0.5 ? 'amber' : 'red'), title: 'Share of recognisable words', text: (p.ocr.engine === 'ocrspace' ? 'OCR.space' : 'Tesseract') + ' · ' + pct(p.ocr.dictRatio, 0) })
          : p.error ? el('span', { class: 'badge red', title: p.error, text: 'error' }) : el('span', { class: 'badge grey', text: 'no OCR yet' });
        pages.append(el('div', { class: 'page-tile' }, img,
          el('div', { class: 'meta' },
            el('div', { class: 'row spread' }, el('span', { text: 'Page ' + (pi + 1) }), ocrInfo),
            sel,
            el('div', { class: 'row' },
              el('button', { class: 'btn small', title: 'Rotate 90°', disabled: s.status === 'confirmed', onclick: () => { p.rotation = (p.rotation + 90) % 360; p.ocr = null; if (s.status === 'review') s.status = 'new'; save(); renderScripts(); } }, '⟳'),
              pi > 0 ? el('button', { class: 'btn small', title: 'Move earlier', disabled: s.status === 'confirmed', onclick: () => { s.pages.splice(pi - 1, 0, s.pages.splice(pi, 1)[0]); if (s.status === 'review') compileScript(s); save(); renderScripts(); } }, '◀') : null,
              el('button', { class: 'btn small danger', title: 'Remove page', disabled: s.status === 'confirmed', onclick: () => { if (!confirm('Remove this page?')) return; s.pages.splice(pi, 1); ST.deleteBlob(p.id); ST.deleteBlob(p.id + ':proc'); dropUrl(p.id); if (!s.pages.length) { state.scripts.splice(si, 1); } else if (s.status === 'review') compileScript(s); save(); renderScripts(); updateCounts(); } }, '✕')
            ),
            p.ocr ? el('details', null, el('summary', { text: 'OCR text' }), el('div', { class: 'ocr-text', text: p.ocr.text || '(empty)' }),
              p.ocr.candidates && p.ocr.candidates.length > 1 ? el('div', { class: 'small muted' }, p.ocr.candidates.map(c => c.engine + ': ' + (c.error ? 'error' : pct(c.dictRatio, 0))).join(' · ')) : null) : null
          )));
      });
      const addPages = el('label', { class: 'btn small' }, '+ pages', el('input', { type: 'file', multiple: true, accept: 'image/*,application/pdf,.pdf', onchange: async e => {
        const files = Array.from(e.target.files);
        for (const f of files) {
          const pg = /\.pdf$/i.test(f.name) ? await O.renderPdf(f) : [{ name: f.name, blob: await O.normaliseImage(f) }];
          for (const x of pg) { const id = uid('p'); await ST.putBlob(id, x.blob); s.pages.push({ id: id, name: x.name, rotation: 0, assign: 'auto', ocr: null }); }
        }
        if (s.status === 'review') s.status = 'new';
        save(); renderScripts();
      } }));
      const addPhoto = el('label', { class: 'btn small', title: 'Photograph another page with the camera' }, '📷 + page', el('input', { type: 'file', accept: 'image/*', capture: 'environment', onchange: e => { const f = e.target.files[0]; e.target.value = ''; addPhotoToScript(s, f); } }));
      const t = s.status === 'review' || s.status === 'confirmed' ? scriptTotals(s) : null;
      box.append(el('div', { class: 'script-card' },
        el('div', { class: 'row spread' },
          el('div', { class: 'row' }, el('strong', { text: '#' + (si + 1) }), nameInput, statusBadge(s),
            t ? el('span', { class: 'small muted', text: 'Total ' + fmtMark(t.final) + ' / ' + fmtMark(t.max) }) : null),
          el('div', { class: 'row' },
            s.status !== 'confirmed' ? addPhoto : null,
            s.status !== 'confirmed' ? addPages : null,
            el('button', { class: 'btn small primary', disabled: busy || s.status === 'confirmed', onclick: () => processScripts([s], s.status === 'review') }, s.status === 'review' ? 'Re-run OCR' : 'Run OCR & score'),
            s.status === 'review' || s.status === 'confirmed' ? el('button', { class: 'btn small', onclick: () => { state.selectedId = s.id; switchTab('review'); } }, 'Review →') : null,
            el('button', { class: 'btn small danger', onclick: () => deleteScript(s) }, 'Delete'))),
        pages));
    });
  }

  function deleteScript(s) {
    if (!confirm('Delete script "' + s.name + '" and its pages?')) return;
    s.pages.forEach(p => { ST.deleteBlob(p.id); ST.deleteBlob(p.id + ':proc'); dropUrl(p.id); dropUrl(p.id + ':proc'); });
    state.scripts = state.scripts.filter(x => x !== s);
    if (state.selectedId === s.id) state.selectedId = null;
    save(); renderScripts(); updateCounts();
  }

  async function openPage(s, pi, processed) {
    const p = s.pages[pi];
    const id = processed ? p.id + ':proc' : p.id;
    const u = await blobUrl(id);
    $('modalTitle').textContent = s.name + ' — page ' + (pi + 1) + (processed ? ' (processed)' : '');
    const body = $('modalBody');
    body.innerHTML = '';
    if (u) {
      const img = el('img', { src: u, alt: 'Page ' + (pi + 1) });
      if (!processed) img.style.transform = 'rotate(' + p.rotation + 'deg)';
      body.append(img);
    } else body.append(el('p', { text: 'Image not available.' }));
    $('modal').classList.remove('hidden');
  }

  function updateCounts() { $('countScripts').textContent = state.scripts.length; }

  // ------------------------------------------------------------ demo page

  async function addDemoScript() {
    const answers = [
      'Q1 The CIA triad has three parts. Confidentiality means data is kept',
      'secret so that only authorised users can access it, e.g. by encryption.',
      'Integrity means the data is accurate and not altered by unauthorised',
      'people. Availability means the system is accessible when needed.',
      '',
      'Q2 Chain of custody is a record of who collected and handled the',
      'evidence and when. It shows the evidence was not tampered with so',
      'it is admissible in court. Investigators make a forensic image.',
      '',
      'Q3 Phases of ethical hacking: reconnaissance to gather information,',
      'scanning for open ports, gaining access, maintaining access and',
      'covering tracks. A report is given to the organisation.',
      '',
      'Q4 Phishing is a fake email that tricks users into giving their',
      'passwords or clicking links. Prevent it by awareness training.'
    ];
    const c = el('canvas');
    c.width = 1700; c.height = 2200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fbfaf5'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = 'rgba(80,120,200,.25)';
    for (let y = 150; y < c.height; y += 64) { ctx.beginPath(); ctx.moveTo(60, y + 16); ctx.lineTo(c.width - 60, y + 16); ctx.stroke(); }
    ctx.fillStyle = '#1d2a6b';
    ctx.font = '40px "Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive';
    ctx.fillText('Candidate: DEMO-001        Course: Intro to Cyber Security', 90, 110);
    ctx.font = '42px "Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive';
    let y = 214;
    answers.forEach(line => {
      ctx.save();
      ctx.translate(90 + Math.random() * 8, y);
      ctx.rotate((Math.random() - 0.5) * 0.008);
      ctx.fillText(line, 0, 0);
      ctx.restore();
      y += 64 * (line ? 1 : 0.6);
    });
    const blob = await O.canvasToBlob(c, 'image/jpeg', 0.9);
    const id = uid('p');
    await ST.putBlob(id, blob);
    state.scripts.push({ id: uid('s'), name: 'DEMO-001', created: Date.now(), pages: [{ id: id, name: 'demo.jpg', rotation: 0, assign: 'auto', ocr: null }], status: 'new', answers: {}, unassigned: '', timeMs: 0 });
    save(); renderScripts(); updateCounts();
    toast('Demo script added. Click "Run OCR & score".');
  }

  // ------------------------------------------------------------ review tab

  function reviewable() { return state.scripts.filter(s => s.status === 'review' || s.status === 'confirmed'); }

  function updateScriptSelect() {
    const sel = $('scriptSelect');
    const list = reviewable();
    sel.innerHTML = '';
    list.forEach(s => sel.append(el('option', { value: s.id, text: (s.status === 'confirmed' ? '✓ ' : '• ') + s.name, selected: s.id === state.selectedId })));
  }

  function timerPause() {
    if (timerStart === null) return;
    const s = state.scripts.find(x => x.id === timerStart.id);
    if (s) s.timeMs = (s.timeMs || 0) + (Date.now() - timerStart.t);
    timerStart = null;
    save();
  }
  function timerResume() {
    timerPause();
    const s = selected();
    if (currentTab === 'review' && s && s.status === 'review' && document.visibilityState === 'visible') timerStart = { id: s.id, t: Date.now() };
  }
  function timerDisplay() {
    const s = selected();
    if (!s || currentTab !== 'review') return;
    let ms = s.timeMs || 0;
    if (timerStart && timerStart.id === s.id) ms += Date.now() - timerStart.t;
    $('timer').textContent = mmss(ms);
  }

  function renderReview() {
    const list = reviewable();
    $('reviewEmpty').classList.toggle('hidden', list.length > 0);
    $('reviewArea').classList.toggle('hidden', list.length === 0);
    if (!list.length) return;
    if (!selected() || !list.includes(selected())) state.selectedId = list[0].id;
    const s = selected();
    ensureAnswers(s);
    updateScriptSelect();
    viewer.pageIdx = Math.min(viewer.pageIdx, s.pages.length - 1);
    renderViewer(s);
    $('unassignedText').value = s.unassigned || '';
    $('unassignedText').disabled = s.status === 'confirmed';
    $('unassignedCount').textContent = s.unassigned ? '(' + s.unassigned.split(/\s+/).filter(Boolean).length + ' words)' : '(none)';
    $('resegmentBtn').disabled = s.status === 'confirmed';
    const cards = $('questionCards');
    cards.innerHTML = '';
    cardUpdaters.clear();
    rubric.questions.forEach(q => cards.append(questionCard(s, q)));
    renderScriptBar(s);
    timerResume();
    timerDisplay();
  }

  function renderScriptBar(s) {
    const t = scriptTotals(s);
    $('totSuggested').textContent = fmtMark(t.suggested) + ' / ' + fmtMark(t.max);
    $('totFinal').textContent = fmtMark(t.final) + ' / ' + fmtMark(t.max);
    const d = $('totDecision');
    d.className = 'badge ' + (t.pass ? 'green' : 'red');
    d.textContent = (t.pass ? 'Pass' : 'Fail') + ' (pass mark ' + fmtMark(t.passMark) + ')';
    const st = $('scriptStatus');
    const pending = rubric.questions.filter(q => s.answers[q.id] && s.answers[q.id].status === 'pending').length;
    if (s.status === 'confirmed') { st.className = 'badge green'; st.textContent = 'Confirmed'; }
    else { st.className = 'badge amber'; st.textContent = pending ? pending + ' question' + (pending > 1 ? 's' : '') + ' to review' : 'All reviewed — confirm'; }
    $('confirmBtn').textContent = s.status === 'confirmed' ? 'Reopen script' : 'Confirm script';
    $('acceptAllBtn').disabled = s.status === 'confirmed';
    const flags = $('scriptFlags');
    flags.innerHTML = '';
    if (t.nearPass) flags.append(el('div', { class: 'notice warn' }, el('strong', { text: 'Re-mark in full: ' }), 'the suggested total (' + fmtMark(t.suggested) + ') is within ' + fmtMark(state.settings.bandPct / 100 * t.max) + ' marks of the pass mark. Errors near the pass mark change decisions.'));
    const counts = { red: 0, amber: 0 };
    rubric.questions.forEach(q => { const a = s.answers[q.id]; if (a && a.result && counts[a.result.confidence] !== undefined) counts[a.result.confidence]++; });
    if (counts.red || counts.amber) flags.append(el('div', { class: 'small muted', text: 'Check first: ' + counts.red + ' red and ' + counts.amber + ' amber question(s).' }));
    if (!s.markersFound && rubric.questions.length > 1 && s.pages.every(p => p.assign === 'auto')) flags.append(el('div', { class: 'notice warn', text: 'No question markers (Q1, Question 2 …) were found. Assign pages to questions on the Scripts tab, or paste text into each question below.' }));
  }

  async function renderViewer(s) {
    const tabs = $('pageTabs');
    tabs.innerHTML = '';
    s.pages.forEach((p, i) => tabs.append(el('button', { class: 'btn small' + (i === viewer.pageIdx ? ' primary' : ''), onclick: () => { viewer.pageIdx = i; renderViewer(s); } }, 'p' + (i + 1) + (p.assign !== 'auto' ? ' · Q' + p.assign : ''))));
    const p = s.pages[viewer.pageIdx];
    const img = $('stageImg');
    if (!p) { img.removeAttribute('src'); return; }
    const processed = $('showProcessed').checked;
    let u = await blobUrl(processed ? p.id + ':proc' : p.id);
    if (!u && processed) u = await blobUrl(p.id);
    img.src = u || '';
    img.style.width = (viewer.zoom * 100) + '%';
    img.style.transform = processed ? '' : (p.rotation ? 'rotate(' + p.rotation + 'deg)' : '');
  }

  function highlightNodes(text, matched) {
    const found = new Set();
    matched.forEach(m => m.found.split(' ').forEach(w => found.add(w)));
    const frag = document.createDocumentFragment();
    String(text).split(/(\s+)/).forEach(part => {
      if (!part) return;
      const norm = G.normalizeText(part, subsMap);
      if (norm.length && norm.some(t => found.has(t))) frag.append(el('mark', { text: part }));
      else frag.append(part);
    });
    return frag;
  }

  function questionCard(s, q) {
    const a = s.answers[q.id];
    const locked = s.status === 'confirmed';
    const card = el('article', { class: 'qcard', id: 'q-' + q.id });
    const confBadge = el('span', { class: 'badge' });
    const statusBadgeEl = el('span', { class: 'badge' });
    const suggestEl = el('span', { class: 'suggest' });
    const finalInput = el('input', { type: 'number', min: 0, max: q.max, step: state.settings.step || 0.25, 'aria-label': 'Final mark for ' + q.label, disabled: locked });
    const acceptBtn = el('button', { class: 'btn small primary', disabled: locked }, 'Accept');
    const reasonSel = el('select', { 'aria-label': 'Reason for change', disabled: locked },
      el('option', { value: 'text', text: 'Reason: OCR text corrected' }),
      el('option', { value: 'judgement', text: 'Reason: different judgement of quality' }),
      el('option', { value: 'other', text: 'Reason: other' }));
    const reasonWrap = el('div', { class: 'row hidden' }, reasonSel);
    const textArea = el('textarea', { rows: 8, value: a.text, 'aria-label': 'Recognised text for ' + q.label, disabled: locked, spellcheck: true });
    const metrics = el('div');
    const hl = el('div', { class: 'highlight' });

    function update() {
      const r = a.result;
      card.className = 'qcard ' + r.confidence;
      confBadge.className = 'badge ' + r.confidence;
      confBadge.textContent = { green: 'Confident', amber: 'Check', red: 'Check carefully' }[r.confidence];
      const sm = { pending: ['grey', 'Not reviewed'], accepted: ['green', 'Accepted'], changed: ['blue', 'Changed'] }[a.status] || ['grey', a.status];
      statusBadgeEl.className = 'badge ' + sm[0];
      statusBadgeEl.textContent = sm[1];
      suggestEl.textContent = fmtMark(r.suggested) + ' / ' + fmtMark(q.max);
      if (document.activeElement !== finalInput) finalInput.value = fmtMark(effective(a));
      const overridden = a.status !== 'pending' && Math.abs(effective(a) - a.originalSuggested) > 1e-9;
      reasonWrap.classList.toggle('hidden', !overridden);
      if (overridden) {
        if (!a.reason) a.reason = a.textEdited ? 'text' : 'judgement';
        reasonSel.value = a.reason;
      }
      metrics.innerHTML = '';
      const bar = (label, v, title) => el('div', { class: 'metric-row', title: title },
        el('span', { text: label }), el('div', { class: 'bar' }, el('div', { style: 'width:' + Math.round((v || 0) * 100) + '%' })), el('strong', { text: v === null ? 'n/a' : fmt(v) }));
      metrics.append(...[
        bar('Similarity (cos)', r.cosine, 'Cosine similarity between the answer and the model answer'),
        bar('Keyword coverage', r.coverage, 'Share of keyword groups found'),
        el('div', { class: 'small muted', text: 'Raw score ' + fmt(r.raw) + ' → rounded ' + fmtMark(r.suggested) + (a.textEdited ? ' · tool score on unedited OCR text: ' + fmtMark(a.originalSuggested) : '') + ' · ' + r.wordCount + ' words' }),
        el('div', { style: 'margin-top:6px' }, el('div', { class: 'small', text: 'Matched keywords' }),
          r.matched.length ? r.matched.map(m => el('span', { class: 'chip hit', title: 'Matched "' + m.found + '" (similarity ' + fmt(m.similarity) + ')' }, m.keyword + (m.found !== m.keyword.replace(/\*$/, '') ? ' ← ' + m.found : ''))) : el('span', { class: 'small muted', text: 'none' })),
        el('div', { style: 'margin-top:4px' }, el('div', { class: 'small', text: 'Missing keywords' }),
          r.missed.length ? r.missed.map(m => el('span', { class: 'chip miss' }, m.keywords.join(' | '))) : el('span', { class: 'small muted', text: 'none' })),
        r.reasons.length ? el('ul', { class: 'reasons' }, r.reasons.map(x => el('li', { text: x }))) : null
      ].filter(Boolean));
      hl.innerHTML = '';
      hl.append(a.text.trim() ? highlightNodes(a.text, r.matched) : el('span', { class: 'muted', text: '(no text)' }));
    }

    function afterChange() {
      update();
      renderScriptBar(s);
      save();
    }

    let tmr = null;
    textArea.addEventListener('input', () => {
      clearTimeout(tmr);
      tmr = setTimeout(() => {
        a.text = textArea.value;
        a.textEdited = a.text !== a.ocrText;
        scoreAnswer(a, q);
        if (a.status === 'accepted') { a.status = 'pending'; a.final = null; }
        afterChange();
      }, 250);
    });
    finalInput.addEventListener('change', () => {
      let v = parseFloat(finalInput.value);
      if (!isFinite(v)) { finalInput.value = fmtMark(effective(a)); return; }
      v = Math.max(0, Math.min(q.max, v));
      a.final = v;
      a.status = Math.abs(v - a.result.suggested) < 1e-9 ? 'accepted' : 'changed';
      a.reason = '';
      finalInput.value = fmtMark(v);
      afterChange();
    });
    acceptBtn.addEventListener('click', () => {
      a.final = a.result.suggested;
      a.status = 'accepted';
      a.reason = '';
      afterChange();
    });
    reasonSel.addEventListener('change', () => { a.reason = reasonSel.value; save(); });

    const assignedPage = s.pages.findIndex(p => p.assign === q.id);
    card.append(
      el('header', null,
        el('h3', { text: q.label + (q.title ? ' — ' + q.title : '') }),
        confBadge, statusBadgeEl,
        assignedPage >= 0 ? el('button', { class: 'btn small', onclick: () => { viewer.pageIdx = assignedPage; renderViewer(s); } }, 'Show page') : null),
      el('div', { class: 'qbody' },
        el('div', { class: 'stack' },
          el('div', { class: 'row spread' }, el('span', { class: 'small', text: 'Recognised text (edit to correct OCR errors; the score updates)' }),
            el('button', { class: 'btn small', disabled: locked, title: 'Restore the OCR output', onclick: () => { textArea.value = a.ocrText; textArea.dispatchEvent(new Event('input')); } }, 'Reset')),
          textArea,
          el('details', null, el('summary', { text: 'Matched words in context' }), hl),
          el('details', null, el('summary', { text: 'Model answer' }), el('div', { class: 'highlight', text: q.model }))),
        el('div', { class: 'stack' },
          el('div', { class: 'mark-box' }, el('span', { class: 'small muted', text: 'Suggested' }), suggestEl),
          el('div', { class: 'mark-box' }, el('span', { class: 'small muted', text: 'Final mark' }), finalInput, acceptBtn),
          reasonWrap,
          metrics))
    );
    update();
    cardUpdaters.set(q.id, update);
    return card;
  }

  function moveScript(dir) {
    const list = reviewable();
    const i = list.findIndex(s => s.id === state.selectedId);
    const n = list[i + dir];
    if (!n) return;
    timerPause();
    state.selectedId = n.id;
    viewer.pageIdx = 0;
    save();
    renderReview();
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ results tab

  function renderResults() {
    const qs = rubric.questions;
    const done = reviewable();
    const table = $('resultsTable');
    table.innerHTML = '';
    const head = el('tr', null, el('th', { text: 'Script' }), qs.map(q => el('th', { class: 'num', text: q.label + ' (' + fmtMark(q.max) + ')' })),
      el('th', { class: 'num', text: 'Total' }), el('th', { class: 'num', text: '%' }), el('th', { text: 'Decision' }), el('th', { text: 'Flags' }), el('th', { text: 'Status' }), el('th', { class: 'num', text: 'Time' }));
    table.append(el('thead', null, head));
    const body = el('tbody');
    let answers = 0, reviewed = 0, changed = 0, changedText = 0, changedFlagged = 0, flagged = 0, passes = 0;
    const times = [], pcts = [];
    done.forEach(s => {
      const t = scriptTotals(s);
      if (t.pass) passes++;
      pcts.push(t.final / t.max);
      if (s.status === 'confirmed' && s.timeMs) times.push(s.timeMs / 60000);
      const flagsTxt = [];
      if (t.nearPass) flagsTxt.push('re-mark (near pass)');
      let reds = 0;
      body.append(el('tr', null,
        el('td', null, el('a', { href: '#', onclick: e => { e.preventDefault(); state.selectedId = s.id; switchTab('review'); }, text: s.name })),
        qs.map(q => {
          const a = s.answers[q.id];
          if (!a || !a.result) return el('td', { class: 'num', text: '–' });
          answers++;
          if (a.result.confidence !== 'green') flagged++;
          if (a.result.confidence === 'red') reds++;
          if (a.status !== 'pending') {
            reviewed++;
            if (Math.abs(effective(a) - a.originalSuggested) > 1e-9) {
              changed++;
              if ((a.reason || (a.textEdited ? 'text' : 'judgement')) === 'text') changedText++;
              if (a.result.confidence !== 'green') changedFlagged++;
            }
          }
          const diff = Math.abs(effective(a) - a.originalSuggested) > 1e-9;
          return el('td', { class: 'num', title: 'Tool suggested ' + fmtMark(a.originalSuggested) + ' · ' + a.result.confidence },
            el('span', { style: 'color:var(--' + a.result.confidence + ')', text: '● ' }), fmtMark(effective(a)),
            diff ? el('span', { class: 'small muted', text: ' (' + fmtMark(a.originalSuggested) + ')' }) : null);
        }),
        el('td', { class: 'num', text: fmtMark(t.final) + ' / ' + fmtMark(t.max) }),
        el('td', { class: 'num', text: pct(t.final / t.max, 0) }),
        el('td', null, el('span', { class: 'badge ' + (t.pass ? 'green' : 'red'), text: t.pass ? 'Pass' : 'Fail' })),
        el('td', { class: 'small', text: flagsTxt.concat(reds ? [reds + ' red'] : []).join(', ') || '–' }),
        el('td', null, statusBadge(s)),
        el('td', { class: 'num', text: s.timeMs ? mmss(s.timeMs) : '–' })));
    });
    if (!done.length) body.append(el('tr', null, el('td', { colspan: qs.length + 7, class: 'muted', text: 'No processed scripts yet.' })));
    table.append(body);
    const conf = done.filter(s => s.status === 'confirmed').length;
    const chip = (label, val, cls) => el('span', { class: 'badge ' + (cls || 'grey') }, label + ': ', el('strong', { text: val }));
    const sum = $('summary');
    sum.innerHTML = '';
    sum.append(
      chip('Scripts', done.length + ' (' + conf + ' confirmed)', 'blue'),
      chip('Mean total', done.length ? pct(S.mean(pcts), 1) : '–'),
      chip('Pass rate', done.length ? pct(passes / done.length, 0) : '–'),
      chip('Marks changed by examiner', reviewed ? changed + ' of ' + reviewed + ' (' + pct(changed / reviewed) + ')' : '–', 'amber'),
      chip('…after OCR text correction', changed ? pct(changedText / changed) : '–'),
      chip('…on amber/red questions', changed ? pct(changedFlagged / changed) : '–'),
      chip('Amber/red questions', answers ? pct(flagged / answers) : '–'),
      chip('Median marking time', times.length ? S.median(times).toFixed(1) + ' min' : '–'));
  }

  function longCsv() {
    const rows = [['script', 'question', 'max', 'ocr_engines', 'ocr_recognisable_words', 'cosine', 'keyword_coverage', 'matched_keywords', 'missing_keywords',
      'tool_suggested', 'suggested_after_text_edits', 'final', 'review_status', 'overridden', 'override_reason', 'text_edited', 'confidence', 'off_topic', 'recognised_text']];
    reviewable().forEach(s => {
      const engines = Array.from(new Set(s.pages.map(p => p.ocr && p.ocr.engine).filter(Boolean))).join('+');
      rubric.questions.forEach(q => {
        const a = s.answers[q.id];
        if (!a || !a.result) return;
        const r = a.result;
        const over = a.status !== 'pending' && Math.abs(effective(a) - a.originalSuggested) > 1e-9;
        rows.push([s.name, q.label, q.max, engines, a.text.trim() ? fmt(G.dictionaryRatio(a.text, vocab, subsMap), 3) : '', fmt(r.cosine, 3), r.coverage === null ? '' : fmt(r.coverage, 3),
          r.matched.map(m => m.keyword).join('; '), r.missed.map(m => m.keywords[0]).join('; '),
          a.originalSuggested, r.suggested, effective(a), a.status, over ? 1 : 0, over ? (a.reason || (a.textEdited ? 'text' : 'judgement')) : '',
          a.textEdited ? 1 : 0, r.confidence, r.offTopic ? 1 : 0, a.text]);
      });
    });
    return E.toCsv(rows);
  }

  function wideCsv() {
    const qs = rubric.questions;
    const rows = [['script'].concat(qs.map(q => q.label), ['total', 'max_total', 'percent', 'decision', 'remark_near_pass', 'status', 'marking_minutes'])];
    reviewable().forEach(s => {
      const t = scriptTotals(s);
      rows.push([s.name].concat(qs.map(q => s.answers[q.id] ? effective(s.answers[q.id]) : ''),
        [t.final, t.max, fmt(100 * t.final / t.max, 1), t.pass ? 'pass' : 'fail', t.nearPass ? 1 : 0, s.status, s.timeMs ? fmt(s.timeMs / 60000, 2) : '']));
    });
    return E.toCsv(rows);
  }

  function blobToDataUrl(b) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  }

  async function exportSession() {
    timerPause();
    const out = { app: 'hwgrader', version: 1, exported: new Date().toISOString(), state: state };
    if ($('includeImages').checked) {
      out.images = {};
      for (const s of state.scripts) for (const p of s.pages) {
        const b = await ST.getBlob(p.id);
        if (b) out.images[p.id] = await blobToDataUrl(b);
      }
    }
    download('grading-session-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(out), 'application/json');
    timerResume();
  }

  async function importSession(file) {
    try {
      const j = JSON.parse(await file.text());
      if (j.app !== 'hwgrader' || !j.state) throw new Error('not a grading session file');
      if (state.scripts.length && !confirm('Replace the current session (' + state.scripts.length + ' scripts) with the loaded one?')) return;
      timerPause();
      if (j.images) for (const id in j.images) { const b = await (await fetch(j.images[id])).blob(); await ST.putBlob(id, b); }
      state = j.state;
      state.settings = Object.assign(clone(DEFAULT_SETTINGS), state.settings || {});
      state.settings.pp = Object.assign({}, P.DEFAULTS, state.settings.pp || {});
      state.cerPairs = state.cerPairs || [];
      urlCache.forEach(u => URL.revokeObjectURL(u));
      urlCache.clear();
      $('rubricText').value = state.rubricText;
      applyRubric();
      loadSettingsUI();
      save();
      renderAll();
      toast('Session loaded' + (j.images ? ' with page images.' : '. Page images were not included; marks and text are available.'));
    } catch (e) {
      toast('Could not load session: ' + e.message, 6000);
    }
  }

  // ------------------------------------------------------------ evaluation tab

  function evalFromSession(finalAsRef) {
    const rows = [['script', 'question', 'max', 'tool', 'reference', 'examiner1', 'examiner2']];
    const existing = E.readMarks($('evalCsv').value);
    const prior = new Map();
    existing.rows.forEach(r => prior.set(r.script + '|' + r.question, r));
    let n = 0;
    reviewable().forEach(s => {
      if (finalAsRef && s.status !== 'confirmed') return;
      rubric.questions.forEach(q => {
        const a = s.answers[q.id];
        if (!a || !a.result) return;
        const p = prior.get(s.name + '|' + q.label);
        rows.push([s.name, q.label, q.max, a.originalSuggested,
          finalAsRef ? effective(a) : (p && p.reference !== null && !p.adjudicated && p.e1 === null ? p.reference : ''),
          p && p.e1 !== null ? p.e1 : '', p && p.e2 !== null ? p.e2 : '']);
        n++;
      });
    });
    if (!n) { toast(finalAsRef ? 'Confirm some scripts first.' : 'No processed scripts in this session.'); return; }
    $('evalCsv').value = E.toCsv(rows);
    state.evalCsv = $('evalCsv').value;
    save();
    toast(finalAsRef ? 'Filled ' + n + ' responses: tool = unedited suggestion, reference = examiner-confirmed mark.' : 'Filled ' + n + ' tool marks. Add the examiners\' marks in the reference (or examiner1/examiner2) column.');
  }

  function baPlot(points, loa, bias) {
    const W = 520, H = 260, m = { l: 44, r: 12, t: 12, b: 34 };
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]).concat(loa, [0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) || 1;
    const yAbs = Math.max(0.5, ...ys.map(Math.abs)) * 1.15;
    const sx = x => m.l + (x - x0) / ((x1 - x0) || 1) * (W - m.l - m.r);
    const sy = y => m.t + (yAbs - y) / (2 * yAbs) * (H - m.t - m.b);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'plot');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Bland–Altman plot of tool minus reference against their mean');
    svg.style.width = '100%';
    svg.style.maxWidth = W + 'px';
    const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text !== undefined) n.textContent = text; svg.append(n); return n; };
    add('line', { x1: m.l, x2: W - m.r, y1: sy(0), y2: sy(0), class: 'axis' });
    add('line', { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, class: 'axis' });
    add('line', { x1: m.l, x2: W - m.r, y1: sy(bias), y2: sy(bias), class: 'bias' });
    loa.forEach(v => add('line', { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v), class: 'loa' }));
    add('text', { x: W - m.r, y: sy(bias) - 4, 'text-anchor': 'end' }, 'bias ' + fmt(bias));
    add('text', { x: W - m.r, y: sy(loa[1]) - 4, 'text-anchor': 'end' }, '+1.96 SD ' + fmt(loa[1]));
    add('text', { x: W - m.r, y: sy(loa[0]) + 13, 'text-anchor': 'end' }, '−1.96 SD ' + fmt(loa[0]));
    const jitter = {};
    points.forEach(p => {
      const k = p[0] + '|' + p[1];
      jitter[k] = (jitter[k] || 0) + 1;
      add('circle', { cx: sx(p[0]) + (jitter[k] - 1) * 3, cy: sy(p[1]), r: 3.5, class: 'pt' });
    });
    [-yAbs / 1.15, 0, yAbs / 1.15].forEach(v => add('text', { x: m.l - 6, y: sy(v) + 4, 'text-anchor': 'end' }, fmt(v, 1)));
    [x0, (x0 + x1) / 2, x1].forEach(v => add('text', { x: sx(v), y: H - m.b + 16, 'text-anchor': 'middle' }, fmt(v, 1)));
    add('text', { x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle' }, 'Mean of tool and reference (marks)');
    return svg;
  }

  function cmTable(cm, title) {
    return el('div', null, el('h3', { text: title }),
      el('table', { class: 'cm' },
        el('tr', null, el('th', { text: '' }), el('th', { text: 'Reference: Pass' }), el('th', { text: 'Reference: Fail' }), el('th', { text: 'Total' })),
        el('tr', null, el('th', { text: 'Tool: Pass' }), el('td', { class: 'ok', text: 'True pass ' + cm.tp }), el('td', { class: 'bad', text: 'False pass ' + cm.fp }), el('td', { text: cm.tp + cm.fp })),
        el('tr', null, el('th', { text: 'Tool: Fail' }), el('td', { class: 'bad', text: 'False fail ' + cm.fn }), el('td', { class: 'ok', text: 'True fail ' + cm.tn }), el('td', { text: cm.fn + cm.tn })),
        el('tr', null, el('th', { text: 'Total' }), el('td', { text: cm.tp + cm.fn }), el('td', { text: cm.fp + cm.tn }), el('td', { text: cm.n }))));
  }

  function runEvaluation() {
    const out = $('evalOut');
    out.innerHTML = '';
    state.evalCsv = $('evalCsv').value;
    save();
    const data = E.readMarks($('evalCsv').value);
    if (data.errors.length) out.append(el('div', { class: 'notice ' + (data.rows.length ? 'warn' : 'err') }, el('ul', null, data.errors.slice(0, 8).map(e => el('li', { text: e })), data.errors.length > 8 ? el('li', { text: '… ' + (data.errors.length - 8) + ' more' }) : null)));
    if (data.rows.length < 3) { out.append(el('p', { class: 'muted', text: 'At least 3 complete rows are needed.' })); return; }
    const B = Math.max(0, Math.min(10000, parseInt($('evalB').value, 10) || 0));
    const passPct = parseFloat($('evalPass').value) || 50;
    out.append(el('p', { class: 'muted small', text: 'Computing…' }));
    setTimeout(() => {
      const R = E.evaluate(data.rows, data.hasBaseline, { passPct: passPct, B: B });
      out.innerHTML = '';
      if (data.errors.length) out.append(el('div', { class: 'notice warn', text: data.errors.length + ' row(s) skipped.' }));
      const t = R.tool, h = R.human;
      out.append(el('p', { class: 'small muted', text: t.n + ' responses from ' + t.scripts + ' scripts. Confidence intervals: cluster bootstrap over scripts (' + B + ' resamples); proportions: exact Clopper–Pearson. Marks treated as ordinal in steps of ' + t.step + ' for QWK.' }));

      out.append(el('h3', { text: 'Pre-specified acceptance criteria' }),
        el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
          el('tr', null, el('th', { text: 'Criterion' }), el('th', { text: 'Observed' }), el('th', { text: 'Met?' })),
          R.criteria.map(c => el('tr', null, el('td', { text: c.name }), el('td', { text: c.value }), el('td', { class: c.met ? 'crit-yes' : 'crit-no', text: c.met ? 'Yes' : 'No' }))))));

      const row = (label, tv, hv) => el('tr', null, el('td', { text: label }), el('td', { class: 'num', text: tv }), h ? el('td', { class: 'num', text: hv }) : null);
      out.append(el('h3', { text: 'Agreement with the reference standard', style: 'margin-top:16px' }),
        el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
          el('tr', null, el('th', { text: 'Metric' }), el('th', { class: 'num', text: 'Tool vs reference' }), h ? el('th', { class: 'num', text: 'Examiner 1 vs Examiner 2' }) : null),
          row('MAE, marks (95% CI)', fmt(t.mae) + ' ' + ci(t.maeCI), h && fmt(h.mae) + ' ' + ci(h.maeCI)),
          row('MAE, % of max. mark', fmt(t.maePct, 1), h && fmt(h.maePct, 1)),
          row('RMSE, marks', fmt(t.rmse), h && fmt(h.rmse)),
          row('Mean difference (bias), marks', fmt(t.bias), h && fmt(h.bias)),
          row('Standardised mean difference', fmt(t.smd), h && fmt(h.smd)),
          row('Bland–Altman 95% limits, marks', fmt(t.loa[0]) + ' to ' + fmt(t.loa[1]), h && fmt(h.loa[0]) + ' to ' + fmt(h.loa[1])),
          row('QWK (95% CI)', fmt(t.qwk) + ' ' + ci(t.qwkCI), h && fmt(h.qwk) + ' ' + ci(h.qwkCI)),
          row('ICC(2,1) absolute agreement (95% CI)', fmt(t.icc) + ' ' + ci(t.iccCI), h && fmt(h.icc) + ' ' + ci(h.iccCI)),
          row("Spearman's ρ, script totals (95% CI)", fmt(t.rho) + ' ' + ci(t.rhoCI), h && fmt(h.rho) + ' ' + ci(h.rhoCI)))),
        el('h3', { text: 'Bland–Altman plot (tool − reference)', style: 'margin-top:16px' }), baPlot(t.points, t.loa, t.bias));

      const d = R.decisions;
      out.append(el('div', { class: 'grid2', style: 'margin-top:16px' },
        cmTable(d.script.cm, 'Pass/fail — script level (pass mark ' + passPct + '%)'),
        cmTable(d.response.cm, 'Pass/fail — response level (' + passPct + '% of each question)')));
      const ixRow = (name, formula, a, b) => el('tr', null, el('td', { text: name }), el('td', { class: 'mono small', text: formula }), el('td', { class: 'num', text: a }), el('td', { class: 'num', text: b }));
      const pv = x => fmt(x.value) + ' ' + ci(x.ci);
      const si = d.script.ix, ri = d.response.ix;
      out.append(el('h3', { text: 'Classification indices', style: 'margin-top:16px' }),
        el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
          el('tr', null, el('th', { text: 'Index' }), el('th', { text: 'Formula' }), el('th', { class: 'num', text: 'Script level (95% CI)' }), el('th', { class: 'num', text: 'Response level (95% CI)' })),
          ixRow('Accuracy', '(TP+TN)/N', pv(si.accuracy), pv(ri.accuracy)),
          ixRow('Sensitivity (pass recall)', 'TP/(TP+FN)', pv(si.sensitivity), pv(ri.sensitivity)),
          ixRow('Specificity (fail recall)', 'TN/(TN+FP)', pv(si.specificity), pv(ri.specificity)),
          ixRow('Positive predictive value', 'TP/(TP+FP)', pv(si.ppv), pv(ri.ppv)),
          ixRow('Negative predictive value', 'TN/(TN+FN)', pv(si.npv), pv(ri.npv)),
          ixRow('F1 score', '2TP/(2TP+FP+FN)', fmt(si.f1), fmt(ri.f1)),
          ixRow("Cohen's κ", '(po−pe)/(1−pe)', pv(si.kappa), pv(ri.kappa)),
          ixRow("McNemar's test (continuity-corrected)", '(|FP−FN|−1)²/(FP+FN)', 'χ² = ' + fmt(si.mcnemar.chi2) + ', p = ' + fmt(si.mcnemar.p, 3), 'χ² = ' + fmt(ri.mcnemar.chi2) + ', p = ' + fmt(ri.mcnemar.p, 3)))));

      out.append(el('h3', { text: 'Distribution of absolute errors per response', style: 'margin-top:16px' }),
        el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
          el('tr', null, el('th', { text: 'Absolute error (marks)' }), el('th', { class: 'num', text: 'Responses, n' }), el('th', { class: 'num', text: '% of responses' }), el('th', { class: 'num', text: 'Cumulative %' })),
          t.bands.map(b => el('tr', null, el('td', { text: b.label }), el('td', { class: 'num', text: b.n }), el('td', { class: 'num', text: fmt(b.pct, 1) }), el('td', { class: 'num', text: fmt(b.cumPct, 1) }))),
          el('tr', null, el('td', { text: 'Total' }), el('td', { class: 'num', text: t.n }), el('td', { class: 'num', text: '100' }), el('td', { text: '' })))));

      const near = t.totals.filter(x => Math.abs(x.b - passPct / 100 * x.max) <= state.settings.bandPct / 100 * x.max + 1e-9);
      const mis = t.totals.filter(x => (x.a >= passPct / 100 * x.max - 1e-9) !== (x.b >= passPct / 100 * x.max - 1e-9));
      if (mis.length) out.append(el('p', { class: 'small', text: 'Misclassified scripts: ' + mis.map(x => x.script + ' (tool ' + fmtMark(x.a) + ', reference ' + fmtMark(x.b) + ')').join('; ') + '. ' + mis.filter(x => near.includes(x)).length + ' of ' + mis.length + ' lie inside the re-mark band.' }));
      out.append(el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { class: 'btn small', onclick: () => download('agreement-report.json', JSON.stringify(R, (k, v) => (k === 'points' || k === 'abs') ? undefined : v, 2), 'application/json') }, 'Download results (.json)')));
    }, 20);
  }

  function renderCer() {
    const out = $('cerOut');
    out.innerHTML = '';
    const pairs = state.cerPairs;
    if (!pairs.length) { out.append(el('p', { class: 'small muted', text: 'No pairs yet.' })); return; }
    const groups = new Map();
    pairs.forEach(p => { const k = p.label || '(unlabelled)'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
    const pooled = list => {
      let ce = 0, cn = 0, we = 0, wn = 0;
      list.forEach(p => { const r = S.errorRates(p.ref, p.hyp); ce += r.cer * r.chars; cn += r.chars; we += r.wer * r.words; wn += r.words; });
      return { cer: cn ? ce / cn : NaN, wer: wn ? we / wn : NaN, words: wn };
    };
    const tbody = [];
    groups.forEach((list, label) => {
      const r = pooled(list);
      const clusters = list.map(p => [p]);
      const cerCI = list.length > 2 ? S.clusterBootstrap(clusters, rs => pooled(rs).cer, 1000, 3) : null;
      const werCI = list.length > 2 ? S.clusterBootstrap(clusters, rs => pooled(rs).wer, 1000, 4) : null;
      tbody.push(el('tr', null, el('td', { text: label }), el('td', { class: 'num', text: list.length }), el('td', { class: 'num', text: r.words }),
        el('td', { class: 'num', text: fmt(r.cer * 100, 1) + (cerCI ? ' (' + fmt(cerCI[0] * 100, 1) + '–' + fmt(cerCI[1] * 100, 1) + ')' : '') }),
        el('td', { class: 'num', text: fmt(r.wer * 100, 1) + (werCI ? ' (' + fmt(werCI[0] * 100, 1) + '–' + fmt(werCI[1] * 100, 1) + ')' : '') })));
    });
    out.append(el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
      el('tr', null, el('th', { text: 'OCR configuration' }), el('th', { class: 'num', text: 'Pairs' }), el('th', { class: 'num', text: 'Words' }), el('th', { class: 'num', text: 'CER % (95% CI)' }), el('th', { class: 'num', text: 'WER % (95% CI)' })),
      tbody)), el('p', { class: 'small muted', text: 'Rates are pooled (total edits ÷ total characters or words). Intervals use a bootstrap over pairs when there are at least 3.' }));
  }

  function refreshCerSource() {
    const sel = $('cerFromSession');
    sel.innerHTML = '';
    sel.append(el('option', { value: '', text: 'Fill OCR output from a session response…' }));
    reviewable().forEach(s => rubric.questions.forEach(q => { if (s.answers[q.id]) sel.append(el('option', { value: s.id + '|' + q.id, text: s.name + ' — ' + q.label })); }));
  }

  function runTimes() {
    const out = $('timeOut');
    out.innerHTML = '';
    state.timeCsv = $('timeCsv').value;
    save();
    const t = E.parseCsv($('timeCsv').value);
    if (t.length < 2) { out.append(el('p', { class: 'muted small', text: 'Paste a CSV with a header row.' })); return; }
    const head = t[0].map(x => x.trim().toLowerCase());
    const hi = head.indexOf('hand_minutes'), ti = head.indexOf('tool_minutes');
    if (hi < 0 || ti < 0) { out.append(el('div', { class: 'notice err', text: 'Columns hand_minutes and tool_minutes are required.' })); return; }
    const hand = [], tool = [];
    t.slice(1).forEach(r => { const a = parseFloat(r[hi]), b = parseFloat(r[ti]); if (isFinite(a) && isFinite(b)) { hand.push(a); tool.push(b); } });
    if (hand.length < 2) { out.append(el('p', { class: 'muted small', text: 'Need at least 2 scripts timed under both conditions.' })); return; }
    const w = S.wilcoxon(hand, tool);
    const iqr = a => fmt(S.quantile(a, 0.25), 1) + '–' + fmt(S.quantile(a, 0.75), 1);
    out.append(el('table', { class: 'data' },
      el('tr', null, el('th', { text: 'Condition' }), el('th', { class: 'num', text: 'Median min/script' }), el('th', { class: 'num', text: 'IQR' })),
      el('tr', null, el('td', { text: 'By hand' }), el('td', { class: 'num', text: fmt(S.median(hand), 1) }), el('td', { class: 'num', text: iqr(hand) })),
      el('tr', null, el('td', { text: 'With tool (incl. review)' }), el('td', { class: 'num', text: fmt(S.median(tool), 1) }), el('td', { class: 'num', text: iqr(tool) }))),
      el('p', { class: 'small', text: 'Wilcoxon signed-rank: n = ' + w.n + ', z = ' + fmt(w.z) + ', p ' + (w.p < 0.001 ? '< 0.001' : '= ' + fmt(w.p, 3)) + '. Median reduction ' + pct(1 - S.median(tool) / S.median(hand), 0) + '.' }));
  }

  function renderOverrides() {
    let reviewed = 0, changed = 0, txt = 0, flagged = 0;
    reviewable().forEach(s => rubric.questions.forEach(q => {
      const a = s.answers[q.id];
      if (!a || !a.result || a.status === 'pending') return;
      reviewed++;
      if (Math.abs(effective(a) - a.originalSuggested) > 1e-9) {
        changed++;
        if ((a.reason || (a.textEdited ? 'text' : 'judgement')) === 'text') txt++;
        if (a.result.confidence !== 'green') flagged++;
      }
    }));
    const out = $('overrideOut');
    out.innerHTML = '';
    out.append(el('h3', { text: 'Override rate (this session)' }),
      reviewed ? el('p', { class: 'small', text: 'Examiners changed ' + changed + ' of ' + reviewed + ' reviewed marks (' + pct(changed / reviewed) + '). ' +
        (changed ? pct(txt / changed) + ' followed correction of the recognised text and ' + pct(1 - txt / changed) + ' reflected a different judgement; ' + pct(flagged / changed) + ' of changes were on amber or red questions.' : '') })
        : el('p', { class: 'small muted', text: 'No reviewed marks yet.' }));
  }

  function renderEvaluation() {
    if (!$('evalCsv').value && state.evalCsv) $('evalCsv').value = state.evalCsv;
    if (!$('timeCsv').value && state.timeCsv) $('timeCsv').value = state.timeCsv;
    $('evalPass').value = state.settings.passPct;
    refreshCerSource();
    renderCer();
    renderOverrides();
  }

  // ------------------------------------------------------------ settings tab

  const bindings = [
    ['setW', 'w', 'num'], ['setTheta', 'theta', 'num'], ['setTau', 'tau', 'num'], ['setStep', 'step', 'num'],
    ['setStop', 'removeStopwords', 'bool'], ['setStem', 'stem', 'bool'], ['setPass', 'passPct', 'num'], ['setBand', 'bandPct', 'num'],
    ['setSeg', 'segMode', 'str'], ['setSubs', 'subs', 'str'], ['setEngine', 'engine', 'str'], ['setOcrEngine', 'ocrSpaceEngine', 'str']
  ];
  const ppBindings = [['ppEnabled', 'enabled', 'bool'], ['ppMedian', 'median', 'num'], ['ppContrast', 'contrast', 'num'], ['ppSharpen', 'sharpen', 'num'], ['ppBinarize', 'binarize', 'str'], ['ppClosing', 'closing', 'num']];

  function loadSettingsUI() {
    bindings.forEach(([id, k, t]) => { const n = $(id); if (t === 'bool') n.checked = !!state.settings[k]; else n.value = state.settings[k]; });
    ppBindings.forEach(([id, k, t]) => { const n = $(id); if (t === 'bool') n.checked = !!state.settings.pp[k]; else n.value = state.settings.pp[k]; });
    $('setKey').value = apiKey;
    $('setRemember').checked = ST.getPref('ocrspaceKey', null) !== null;
    $('ppContrastV').textContent = fmt(state.settings.pp.contrast);
    $('ppSharpenV').textContent = fmt(state.settings.pp.sharpen, 1);
  }

  let rescoreTimer = null;
  function bindSettings() {
    bindings.forEach(([id, k, t]) => {
      $(id).addEventListener(t === 'str' && id === 'setSubs' ? 'input' : 'change', e => {
        const n = e.target;
        let v = t === 'bool' ? n.checked : t === 'num' ? parseFloat(n.value) : n.value;
        if (t === 'num' && !isFinite(v)) { n.value = state.settings[k]; return; }
        state.settings[k] = v;
        if (k === 'engine') renderPrivacy();
        save();
        clearTimeout(rescoreTimer);
        rescoreTimer = setTimeout(() => { applyRubric(); save(); }, 300);
      });
    });
    ppBindings.forEach(([id, k, t]) => {
      $(id).addEventListener(t === 'num' && /Contrast|Sharpen/.test(id) ? 'input' : 'change', e => {
        const n = e.target;
        state.settings.pp[k] = t === 'bool' ? n.checked : t === 'num' ? parseFloat(n.value) : n.value;
        $('ppContrastV').textContent = fmt(state.settings.pp.contrast);
        $('ppSharpenV').textContent = fmt(state.settings.pp.sharpen, 1);
        renderPrivacy();
        save();
      });
    });
    $('setKey').addEventListener('change', e => {
      apiKey = e.target.value.trim();
      if ($('setRemember').checked) ST.setPref('ocrspaceKey', apiKey);
    });
    $('setRemember').addEventListener('change', e => ST.setPref('ocrspaceKey', e.target.checked ? apiKey : null));
    $('resetSettings').addEventListener('click', () => {
      if (!confirm('Restore all scoring, OCR and preprocessing settings to their defaults?')) return;
      state.settings = clone(DEFAULT_SETTINGS);
      loadSettingsUI();
      applyRubric();
      renderPrivacy();
      save();
    });
    $('warmTesseract').addEventListener('click', async () => {
      $('warmStatus').textContent = 'Loading…';
      try {
        await O.getTesseract();
        const st = O.engineStatus();
        $('warmStatus').textContent = 'Ready (' + (st.tesseractLocal ? 'bundled copy' : 'from CDN') + ').';
      } catch (e) { $('warmStatus').textContent = 'Failed: ' + e.message; }
    });
    $('ppPreviewBtn').addEventListener('click', async () => {
      const v = $('ppPreviewPage').value;
      if (!v) { toast('Choose a page first.'); return; }
      const [sid, pid] = v.split('|');
      const s = state.scripts.find(x => x.id === sid);
      const p = s && s.pages.find(x => x.id === pid);
      const b = p && await ST.getBlob(p.id);
      if (!b) return;
      const c = await O.blobToCanvas(b, p.rotation, 1600);
      const pc = P.processCanvas(c, state.settings.pp);
      const box = $('ppPreview');
      box.innerHTML = '';
      const a = el('img', { src: c.toDataURL('image/jpeg', 0.85), alt: 'Original', style: 'width:100%;background:#fff' });
      const bimg = el('img', { src: pc.toDataURL('image/jpeg', 0.85), alt: 'Processed', style: 'width:100%;background:#fff' });
      box.append(el('div', null, el('div', { class: 'small muted', text: 'Original' }), a), el('div', null, el('div', { class: 'small muted', text: 'Processed' }), bimg));
    });
  }

  function refreshPreviewPages() {
    const sel = $('ppPreviewPage');
    const cur = sel.value;
    sel.innerHTML = '';
    sel.append(el('option', { value: '', text: 'Preview on page…' }));
    state.scripts.forEach(s => s.pages.forEach((p, i) => sel.append(el('option', { value: s.id + '|' + p.id, text: s.name + ' — page ' + (i + 1), selected: cur === s.id + '|' + p.id }))));
  }

  // ------------------------------------------------------------ tabs & wiring

  function switchTab(name) {
    if (currentTab === 'review' && name !== 'review') timerPause();
    currentTab = name;
    document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('section.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
    if (name === 'rubric') renderRubric();
    if (name === 'scripts') renderScripts();
    if (name === 'review') renderReview();
    if (name === 'results') renderResults();
    if (name === 'evaluation') renderEvaluation();
    if (name === 'settings') refreshPreviewPages();
    try { sessionStorage.setItem('hwgrader.tab', name); } catch (e) { /* ignore */ }
  }

  function renderAll() {
    renderPrivacy();
    updateCounts();
    switchTab(currentTab);
  }

  function wire() {
    document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

    // rubric
    const rt = $('rubricText');
    rt.value = state.rubricText;
    let rtTimer = null;
    rt.addEventListener('input', () => {
      clearTimeout(rtTimer);
      rtTimer = setTimeout(() => { state.rubricText = rt.value; applyRubric(); renderRubric(); save(); }, 300);
    });
    $('rubricSample').addEventListener('click', () => {
      if (rt.value.trim() && rt.value !== SAMPLE_RUBRIC && !confirm('Replace the current rubric with the sample?')) return;
      rt.value = state.rubricText = SAMPLE_RUBRIC;
      applyRubric(); renderRubric(); save();
    });
    $('rubricImport').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      rt.value = state.rubricText = await f.text();
      e.target.value = '';
      applyRubric(); renderRubric(); save();
    });
    $('rubricExport').addEventListener('click', () => download('rubric.txt', rt.value));

    // uploads
    $('fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
    const dz = $('dropzone');
    ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => addFiles(e.dataTransfer.files));
    $('demoBtn').addEventListener('click', addDemoScript);
    $('cameraInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; newCameraScript(f); });
    if (O.LOW_MEMORY) document.documentElement.classList.add('touch');
    $('processAllBtn').addEventListener('click', () => {
      const todo = state.scripts.filter(s => s.status === 'new' || s.status === 'processing');
      if (!todo.length) { toast('Nothing pending. Use "Re-run OCR" on a script to process it again.'); return; }
      processScripts(todo, false);
    });
    $('stopBtn').addEventListener('click', () => { stopRequested = true; $('stopBtn').disabled = true; setProgress(0, 'Stopping after the current page…'); });

    // review
    $('scriptSelect').addEventListener('change', e => { timerPause(); state.selectedId = e.target.value; viewer.pageIdx = 0; save(); renderReview(); });
    $('prevScript').addEventListener('click', () => moveScript(-1));
    $('nextScript').addEventListener('click', () => moveScript(1));
    $('showProcessed').addEventListener('change', () => { const s = selected(); if (s) renderViewer(s); });
    $('zoomIn').addEventListener('click', () => { viewer.zoom = Math.min(4, viewer.zoom * 1.25); $('stageImg').style.width = viewer.zoom * 100 + '%'; });
    $('zoomOut').addEventListener('click', () => { viewer.zoom = Math.max(0.5, viewer.zoom / 1.25); $('stageImg').style.width = viewer.zoom * 100 + '%'; });
    $('unassignedText').addEventListener('input', e => { const s = selected(); if (s) { s.unassigned = e.target.value; save(); } });
    $('resegmentBtn').addEventListener('click', () => {
      const s = selected();
      if (!s || !confirm('Rebuild every answer from the page OCR text? Text edits and marks for this script will be lost.')) return;
      compileScript(s); save(); renderReview();
    });
    $('acceptAllBtn').addEventListener('click', () => {
      const s = selected();
      if (!s) return;
      let n = 0;
      rubric.questions.forEach(q => { const a = s.answers[q.id]; if (a && a.status === 'pending' && a.result.confidence === 'green') { a.final = a.result.suggested; a.status = 'accepted'; n++; } });
      save(); renderReview();
      toast(n ? 'Accepted ' + n + ' green suggestion(s).' : 'No pending green questions.');
    });
    $('confirmBtn').addEventListener('click', () => {
      const s = selected();
      if (!s) return;
      if (s.status === 'confirmed') { s.status = 'review'; s.confirmedAt = null; save(); renderReview(); return; }
      const pending = rubric.questions.filter(q => s.answers[q.id] && s.answers[q.id].status === 'pending');
      if (pending.length && !confirm(pending.length + ' question(s) have not been reviewed (' + pending.map(q => q.label).join(', ') + '). Accept their suggested marks and confirm?')) return;
      if (scriptTotals(s).nearPass && !confirm('This script is near the pass mark and should be re-marked in full. Confirm anyway?')) return;
      pending.forEach(q => { const a = s.answers[q.id]; a.final = a.result.suggested; a.status = 'accepted'; });
      rubric.questions.forEach(q => {
        const a = s.answers[q.id];
        if (a && !a.reason && Math.abs(effective(a) - a.originalSuggested) > 1e-9) a.reason = a.textEdited ? 'text' : 'judgement';
      });
      timerPause();
      s.status = 'confirmed';
      s.confirmedAt = Date.now();
      save();
      const next = reviewable().find(x => x.status === 'review');
      if (next) { state.selectedId = next.id; viewer.pageIdx = 0; toast('Confirmed. Next: ' + next.name); }
      else toast('Script confirmed. All processed scripts are confirmed.');
      renderReview();
      window.scrollTo(0, 0);
    });
    document.addEventListener('keydown', e => {
      if (currentTab !== 'review' || !e.altKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); moveScript(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); moveScript(1); }
    });

    // results
    $('exportCsvLong').addEventListener('click', () => download('marks-per-question.csv', longCsv(), 'text/csv'));
    $('exportCsvWide').addEventListener('click', () => download('marks-per-script.csv', wideCsv(), 'text/csv'));
    $('exportJson').addEventListener('click', exportSession);
    $('importJson').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importSession(f); });
    $('clearAll').addEventListener('click', async () => {
      if (!confirm('Delete all scripts, page images and marks from this browser? Export first if you need them.')) return;
      timerPause();
      await ST.clearBlobs();
      urlCache.forEach(u => URL.revokeObjectURL(u));
      urlCache.clear();
      state.scripts = [];
      state.selectedId = null;
      save();
      renderAll();
      toast('Cleared.');
    });

    // evaluation
    $('evalFromSession').addEventListener('click', () => evalFromSession(false));
    $('evalFinalAsRef').addEventListener('click', () => evalFromSession(true));
    $('evalImport').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) { $('evalCsv').value = await f.text(); state.evalCsv = $('evalCsv').value; save(); } });
    $('evalTemplate').addEventListener('click', () => download('agreement-template.csv', 'script,question,max,tool,reference,examiner1,examiner2,examiner3\nS01,Q1,5,3.5,,4,3.5,\n', 'text/csv'));
    $('evalRun').addEventListener('click', runEvaluation);
    $('cerFromSession').addEventListener('change', e => {
      const [sid, qid] = e.target.value.split('|');
      const s = state.scripts.find(x => x.id === sid);
      if (s && s.answers[qid]) $('cerHyp').value = s.answers[qid].ocrText;
    });
    $('cerAdd').addEventListener('click', () => {
      const ref = $('cerRef').value.trim(), hyp = $('cerHyp').value.trim();
      if (!ref) { toast('Enter the ground-truth transcription.'); return; }
      state.cerPairs.push({ ref: ref, hyp: hyp, label: $('cerLabel').value.trim() });
      $('cerRef').value = ''; $('cerHyp').value = '';
      save(); renderCer();
    });
    $('cerClear').addEventListener('click', () => { if (confirm('Remove all OCR accuracy pairs?')) { state.cerPairs = []; save(); renderCer(); } });
    $('timeFromSession').addEventListener('click', () => {
      timerPause();
      const prior = new Map();
      const t = E.parseCsv($('timeCsv').value);
      if (t.length > 1) {
        const head = t[0].map(x => x.trim().toLowerCase());
        const hi = head.indexOf('hand_minutes');
        t.slice(1).forEach(r => prior.set(r[0], hi >= 0 ? r[hi] : ''));
      }
      const rows = [['script', 'hand_minutes', 'tool_minutes']];
      state.scripts.filter(s => s.status === 'confirmed').forEach(s => rows.push([s.name, prior.get(s.name) || '', fmt(s.timeMs / 60000, 2)]));
      if (rows.length === 1) { toast('Confirm some scripts first; marking time is recorded while you review.'); return; }
      $('timeCsv').value = E.toCsv(rows);
      state.timeCsv = $('timeCsv').value;
      save();
      timerResume();
    });
    $('timeRun').addEventListener('click', runTimes);

    // misc
    $('modalClose').addEventListener('click', () => $('modal').classList.add('hidden'));
    $('modal').addEventListener('click', e => { if (e.target.id === 'modal') $('modal').classList.add('hidden'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') $('modal').classList.add('hidden'); });
    $('themeBtn').addEventListener('click', () => {
      const root = document.documentElement;
      const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      ST.setPref('theme', root.dataset.theme);
    });
    const th = ST.getPref('theme', null);
    if (th) document.documentElement.dataset.theme = th;
    window.addEventListener('online', renderPrivacy);
    window.addEventListener('offline', renderPrivacy);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') timerResume(); else timerPause(); });
    window.addEventListener('beforeunload', () => { timerPause(); ST.saveState(state); });
    setInterval(timerDisplay, 1000);

    bindSettings();
    loadSettingsUI();
  }

  // ------------------------------------------------------------ start

  wire();
  // Scripts that were mid-OCR when the page closed go back to "not processed".
  state.scripts.forEach(s => { if (s.status === 'processing') s.status = 'new'; });
  applyRubric();
  let startTab = 'rubric';
  try { startTab = sessionStorage.getItem('hwgrader.tab') || (state.scripts.length ? 'scripts' : 'rubric'); } catch (e) { /* ignore */ }
  currentTab = startTab;
  renderAll();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered:', err));
  }
  if (location.protocol === 'file:') {
    toast('Opened from disk: OCR may be blocked. Serve this folder over HTTP (see Help).', 8000);
  }

  // Exposed for automated tests and debugging.
  window.__grader = { get state() { return state; }, get rubric() { return rubric; }, processScripts: processScripts, switchTab: switchTab };
})();
