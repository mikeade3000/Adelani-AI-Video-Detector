/**
 * ESAMI Live Poll — Google Apps Script backend
 * ------------------------------------------------------------
 * Stores participant responses in the Google Sheet this script
 * is attached to, and returns them to the presenter page.
 *
 * Setup (5 minutes, free):
 *  1. Create a new Google Sheet (e.g. "ESAMI AI Grading Poll").
 *  2. Extensions -> Apps Script. Delete the sample code, paste this file, Save.
 *  3. Deploy -> New deployment -> type "Web app".
 *       Execute as:      Me
 *       Who has access:  Anyone
 *  4. Authorise, then copy the Web app URL (ends in /exec).
 *  5. Open the poll page, click "Settings", paste the URL.
 *
 * Every participant device sends one response per session; if they
 * resubmit, their earlier row is updated (no double counting).
 */

var SHEET_NAME = 'Responses';
var HEADERS = ['timestamp', 'session', 'clientId', 'role', 'q1', 'q2', 'q3', 'q4'];
var ALLOWED = {
  role: ['lecturer', 'leader', 'admin', 'student', 'other', ''],
  q1: ['a', 'b', 'c', 'd', ''],
  q2: ['a', 'b', 'c', 'd', ''],
  q3: ['a', 'b', 'c', 'd', '']
};

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Keep spreadsheet safe from formula injection and over-long input.
function clean_(v, max) {
  v = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  return v;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var d = JSON.parse(e.postData.contents || '{}');
    var session = clean_(d.session, 40);
    var clientId = clean_(d.clientId, 64);
    if (!session || !clientId) return json_({ ok: false, error: 'missing session or clientId' });

    var rec = { role: clean_(d.role, 20), q1: clean_(d.q1, 2), q2: clean_(d.q2, 2), q3: clean_(d.q3, 2) };
    for (var k in ALLOWED) {
      if (ALLOWED[k].indexOf(rec[k]) < 0) return json_({ ok: false, error: 'invalid ' + k });
    }
    rec.q4 = clean_(d.q4, 40);

    var row = [new Date(), session, clientId, rec.role, rec.q1, rec.q2, rec.q3, rec.q4];
    var sh = sheet_();
    var values = sh.getDataRange().getValues();
    for (var i = values.length - 1; i >= 1; i--) {
      if (values[i][1] === session && values[i][2] === clientId) {
        sh.getRange(i + 1, 1, 1, HEADERS.length).setValues([row]);
        return json_({ ok: true, updated: true });
      }
    }
    sh.appendRow(row);
    return json_({ ok: true, updated: false });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'ping') return json_({ ok: true, pong: true });
  var session = clean_(p.session, 40);
  var values = sheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (session && r[1] !== session) continue;
    out.push({
      t: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      session: r[1], id: r[2], role: r[3], q1: r[4], q2: r[5], q3: r[6],
      q4: String(r[7]).replace(/^'/, '')
    });
  }
  return json_({ ok: true, responses: out });
}
