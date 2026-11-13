// Seeds a local CBT for the Answer review tests and prints the facts the checks need (JSON on the last line).
const B = process.argv[2], PW = 'Kiu2026exam9x';
const api = async (a, b) => (await fetch(B + '/api', { method: 'POST', body: JSON.stringify(Object.assign({ action: a }, b || {})) })).json();
const sign = async (u, p) => { let r = await api('adminLogin', { username: u, password: p }); if (r.must_change) { await api('changePassword', { token: r.token, current: p, next: PW }); r = await api('adminLogin', { username: u, password: PW }); } return r.token; };
(async () => {
  await fetch(B + '/api?setup=1');
  const t = await sign('super', 'changeme');
  await api('saveSettings', { token: t, settings: { require_photo: '0', require_camera: '0', record_video: '0', require_location: '0', theory_enabled: '0', shuffle_options: '1', shuffle_questions: '1' } });
  const S = ['S1', 'S2', 'S3', 'S4', 'S6', 'S7'];
  await api('importKiu', { token: t, units: [{ code: 'MTH101', programme: 'BSc', description: 'MTH101 - Calculus' }, { code: 'ENG102', programme: 'BA', description: 'ENG102 - English' }],
    lecturers: [{ email: 'lec@kiu.ac.ug', name: 'Dr Maths', programme: 'BSc', code: 'MTH101', password: 'password123' }, { email: 'lec2@kiu.ac.ug', name: 'Dr English', programme: 'BA', code: 'ENG102', password: 'password123' }],
    students: S.concat(['S5']).map(a => ({ admission: a, name: 'Student ' + a, password: 'pw' })),
    enrolments: S.map(a => ({ admission: a, code: 'MTH101', programme: 'BSc' })).concat([{ admission: 'S5', code: 'ENG102', programme: 'BA' }]) });
  const lec = await sign('lec@kiu.ac.ug', 'password123'), lec2 = await sign('lec2@kiu.ac.ug', 'password123');
  const Q = [['Q1', '2 + 2 = ?', '4', '5', '6', '3'], ['Q2', 'Derivative of x^2?', '2x', 'x', 'x^2', '2'], ['Q3', 'Integral of 1 dx?', 'x + C', '1', '0', 'C'], ['Q4', '5 x 6 = ?', '30', '11', '56', '25'], ['Q5', 'Is 7 prime?', 'True', 'False']];
  await api('uploadQuestions', { token: lec, rows: Q.map(q => ({ question_id: q[0], question_text: q[1], option_a: q[2], option_b: q[3], option_c: q[4] || '', option_d: q[5] || '', correct_answer: 'A', marks: 2 })).map(r => Object.assign(r, { course: 'MTH101' })) });
  await api('uploadQuestions', { token: lec2, rows: [{ question_id: 'E1', question_text: 'Plural of child?', option_a: 'children', option_b: 'childs', correct_answer: 'A', course: 'ENG102' }] });
  const key = {}; (await api('listQuestions', { token: t })).rows.forEach(q => { key[q.question_id] = q.correct_answer; });
  const wrong = (q, opts) => Object.keys(opts).find(k => k !== key[q] && opts[k]);
  const sit = async (adm) => { const s = await api('candidateLogin', { username: adm, password: 'pw' }); const x = s.sittings.find(y => y.course === 'MTH101'); return api('candidateLogin', { student_token: s.student_token, sitting: x.id }); };
  const chosen = {};
  const plan = { S1: q => key[q], S2: (q, o) => q === 'Q2' ? wrong(q, o) : q === 'Q4' ? '' : q === 'Q5' ? wrong(q, o) : key[q], S6: (q, o) => q === 'Q2' ? wrong(q, o) : key[q], S7: (q, o) => q === 'Q2' ? wrong(q, o) : key[q] };
  for (const adm of ['S1', 'S2', 'S6', 'S7']) {
    const c = await sit(adm); await api('candidateStart', { token: c.token });
    const ans = {}; c.questions.forEach(q => { const a = plan[adm](q.id, q.opts); if (a) ans[q.id] = a; }); chosen[adm] = ans;
    await api('candidateSubmit', { token: c.token, answers: ans });
  }
  const w = await sit('S3'); await api('candidateStart', { token: w.token }); await api('candidateSync', { token: w.token, answers: { Q1: key.Q1 } });   // still writing
  const res = (await api('results', { token: t })).rows.filter(r => r.course === 'MTH101').map(r => ({ id: r.exam_taker_id, score: r.score, max: r.max_score }));
  console.log(JSON.stringify({ key, chosen, results: res, tokens: { t, lec, lec2 } }));
})().catch(e => { console.log('ERROR', e); process.exit(1); });
