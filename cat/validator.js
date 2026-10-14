/*
 * KIU CAT Question Submission Form — automatic conformity checker.
 *
 * Reads a lecturer's .docx upload entirely in the browser (no server, no
 * third-party libraries) and checks it against the official template
 * (form code CAT-GEN-v 1). Every rule produces a check entry so the lecturer
 * sees exactly what passed and what must be fixed.
 *
 * Works in modern browsers and in Node 18+ (uses DecompressionStream).
 *
 *   const result = await CATValidator.validateDocx(arrayBuffer, fileName);
 *   result.accepted  -> true / false
 *   result.checks    -> [{ section, label, ok, detail }]
 *   result.data      -> extracted lecturer / course / question details
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Template specification. Edit here if the official template is revised.
  // ---------------------------------------------------------------------------
  const TEMPLATE = {
    formCode: 'CAT-GEN-v 1',
    maxFileBytes: 10 * 1024 * 1024,
    page: { w: 11906, h: 16838, top: 1440, right: 1440, bottom: 1440, left: 1440 },
    titles: [
      'KAMPALA INTERNATIONAL UNIVERSITY',
      'Continuous Assessment Test (CAT)',
      'CAT Question Submission Form'
    ],
    instructions:
      'Instructions: This is a practical, laptop-based CAT. Candidates must use only their own devices, ' +
      'their own files or sample data provided by the lecturer, and must handle all data lawfully and ethically. ' +
      'Complete the CAT Setup, and provide five (5) questions for the single topic. ' +
      'Do not delete or renumber the rows the system reads this form automatically on upload.',
    sectionA: 'A. COURSE & SUBMISSION DETAILS',
    sectionB: 'B. CAT SETUP',
    note:
      'Note: Candidates work on their own laptops and paste labelled screenshots of each completed step as ' +
      'evidence, documenting their process as they would in a real investigation. ' +
      '"Number to attempt" must not exceed "number to appear".',
    sectionCPrefix: 'C. QUESTIONS (topic:',
    tableA: {
      grid: [2900, 6126],
      labels: [
        ['programme', 'Programme'],
        ['courseCode', 'Course Code'],
        ['courseTitle', 'Course Title'],
        ['academicYear', 'Academic Year'],
        ['level', 'Level'],
        ['semester', 'Semester'],
        ['lecturer', 'Lecturer (Full Name)'],
        ['school', 'School'],
        ['department', 'Department'],
        ['submissionDate', 'Date of Submission']
      ]
    },
    tableB: {
      grid: [3400, 5626],
      header: ['CAT Setup', "Lecturer's instructions"],
      labels: [
        ['topic', 'Topic'],
        ['appear', 'Number of questions to appear on the paper'],
        ['attempt', 'Number of questions to attempt'],
        ['compulsory', 'Compulsory question (Question 1)? [Yes / No]']
      ]
    },
    tableC: {
      grid: [760, 6766, 1500],
      header: ['#', 'Question', 'Marks'],
      questions: 5
    }
  };

  // ---------------------------------------------------------------------------
  // Minimal ZIP reader (stored + deflate) built on DecompressionStream.
  // ---------------------------------------------------------------------------
  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a ZIP container');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const entries = {};
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt ZIP directory');
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { flags, method, compSize, local };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return {
      names: Object.keys(entries),
      async text(name) {
        const e = entries[name];
        if (!e) return null;
        if (e.flags & 1) throw new Error('file is password-protected / encrypted');
        const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
        const raw = bytes.subarray(start, start + e.compSize);
        let out;
        if (e.method === 0) out = raw;
        else if (e.method === 8) out = await inflateRaw(raw);
        else throw new Error('unsupported ZIP compression method ' + e.method);
        return new TextDecoder().decode(out);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // WordprocessingML parsing: paragraphs, tables, rows, cells.
  // ---------------------------------------------------------------------------
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (k === 'amp') return '&';
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      if (k === 'quot') return '"';
      if (k === 'apos') return "'";
      if (k[1] === 'x') return String.fromCodePoint(parseInt(k.slice(2), 16));
      return String.fromCodePoint(parseInt(k.slice(1), 10));
    });
  }

  function runText(xml) {
    let out = '';
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\s*\/>/g;
    let m;
    while ((m = re.exec(xml))) out += m[1] !== undefined ? decodeEntities(m[1]) : (m[2] === 'tab' ? '\t' : '\n');
    return out;
  }

  // Builds a tree of w:tbl / w:tr / w:tc / w:p elements from the body XML.
  function parseBody(xml) {
    const root = { tag: 'body', children: [], start: 0 };
    const stack = [root];
    const re = /<(\/?)w:(p|tbl|tr|tc)(?=[\s/>])[^>]*?(\/?)>/g;
    let m;
    while ((m = re.exec(xml))) {
      const [, close, tag, self] = m;
      if (close) {
        const node = stack.pop();
        if (!node || node.tag !== tag) throw new Error('malformed document body');
        node.xml = xml.slice(node.start, m.index);
      } else {
        const node = { tag, children: [], start: re.lastIndex };
        stack[stack.length - 1].children.push(node);
        if (self) node.xml = '';
        else stack.push(node);
      }
    }
    return root;
  }

  function paraText(p) { return runText(p.xml); }

  function cellParas(tc) {
    return tc.children.filter(c => c.tag === 'p').map(paraText).map(clean).filter(Boolean);
  }

  function tableInfo(tbl) {
    const grid = [...tbl.xml.matchAll(/<w:gridCol\s+w:w="(\d+)"/g)].map(m => +m[1]);
    const nested = tbl.children.some(tr => tr.children.some(tc => tc.children.some(c => c.tag === 'tbl')));
    const merged = /<w:(gridSpan|vMerge)\b/.test(tbl.xml);
    const rows = tbl.children.filter(c => c.tag === 'tr').map(tr =>
      tr.children.filter(c => c.tag === 'tc').map(tc => ({ paras: cellParas(tc), text: cellParas(tc).join('\n') }))
    );
    return { type: 'tbl', grid, nested, merged, rows };
  }

  // ---------------------------------------------------------------------------
  // Text helpers
  // ---------------------------------------------------------------------------
  function clean(s) {
    return String(s)
      .replace(/[   ]/g, ' ')
      .replace(/[‘’‛′]/g, "'")
      .replace(/[“”‟″]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();
  }
  const norm = s => clean(s).replace(/\s+/g, ' ').toLowerCase();
  const same = (a, b) => norm(a) === norm(b);
  const PLACEHOLDER = /^(\[.*\]|<.*>|_+|\.+|-+|x+|tbd|tba|n\/?a|nil|none|enter\b.*|type\b.*|click\b.*|insert\b.*|e\.g\..*)$/i;
  const isBlank = v => !clean(v) || PLACEHOLDER.test(clean(v));

  function parseDate(s) {
    const m = clean(s).match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (!m) return null;
    const d = +m[1], mo = +m[2], y = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return dt;
  }

  // ---------------------------------------------------------------------------
  // Main validation
  // ---------------------------------------------------------------------------
  async function validateDocx(buffer, fileName) {
    const checks = [];
    const data = {};
    const add = (section, label, ok, detail) => { checks.push({ section, label, ok: !!ok, detail: detail || '' }); return !!ok; };
    const result = () => ({ accepted: checks.every(c => c.ok), checks, data, errors: checks.filter(c => !c.ok) });

    // ---- 1. File -----------------------------------------------------------
    const F = '1. File';
    const size = buffer.byteLength;
    add(F, 'File is a Word .docx document', /\.docx$/i.test(fileName || ''),
      `"${fileName}" is not a .docx file. Save the template in Word as "Word Document (*.docx)" — not .doc, .pdf or .odt.`);
    if (!add(F, 'File size is within 10 MB', size > 0 && size <= TEMPLATE.maxFileBytes,
      size ? `File is ${(size / 1048576).toFixed(1)} MB; the limit is 10 MB.` : 'The file is empty.')) return result();

    let zip, docXml;
    try {
      zip = await readZip(buffer);
      docXml = await zip.text('word/document.xml');
    } catch (e) {
      add(F, 'File opens as a valid Word document', false, `The file could not be read (${e.message}). Re-save it from Word as .docx without a password.`);
      return result();
    }
    if (!add(F, 'File opens as a valid Word document', !!docXml,
      'No Word document body found. Upload the official template saved as .docx.')) return result();

    const types = (await zip.text('[Content_Types].xml')) || '';
    add(F, 'No macros embedded', !/macroEnabled|vbaProject/i.test(types) && !zip.names.some(n => /vbaProject\.bin$/i.test(n)),
      'The document contains macros (.docm). Save it as a plain .docx.');
    add(F, 'No unaccepted tracked changes', !/<w:(ins|del|moveFrom|moveTo)\b/.test(docXml),
      'The document still has tracked changes. In Word: Review → Accept → Accept All Changes, turn off Track Changes, then save.');

    // ---- 2. Page layout & footer -----------------------------------------
    const L = '2. Layout';
    const pg = TEMPLATE.page;
    const sz = docXml.match(/<w:pgSz\b[^>]*>/);
    const mar = docXml.match(/<w:pgMar\b[^>]*>/);
    const attr = (tag, a) => { const m = tag && tag[0].match(new RegExp(`w:${a}="(-?\\d+)"`)); return m ? +m[1] : NaN; };
    const near = (a, b, tol = 20) => Math.abs(a - b) <= tol;
    const orient = sz && /w:orient="landscape"/.test(sz[0]);
    add(L, 'Page size is A4 portrait', sz && !orient && near(attr(sz, 'w'), pg.w) && near(attr(sz, 'h'), pg.h),
      'Page size/orientation was changed. Use A4 (21.0 × 29.7 cm), portrait, as in the template.');
    add(L, 'Page margins are 2.54 cm (Normal) on all sides',
      mar && ['top', 'right', 'bottom', 'left'].every(k => near(Math.abs(attr(mar, k)), pg[k])),
      'Page margins were changed. Layout → Margins → Normal (2.54 cm).');

    let footerText = '';
    for (const n of zip.names.filter(n => /^word\/footer\d*\.xml$/.test(n))) footerText += runText(await zip.text(n)) + '\n';
    add(L, `Footer form code "${TEMPLATE.formCode}" is intact`,
      norm(footerText).replace(/\s/g, '').includes(norm(TEMPLATE.formCode).replace(/\s/g, '')),
      `The footer must read "Form code: ${TEMPLATE.formCode}". It was removed or edited — use the official template.`);

    // ---- 3. Document structure -------------------------------------------
    const S = '3. Structure';
    let body;
    try {
      const b = docXml.indexOf('<w:body>');
      body = parseBody(docXml.slice(b, docXml.lastIndexOf('</w:body>')));
    } catch (e) {
      add(S, 'Document body can be read', false, 'The document body is malformed. Re-save it from Word.');
      return result();
    }
    const blocks = body.children
      .map(n => (n.tag === 'tbl' ? tableInfo(n) : n.tag === 'p' ? { type: 'p', text: clean(paraText(n)) } : null))
      .filter(b => b && (b.type === 'tbl' || b.text));

    const expected = [
      ...TEMPLATE.titles.map(t => ({ label: `Title line "${t}"`, test: b => b.type === 'p' && same(b.text, t) })),
      { label: 'Instructions paragraph (unchanged)', test: b => b.type === 'p' && same(b.text, TEMPLATE.instructions),
        loose: b => b.type === 'p' && /^instructions:/i.test(b.text) },
      { label: `Heading "${TEMPLATE.sectionA}"`, test: b => b.type === 'p' && same(b.text, TEMPLATE.sectionA) },
      { label: 'Table A — Course & Submission Details', key: 'A', test: b => b.type === 'tbl' },
      { label: `Heading "${TEMPLATE.sectionB}"`, test: b => b.type === 'p' && same(b.text, TEMPLATE.sectionB) },
      { label: 'Table B — CAT Setup', key: 'B', test: b => b.type === 'tbl' },
      { label: 'Note paragraph (unchanged)', test: b => b.type === 'p' && same(b.text, TEMPLATE.note),
        loose: b => b.type === 'p' && /^note:/i.test(b.text) },
      { label: 'Heading "C. QUESTIONS (topic: …)"', key: 'Chead',
        test: b => b.type === 'p' && norm(b.text).startsWith(norm(TEMPLATE.sectionCPrefix)) && /\)\s*$/.test(b.text) },
      { label: 'Table C — Questions', key: 'C', test: b => b.type === 'tbl' }
    ];
    const found = {};
    let pos = 0;
    const extras = [];
    for (const exp of expected) {
      let idx = -1;
      for (let i = pos; i < blocks.length; i++) if (exp.test(blocks[i])) { idx = i; break; }
      if (idx < 0 && exp.loose) {
        const li = blocks.findIndex((b, i) => i >= pos && exp.loose(b));
        add(S, exp.label, false, li >= 0
          ? 'This fixed text was edited. Do not change the template wording — copy it back from the official template.'
          : 'Missing. It was deleted or moved — use the official template without removing anything.');
        if (li >= 0) { extras.push(...blocks.slice(pos, li)); pos = li + 1; }
        continue;
      }
      if (!add(S, exp.label, idx >= 0, 'Missing or out of order. It was deleted, renamed or moved — restore it from the official template.')) continue;
      extras.push(...blocks.slice(pos, idx));
      if (exp.key) found[exp.key] = blocks[idx];
      pos = idx + 1;
    }
    extras.push(...blocks.slice(pos));
    add(S, 'No extra paragraphs or tables added', extras.length === 0,
      extras.length ? 'Remove content that is not part of the template: ' +
        extras.slice(0, 4).map(b => b.type === 'tbl' ? '[an extra table]' : `"${b.text.slice(0, 60)}${b.text.length > 60 ? '…' : ''}"`).join('; ') +
        (extras.length > 4 ? ` (+${extras.length - 4} more)` : '') : '');

    const tableShape = (t, name, spec, rows, cols) => {
      if (!t) return false;
      const ok1 = add(S, `${name}: ${rows} rows × ${cols} columns, no merged or nested cells`,
        !t.nested && !t.merged && t.rows.length === rows && t.rows.every(r => r.length === cols),
        `${name} has ${t.rows.length} rows (${[...new Set(t.rows.map(r => r.length))].join('/')} columns)` +
        `${t.merged ? ', merged cells' : ''}${t.nested ? ', a nested table' : ''}. ` +
        `Expected exactly ${rows} rows × ${cols} columns — do not add, delete, split or merge rows/cells.`);
      add(S, `${name}: column widths unchanged`,
        t.grid.length === spec.grid.length && t.grid.every((w, i) => Math.abs(w - spec.grid[i]) <= spec.grid[i] * 0.02 + 10),
        `${name} column widths were changed (found ${t.grid.join(', ') || 'none'} twips; expected ${spec.grid.join(', ')}). Do not resize the columns.`);
      return ok1;
    };

    // ---- 4. Table A: course & submission details -------------------------
    const A = '4. Course details';
    const tA = found.A;
    if (tableShape(tA, 'Table A', TEMPLATE.tableA, TEMPLATE.tableA.labels.length, 2)) {
      TEMPLATE.tableA.labels.forEach(([key, label], i) => {
        const [lc, vc] = tA.rows[i];
        if (!add(A, `Row ${i + 1} label is "${label}"`, same(lc.text, label),
          `Found "${clean(lc.text) || '(empty)'}". Row labels must not be edited or reordered.`)) return;
        const v = clean(vc.text).replace(/\n/g, ' ');
        if (add(A, `${label} is filled in`, !isBlank(v), `"${label}" is empty or still a placeholder.`)) data[key] = v;
      });
      if (data.courseCode) add(A, 'Course Code format (e.g. CYB 3201)', /^[A-Z]{2,5}\s?-?\d{3,4}[A-Z]?$/i.test(data.courseCode),
        `"${data.courseCode}" is not a valid course code. Use letters followed by digits, e.g. "CYB 3201".`);
      if (data.academicYear) {
        const m = data.academicYear.match(/^(\d{4})\s*\/\s*(\d{4})$/);
        add(A, 'Academic Year format (YYYY/YYYY)', m && +m[2] === +m[1] + 1,
          `"${data.academicYear}" is invalid. Use consecutive years, e.g. "2026/2027".`);
      }
      if (data.semester) add(A, 'Semester is ONE, TWO or THREE', /^(one|two|three|1|2|3|i|ii|iii)$/i.test(data.semester.replace(/^semester\s+/i, '')),
        `"${data.semester}" is not a recognised semester. Write ONE, TWO or THREE.`);
      if (data.lecturer) add(A, 'Lecturer full name has at least two names', data.lecturer.replace(/\b(dr|prof|mr|mrs|ms|miss|eng|assoc)\.?\s+/gi, '').trim().split(/\s+/).length >= 2,
        `"${data.lecturer}" — give your full name (at least first name and surname).`);
      if (data.submissionDate) add(A, 'Date of Submission is a valid date (DD-MM-YYYY)', parseDate(data.submissionDate),
        `"${data.submissionDate}" is not a valid date. Use DD-MM-YYYY, e.g. 28-09-2026.`);
    }

    // ---- 5. Table B: CAT setup -------------------------------------------
    const B = '5. CAT setup';
    const tB = found.B;
    if (tableShape(tB, 'Table B', TEMPLATE.tableB, TEMPLATE.tableB.labels.length + 1, 2)) {
      add(B, 'Header row is "CAT Setup | Lecturer\'s instructions"',
        tB.rows[0].every((c, i) => same(c.text, TEMPLATE.tableB.header[i])), 'The header row was edited. Restore it from the template.');
      TEMPLATE.tableB.labels.forEach(([key, label], i) => {
        const [lc, vc] = tB.rows[i + 1];
        if (!add(B, `Row label "${label}"`, same(lc.text.replace(/\[\s*/g, '[').replace(/\s*\]/g, ']'), label),
          `Found "${clean(lc.text) || '(empty)'}". Row labels must not be edited or reordered.`)) return;
        const v = clean(vc.text).replace(/\n/g, ' ');
        if (add(B, `${label.replace(/\s*\[.*$/, '')} is filled in`, !isBlank(v), `"${label}" is empty or still a placeholder.`)) data[key] = v;
      });
      const n = TEMPLATE.tableC.questions;
      const appear = /^\d+$/.test(data.appear || '') ? +data.appear : NaN;
      const attempt = /^\d+$/.test(data.attempt || '') ? +data.attempt : NaN;
      if (data.appear !== undefined) add(B, `Questions to appear is a whole number from 1 to ${n}`, appear >= 1 && appear <= n,
        `"${data.appear}" — enter a single number between 1 and ${n}.`);
      if (data.attempt !== undefined) add(B, 'Questions to attempt is a whole number ≥ 1', attempt >= 1,
        `"${data.attempt}" — enter a single number (1 or more).`);
      if (appear >= 1 && attempt >= 1) add(B, 'Number to attempt does not exceed number to appear', attempt <= appear,
        `You set ${attempt} to attempt but only ${appear} appear on the paper.`);
      if (data.compulsory !== undefined) add(B, 'Compulsory question answered Yes or No', /^(yes|no)$/i.test(data.compulsory),
        `"${data.compulsory}" — write exactly "Yes" or "No".`);
      if (appear >= 1) data.appear = appear;
      if (attempt >= 1) data.attempt = attempt;
    }
    if (found.Chead && data.topic) {
      const t = found.Chead.text.replace(/^.*?topic:\s*/i, '').replace(/\)\s*$/, '');
      add(B, 'Topic in Section C heading matches the CAT Setup topic', same(t, data.topic),
        `Section C heading says "${clean(t)}" but CAT Setup topic is "${data.topic}". They must be the same topic.`);
    }

    // ---- 6. Table C: questions -------------------------------------------
    const Q = '6. Questions';
    const tC = found.C;
    const nQ = TEMPLATE.tableC.questions;
    if (tableShape(tC, 'Table C', TEMPLATE.tableC, nQ + 1, 3)) {
      add(Q, 'Header row is "# | Question | Marks"', tC.rows[0].every((c, i) => same(c.text, TEMPLATE.tableC.header[i])),
        'The header row was edited. Restore it from the template.');
      data.questions = [];
      for (let i = 1; i <= nQ; i++) {
        const [numC, qC, mC] = tC.rows[i];
        const tag = `Question ${i}`;
        add(Q, `${tag}: numbered "${i}"`, clean(numC.text) === String(i),
          `Found "${clean(numC.text) || '(empty)'}" in the # column. Do not renumber the rows.`);
        const marksTxt = clean(mC.text);
        const marks = /^\d+$/.test(marksTxt) ? +marksTxt : NaN;
        add(Q, `${tag}: marks is a whole number`, marks > 0, `Marks column shows "${marksTxt || '(empty)'}". Enter one whole number, e.g. 10.`);

        const paras = qC.paras;
        const partRe = /^\(([a-z])\)\s*(.+)$/i;
        const firstPart = paras.findIndex(p => partRe.test(p));
        const stem = (firstPart < 0 ? paras : paras.slice(0, firstPart)).join(' ');
        add(Q, `${tag}: has a scenario / question stem`, !isBlank(stem) && stem.length >= 20,
          'The question text is empty or too short. Write the scenario/instruction before the parts (a), (b)…');
        const parts = [];
        const badParts = [];
        paras.forEach(p => {
          const m = p.match(partRe);
          if (!m) return;
          const mk = m[2].match(/\((\d+)\s*marks?\)\s*[.;]?\s*$/i);
          if (mk) parts.push({ letter: m[1].toLowerCase(), marks: +mk[1] }); else badParts.push(`(${m[1]})`);
        });
        if (add(Q, `${tag}: has lettered parts (a), (b)…`, parts.length + badParts.length >= 1,
          'No parts found. List the tasks as separate lines starting with (a), (b), (c)…')) {
          add(Q, `${tag}: every part ends with its marks, e.g. "(2 marks)"`, badParts.length === 0,
            `Part ${badParts.join(', ')} does not end with "(N marks)".`);
          const letters = parts.map(p => p.letter).join('');
          add(Q, `${tag}: parts are lettered in order from (a)`, 'abcdefghijklmnopqrstuvwxyz'.startsWith(letters) || badParts.length > 0,
            `Parts are lettered (${parts.map(p => p.letter).join('), (')}) — they must run (a), (b), (c)… without gaps.`);
          const sum = parts.reduce((s, p) => s + p.marks, 0);
          if (marks > 0 && badParts.length === 0) add(Q, `${tag}: part marks add up to the Marks column`, sum === marks,
            `Parts add up to ${sum} marks (${parts.map(p => p.marks).join(' + ')}) but the Marks column says ${marks}.`);
        }
        add(Q, `${tag}: has a "Screenshots:" evidence line`, paras.some(p => /^screenshots?\s*:/i.test(p) && p.length > 15),
          'Add the final line "Screenshots: …" stating what evidence candidates must paste.');
        data.questions.push({ number: i, marks: marks || 0, parts: parts.length });
      }
      data.totalMarks = data.questions.reduce((s, q) => s + q.marks, 0);
    }

    return result();
  }

  const api = { validateDocx, TEMPLATE, parseDate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CATValidator = api;
})(typeof self !== 'undefined' ? self : this);
