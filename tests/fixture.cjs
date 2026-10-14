// Builds a synthetic CAT submission .docx that matches the official template,
// so tests never need a real (confidential) exam paper.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function zipStored(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const nm = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(offset, 42);
    local.push(lh, nm, data);
    central.push(ch, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  const out = Buffer.concat([...local, cd, end]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = t => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
const cell = lines => `<w:tc><w:tcPr/>${[].concat(lines).map(p).join('')}</w:tc>`;
const tbl = (grid, rows) =>
  `<w:tbl><w:tblPr/><w:tblGrid>${grid.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
  rows.map(r => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('') + '</w:tbl>';

function defaults() {
  return {
    details: [
      ['Programme', 'BACHELOR OF SCIENCE IN COMPUTER SCIENCE'],
      ['Course Code', 'CSC 2105'],
      ['Course Title', 'DATA STRUCTURES'],
      ['Academic Year', '2026/2027'],
      ['Level', 'YEAR TWO'],
      ['Semester', 'ONE'],
      ['Lecturer (Full Name)', 'DR. JANE AKELLO'],
      ['School', 'SCHOOL OF MATHEMATICS AND COMPUTING (SOMAC)'],
      ['Department', 'COMPUTER SCIENCE'],
      ['Date of Submission', '01-10-2026']
    ],
    setup: [
      ['CAT Setup', "Lecturer's instructions"],
      ['Topic', 'LINKED LISTS'],
      ['Number of questions to appear on the paper', '3'],
      ['Number of questions to attempt', '2'],
      ['Compulsory question (Question 1)?  [Yes / No]', 'No']
    ],
    questions: [1, 2, 3, 4, 5].map(n => [String(n), [
      `Scenario ${n}: implement and test a singly linked list on your own laptop and paste screenshots.`,
      '(a) Implement insertion at the head. (3 marks)',
      '(b) Implement deletion of a node. (3 marks)',
      '(c) Explain the time complexity of each operation. (4 marks)',
      'Screenshots: the code, the test run and the output.'
    ], '10']),
    topicHeading: 'C.  QUESTIONS (topic: Linked lists)',
    footer: 'Form code: CAT-GEN-v 1 · system-read field — do not edit',
    pgSz: '<w:pgSz w:w="11906" w:h="16838"/>',
    extraBody: ''
  };
}

function buildDocx(over = {}) {
  const o = Object.assign(defaults(), over);
  const body = [
    p('KAMPALA INTERNATIONAL UNIVERSITY'),
    p('Continuous Assessment Test (CAT)'),
    p('CAT Question Submission Form'),
    p('Instructions: This is a practical, laptop-based CAT. Candidates must use only their own devices, their own files or sample data provided by the lecturer, and must handle all data lawfully and ethically. Complete the CAT Setup, and provide five (5) questions for the single topic. Do not delete or renumber the rows the system reads this form automatically on upload.'),
    p('A.  COURSE & SUBMISSION DETAILS'),
    tbl([2900, 6126], o.details),
    p('B.  CAT SETUP'),
    tbl([3400, 5626], o.setup),
    p('Note: Candidates work on their own laptops and paste labelled screenshots of each completed step as evidence, documenting their process as they would in a real investigation. “Number to attempt” must not exceed “number to appear”.'),
    p(o.topicHeading),
    tbl([760, 6766, 1500], [['#', 'Question', 'Marks'], ...o.questions]),
    o.extraBody,
    `<w:sectPr>${o.pgSz}<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`
  ].join('');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return zipStored({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    'word/footer1.xml': `<?xml version="1.0"?><w:ftr ${W}>${o.footer ? p(o.footer) : ''}</w:ftr>`
  });
}

module.exports = { buildDocx, defaults };
