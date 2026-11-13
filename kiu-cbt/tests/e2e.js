// End to end on the local Cloudflare runtime: first sign-in, a student's whole exam in Chromium (simulated camera
// and microphone: photo, recording, Section B page), then the staff side.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const B = process.argv[2], R2 = process.argv[3], OUT = process.argv[4], PW = 'Kiu2026exam9x', SITE = path.resolve(__dirname, '..');
const api = async (a, b) => (await fetch(B + '/api', { method: 'POST', body: JSON.stringify(Object.assign({ action: a }, b || {})) })).json();
const res = []; const check = (n, ok, d) => { res.push(!!ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (d ? '  — ' + String(d).slice(0, 220) : '')); };
const count = d => { let n = 0; const w = p => { if (!fs.existsSync(p)) return; for (const f of fs.readdirSync(p)) { const q = path.join(p, f); fs.statSync(q).isDirectory() ? w(q) : n++; } }; w(d); return n; };
(async () => {
  await fetch(B + '/api?setup=1');
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['camera', 'microphone', 'geolocation'], geolocation: { latitude: 0.3476, longitude: 32.5825, accuracy: 20 }, timezoneId: 'Africa/Kampala' });
  const errors = [];
  // 1. superadmin's first sign-in on the page: must choose a password
  const ap = await ctx.newPage(); ap.on('pageerror', e => errors.push('admin: ' + e.message)); ap.on('dialog', d => d.accept());
  await ap.goto(B + '/admin.html'); await ap.fill('#lu', 'super'); await ap.fill('#lp', 'changeme'); await ap.click('#lb');
  await ap.waitForSelector('#t-account:not(.hidden)'); await ap.fill('#pw-cur', 'changeme'); await ap.fill('#pw-new', PW); await ap.fill('#pw-new2', PW); await ap.click('#pw-save');
  await ap.waitForSelector('#login:not(.hidden)', { timeout: 10000 }); await ap.fill('#lu', 'super'); await ap.fill('#lp', PW); await ap.click('#lb'); await ap.waitForSelector('#app:not(.hidden)');
  check('E1 superadmin signs in, is made to choose a password, and gets in', await ap.isVisible('.tab[data-tab="monitor"]'), '');
  const t = (await api('adminLogin', { username: 'super', password: PW })).token;
  await api('saveSettings', { token: t, settings: { duration_minutes: '30', require_photo: '1', require_camera: '1', record_video: '1', record_audio: '1', record_segment_seconds: '30', snapshot_seconds: '15', require_location: '1',
    theory_enabled: '1', theory_upload_enabled: '1', theory_duration_minutes: '20', shuffle_questions: '0', shuffle_options: '0', paper_size: '', mark_per_question: '' } });
  await api('uploadTheory', { token: t, rows: [{ theory_id: 'T1', number: 1, prompt: 'Explain recursion.', max_marks: 10 }] });
  await api('importKiu', { token: t, units: [{ code: 'CSC2201', programme: 'BSc CS', description: 'CSC2201 - Data Structures' }], lecturers: [{ email: 'lec@kiu.ac.ug', name: 'Dr Lec', programme: 'BSc CS', code: 'CSC2201', password: 'password123' }],
    students: [{ admission: 'S1', name: 'Namubiru Sarah', password: 'pw' }], enrolments: [{ admission: 'S1', code: 'CSC2201', programme: 'BSc CS' }] });
  let l = await api('adminLogin', { username: 'lec@kiu.ac.ug', password: 'password123' }); await api('changePassword', { token: l.token, current: 'password123', next: PW }); l = (await api('adminLogin', { username: 'lec@kiu.ac.ug', password: PW })).token;
  const up = await api('uploadQuestions', { token: l, rows: [['Stack order?', 'LIFO', 'FIFO', 'Random', 'Sorted'], ['Queue order?', 'FIFO', 'LIFO', 'Random', 'None'], ['Binary search needs?', 'Sorted data', 'A stack', 'A queue', 'Nothing']].map((q, i) => ({ question_id: 'D' + (i + 1), question_text: q[0], option_a: q[1], option_b: q[2], option_c: q[3], option_d: q[4], correct_answer: 'A', marks: 1, course: 'CSC2201' })) });
  check('E2 the lecturer uploads 3 questions (correct answers spread over A–D)', up.processed === 3, JSON.stringify(up.placed));
  const key = {}; (await api('listQuestions', { token: t })).rows.forEach(q => { key[q.question_id] = q.correct_answer; });
  const r2before = count(R2);
  // 2. the student
  const c = await ctx.newPage(); global.C = c; c.on('pageerror', e => errors.push('student: ' + e.message)); c.on('dialog', d => d.accept());
  await c.goto(B + '/index.html?u=S1'); await c.waitForSelector('#p'); await c.fill('#p', 'pw'); await c.click('#b-password'); console.log('step', "'#b-password');");
  await c.waitForSelector('#ch-list [data-sit]'); await c.click('#ch-list [data-sit*="CSC2201"]'); console.log('step', '\'#ch-list [data-sit*="CSC2');
  await c.waitForSelector('#s-instructions:not(.hidden)'); await c.click('#agree'); await c.click('#b-instructions'); console.log('step', "'#b-instructions');");
  await c.waitForSelector('#s-photo:not(.hidden), #s-confirm:not(.hidden)', { timeout: 15000 });
  if (await c.isVisible('#s-photo')) {
    await c.waitForTimeout(1500); if (await c.isVisible('#b-cam-on')) await c.click('#b-cam-on'); await c.waitForSelector('#b-snap:not([disabled]):not(.hidden)', { timeout: 20000 }); await c.click('#b-snap'); console.log('step', "'#b-snap');");
    await c.waitForSelector('#b-usephoto:not(.hidden)', { timeout: 10000 }); await c.click('#b-usephoto'); console.log('step', "'#b-usephoto');");
  }
  await c.waitForSelector('#s-confirm:not(.hidden)', { timeout: 20000 }); await c.click('#b-confirm'); console.log('step', "'#b-confirm');");
  await c.waitForSelector('#b-start:not([disabled])', { timeout: 20000 }); await c.click('#b-start'); console.log('step', "'#b-start');"); await c.waitForSelector('#s-exam:not(.hidden)', { timeout: 30000 });
  check('E3 the student signs in, takes the identity photo with the camera, confirms and starts', await c.isVisible('#s-exam'), '');
  const n = await c.locator('#x-palette > *').count();
  for (let i = 0; i < n; i++) {
    await c.locator('#x-palette > *').nth(i).click(); await c.waitForTimeout(200);
    const txt = (await c.textContent('#x-text')) || ''; const want = i === 2 ? null : null;
    const opts = c.locator('#x-opts .opt'); const k = await opts.count();
    // answer D1 and D2 correctly, D3 wrongly
    const qid = ['D1', 'D2', 'D3'][['Stack', 'Queue', 'Binary'].findIndex(w => txt.indexOf(w) >= 0)];
    for (let j = 0; j < k; j++) { const letter = (await opts.nth(j).innerText()).trim().charAt(0); if ((qid === 'D3') ? letter !== key[qid] : letter === key[qid]) { await opts.nth(j).click(); break; } }
  }
  await c.waitForTimeout(35000);   // one 30-second recording part and live pictures
  await c.click('#x-submit'); await c.waitForSelector('#s-mcqdone:not(.hidden)', { timeout: 20000 });
  check('E4 Section A is submitted with 3 answers; the page offers Section B', n === 3 && await c.isVisible('#b-to-theory'), n + ' questions');
  await c.click('#b-to-theory'); await c.waitForSelector('#s-theory:not(.hidden)', { timeout: 20000 });
  await c.setInputFiles('#th-file', path.join(SITE, 'assets/mark.png')); await c.waitForSelector('#th-scans .scan', { timeout: 30000 });
  await c.click('#th-submit'); await c.waitForSelector('#s-done:not(.hidden)', { timeout: 30000 });
  await c.waitForFunction(() => /may now close/.test((document.getElementById('done-flush') || {}).textContent || ''), null, { timeout: 90000 }).catch(() => {});
  await c.screenshot({ path: OUT + '/e2e-finished.png' });
  check('E5 Section B page uploaded and submitted; every recording part delivered before "you may now close"', /may now close/.test(await c.textContent('#done-flush')), (await c.textContent('#done-flush')).trim().slice(0, 80));
  // 3. staff side
  const row = (await api('results', { token: t })).rows.find(x => x.exam_taker_id === 'S1-CSC2201') || {};
  check('E6 Results: marked on the server, 2 of 3 right', row.score === 2 && row.max_score === 3, JSON.stringify({ score: row.score, max: row.max_score }));
  const pv = await api('proctorView', { token: t, exam_taker_id: 'S1-CSC2201' });
  check('E7 the identity photo and the recording parts are stored (R2)', pv.ok && !!pv.candidate.photo_file_id && pv.recordings.length >= 1 && count(R2) > r2before, 'recordings ' + (pv.recordings || []).length + ', R2 objects ' + r2before + ' → ' + count(R2));
  const vid = (pv.recordings || []).find(r => /video|webm/i.test(JSON.stringify(r))); console.log('INFO recordings', JSON.stringify((pv.recordings || []).map(r => [r.phase, r.mime || r.kind, r.size]))); const media = vid && await api('proctorMedia', { token: t, file_id: vid.file_id });
  check('E8 staff can play a recording part (WebM comes back intact)', media && media.ok && Buffer.from(media.data, 'base64').slice(0, 4).toString('hex') === '1a45dfa3', media && media.mime);
  const mk = await api('marking', { token: t }), mr = (mk.rows || []).find(x => x.exam_taker_id === 'S1-CSC2201');
  const ts = await api('saveTheoryScore', { token: t, exam_taker_id: 'S1-CSC2201', scores: { T1: 7 } });
  const row2 = (await api('results', { token: t })).rows.find(x => x.exam_taker_id === 'S1-CSC2201') || {};
  check('E9 Theory marking: the page is listed, a mark of 7 is saved and added to the total (9)', mr && ts.ok && Number(row2.grand_total) === 9, JSON.stringify({ listed: !!mr, saved: ts.ok || ts.error, total: row2.grand_total }));
  const rv = await api('answerReview', { token: t, course: 'CSC2201' }), x = rv.students && rv.students[0];
  check('E10 Answer review shows this exam: D1, D2 right, D3 wrong', x && x.answers.D1 === key.D1 && x.answers.D2 === key.D2 && x.answers.D3 && x.answers.D3 !== key.D3, JSON.stringify(x && x.answers) + ' key ' + JSON.stringify(key));
  const again = await (async () => { const p = await ctx.newPage(); await p.goto(B + '/index.html?u=S1'); await p.waitForSelector('#p'); await p.fill('#p', 'pw'); await p.click('#b-password'); await p.waitForSelector('#ch-list [data-sit]'); return p.textContent('#ch-list'); })();
  check('E11 signing in again, the student sees the unit as Completed', /Completed/.test(again), again.replace(/\s+/g, ' ').slice(0, 120));
  check('E12 no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log('\n' + res.filter(Boolean).length + '/' + res.length + ' passed');
})().catch(async e => { console.log('ERROR', e.message.split('\n')[0]); try { await global.C.screenshot({ path: OUT + '/e2e-fail.png' }); console.log('STAGE', await global.C.evaluate(() => [...document.querySelectorAll('section.stage')].filter(x => !x.classList.contains('hidden')).map(x => x.id + ': ' + x.innerText.replace(/\s+/g, ' ').slice(0, 300)).join(' | '))); } catch (x) {} process.exit(1); });
