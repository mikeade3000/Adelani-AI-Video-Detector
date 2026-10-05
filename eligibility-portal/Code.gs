/**
 * Y2027 PROMOTION ELIGIBILITY LIST — GOOGLE SHEETS BACKEND (v2, with accounts)
 * ------------------------------------------------------------------------
 * Deploy as a Web App (Extensions > Apps Script, inside a Google Sheet).
 * See SETUP_INSTRUCTIONS.md for the full walkthrough.
 *
 * Sheets created automatically on first run:
 *   - "Submissions"  -> accepted records (one row per officer)
 *   - "Users"        -> login accounts, created by the super admin
 *   - "Sessions"     -> active login sessions (auto-expire after 8 hours)
 *   - "AdminConfig"  -> one-time bootstrap password/email for the first admin
 */

const SUBMISSIONS_SHEET = 'Submissions';
const USERS_SHEET = 'Users';
const SESSIONS_SHEET = 'Sessions';
const ADMIN_SHEET = 'AdminConfig';
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000; // 8 hours
const RESET_LIFETIME_MS = 60 * 60 * 1000;       // 1 hour

// Keep in sync with FIELDS in index.html (order matters).
const RECORD_COLUMNS = [
  'id','timestamp','submitted_by','mda','surname_first','csc_file_no','oracle_no',
  'post_1st_appt','grade_1st','date_1st_appt','date_confirmation','present_post',
  'grade_present','date_present_appt','promotion_post','grade_promotion',
  'proposed_notional_date','proposed_financial_date','official_email','mobile_no',
  'disability','remarks'
];
const USER_COLUMNS = ['id','email','passwordHash','salt','name','mda','role','createdAt','resetToken','resetTokenExpiry'];
const SESSION_COLUMNS = ['token','email','role','name','mda','expiry'];

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut({ success: false, message: 'Invalid request body.' }); }

  try {
    switch (body.action) {
      case 'ping': return jsonOut({ success: true, message: 'pong' });
      case 'getAnalytics': return handleGetAnalytics(body);
      case 'getMdaDownloadToken': return handleGetMdaDownloadToken(body);
      case 'mdaDownload': return handleMdaDownload(body);
      case 'login': return handleLogin(body);
      case 'logout': return handleLogout(body);
      case 'requestPasswordReset': return handleRequestPasswordReset(body);
      case 'resetPassword': return handleResetPassword(body);
      case 'changePassword': return handleChangePassword(body);
      case 'submitRecords': return handleSubmit(body);
      case 'getAllRecords': return handleGetAll(body);
      case 'adminCreateUser': return handleAdminCreateUser(body);
      case 'adminListUsers': return handleAdminListUsers(body);
      case 'adminDeleteUser': return handleAdminDeleteUser(body);
      case 'adminUpdateRecord': return handleAdminUpdateRecord(body);
      case 'adminDeleteRecord': return handleAdminDeleteRecord(body);
      case 'submitBrief': return handleSubmitBrief(body);
      case 'listBriefs': return handleListBriefs(body);
      case 'updateBrief': return handleUpdateBrief(body);
      case 'authorizeBrief': return handleAuthorizeBrief(body);
      default: return jsonOut({ success: false, message: 'Unknown action: ' + body.action });
    }
  } catch (err) {
    return jsonOut({ success: false, message: 'Server error: ' + err.message });
  }
}

function doGet(e) {
  return jsonOut({ success: true, message: 'Y2027 Eligibility List backend is running.' });
}

/* ========================================================================
   AUTH HELPERS
   ======================================================================== */
function hashPassword(password, salt) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + ':' + salt);
  return raw.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
function randomPassword(len) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
function getSession(token) {
  if (!token) return null;
  const sheet = getOrCreateSessionsSheet();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === token) {
      const expiry = new Date(values[i][5]);
      if (expiry < new Date()) { sheet.deleteRow(i + 1); return null; }
      return { token, email: values[i][1], role: values[i][2], name: values[i][3], mda: values[i][4] };
    }
  }
  return null;
}
// The bootstrap email from AdminConfig!B2 identifies the super administrator.
// Cached per execution to avoid re-reading the sheet repeatedly.
var _superAdminEmailCache = null;
function getBootstrapAdminEmail() {
  if (_superAdminEmailCache !== null) return _superAdminEmailCache;
  try {
    const cfg = getOrCreateAdminConfigSheet();
    _superAdminEmailCache = String(cfg.getRange('B2').getValue() || 'admin@portal.local').trim().toLowerCase();
  } catch (e) {
    _superAdminEmailCache = 'admin@portal.local';
  }
  return _superAdminEmailCache;
}
function isSuperAdmin(row) {
  // A row is the super administrator if EITHER its role is 'superadmin'
  // OR its email matches the bootstrap email in AdminConfig!B2. The email
  // check makes existing deployments (whose bootstrap row may still carry
  // role 'admin') behave correctly without needing a sheet rebuild.
  // row: Users-sheet row array — email at index 1, role at index 6.
  const role = String(row[6]).toLowerCase();
  const email = String(row[1]).trim().toLowerCase();
  return role === 'superadmin' || email === getBootstrapAdminEmail();
}
function isSuperAdminEmail(email) {
  return String(email || '').trim().toLowerCase() === getBootstrapAdminEmail();
}
function requireAdmin(token) {
  const s = getSession(token);
  if (!s) throw new Error('Session expired or invalid — please sign in again.');
  if (s.role !== 'admin' && s.role !== 'superadmin') throw new Error('This action requires an administrator account.');
  return s;
}
function requireUser(token) {
  const s = getSession(token);
  if (!s) throw new Error('Session expired or invalid — please sign in again.');
  return s;
}

/* ========================================================================
   LOGIN / SESSIONS / PASSWORD RESET
   ======================================================================== */
function handleLogin(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return jsonOut({ success: false, message: 'Email and password are required.' });

  const usersSheet = getOrCreateUsersSheet();
  const values = usersSheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).toLowerCase() === email) {
      const [id, , passwordHash, salt, name, mda, role] = values[i];
      if (hashPassword(password, salt) !== passwordHash) {
        return jsonOut({ success: false, message: 'Incorrect email or password.' });
      }
      const token = createSession(email, role, name, mda);
      return jsonOut({ success: true, token, user: { email, name, mda, role } });
    }
  }
  return jsonOut({ success: false, message: 'Incorrect email or password.' });
}

function createSession(email, role, name, mda) {
  const sheet = getOrCreateSessionsSheet();
  const token = Utilities.getUuid();
  const expiry = new Date(Date.now() + SESSION_LIFETIME_MS);
  sheet.appendRow([token, email, role, name, mda, expiry]);
  return token;
}

function handleLogout(body) {
  const sheet = getOrCreateSessionsSheet();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === body.token) { sheet.deleteRow(i + 1); break; }
  }
  return jsonOut({ success: true });
}

function handleRequestPasswordReset(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const usersSheet = getOrCreateUsersSheet();
  const values = usersSheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).toLowerCase() === email) {
      const token = Utilities.getUuid();
      const expiry = new Date(Date.now() + RESET_LIFETIME_MS);
      usersSheet.getRange(i + 1, 9, 1, 2).setValues([[token, expiry]]); // resetToken, resetTokenExpiry
      sendResetEmail(email, token);
      break;
    }
  }
  // Always return success (don't reveal whether the email exists)
  return jsonOut({ success: true, message: 'If that email is registered, a reset link has been sent.' });
}

function sendResetEmail(email, token) {
  const portalUrl = getPortalUrl();
  const link = portalUrl ? `${portalUrl}?reset=${token}&email=${encodeURIComponent(email)}` : null;
  const body = link
    ? `A password reset was requested for the Y2027 Eligibility List Portal.\n\nClick to reset your password:\n${link}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`
    : `A password reset was requested for the Y2027 Eligibility List Portal.\n\nYour reset code is: ${token}\n\nOpen the portal, go to "Forgot Password" > "I have a code", and enter this code with your new password. This code expires in 1 hour.`;
  try {
    MailApp.sendEmail(email, 'Y2027 Eligibility Portal — Password Reset', body);
  } catch (err) {
    // Email quota or permission issue — token is still stored, admin can relay it manually if needed.
  }
}

function handleResetPassword(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const token = String(body.token || '').trim();
  const newPassword = String(body.newPassword || '');
  if (!email || !token || newPassword.length < 6) {
    return jsonOut({ success: false, message: 'Email, code, and a password of at least 6 characters are required.' });
  }
  const usersSheet = getOrCreateUsersSheet();
  const values = usersSheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).toLowerCase() === email) {
      const storedToken = values[i][8], expiry = values[i][9];
      if (!storedToken || storedToken !== token) return jsonOut({ success: false, message: 'Invalid or already-used reset code.' });
      if (new Date(expiry) < new Date()) return jsonOut({ success: false, message: 'This reset code has expired — request a new one.' });
      const salt = Utilities.getUuid();
      const hash = hashPassword(newPassword, salt);
      usersSheet.getRange(i + 1, 3, 1, 2).setValues([[hash, salt]]); // passwordHash, salt
      usersSheet.getRange(i + 1, 9, 1, 2).setValues([['', '']]);     // clear resetToken/expiry
      return jsonOut({ success: true, message: 'Password updated — you can now sign in.' });
    }
  }
  return jsonOut({ success: false, message: 'No account found for that email.' });
}

function handleChangePassword(body) {
  const session = requireUser(body.token);
  const oldPassword = String(body.oldPassword || '');
  const newPassword = String(body.newPassword || '');
  if (newPassword.length < 6) return jsonOut({ success: false, message: 'New password must be at least 6 characters.' });
  const usersSheet = getOrCreateUsersSheet();
  const values = usersSheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).toLowerCase() === session.email.toLowerCase()) {
      const [, , passwordHash, salt] = values[i];
      if (hashPassword(oldPassword, salt) !== passwordHash) return jsonOut({ success: false, message: 'Current password is incorrect.' });
      const newSalt = Utilities.getUuid();
      usersSheet.getRange(i + 1, 3, 1, 2).setValues([[hashPassword(newPassword, newSalt), newSalt]]);
      return jsonOut({ success: true, message: 'Password changed.' });
    }
  }
  return jsonOut({ success: false, message: 'Account not found.' });
}

/* ========================================================================
   ADMIN — USER MANAGEMENT
   ======================================================================== */
function handleAdminCreateUser(body) {
  requireAdmin(body.token);
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const mda = String(body.mda || '').trim();
  const role = body.role === 'admin' ? 'admin' : 'user';
  if (!email || !name || !mda) return jsonOut({ success: false, message: 'Name, email, and MDA are required.' });

  const usersSheet = getOrCreateUsersSheet();
  const values = usersSheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).toLowerCase() === email) {
      // Never confirm a super-admin's existence via the "already exists" path —
      // return the same generic error other collisions would, but do not create.
      if (isSuperAdmin(values[i])) return jsonOut({ success: false, message: 'That email cannot be used. Please choose another.' });
      return jsonOut({ success: false, message: 'An account with that email already exists.' });
    }
  }
  const tempPassword = randomPassword(10);
  const salt = Utilities.getUuid();
  const hash = hashPassword(tempPassword, salt);
  usersSheet.appendRow([Utilities.getUuid(), email, hash, salt, name, mda, role, new Date(), '', '']);

  try {
    MailApp.sendEmail(email, 'Y2027 Eligibility Portal — Your Account',
      `An account has been created for you on the Y2027 Eligibility List Portal.\n\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nSign in and change your password from the Account panel, or use "Forgot Password" any time.`);
  } catch (err) { /* email may fail silently; admin still sees the password below */ }

  return jsonOut({ success: true, tempPassword, message: 'Account created and emailed to the user.' });
}

function handleAdminListUsers(body) {
  requireAdmin(body.token);
  const usersSheet = getOrCreateUsersSheet();
  const values = usersSheet.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < values.length; i++) {
    if (isSuperAdmin(values[i])) continue; // super-admin is never listed
    const [id, email, , , name, mda, role, createdAt] = values[i];
    users.push({ id, email, name, mda, role, createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt });
  }
  return jsonOut({ success: true, users });
}

function handleAdminDeleteUser(body) {
  requireAdmin(body.token);
  const email = String(body.email || '').trim().toLowerCase();
  const usersSheet = getOrCreateUsersSheet();
  const values = usersSheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).toLowerCase() === email) {
      if (isSuperAdmin(values[i])) return jsonOut({ success: false, message: 'Account not found.' }); // never reveal/allow deletion of super-admin
      usersSheet.deleteRow(i + 1);
      return jsonOut({ success: true });
    }
  }
  return jsonOut({ success: false, message: 'Account not found.' });
}

/* ========================================================================
   RECORDS
   ======================================================================== */
function handleSubmit(body) {
  const session = requireUser(body.token);
  const records = body.records;
  if (!Array.isArray(records) || !records.length) return jsonOut({ success: false, message: 'No records supplied.' });

  const sheet = getOrCreateSubmissionsSheet();
  const now = new Date();
  const rows = records.map(r => {
    const rec = { ...r };
    rec.id = Utilities.getUuid();
    rec.timestamp = now;
    rec.submitted_by = session.email;
    if (session.role !== 'admin' && session.role !== 'superadmin') rec.mda = session.mda; // non-admins can't spoof another MDA
    return RECORD_COLUMNS.map(c => rec[c] !== undefined ? rec[c] : '');
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, RECORD_COLUMNS.length).setValues(rows);
  return jsonOut({ success: true, inserted: rows.length });
}

// Public aggregate analytics — NO personal data, NO auth required. Safe to expose
// via a shareable analysis-only link. Returns only counts.
function handleGetAnalytics(body) {
  const superEmails = getSuperAdminEmails();
  const sheet = getOrCreateSubmissionsSheet();
  const lastRow = sheet.getLastRow();
  const empty = { success:true, total:0, byMda:{}, byPromotionGrade:{}, notional:{jan:0,jul:0,other:0}, bracket:{low:0,high:0,other:0} };
  if (lastRow < 2) return jsonOut(empty);
  const values = sheet.getRange(2, 1, lastRow - 1, RECORD_COLUMNS.length).getValues();
  const idx = {};
  RECORD_COLUMNS.forEach((c,i)=>idx[c]=i);
  const byMda={}, byGrade={}, notional={jan:0,jul:0,other:0}, bracket={low:0,high:0,other:0};
  let total=0;
  values.forEach(row=>{
    if (superEmails.indexOf(String(row[idx.submitted_by]).toLowerCase()) !== -1) return;
    total++;
    const mda = String(row[idx.mda]||'').trim() || '(Unspecified)';
    byMda[mda] = (byMda[mda]||0)+1;
    // promotion grade
    let g = String(row[idx.grade_promotion]||'').replace(/[^\d]/g,'');
    if (g){ g = ('0'+parseInt(g,10)).slice(-2); byGrade[g]=(byGrade[g]||0)+1; }
    const gi = parseInt(g,10);
    if (!isNaN(gi)){ if(gi>=6&&gi<=10) bracket.low++; else if(gi>=12&&gi<=16) bracket.high++; else bracket.other++; }
    else bracket.other++;
    // notional month
    let nd = row[idx.proposed_notional_date];
    let month = -1;
    if (nd instanceof Date) month = nd.getMonth();
    else { const s=String(nd); let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) month=+m[2]-1; else { m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if(m) month=+m[2]-1; else { m=s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i); if(m) month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].toLowerCase()); } } }
    if (month===0) notional.jan++; else if (month===6) notional.jul++; else notional.other++;
  });
  return jsonOut({ success:true, total, byMda, byPromotionGrade:byGrade, notional, bracket });
}

function handleGetAll(body) {
  requireAdmin(body.token);
  // Build the set of super-admin emails so their submissions stay invisible.
  const superEmails = getSuperAdminEmails();
  const sheet = getOrCreateSubmissionsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut({ success: true, records: [] });
  const values = sheet.getRange(2, 1, lastRow - 1, RECORD_COLUMNS.length).getValues();
  const submittedByCol = RECORD_COLUMNS.indexOf('submitted_by');
  const records = [];
  values.forEach(row => {
    // Hide any record submitted by a super-admin account.
    if (superEmails.indexOf(String(row[submittedByCol]).toLowerCase()) !== -1) return;
    const obj = {};
    RECORD_COLUMNS.forEach((c, i) => {
      let v = row[i];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
      obj[c] = v;
    });
    records.push(obj);
  });
  return jsonOut({ success: true, records });
}

// Returns lowercase emails of all super-admin accounts (normally just one).
function getSuperAdminEmails() {
  const usersSheet = getOrCreateUsersSheet();
  const values = usersSheet.getDataRange().getValues();
  const emails = [];
  for (let i = 1; i < values.length; i++) {
    if (isSuperAdmin(values[i])) emails.push(String(values[i][1]).toLowerCase());
  }
  return emails;
}

function handleAdminUpdateRecord(body) {
  requireAdmin(body.token);
  const id = body.id;
  const fields = body.fields || {};
  const sheet = getOrCreateSubmissionsSheet();
  const values = sheet.getDataRange().getValues();
  const idCol = RECORD_COLUMNS.indexOf('id');
  for (let i = 1; i < values.length; i++) {
    if (values[i][idCol] === id) {
      RECORD_COLUMNS.forEach((c, ci) => {
        if (c === 'id' || c === 'timestamp' || c === 'submitted_by') return; // protected columns
        if (fields[c] !== undefined) sheet.getRange(i + 1, ci + 1).setValue(fields[c]);
      });
      return jsonOut({ success: true });
    }
  }
  return jsonOut({ success: false, message: 'Record not found.' });
}

function handleAdminDeleteRecord(body) {
  requireAdmin(body.token);
  const id = body.id;
  const sheet = getOrCreateSubmissionsSheet();
  const values = sheet.getDataRange().getValues();
  const idCol = RECORD_COLUMNS.indexOf('id');
  for (let i = 1; i < values.length; i++) {
    if (values[i][idCol] === id) { sheet.deleteRow(i + 1); return jsonOut({ success: true }); }
  }
  return jsonOut({ success: false, message: 'Record not found.' });
}

/* ========================================================================
   SHEET BOOTSTRAP HELPERS
   ======================================================================== */
function getOrCreateSubmissionsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SUBMISSIONS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SUBMISSIONS_SHEET);
    sheet.getRange(1, 1, 1, RECORD_COLUMNS.length).setValues([RECORD_COLUMNS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateSessionsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SESSIONS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SESSIONS_SHEET);
    sheet.getRange(1, 1, 1, SESSION_COLUMNS.length).setValues([SESSION_COLUMNS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateUsersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(USERS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET);
    sheet.getRange(1, 1, 1, USER_COLUMNS.length).setValues([USER_COLUMNS]);
    sheet.setFrozenRows(1);
  }
  if (sheet.getLastRow() < 2) {
    // Bootstrap the first admin account from AdminConfig. This account uses the
    // 'superadmin' role, which is deliberately hidden from every listing and
    // treated as invisible across the portal (see isSuperAdmin / user-list and
    // record-list filtering). It still has full administrator privileges.
    const cfg = getOrCreateAdminConfigSheet();
    const bootstrapPassword = String(cfg.getRange('B1').getValue() || 'changeme123');
    const bootstrapEmail = String(cfg.getRange('B2').getValue() || 'admin@portal.local').toLowerCase();
    const salt = Utilities.getUuid();
    sheet.appendRow([Utilities.getUuid(), bootstrapEmail, hashPassword(bootstrapPassword, salt), salt, 'Super Admin', 'ALL', 'superadmin', new Date(), '', '']);
  }
  return sheet;
}

function getOrCreateAdminConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ADMIN_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ADMIN_SHEET);
    sheet.getRange('A1').setValue('Bootstrap admin password (first sign-in only):');
    sheet.getRange('B1').setValue('changeme123');
    sheet.getRange('A2').setValue('Bootstrap admin email (first sign-in only):');
    sheet.getRange('B2').setValue('admin@portal.local');
    sheet.getRange('A3').setValue('Portal URL (used in reset-password emails):');
    sheet.getRange('B3').setValue('');
    sheet.getRange('A1:A3').setFontWeight('bold');
  }
  return sheet;
}

function getPortalUrl() {
  const cfg = getOrCreateAdminConfigSheet();
  const v = cfg.getRange('B3').getValue();
  return v ? String(v).trim() : '';
}

/* ========================================================================
   FORM A — BRIEF ON CANDIDATE (submitted by eligible officers, no login)
   ======================================================================== */
function getOrCreateBriefsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Briefs');
  if (!sheet) {
    sheet = ss.insertSheet('Briefs');
    sheet.appendRow(BRIEF_COLUMNS);
    sheet.getRange(1, 1, 1, BRIEF_COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Column order for the Briefs sheet. 'id'/'timestamp' first, then the form fields
// in the same order the client sends them.
var BRIEF_FIELD_KEYS = [
  'Name (Surname first)','Department/Ministry','Date of 1st Appt','Designation at 1st Appt',
  'Date of Confirmation','Date of Present Appt','Present Designation','Conversion Post',
  'Educ: Post Primary','Educ: Secondary School','Educ: University etc','Educ: Professional Certificates',
  'Educ: Additional Qualification','Date of Birth','State of Origin','Nationality','Age',
  'CSC File No.','Oracle No.','Date issued last query','Facing disciplinary action?',
  'Pending request/appeal/appraisal','Appraisal 2023 Score','Appraisal 2024 Score','Appraisal 2025 Score','Appraisal 2026 Score',
  'Certifying Officer Name','Certifying Officer Rank','Certifying Officer Telephone','Certification Date'
];
// Performance-appraisal scores are optional and are not required to submit.
var BRIEF_OPTIONAL_KEYS = ['Appraisal 2023 Score','Appraisal 2024 Score','Appraisal 2025 Score','Appraisal 2026 Score'];
var BRIEF_COLUMNS = ['id','timestamp'].concat(BRIEF_FIELD_KEYS).concat(['Photo (data URL)','Status','Authorized By','Authorized MDA','Authorized At']);

// Ensure an existing Briefs sheet has the workflow columns (for deployments
// created before this update). Adds any missing trailing headers in place.
function ensureBriefWorkflowColumns(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, Math.max(lastCol,1)).getValues()[0].map(String);
  const needed = ['Status','Authorized By','Authorized MDA','Authorized At'];
  let added = false;
  needed.forEach(h => {
    if (headers.indexOf(h) === -1) {
      sheet.getRange(1, sheet.getLastColumn()+1).setValue(h).setFontWeight('bold');
      added = true;
    }
  });
  return added;
}

// Map a Briefs row (array) to an object keyed by its header names.
function briefRowToObj(headers, row) {
  const o = {};
  headers.forEach((h,i)=>{ o[h] = row[i]; });
  return o;
}

function handleSubmitBrief(body) {
  const brief = body.brief || {};
  // All fields are compulsory EXCEPT the optional performance-appraisal scores.
  const missing = BRIEF_FIELD_KEYS.filter(k => BRIEF_OPTIONAL_KEYS.indexOf(k)===-1 && !String(brief[k] == null ? '' : brief[k]).trim());
  if (missing.length) {
    return jsonOut({ success: false, message: 'Required fields are missing: ' + missing.join(', ') });
  }
  const photo = String(body.photo || '');
  if (!photo) {
    return jsonOut({ success: false, message: 'Passport photograph is required.' });
  }
  const sheet = getOrCreateBriefsSheet();
  ensureBriefWorkflowColumns(sheet);
  const id = Utilities.getUuid();
  const rowObj = { id: id, timestamp: new Date() };
  BRIEF_FIELD_KEYS.forEach(k => { rowObj[k] = String(brief[k]).trim(); });
  rowObj['Photo (data URL)'] = photo;
  rowObj['Status'] = 'Pending';
  rowObj['Authorized By'] = '';
  rowObj['Authorized MDA'] = '';
  rowObj['Authorized At'] = '';
  // Write in the current header order so pre-existing sheets stay aligned.
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);
  const row = headers.map(h => rowObj[h] !== undefined ? rowObj[h] : '');
  sheet.appendRow(row);
  return jsonOut({ success: true, id: id, message: 'Brief on Candidate saved.' });
}

// MDA user (or admin) lists Form A submissions. Non-admins are restricted to
// their own assigned MDA; admins get everything.
function handleListBriefs(body) {
  const session = requireUser(body.token);
  const isAdmin = (session.role === 'admin' || session.role === 'superadmin');
  const sheet = getOrCreateBriefsSheet();
  ensureBriefWorkflowColumns(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut({ success: true, briefs: [] });
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);
  const values = sheet.getRange(2,1,lastRow-1,sheet.getLastColumn()).getValues();
  const mdaIdx = headers.indexOf('Department/Ministry');
  const briefs = [];
  values.forEach(row => {
    if (!isAdmin && String(row[mdaIdx]).trim() !== String(session.mda).trim()) return;
    const o = briefRowToObj(headers, row);
    if (o.timestamp instanceof Date) o.timestamp = Utilities.formatDate(o.timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    if (o['Authorized At'] instanceof Date) o['Authorized At'] = Utilities.formatDate(o['Authorized At'], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    briefs.push(o);
  });
  return jsonOut({ success: true, briefs: briefs, isAdmin: isAdmin });
}

// Edit a Form A. MDA users may edit only their MDA's records and only while
// still Pending; admins may edit any record at any time.
function handleUpdateBrief(body) {
  const session = requireUser(body.token);
  const isAdmin = (session.role === 'admin' || session.role === 'superadmin');
  const id = String(body.id || '');
  const fields = body.fields || {};
  const sheet = getOrCreateBriefsSheet();
  ensureBriefWorkflowColumns(sheet);
  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);
  const idIdx = headers.indexOf('id');
  const mdaIdx = headers.indexOf('Department/Ministry');
  const statusIdx = headers.indexOf('Status');
  const values = sheet.getRange(2,1,lastRow-1,sheet.getLastColumn()).getValues();
  for (let i=0;i<values.length;i++){
    if (String(values[i][idIdx]) === id){
      const row = values[i];
      if (!isAdmin){
        if (String(row[mdaIdx]).trim() !== String(session.mda).trim())
          return jsonOut({ success:false, message:'You can only edit Form A records for your own MDA.' });
        if (String(row[statusIdx]) === 'Sent')
          return jsonOut({ success:false, message:'This Form A has already been sent to the Commission and can no longer be edited.' });
      }
      // Apply edits to known field columns only (never id/timestamp/photo/status).
      const locked = ['id','timestamp','Photo (data URL)','Status','Authorized By','Authorized MDA','Authorized At'];
      Object.keys(fields).forEach(k=>{
        const ci = headers.indexOf(k);
        if (ci !== -1 && locked.indexOf(k) === -1){ row[ci] = String(fields[k]); }
      });
      sheet.getRange(i+2,1,1,headers.length).setValues([row]);
      return jsonOut({ success:true });
    }
  }
  return jsonOut({ success:false, message:'Form A record not found.' });
}

// MDA user authorizes + sends a Form A to the Commission. Stamps who/when and
// flips status to 'Sent'. Only the assigned MDA user (or admin) may do this.
function handleAuthorizeBrief(body) {
  const session = requireUser(body.token);
  const isAdmin = (session.role === 'admin' || session.role === 'superadmin');
  const id = String(body.id || '');
  const sheet = getOrCreateBriefsSheet();
  ensureBriefWorkflowColumns(sheet);
  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);
  const idIdx = headers.indexOf('id');
  const mdaIdx = headers.indexOf('Department/Ministry');
  const values = sheet.getRange(2,1,lastRow-1,sheet.getLastColumn()).getValues();
  for (let i=0;i<values.length;i++){
    if (String(values[i][idIdx]) === id){
      const row = values[i];
      if (!isAdmin && String(row[mdaIdx]).trim() !== String(session.mda).trim())
        return jsonOut({ success:false, message:'You can only authorize Form A records for your own MDA.' });
      const set = (h,v)=>{ const ci=headers.indexOf(h); if(ci!==-1) row[ci]=v; };
      set('Status','Sent');
      set('Authorized By', session.name + ' (' + session.email + ')');
      set('Authorized MDA', session.mda);
      set('Authorized At', new Date());
      sheet.getRange(i+2,1,1,headers.length).setValues([row]);
      return jsonOut({ success:true });
    }
  }
  return jsonOut({ success:false, message:'Form A record not found.' });
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ========================================================================
   SECURE PER-MDA DOWNLOAD LINKS
   The admin generates a tokenized link for a specific MDA. The token is an
   HMAC of the MDA name using a server-side secret, so it is verifiable but
   cannot be forged or altered to reach another MDA's data. Opening the link
   requires no login and returns ONLY that MDA's records.
   ======================================================================== */

// Returns the per-MDA download secret from AdminConfig!B4, creating a random
// one on first use. Keeping it server-side means links can't be forged.
function getDownloadSecret() {
  const cfg = getOrCreateAdminConfigSheet();
  var secret = String(cfg.getRange('B4').getValue() || '').trim();
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    cfg.getRange('A4').setValue('Per-MDA download link secret (do not share):').setFontWeight('bold');
    cfg.getRange('B4').setValue(secret);
  }
  return secret;
}

// Deterministic, non-forgeable token for a given MDA name.
function mdaDownloadToken(mda) {
  const secret = getDownloadSecret();
  const raw = Utilities.computeHmacSha256Signature(String(mda).trim().toLowerCase(), secret);
  // URL-safe base64, trimmed to a compact length.
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/,'').slice(0, 32);
}

// Admin-only: returns the signed token for an MDA so the frontend can build the link.
function handleGetMdaDownloadToken(body) {
  requireAdmin(body.token);
  const mda = String(body.mda || '').trim();
  if (!mda) return jsonOut({ success:false, message:'MDA is required.' });
  return jsonOut({ success:true, mda:mda, mdaToken: mdaDownloadToken(mda) });
}

// Public (tokenized): returns one MDA's eligibility records AND Form A records.
// No session required, but the token must match the MDA.
function handleMdaDownload(body) {
  const mda = String(body.mda || '').trim();
  const token = String(body.mdaToken || '').trim();
  if (!mda || !token) return jsonOut({ success:false, message:'Invalid download link.' });
  if (token !== mdaDownloadToken(mda)) return jsonOut({ success:false, message:'This download link is invalid or has expired.' });

  const superEmails = getSuperAdminEmails();

  // --- Eligibility records for this MDA ---
  const recSheet = getOrCreateSubmissionsSheet();
  const eligibility = [];
  if (recSheet.getLastRow() >= 2) {
    const vals = recSheet.getRange(2,1,recSheet.getLastRow()-1,RECORD_COLUMNS.length).getValues();
    const mdaIdx = RECORD_COLUMNS.indexOf('mda');
    const subIdx = RECORD_COLUMNS.indexOf('submitted_by');
    vals.forEach(row=>{
      if (superEmails.indexOf(String(row[subIdx]).toLowerCase()) !== -1) return;
      if (String(row[mdaIdx]).trim().toLowerCase() !== mda.toLowerCase()) return;
      const o = {};
      RECORD_COLUMNS.forEach((c,i)=>{ let v=row[i]; if(v instanceof Date) v=Utilities.formatDate(v,Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm'); o[c]=v; });
      eligibility.push(o);
    });
  }

  // --- Form A (Brief) records for this MDA ---
  const briefSheet = getOrCreateBriefsSheet();
  ensureBriefWorkflowColumns(briefSheet);
  const briefs = [];
  if (briefSheet.getLastRow() >= 2) {
    const headers = briefSheet.getRange(1,1,1,briefSheet.getLastColumn()).getValues()[0].map(String);
    const bMdaIdx = headers.indexOf('Department/Ministry');
    const vals = briefSheet.getRange(2,1,briefSheet.getLastRow()-1,briefSheet.getLastColumn()).getValues();
    vals.forEach(row=>{
      if (String(row[bMdaIdx]).trim().toLowerCase() !== mda.toLowerCase()) return;
      const o = {};
      headers.forEach((h,i)=>{ if (h==='Photo (data URL)') return; // omit bulky photo from the export
        let v=row[i]; if(v instanceof Date) v=Utilities.formatDate(v,Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm'); o[h]=v; });
      briefs.push(o);
    });
  }

  return jsonOut({ success:true, mda:mda, eligibility:eligibility, briefs:briefs });
}
