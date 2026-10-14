// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { validateDocx } = require('../cat/validator.js');
const { buildDocx, defaults } = require('./fixture.cjs');

const check = (over, name = 'CAT.docx') => validateDocx(buildDocx(over), name);
const failed = r => r.errors.map(e => e.label).join('\n');

test('a conforming submission is accepted and its details extracted', async () => {
  const r = await check();
  assert.strictEqual(r.accepted, true, failed(r));
  assert.strictEqual(r.data.lecturer, 'DR. JANE AKELLO');
  assert.strictEqual(r.data.courseCode, 'CSC 2105');
  assert.strictEqual(r.data.courseTitle, 'DATA STRUCTURES');
  assert.strictEqual(r.data.appear, 3);
  assert.strictEqual(r.data.totalMarks, 50);
});

const rejects = (title, over, expect, name) =>
  test(`rejects: ${title}`, async () => {
    const r = await check(typeof over === 'function' ? over(defaults()) : over, name);
    assert.strictEqual(r.accepted, false);
    assert.match(failed(r), expect);
  });

rejects('wrong file type', {}, /\.docx/, 'CAT.pdf');
rejects('missing footer form code', { footer: '' }, /Footer form code/);
rejects('landscape page', { pgSz: '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' }, /A4 portrait/);
rejects('deleted details row', d => ({ details: d.details.slice(0, 9) }), /Table A: 10 rows/);
rejects('renamed details label', d => { d.details[6][0] = 'Lecturer'; return { details: d.details }; }, /Row 7 label/);
rejects('blank lecturer name', d => { d.details[6][1] = ''; return { details: d.details }; }, /Lecturer \(Full Name\) is filled in/);
rejects('placeholder course code', d => { d.details[1][1] = '[Course code]'; return { details: d.details }; }, /Course Code is filled in/);
rejects('invalid academic year', d => { d.details[3][1] = '2026/2028'; return { details: d.details }; }, /Academic Year format/);
rejects('invalid submission date', d => { d.details[9][1] = '31-02-2026'; return { details: d.details }; }, /valid date/);
rejects('attempt exceeds appear', d => { d.setup[3][1] = '4'; return { setup: d.setup }; }, /does not exceed/);
rejects('compulsory not Yes/No', d => { d.setup[4][1] = 'Maybe'; return { setup: d.setup }; }, /Yes or No/);
rejects('topic mismatch', { topicHeading: 'C. QUESTIONS (topic: Trees)' }, /Topic in Section C heading/);
rejects('only four questions', d => ({ questions: d.questions.slice(0, 4) }), /Table C: 6 rows/);
rejects('renumbered question', d => { d.questions[2][0] = '7'; return { questions: d.questions }; }, /Question 3: numbered/);
rejects('marks do not add up', d => { d.questions[1][2] = '12'; return { questions: d.questions }; }, /Question 2: part marks add up/);
rejects('part without marks', d => { d.questions[0][1][2] = '(b) Implement deletion.'; return { questions: d.questions }; }, /Question 1: every part ends/);
rejects('missing screenshots line', d => { d.questions[4][1].pop(); return { questions: d.questions }; }, /Question 5: has a "Screenshots:"/);
rejects('extra paragraph added', { extraBody: '<w:p><w:r><w:t>Extra notes</w:t></w:r></w:p>' }, /No extra paragraphs/);
rejects('tracked changes left in', { extraBody: '<w:p><w:ins><w:r><w:t>x</w:t></w:r></w:ins></w:p>' }, /tracked changes/);

test('rejects a file that is not a Word document', async () => {
  const r = await validateDocx(new TextEncoder().encode('hello').buffer, 'fake.docx');
  assert.strictEqual(r.accepted, false);
  assert.match(failed(r), /valid Word document/);
});
