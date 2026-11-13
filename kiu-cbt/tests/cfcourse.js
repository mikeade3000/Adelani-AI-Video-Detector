// Course units must be in the system; orphan clean-up, on the real Cloudflare runtime (R2 objects too).
const fs = require('fs'), path = require('path');
const B = process.argv[2], R2 = process.argv[3], PW = 'Kiu2026exam9x';
const api = async (a, b) => (await fetch(B + '/api', { method: 'POST', body: JSON.stringify(Object.assign({ action: a }, b || {})) })).json();
const count = () => { let n = 0; const walk = d => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : n++; } }; walk(R2); return n; };
const res = []; const check = (n, ok, d) => { res.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (d ? '  — ' + d : '')); };
const q = (id, course) => ({ question_id: id, question_text: 'q ' + id, option_a: 'R', option_b: 'W', correct_answer: 'A', course });
const sign = async (u, p) => { let r = await api('adminLogin', { username: u, password: p }); if (r.must_change) { await api('changePassword', { token: r.token, current: p, next: PW }); r = await api('adminLogin', { username: u, password: PW }); } return r.token; };
(async () => {
  await fetch(B + '/api?setup=1');
  const t = await sign('super', 'changeme');
  await api('saveSettings', { token: t, settings: { require_photo: '1', theory_enabled: '0' } });
  await api('importKiu', { token: t, units: [{ code: 'MTH101', programme: 'BSc', description: 'MTH101 - Calculus' }], lecturers: [{ email: 'lec@kiu.ac.ug', name: 'Dr Lec', programme: 'BSc', code: 'MTH101', password: 'password123' }],
    students: [{ admission: 'S1', name: 'One', password: 'pw' }], enrolments: [{ admission: 'S1', code: 'MTH101', programme: 'BSc' }, { admission: 'S1', code: 'ZZZ1', programme: 'BSc' }] });
  const up = await api('uploadQuestions', { token: t, rows: [q('A1', 'MTH101'), q('A2', 'FAKE1'), q('A3', 'mth 101')] });
  check('C1 questions for a course unit not in the system are refused; spelling variants are filed under the registered code', up.processed === 2 && up.not_in_system.join() === 'FAKE1', JSON.stringify(up.notes));
  const cu = await api('uploadCandidates', { token: t, rows: [{ exam_taker_id: 'C1', username: 'c1', password: 'pw', full_name: 'One', course: 'NOPE' }] });
  check('C2 candidates for a course unit not in the system are refused', cu.processed === 0 && cu.not_in_system.join() === 'NOPE', '');
  const lec = await sign('lec@kiu.ac.ug', 'password123');
  await api('saveCourse', { token: lec, course_code: 'OLD 300', programme: 'BSc' });
  await api('uploadQuestions', { token: lec, rows: [q('O1', 'OLD 300'), q('O2', 'OLD 300')] });
  await api('saveStudents', { token: lec, rows: [{ exam_taker_id: 'OS1', full_name: 'Old', username: 'os1', password: 'pw', course: 'OLD 300' }] });
  const ct = (await api('candidateLogin', { username: 'os1', password: 'pw' })).token;
  await api('photoUpload', { token: ct, image: 'data:image/jpeg;base64,' + Buffer.from('\xff\xd8\xff' + 'p'.repeat(3000), 'latin1').toString('base64') });
  await api('candidateStart', { token: ct });
  for (const s of [1, 2]) await api('recUpload', { token: ct, session: 's', seq: s, data: 'data:video/webm;base64,' + Buffer.from('\x1a\x45\xdf\xa3' + 'v'.repeat(9000), 'latin1').toString('base64') });
  await new Promise(r => setTimeout(r, 1500)); const objBefore = count();
  await api('deleteCourse', { token: lec, course_code: 'OLD 300' });
  const list = await api('orphanCourses', { token: t });
  check('C3 the removed course unit is listed as not in the system', list.rows.length === 1 && list.rows[0].course === 'OLD 300' && list.rows[0].questions === 2 && list.rows[0].sittings === 1 && list.rows[0].started === 1, JSON.stringify(list.rows));
  const del = await api('deleteOrphanCourses', { token: t, courses: ['OLD 300'] });
  await new Promise(r => setTimeout(r, 2500));
  check('C4 superadmin deletes it: questions, sitting and its 3 media files', del.ok && del.questions_removed === 2 && del.sittings_removed === 1 && del.media_deleted === 3, JSON.stringify(del));
  check('C5 the R2 objects are removed from storage', count() === objBefore - 3, 'R2 objects ' + objBefore + ' → ' + count());
  const after = await api('orphanCourses', { token: t }), s1 = await api('candidateLogin', { username: 'S1', password: 'pw' });
  check('C6 nothing left; the MTH101 sitting still signs in', after.rows.length === 0 && !s1.error, JSON.stringify(Object.keys(s1)));
  console.log('\n' + res.filter(Boolean).length + '/' + res.length + ' passed');
})().catch(e => { console.log('ERROR', e); process.exit(1); });
