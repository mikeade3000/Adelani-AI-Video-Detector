// Questions per paper enforced on started and completed papers, on the real Cloudflare runtime.
const B = process.argv[2], PW = 'Kiu2026exam9x';
const api = async (a, b) => (await fetch(B + '/api', { method: 'POST', body: JSON.stringify(Object.assign({ action: a }, b || {})) })).json();
const res = []; const check = (n, ok, d) => { res.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (d ? '  — ' + d : '')); };
(async () => {
  await fetch(B + '/api?setup=1');
  let r = await api('adminLogin', { username: 'super', password: 'changeme' }); await api('changePassword', { token: r.token, current: 'changeme', next: PW });
  const t = (await api('adminLogin', { username: 'super', password: PW })).token;
  await api('saveSettings', { token: t, settings: { require_photo: '0', theory_enabled: '0', paper_size: '' } });
  await api('importKiu', { token: t, units: [{ code: 'MTH101', programme: 'BSc', description: 'MTH101' }], lecturers: [], students: ['S1', 'S2', 'S3'].map(a => ({ admission: a, name: a, password: 'pw' })), enrolments: ['S1', 'S2', 'S3'].map(a => ({ admission: a, code: 'MTH101', programme: 'BSc' })) });
  await api('uploadQuestions', { token: t, rows: Array.from({ length: 60 }, (_, i) => ({ question_id: 'Q' + i, question_text: 'q' + i, option_a: 'R', option_b: 'W', correct_answer: 'A', course: 'MTH101' })).concat(Array.from({ length: 6 }, (_, i) => ({ question_id: 'P' + i, question_text: 'p' + i, option_a: 'R', option_b: 'W', correct_answer: 'A', course: 'PRACTICE' }))) });
  await api('addPracticeSittings', { token: t, course: 'PRACTICE' });
  const sit = async (u, unit) => { const s = await api('candidateLogin', { username: u, password: 'pw' }); const x = s.sittings.find(y => y.course === unit); return api('candidateLogin', { student_token: s.student_token, sitting: x.id }); };
  const all = qs => Object.fromEntries(qs.map(q => [q.id, Object.keys(q.opts).find(k => q.opts[k] === 'R')]));
  const a = await sit('S1', 'MTH101'); await api('candidateStart', { token: a.token }); await api('candidateSubmit', { token: a.token, answers: all(a.questions) });
  const p = await sit('S1', 'PRACTICE'); await api('candidateStart', { token: p.token }); await api('candidateSubmit', { token: p.token, answers: all(p.questions) });
  const b = await sit('S2', 'MTH101'); await api('candidateStart', { token: b.token });
  const c = await sit('S3', 'MTH101');
  const sv = await api('saveSettings', { token: t, settings: { paper_size: '5' } });
  const rows = async () => Object.fromEntries((await api('results', { token: t })).rows.map(x => [x.exam_taker_id, x.score + '/' + x.max_score + ' (' + x.total_q + ')']));
  let rr = await rows();
  check('X1 completed 60 → marked on 5 at once; practice untouched (6)', rr['S1-MTH101'] === '5/5 (5)' && rr['S1-PRACTICE'] === '6/6 (6)' && sv.impact.completed === 1 && sv.impact.writing === 1, JSON.stringify(rr));
  const cs = await api('candidateStart', { token: c.token });
  check('X2 signed in with 60 on screen → Start sends the 5', cs.ok && cs.questions.length === 5, cs.questions && cs.questions.length + '');
  await api('candidateSubmit', { token: b.token, answers: all(b.questions) });
  const ms = await api('mcqScore', { token: b.token });
  check('X3 writing on 60 → after Submit the portal shows 5 / 5', ms.score === 5 && ms.max_score === 5, ms.score + '/' + ms.max_score);
  console.log('\n' + res.filter(Boolean).length + '/' + res.length + ' passed');
})().catch(e => { console.log('ERROR', e); process.exit(1); });
