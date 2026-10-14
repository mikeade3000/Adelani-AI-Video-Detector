/**
 * KIU CAT Submission Portal — Google Apps Script backend.
 *
 * Receives uploads from the portal, re-runs the template autocheck on the
 * server, stores every uploaded .docx in your Google Drive and records it in
 * a Google Sheet. Also serves the public CAT schedule to the portal.
 *
 * Files (this project needs both):
 *   Code.gs       — this file
 *   Validator.gs  — an exact copy of cat/validator.js
 *
 * Setup: see backend/README.md. Run setup() once, then Deploy → Web app
 * (Execute as: Me, Who has access: Anyone).
 */

const CONFIG = {
  FOLDER_NAME: 'KIU CAT Submissions',
  SPREADSHEET_NAME: 'KIU CAT Submissions Register',
  TIMEZONE: 'Africa/Kampala',
  MAX_BYTES: 10 * 1024 * 1024
};

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const SCHEDULE_HEADERS = [
  'ID', 'Lecturer', 'Course Code', 'Course Title', 'Programme', 'Level', 'Semester', 'Academic Year',
  'School', 'Department', 'Topic', 'Questions to Appear', 'Questions to Attempt', 'Q1 Compulsory',
  'Total Marks', 'Exam Date', 'Start Time', 'End Time', 'Venue', 'Date of Submission (form)',
  'Accepted At', 'Original File Name', 'File Link'
];
const LOG_HEADERS = [
  'Received At', 'Result', 'Original File Name', 'Lecturer', 'Course Code', 'Course Title',
  'Exam Date', 'Start Time', 'End Time', 'Problems Found', 'File Link'
];

// Fields published to the portal (no file links, no question content).
const PUBLIC_FIELDS = {
  id: 'ID', lecturer: 'Lecturer', courseCode: 'Course Code', courseTitle: 'Course Title',
  programme: 'Programme', level: 'Level', semester: 'Semester', academicYear: 'Academic Year',
  department: 'Department', examDate: 'Exam Date', startTime: 'Start Time', endTime: 'End Time',
  venue: 'Venue'
};

// ---------------------------------------------------------------------------
// One-time setup: run this from the editor (Run → setup) before deploying.
// ---------------------------------------------------------------------------
function setup() {
  const props = PropertiesService.getScriptProperties();
  let folder = props.getProperty('FOLDER_ID') && tryGet_(() => DriveApp.getFolderById(props.getProperty('FOLDER_ID')));
  if (!folder) {
    folder = DriveApp.createFolder(CONFIG.FOLDER_NAME);
    props.setProperty('FOLDER_ID', folder.getId());
  }
  ['Accepted', 'Rejected'].forEach(name => subfolder_(folder, name));

  let ss = props.getProperty('SHEET_ID') && tryGet_(() => SpreadsheetApp.openById(props.getProperty('SHEET_ID')));
  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.SPREADSHEET_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    props.setProperty('SHEET_ID', ss.getId());
  }
  prepareSheet_(ss, 'Schedule', SCHEDULE_HEADERS);
  prepareSheet_(ss, 'Submissions Log', LOG_HEADERS);
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  Logger.log('Drive folder: ' + folder.getUrl());
  Logger.log('Register sheet: ' + ss.getUrl());
}

// ---------------------------------------------------------------------------
// GET  → public schedule for the portal.
// ---------------------------------------------------------------------------
function doGet() {
  const sheet = sheet_('Schedule');
  const values = sheet.getDataRange().getDisplayValues();
  const head = values.shift() || [];
  const col = {};
  head.forEach((h, i) => (col[h] = i));
  const schedule = values.filter(r => r[col.ID]).map(r => {
    const o = {};
    Object.keys(PUBLIC_FIELDS).forEach(k => (o[k] = r[col[PUBLIC_FIELDS[k]]]));
    return o;
  });
  return json_({ ok: true, schedule: schedule });
}

// ---------------------------------------------------------------------------
// POST → { fileName, fileBase64, examDate, startTime, endTime, venue }
// ---------------------------------------------------------------------------
function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Invalid request.' });
  }
  const fileName = String(req.fileName || '').slice(0, 200);
  const exam = {
    examDate: String(req.examDate || '').slice(0, 10),
    startTime: String(req.startTime || '').slice(0, 5),
    endTime: String(req.endTime || '').slice(0, 5)
  };
  const venue = String(req.venue || '').trim().slice(0, 80);

  let bytes;
  try {
    bytes = Utilities.base64Decode(String(req.fileBase64 || ''));
  } catch (err) {
    return json_({ ok: false, error: 'The file could not be received. Please try again.' });
  }
  if (!bytes.length || bytes.length > CONFIG.MAX_BYTES) {
    return json_({ ok: false, error: 'The file is empty or larger than 10 MB.' });
  }

  // Re-run the full autocheck on the server — the browser result is not trusted.
  const result = CATValidator.validatePackage(unzip_(bytes), fileName, bytes.length);
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  result.checks = result.checks.concat(CATValidator.timingChecks(result.data, exam, today));
  const accepted = result.checks.every(c => c.ok);
  const errors = result.checks.filter(c => !c.ok);
  const d = result.data;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    const root = DriveApp.getFolderById(prop_('FOLDER_ID'));
    const label = [d.courseCode || 'UNKNOWN', d.lecturer || 'Unknown lecturer', stamp.replace(/:/g, '')].join(' - ');
    const file = subfolder_(root, accepted ? 'Accepted' : 'Rejected')
      .createFile(Utilities.newBlob(bytes, DOCX_MIME, safeName_(label) + '.docx'));
    file.setDescription('Uploaded as "' + fileName + '" on ' + stamp);

    sheet_('Submissions Log').appendRow(cells_([
      stamp, accepted ? 'ACCEPTED' : 'REJECTED', fileName, d.lecturer, d.courseCode, d.courseTitle,
      exam.examDate, exam.startTime, exam.endTime,
      errors.map(c => c.label + ' — ' + c.detail).join('\n'), file.getUrl()
    ]));

    let entry = null;
    if (accepted) {
      entry = {
        id: [d.courseCode, d.academicYear, d.semester].join('|').toUpperCase().replace(/\s+/g, ''),
        lecturer: d.lecturer, courseCode: d.courseCode.toUpperCase(), courseTitle: d.courseTitle,
        programme: d.programme, level: d.level, semester: d.semester, academicYear: d.academicYear,
        department: d.department, examDate: exam.examDate, startTime: exam.startTime,
        endTime: exam.endTime, venue: venue
      };
      upsertSchedule_(entry, [
        entry.id, d.lecturer, entry.courseCode, d.courseTitle, d.programme, d.level, d.semester,
        d.academicYear, d.school, d.department, d.topic, d.appear, d.attempt, d.compulsory,
        d.totalMarks, exam.examDate, exam.startTime, exam.endTime, venue, d.submissionDate,
        stamp, fileName, file.getUrl()
      ]);
    }
    return json_({ ok: true, accepted: accepted, checks: result.checks, entry: entry });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function unzip_(bytes) {
  try {
    const entries = Utilities.unzip(Utilities.newBlob(bytes, 'application/zip', 'upload.zip'));
    const names = entries.map(b => b.getName());
    const files = {};
    entries.forEach(b => {
      const n = b.getName();
      if (n === 'word/document.xml' || n === '[Content_Types].xml' || /^word\/footer\d*\.xml$/.test(n)) {
        files[n] = b.getDataAsString('UTF-8');
      }
    });
    return { names: names, files: files };
  } catch (err) {
    return { error: 'not a valid .docx (ZIP) file' };
  }
}

function upsertSchedule_(entry, row) {
  const sheet = sheet_('Schedule');
  const ids = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getDisplayValues().map(r => r[0]);
  const idx = ids.indexOf(entry.id); // a resubmission replaces the earlier row
  const r = idx > 0 ? idx + 1 : sheet.getLastRow() + 1;
  const range = sheet.getRange(r, 1, 1, row.length);
  range.setNumberFormat('@');
  range.setValues([cells_(row)]);
}

// Text cells only; neutralise anything Sheets would treat as a formula.
function cells_(row) {
  return row.map(v => {
    const s = v === undefined || v === null ? '' : String(v);
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  });
}

function prepareSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
  sheet.setFrozenRows(1);
  return sheet;
}

function sheet_(name) {
  return SpreadsheetApp.openById(prop_('SHEET_ID')).getSheetByName(name);
}

function subfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function prop_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Backend not set up yet — run setup() in the Apps Script editor.');
  return v;
}

function safeName_(s) {
  return String(s).replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
}

function tryGet_(fn) {
  try { return fn(); } catch (err) { return null; }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
