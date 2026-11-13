// Change students' programme on the real Cloudflare runtime.
const B = process.argv[2], PW = 'Kiu2026exam9x', BM = 'VP-BM-PhD-Year1-Semester1', AGR = 'VP-AGR-PhD-Year1-Semester1';
const api = async (a, b) => (await fetch(B + '/api', { method: 'POST', body: JSON.stringify(Object.assign({ action: a }, b || {})) })).json();
const res = []; const check = (n, ok, d) => { res.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (d ? '  — ' + d : '')); };
(async () => {
  await fetch(B + '/api?setup=1');
  let r = await api('adminLogin', { username: 'super', password: 'changeme' }); await api('changePassword', { token: r.token, current: 'changeme', next: PW });
  const t = (await api('adminLogin', { username: 'super', password: PW })).token;
  await api('importKiu', { token: t, units: ['CDC9113', 'CDC9122'].map(c => ({ code: c, programme: BM, description: c })).concat(['CDC9113', 'AGR9101'].map(c => ({ code: c, programme: AGR, description: c }))), lecturers: [],
    students: [{ admission: '675657', name: 'Moses Obenen', programme: BM, password: 'pw' }], enrolments: ['CDC9113', 'CDC9122'].map(c => ({ admission: '675657', code: c, programme: BM })) });
  const body = { students: [{ admission: '675657', programme: AGR }], add: [{ admission: '675657', code: 'CDC9113' }, { admission: '675657', course_id: '1231', code: 'AGR9101' }], remove: [{ admission: '675657', code: 'CDC9122' }] };
  const chk = await api('changeProgrammes', Object.assign({ token: t, apply: false }, body));
  const app = await api('changeProgrammes', Object.assign({ token: t, apply: true }, body));
  const s = await api('candidateLogin', { username: '675657', password: 'pw' });
  check('R1 check then apply: programme changed, AGR9101 added, CDC9122 removed, CDC9113 kept', chk.ok && !chk.plans[0].applied && app.plans[0].applied && s.sittings.map(x => x.course).sort().join() === 'AGR9101,CDC9113', s.sittings.map(x => x.course).join(','));
  console.log('\n' + res.filter(Boolean).length + '/' + res.length + ' passed');
})().catch(e => { console.log('ERROR', e); process.exit(1); });
