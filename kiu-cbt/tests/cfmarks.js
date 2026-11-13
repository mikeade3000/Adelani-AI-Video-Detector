// Marks per question on the real Cloudflare runtime.
const B = process.argv[2], PW = 'Kiu2026exam9x';
const api = async (a, b) => (await fetch(B + '/api', { method: 'POST', body: JSON.stringify(Object.assign({ action: a }, b || {})) })).json();
const res = []; const check = (n, ok, d) => { res.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (d ? '  — ' + d : '')); };
(async () => {
  await fetch(B + '/api?setup=1');
  let r = await api('adminLogin', { username: 'super', password: 'changeme' }); await api('changePassword', { token: r.token, current: 'changeme', next: PW });
  const t = (await api('adminLogin', { username: 'super', password: PW })).token;
  await api('saveSettings', { token: t, settings: { require_photo: '0', theory_enabled: '0' } });
  await api('importKiu', { token: t, units: [{ code: 'MTH101', programme: 'BSc', description: 'MTH101' }], lecturers: [], students: [{ admission: 'S1', name: 'One', password: 'pw' }], enrolments: [{ admission: 'S1', code: 'MTH101', programme: 'BSc' }] });
  await api('uploadQuestions', { token: t, rows: [1, 2, 3].map(i => ({ question_id: 'Q' + i, question_text: 'q' + i, option_a: 'R', option_b: 'W', correct_answer: 'A', marks: 0.5, course: 'MTH101' })) });
  const s = await api('candidateLogin', { username: 'S1', password: 'pw' }), c = await api('candidateLogin', { student_token: s.student_token, sitting: s.sittings[0].id });
  await api('candidateStart', { token: c.token });
  const a = {}; c.questions.forEach(q => { a[q.id] = Object.keys(q.opts).find(k => q.opts[k] === 'R'); });
  await api('candidateSubmit', { token: c.token, answers: a });
  const row = async () => (await api('results', { token: t })).rows.find(x => x.exam_taker_id === 'S1-MTH101');
  const before = await row();
  const sv = await api('saveSettings', { token: t, settings: { mark_per_question: '2' } }), after = await row();
  check('M1 own marks first (3 × 0.5 = 1.5 of 1.5), then 2 per question for every unit (6 of 6)', before.score === 1.5 && before.max_score === 1.5 && sv.ok && after.score === 6 && after.max_score === 6, `${before.score}/${before.max_score} → ${after.score}/${after.max_score}`);
  const bad = await api('saveSettings', { token: t, settings: { mark_per_question: 'two' } });
  check('M2 a value that is not a mark is refused', !!bad.error, bad.error);
  console.log('\n' + res.filter(Boolean).length + '/' + res.length + ' passed');
})().catch(e => { console.log('ERROR', e); process.exit(1); });
