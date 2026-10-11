'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../js/scoring.js');

const RUBRIC = `
# sample
Q1 [5] The CIA triad
Model: Information security protects the confidentiality, integrity and
availability of data. Confidentiality keeps data secret from unauthorised users,
integrity keeps it accurate and unaltered, availability keeps it accessible.
Keywords:
- confidentiality | secrecy
- integrity | accuracy
- availability | accessible
- unauthorised access | unauthorized access

Q2 (10 marks)
Model: A firewall filters network traffic using rules.
Keywords: firewall; filter* | block; rules | policy
`;

test('parses questions, marks, model answers and keyword groups', () => {
  const r = G.parseRubric(RUBRIC);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.questions.length, 2);
  const [q1, q2] = r.questions;
  assert.strictEqual(q1.id, '1');
  assert.strictEqual(q1.max, 5);
  assert.strictEqual(q1.title, 'The CIA triad');
  assert.ok(q1.model.startsWith('Information security'));
  assert.strictEqual(q1.keywordGroups.length, 4);
  assert.deepStrictEqual(q1.keywordGroups[0], ['confidentiality', 'secrecy']);
  assert.strictEqual(q2.max, 10);
  assert.deepStrictEqual(q2.keywordGroups, [['firewall'], ['filter*', 'block'], ['rules', 'policy']]);
});

test('reports missing maximum marks and model answers', () => {
  const r = G.parseRubric('Q1\nKeywords: a');
  assert.ok(r.errors.some(e => /maximum/.test(e)));
  assert.ok(r.errors.some(e => /model answer/.test(e)));
});

test('normalisation applies the OCR substitution list and digit fixes', () => {
  const subs = G.parseSubstitutions(G.DEFAULT_SUBSTITUTIONS);
  assert.deepStrictEqual(G.normalizeText('We stere the c0mputer infor-\nmation!', subs),
    ['we', 'store', 'the', 'computer', 'information']);
});

test('fuzzy keyword matching tolerates OCR errors at θ = 0.80', () => {
  const tokens = G.normalizeText('the informaten must stay confidentiallity');
  const res = G.matchKeywordGroups(tokens, [['information'], ['confidentiality'], ['integrity']], { theta: 0.8, stem: true });
  assert.strictEqual(res.matched.length, 2);
  assert.strictEqual(res.missed.length, 1);
  assert.ok(Math.abs(res.coverage - 2 / 3) < 1e-9);
});

test('prefix keywords and multi-word phrases', () => {
  const tokens = G.normalizeText('It filters packets and stops unauthorized access');
  const res = G.matchKeywordGroups(tokens, [['filter*'], ['unauthorised access | x'.split('|')[0].trim()]], { theta: 0.8, stem: true });
  assert.strictEqual(res.matched.length, 2);
});

test('scoring follows S = M × [w·cos + (1−w)·k], rounded to half marks', () => {
  const q = G.parseRubric(RUBRIC).questions[0];
  const good = 'Security means confidentiality so data is secret from unauthorised access, integrity so data is accurate and not altered, and availability so it is accessible.';
  const r = G.scoreResponse(good, q, {});
  assert.strictEqual(r.coverage, 1);
  const expected = G.roundTo(5 * (0.5 * r.cosine + 0.5 * 1), 0.5);
  assert.strictEqual(r.suggested, expected);
  assert.ok(r.suggested >= 3.5, String(r.suggested));
  assert.strictEqual(r.suggested % 0.5, 0);

  const weak = G.scoreResponse('Integrity is important.', q, {});
  assert.ok(weak.suggested < r.suggested);
});

test('off-topic and empty answers are flagged red and scored zero', () => {
  const q = G.parseRubric(RUBRIC).questions[0];
  const off = G.scoreResponse('My favourite football club won the league yesterday evening.', q, {});
  assert.ok(off.offTopic);
  assert.strictEqual(off.suggested, 0);
  assert.strictEqual(off.confidence, 'red');
  const empty = G.scoreResponse('   ', q, {});
  assert.ok(empty.empty);
  assert.strictEqual(empty.confidence, 'red');
});

test('questions without keywords fall back to similarity only', () => {
  const q = { id: '1', max: 4, model: 'phishing tricks users into revealing passwords', keywordGroups: [] };
  const r = G.scoreResponse('phishing tricks users into revealing passwords', q, {});
  assert.strictEqual(r.coverage, null);
  assert.strictEqual(r.suggested, 4);
});

test('segmentation splits on question markers, including OCR-mangled ones', () => {
  const text = 'Name: X\nQ1. Confidentiality means secret\nmore text\nQuestion 2) firewall rules\nQl0 nope\nQQ 3: hashing';
  const s = G.segmentAnswers(text, ['1', '2', '3'], 'strict');
  assert.strictEqual(s.markersFound, 3);
  assert.ok(s.answers['1'].startsWith('Confidentiality'));
  assert.ok(s.answers['1'].includes('more text'));
  assert.ok(s.answers['2'].startsWith('firewall'));
  assert.strictEqual(s.answers['3'], 'hashing');
  assert.strictEqual(s.unassigned, 'Name: X');
});

test('loose segmentation accepts bare numbers; strict ignores them', () => {
  const text = '1. first answer\n2) second answer';
  assert.strictEqual(G.segmentAnswers(text, ['1', '2'], 'strict').markersFound, 0);
  const s = G.segmentAnswers(text, ['1', '2'], 'loose');
  assert.strictEqual(s.answers['2'], 'second answer');
});

test('dictionary ratio separates clean text from OCR garbage', () => {
  const vocab = G.rubricVocabulary(G.parseRubric(RUBRIC));
  const clean = G.dictionaryRatio('Integrity keeps the data accurate and protects it from unauthorised changes', vocab);
  const junk = G.dictionaryRatio('lntgrty kps th dta acrte nd prtcts t frm unathrsd chngs', vocab);
  assert.ok(clean > 0.8, String(clean));
  assert.ok(junk < 0.3, String(junk));
});
