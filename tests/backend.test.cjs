// Runs backend/Code.gs + cat/validator.js against in-memory fakes of the
// Google Apps Script services. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { buildDocx, defaults } = require('./fixture.cjs');

function unzipSync(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Invalid argument: blob');
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out.push(blob(method ? zlib.inflateRawSync(raw) : raw, '', name));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}
function blob(bytes, mime, name) {
  const b = Buffer.from(bytes);
  const o = {
    bytes: b, getName: () => name, getDataAsString: () => b.toString('utf8'),
    getBytes: () => [...b], getContentType: () => mime, setName: n => { name = n; return o; }
  };
  return o;
}
const driveFiles = {};

function fakeSheet() {
  const rows = [];
  const sheet = {
    rows,
    getLastRow: () => rows.length,
    getMaxRows: () => 1000,
    setFrozenRows() {},
    appendRow: r => rows.push(r.slice()),
    getDataRange: () => sheet.getRange(1, 1, rows.length, Math.max(1, ...rows.map(r => r.length))),
    getRange: (r, c, nr = 1, nc = 1) => ({
      getDisplayValues: () => Array.from({ length: nr }, (_, i) =>
        Array.from({ length: nc }, (_, j) => String((rows[r - 1 + i] || [])[c - 1 + j] ?? ''))),
      setValues(v) { v.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((x, j) => (rows[r - 1 + i][c - 1 + j] = x)); }); return this; },
      setNumberFormat() { return this; },
      setFontWeight() { return this; }
    })
  };
  return sheet;
}

function fakeFolder(name) {
  const f = {
    name, files: [], subs: {},
    getId: () => 'folder-' + name, getUrl: () => 'https://drive/' + name,
    createFolder: n => (f.subs[n] = fakeFolder(n)),
    getFoldersByName: n => { const has = !!f.subs[n]; return { hasNext: () => has, next: () => f.subs[n] }; },
    createFile: b => {
      const id = 'id' + Object.keys(driveFiles).length;
      const file = {
        name: b.getName(), setDescription() {}, getId: () => id, getName: () => b.getName(),
        getUrl: () => 'https://drive/file/' + id, getBlob: () => blob(b.bytes, 'application/docx', b.getName()),
        getParents: () => { let done = false; return { hasNext: () => !done, next: () => { done = true; return f; } }; }
      };
      driveFiles[id] = file;
      f.files.push(file);
      return file;
    }
  };
  return f;
}

function makeBackend() {
  const props = { ADMIN_PASSWORD: 'Secret-Pass-2026' };
  const cache = {};
  const root = fakeFolder('root');
  const sheets = {};
  const ss = {
    getId: () => 'ss', getUrl: () => 'https://sheets/ss', getSheets: () => Object.values(sheets),
    getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = fakeSheet()), deleteSheet() {}
  };
  const ctx = {
    console,
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => (props[k] = v) }) },
    DriveApp: {
      createFolder: () => root, getFolderById: () => root,
      getFileById: id => { if (id === 'ss') return { moveTo() {}, getParents: () => { let done = false; return { hasNext: () => !done, next: () => { done = true; return root; } }; } }; if (!driveFiles[id]) throw new Error('no file'); return driveFiles[id]; }
    },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => (cache[k] = v), remove: k => delete cache[k] }) },
    SpreadsheetApp: { create: () => ss, openById: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
    Utilities: {
      base64Decode: s => { if (/[^A-Za-z0-9+/=]/.test(s)) throw new Error('bad base64'); return [...Buffer.from(s, 'base64')]; },
      newBlob: blob,
      unzip: b => unzipSync(b.bytes),
      formatDate: (d, tz, fmt) => fmt === 'yyyy-MM-dd' ? '2026-10-14' : '2026-10-14 12:00:00',
      getUuid: () => 'tok-' + Math.random(),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => [...require('crypto').createHash('sha256').update(s, 'utf8').digest()],
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      zip: (blobs, name) => blob(Buffer.from(blobs.map(b => b.getName()).join('\n')), 'application/zip', name)
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../cat/validator.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../backend/Code.gs'), 'utf8'), ctx);
  ctx.setup();
  return { ctx, root, sheets };
}

const post = (ctx, body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
const exam = { examDate: '2026-11-20', startTime: '09:00', endTime: '11:00', venue: 'Lab 2' };
const upload = (over, extra) => Object.assign({ fileName: 'CAT.docx', fileBase64: Buffer.from(buildDocx(over)).toString('base64') }, exam, extra);

test('Validator.gs is an exact copy of cat/validator.js', () => {
  assert.strictEqual(
    fs.readFileSync(path.join(__dirname, '../backend/Validator.gs'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../cat/validator.js'), 'utf8'));
});

test('accepted upload is stored in Drive, registered and published', () => {
  const { ctx, root, sheets } = makeBackend();
  const r = post(ctx, upload());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.accepted, true, JSON.stringify(r.checks.filter(c => !c.ok)));
  assert.strictEqual(root.subs.Accepted.files.length, 1);
  assert.match(root.subs.Accepted.files[0].name, /^CSC 2105 - DR\. JANE AKELLO - .*\.docx$/);
  assert.strictEqual(sheets['Submissions Log'].rows[1][1], 'ACCEPTED');
  assert.strictEqual(sheets.Schedule.rows.length, 2);
  const g = ctx.doGet();
  assert.strictEqual(g.schedule.length, 1);
  assert.strictEqual(g.schedule[0].lecturer, 'DR. JANE AKELLO');
  assert.strictEqual(g.schedule[0].examDate, '2026-11-20');
  assert.ok(!JSON.stringify(g).includes('drive/'), 'file links must not be public');

  // A resubmission for the same course replaces the schedule row but keeps both files.
  assert.strictEqual(post(ctx, upload({}, { startTime: '14:00', endTime: '16:00' })).accepted, true);
  assert.strictEqual(sheets.Schedule.rows.length, 2);
  assert.strictEqual(ctx.doGet().schedule[0].startTime, '14:00');
  assert.strictEqual(root.subs.Accepted.files.length, 2);
});

test('server re-checks: a non-conforming upload is rejected and kept in Rejected', () => {
  const { ctx, root, sheets } = makeBackend();
  const d = defaults();
  d.details[6][1] = '';
  const r = post(ctx, upload({ details: d.details }));
  assert.strictEqual(r.accepted, false);
  assert.ok(r.checks.some(c => !c.ok && /Lecturer/.test(c.label)));
  assert.strictEqual(root.subs.Rejected.files.length, 1);
  assert.strictEqual(sheets['Submissions Log'].rows[1][1], 'REJECTED');
  assert.strictEqual(sheets.Schedule.rows.length, 1);
});

test('server re-checks exam timing', () => {
  const { ctx } = makeBackend();
  assert.strictEqual(post(ctx, upload({}, { examDate: '2026-01-05' })).accepted, false);
  assert.strictEqual(post(ctx, upload({}, { endTime: '08:00' })).accepted, false);
});

test('garbage and bad requests are handled', () => {
  const { ctx } = makeBackend();
  assert.strictEqual(ctx.doPost({ postData: { contents: 'not json' } }).ok, false);
  assert.strictEqual(post(ctx, { fileName: 'x.docx', fileBase64: '' }).ok, false);
  const r = post(ctx, { fileName: 'x.docx', fileBase64: Buffer.from('hello').toString('base64'), ...exam });
  assert.strictEqual(r.accepted, false);
  assert.ok(r.checks.some(c => /valid Word document/.test(c.label) && !c.ok));
});

test('formula-like values are neutralised in the sheet', () => {
  const { ctx, sheets } = makeBackend();
  post(ctx, upload({}, { venue: '=IMPORTXML("x")' }));
  assert.strictEqual(sheets.Schedule.rows[1][18], "'=IMPORTXML(\"x\")");
});

test('administrator: password sign-in, list and download accepted files', () => {
  const { ctx, root } = makeBackend();
  post(ctx, upload());
  post(ctx, upload({}, { startTime: '14:00', endTime: '16:00' }));
  const d = defaults();
  d.details[6][1] = '';
  post(ctx, upload({ details: d.details }));         // rejected: must never be listed

  assert.strictEqual(post(ctx, { action: 'list' }).signedOut, true);
  assert.strictEqual(post(ctx, { action: 'list', token: 'forged' }).signedOut, true);
  assert.strictEqual(post(ctx, { action: 'login', password: 'wrong' }).ok, false);

  const login = post(ctx, { action: 'login', password: 'Secret-Pass-2026' });
  assert.strictEqual(login.ok, true);
  const list = post(ctx, { action: 'list', token: login.token });
  assert.strictEqual(list.submissions.length, 2);
  assert.strictEqual(list.submissions[0].startTime, '14:00');      // newest first
  assert.deepStrictEqual(list.submissions.map(s => s.current), [true, false]);

  const file = post(ctx, { action: 'download', token: login.token, fileId: list.submissions[0].fileId });
  assert.strictEqual(file.ok, true);
  assert.match(file.fileName, /^CSC 2105 - DR\. JANE AKELLO/);
  const bytes = Buffer.from(file.base64, 'base64');
  assert.strictEqual(bytes.readUInt32LE(0), 0x04034b50);               // the original .docx (ZIP)

  const rejectedId = root.subs.Rejected.files[0].getId();
  assert.strictEqual(post(ctx, { action: 'download', token: login.token, fileId: rejectedId }).ok, false);
  assert.strictEqual(post(ctx, { action: 'download', token: login.token, fileId: 'ss' }).ok, false);

  const all = post(ctx, { action: 'downloadAll', token: login.token });
  assert.strictEqual(all.ok, true);
  assert.match(all.fileName, /\.zip$/);
  assert.strictEqual(Buffer.from(all.base64, 'base64').toString().split('\n').length, 2);
});

test('administrator: sign-in locks after repeated wrong passwords', () => {
  const { ctx } = makeBackend();
  for (let i = 0; i < 5; i++) assert.match(post(ctx, { action: 'login', password: 'nope' }).error, /Wrong password/);
  const r = post(ctx, { action: 'login', password: 'Secret-Pass-2026' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /locked/);
});
