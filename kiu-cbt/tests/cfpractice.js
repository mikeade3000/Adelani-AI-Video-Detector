// Practice test time separate from the real examinations, on the real Cloudflare runtime.
const B = process.argv[2], PW = 'Kiu2026exam9x';
const api = async (a, b) => (await fetch(B + '/api', { method: 'POST', body: JSON.stringify(Object.assign({ action: a }, b || {})) })).json();
const iso = m => new Date(Date.now() + m * 60000).toISOString();
const res = []; const check = (n, ok, d) => { res.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (d ? '  — ' + d : '')); };
const qs = (pre, n, course) => Array.from({ length: n }, (_, i) => ({ question_id: pre + i, question_text: pre + i, option_a: 'R', option_b: 'W', correct_answer: 'A', course }));
(async () => {
  await fetch(B + '/api?setup=1');
  let r = await api('adminLogin', { username: 'super', password: 'changeme' }); await api('changePassword', { token: r.token, current: 'changeme', next: PW });
  const t = (await api('adminLogin', { username: 'super', password: PW })).token, tomorrow = iso(1440);
  await api('saveSettings', { token: t, settings: { require_photo: '0', theory_enabled: '1', duration_minutes: '120', scheduled_start: tomorrow, paper_size: '2' } });
  await api('importKiu', { token: t, units: [{ code: 'MTH101', programme: 'BSc', description: 'MTH101 - Calculus' }], lecturers: [], students: [{ admission: 'S1', name: 'One', password: 'pw' }], enrolments: [{ admission: 'S1', code: 'MTH101', programme: 'BSc' }] });
  await api('uploadQuestions', { token: t, rows: qs('M', 5, 'MTH101').concat(qs('P', 6, 'PRACTICE')) });
  await api('addPracticeSittings', { token: t, course: 'PRACTICE' });
  const sit = async (unit) => { const s = await api('candidateLogin', { username: 'S1', password: 'pw' }); const x = s.sittings.find(y => y.course === unit); return api('candidateLogin', { student_token: s.student_token, sitting: x.id }); };
  const sp = await api('savePracticeTiming', { token: t, duration_minutes: '20', opens_at: '', last_start_at: '' });
  const p = await sit('PRACTICE'), m = await sit('MTH101');
  check('R1 practice: its own 20 minutes, open now, all 6 questions, no Section B', sp.ok && p.duration_minutes === 20 && !p.scheduled_start && p.questions.length === 6 && p.theory_enabled === false, `${p.duration_minutes} min, ${p.questions.length} q`);
  check('R2 real exam: 120 minutes, opens tomorrow, 2 questions per paper, with Section B', m.duration_minutes === 120 && m.scheduled_start === tomorrow && m.questions.length === 2 && m.theory_enabled === true, `${m.duration_minutes} min`);
  const ps = await api('candidateStart', { token: p.token }), ms = await api('candidateStart', { token: m.token });
  check('R3 practice starts now; the real exam does not open until tomorrow', ps.ok && !!ms.error, ms.error);
  await api('candidateSubmit', { token: p.token, answers: {} });
  const again = await sit('PRACTICE');
  check('R4 practice is finished after Section A', again.attempted === true, '');
  const set = (await api('getSettings', { token: t })).settings;
  check('R5 the real examinations\' Settings are unchanged', set.duration_minutes == 120 && set.scheduled_start === tomorrow, '');
  console.log('\n' + res.filter(Boolean).length + '/' + res.length + ' passed');
})().catch(e => { console.log('ERROR', e); process.exit(1); });
