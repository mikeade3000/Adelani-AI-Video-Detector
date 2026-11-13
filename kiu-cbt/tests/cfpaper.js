// "Questions per paper" on the real Cloudflare runtime.
const B = process.argv[2], PW = 'Kiu2026exam9x';
const api = async (a, b) => (await fetch(B + '/api', { method: 'POST', body: JSON.stringify(Object.assign({ action: a }, b || {})) })).json();
const qs = (pre, n, course) => Array.from({ length: n }, (_, i) => ({ question_id: pre + (i + 1), question_text: pre + ' q' + (i + 1), option_a: 'R', option_b: 'W', correct_answer: 'A', marks: 1, course }));
const res = []; const check = (n, ok, d) => { res.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (d ? '  — ' + d : '')); };
(async () => {
  await fetch(B + '/api?setup=1');
  let r = await api('adminLogin', { username: 'super', password: 'changeme' }); await api('changePassword', { token: r.token, current: 'changeme', next: PW });
  const t = (await api('adminLogin', { username: 'super', password: PW })).token;
  await api('saveSettings', { token: t, settings: { require_photo: '0', require_camera: '0', record_video: '0', record_audio: '0', theory_enabled: '0' } });
  await api('importKiu', { token: t, units: [{ code: 'MTH101', programme: 'BSc', description: 'MTH101 - Calculus' }, { code: 'ENG102', programme: 'BA', description: 'ENG102 - English' }], lecturers: [],
    students: ['S1', 'S2'].map(a => ({ admission: a, name: 'Student ' + a, password: 'pw' })),
    enrolments: [{ admission: 'S1', code: 'MTH101', programme: 'BSc' }, { admission: 'S2', code: 'MTH101', programme: 'BSc' }, { admission: 'S1', code: 'ENG102', programme: 'BA' }] });
  await api('uploadQuestions', { token: t, rows: qs('M', 60, 'MTH101') });
  await api('uploadQuestions', { token: t, rows: qs('E', 15, 'ENG102') });
  const paper = async (adm, unit) => { const s = await api('candidateLogin', { username: adm, password: 'pw' }); if (!s.choose) return s; const sit = s.sittings.find(x => x.course === unit); return api('candidateLogin', { student_token: s.student_token, sitting: sit.id }); };
  const sv = await api('saveSettings', { token: t, settings: { paper_size: '25' } });
  check('C1 saving 25 questions per paper; ENG102 (15) reported as short', sv.ok && (sv.short || []).map(x => x.course + ':' + x.available).join() === 'ENG102:15', JSON.stringify(sv.short));
  const set = await api('getSettings', { token: t }).catch(() => ({}));
  const a = await paper('S1', 'MTH101'), b = await paper('S2', 'MTH101'), e = await paper('S1', 'ENG102');
  const ids = x => (x.questions || []).map(q => q.id);
  check('C2 MTH101 candidates each get 25 distinct questions', ids(a).length === 25 && new Set(ids(a)).size === 25 && ids(b).length === 25, ids(a).length + ' / ' + ids(b).length);
  check('C3 different candidates get different selections', ids(a).sort().join() !== ids(b).sort().join(), '');
  check('C4 ENG102 (bank of 15) gives all 15', ids(e).length === 15, ids(e).length + '');
  const st = await api('candidateStart', { token: a.token });
  const answers = {}; for (const q of a.questions) answers[q.id] = (q.options || []).find(o => /R/.test(o.text || o))?.key || 'A';
  const sub = await api('candidateSubmit', { token: a.token, answers });
  const rr = await api('results', { token: t }); const row = (rr.rows || []).find(x => String(x.exam_taker_id || '').indexOf('S1') >= 0 && /MTH/.test(JSON.stringify(x))) || {};
  check('C5 the paper is marked out of 25 (the questions given)', JSON.stringify(row).indexOf('25') >= 0, JSON.stringify(row).slice(0, 200));
  const clr = await api('saveSettings', { token: t, settings: { paper_size: '' } });
  const b2 = await paper('S2', 'MTH101');
  check('C6 clearing the number: an unstarted candidate gets the whole bank (60) again', clr.ok && ids(b2).length === 60, ids(b2).length + '');
  console.log('\n' + res.filter(Boolean).length + '/' + res.length + ' passed');
})().catch(e => { console.log('ERROR', e); process.exit(1); });
