// The official time zone on the real Cloudflare runtime (TIME_ZONE in wrangler.toml).
const B = process.argv[2], PW = 'Kiu2026exam9x';
const api = async (a, b) => (await fetch(B + '/api', { method: 'POST', body: JSON.stringify(Object.assign({ action: a }, b || {})) })).json();
const res = []; const check = (n, ok, d) => { res.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (d ? '  — ' + d : '')); };
(async () => {
  await fetch(B + '/api?setup=1');
  let r = await api('adminLogin', { username: 'super', password: 'changeme' }); await api('changePassword', { token: r.token, current: 'changeme', next: PW });
  const a = await api('adminLogin', { username: 'super', password: PW });
  await api('saveSettings', { token: a.token, settings: { require_photo: '0', theory_enabled: '0', last_start_at: '2026-10-25T21:00:00.000Z' } });
  await api('importKiu', { token: a.token, units: [{ code: 'MTH101', programme: 'BSc', description: 'MTH101' }], lecturers: [], students: [{ admission: 'S1', name: 'One', password: 'pw' }], enrolments: [{ admission: 'S1', code: 'MTH101', programme: 'BSc' }] });
  await api('uploadQuestions', { token: a.token, rows: [{ question_id: 'Q1', question_text: 'q', option_a: 'R', option_b: 'W', correct_answer: 'A', course: 'MTH101' }] });
  const s = await api('candidateLogin', { username: 'S1', password: 'pw' }), x = await api('candidateLogin', { student_token: s.student_token, sitting: s.sittings[0].id });
  check('Y1 the official zone comes from TIME_ZONE (Africa/Kampala) on every sign-in', a.time_zone === 'Africa/Kampala' && s.time_zone === 'Africa/Kampala', a.time_zone);
  check('Y2 server messages name it', /\(Kampala time, UTC\+3\)/.test(x.error || ''), x.error);
  console.log('\n' + res.filter(Boolean).length + '/' + res.length + ' passed');
})().catch(e => { console.log('ERROR', e); process.exit(1); });
