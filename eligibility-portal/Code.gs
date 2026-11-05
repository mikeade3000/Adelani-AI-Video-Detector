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
 *   - "Briefs"       -> Form A (Brief on Candidate) submitted by officers
 *   - "Verifications"-> audit log of MDA checks of Form A against an uploaded Excel sheet
 *   - "Verified and Authentic Data" -> officers whose eligibility-list row fully matched
 *                       their Form A (one row per officer, refreshed on every check)
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
const VERIFICATIONS_SHEET = 'Verifications';
const VERIFICATION_COLUMNS = ['id','timestamp','checked_by','mda','source','file_name','officer_name',
  'oracle_no','csc_file_no','record_id','status','match_method','fields_compared','fields_matched',
  'discrepancies','discrepancy_details'];
const VERIFIED_SHEET = 'Verified and Authentic Data';
// Values from the uploaded eligibility list (sent by the client) ...
const VERIFIED_SHEET_FIELDS = ['seap_no','surname_first','oracle_no','csc_file_no','post_1st_appt','grade_1st',
  'date_1st_appt','date_confirmation','present_post','grade_present','date_present_appt','promotion_post',
  'grade_promotion','proposed_notional_date','proposed_financial_date','official_email','mobile_no',
  'disability','remarks'];
// ... and values copied by the server straight from the officer's Form A.
const VERIFIED_BRIEF_FIELDS = [
  ['date_of_birth','Date of Birth'],['state_of_origin','State of Origin'],['nationality','Nationality'],['age','Age'],
  ['conversion_post','Conversion Post'],['educ_post_primary','Educ: Post Primary'],['educ_secondary','Educ: Secondary School'],
  ['educ_university','Educ: University etc'],['educ_professional','Educ: Professional Certificates'],
  ['educ_additional','Educ: Additional Qualification'],['last_query','Date issued last query'],
  ['disciplinary_action','Facing disciplinary action?'],['pending_request','Pending request/appeal/appraisal'],
  ['appraisal_2023','Appraisal 2023 Score'],['appraisal_2024','Appraisal 2024 Score'],['appraisal_2025','Appraisal 2025 Score'],
  ['appraisal_2026','Appraisal 2026 Score'],['certifying_officer','Certifying Officer Name'],['certifying_rank','Certifying Officer Rank'],
  ['certifying_phone','Certifying Officer Telephone'],['certification_date','Certification Date'],
  ['form_a_status','Status'],['form_a_submitted','timestamp']];
// Columns added after the first release go at the END (here: seap_no), so a sheet
// created by an earlier version stays aligned; getOrCreateVerifiedSheet adds their headers.
const VERIFIED_LATER_COLUMNS = ['seap_no', 'form_a_check', 'photo'];
var FORM_A_CHECKS = ['Matches Form A', 'Differs from Form A', 'No Form A'];
const VERIFIED_COLUMNS = ['brief_id','verified_at','verified_by','mda','source_file','fields_compared']
  .concat(VERIFIED_SHEET_FIELDS.filter(k => VERIFIED_LATER_COLUMNS.indexOf(k) === -1))
  .concat(VERIFIED_BRIEF_FIELDS.map(p => p[0]))
  .concat(VERIFIED_LATER_COLUMNS);

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut({ success: false, message: 'Invalid request body.' }); }

  // Every action that writes takes the script lock, so two people saving at the
  // same moment can never pick the same "next row" or shift rows under each other.
  const lock = WRITE_ACTIONS.indexOf(body.action) !== -1 ? LockService.getScriptLock() : null;
  if (lock && !lock.tryLock(30000)) return jsonOut({ success: false, message: 'The system is busy — please try again in a moment.' });
  try {
    switch (body.action) {
      case 'ping': return jsonOut({ success: true, message: 'pong' });
      case 'getAnalytics': return handleGetAnalytics(body);
      case 'getMdaDownloadToken': case 'mdaDownload':
        return jsonOut({ success: false, message: "This download link has been replaced. Please ask the Civil Service Commission for your MDA's new print link." });
      case 'mdaLinkStart': return handleMdaLinkStart(body);
      case 'mdaLinkOpen': return handleMdaLinkOpen(body);
      case 'mdaLinkData': return handleMdaLinkData(body);
      case 'mdaLinkPhotos': return handleMdaLinkPhotos(body);
      case 'mdaLinkLog': return handleMdaLinkLog(body);
      case 'mdaLinkSignOut': return handleMdaLinkSignOut(body);
      case 'listMdaLinks': return handleListMdaLinks(body);
      case 'saveMdaLink': return handleSaveMdaLink(body);
      case 'setMdaLinkActive': return handleSetMdaLinkActive(body);
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
      case 'getVerificationData': return handleGetVerificationData(body);
      case 'saveVerification': return handleSaveVerification(body);
      case 'saveVerifiedData': return handleSaveVerifiedData(body);
      case 'listVerifiedData': return handleListVerifiedData(body);
      case 'verifySlip': return handleVerifySlip(body);
      case 'exportTab': return handleExportTab(body);
      case 'getPhotos': return handleGetPhotos(body);
      case 'updateVerifiedRecord': return handleUpdateVerifiedRecord(body);
      case 'regroupVerifiedMda': return handleRegroupVerifiedMda(body);
      default: return jsonOut({ success: false, message: 'Unknown action: ' + body.action });
    }
  } catch (err) {
    return jsonOut({ success: false, message: 'Server error: ' + err.message });
  } finally {
    if (lock) lock.releaseLock();
  }
}
const WRITE_ACTIONS = ['login','logout','requestPasswordReset','resetPassword','changePassword','submitRecords',
  'adminCreateUser','adminDeleteUser','adminUpdateRecord','adminDeleteRecord','submitBrief','updateBrief',
  'authorizeBrief','saveVerification','saveVerifiedData','updateVerifiedRecord','regroupVerifiedMda',
  'mdaLinkOpen','mdaLinkLog','mdaLinkSignOut','saveMdaLink','setMdaLinkActive'];

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
function isAdminSession(s) { return !!s && (s.role === 'admin' || s.role === 'superadmin'); }
function sameMda(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

// Sheets silently converts typed text: "08031234567" becomes the number 8031234567
// (leading zero lost) and "01/07/2027" can become a date in the wrong locale.
// Every record write goes through this so values are stored exactly as sent.
function writeRowsAsText(sheet, startRow, rows, width) {
  const range = sheet.getRange(startRow, 1, rows.length, width);
  range.setNumberFormat('@');
  range.setValues(rows.map(r => r.map(v => (v instanceof Date || v === null || v === undefined) ? (v || '') : String(v))));
}

// Serialise a cell for the client. Dates (including ones Sheets auto-converted
// in rows saved before the plain-text fix) are formatted in the script time zone
// so they never shift by a day; date-only values drop the "00:00".
function fmtCell(v) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone();
    const hm = Utilities.formatDate(v, tz, 'HH:mm');
    return Utilities.formatDate(v, tz, hm === '00:00' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm');
  }
  return v;
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
  pruneExpiredSessions(sheet);
  const token = Utilities.getUuid();
  const expiry = new Date(Date.now() + SESSION_LIFETIME_MS);
  sheet.appendRow([token, email, role, name, mda, expiry]);
  return token;
}

// Remove expired sessions so the Sessions sheet does not grow forever.
function pruneExpiredSessions(sheet) {
  const values = sheet.getDataRange().getValues();
  const now = new Date();
  for (let i = values.length - 1; i >= 1; i--) {
    if (values[i][5] && new Date(values[i][5]) < now) sheet.deleteRow(i + 1);
  }
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
  writeRowsAsText(sheet, sheet.getLastRow() + 1, rows, RECORD_COLUMNS.length);
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
    RECORD_COLUMNS.forEach((c, i) => { obj[c] = fmtCell(row[i]); });
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
        if (fields[c] !== undefined) sheet.getRange(i + 1, ci + 1).setNumberFormat('@').setValue(String(fields[c]));
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
  writeRowsAsText(sheet, sheet.getLastRow() + 1, [row], headers.length);
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
    if (!isAdmin && !sameMda(row[mdaIdx], session.mda)) return;
    briefs.push(briefRowToObj(headers, row.map(fmtCell)));
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
  if (lastRow < 2) return jsonOut({ success:false, message:'Form A record not found.' });
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);
  const idIdx = headers.indexOf('id');
  const mdaIdx = headers.indexOf('Department/Ministry');
  const statusIdx = headers.indexOf('Status');
  const values = sheet.getRange(2,1,lastRow-1,sheet.getLastColumn()).getValues();
  for (let i=0;i<values.length;i++){
    if (String(values[i][idIdx]) === id){
      const row = values[i];
      if (!isAdmin){
        if (!sameMda(row[mdaIdx], session.mda))
          return jsonOut({ success:false, message:'You can only edit Form A records for your own MDA.' });
        if (String(row[statusIdx]) === 'Sent')
          return jsonOut({ success:false, message:'This Form A has already been sent to the Commission and can no longer be edited.' });
      }
      // Apply edits to known field columns only (never id/timestamp/photo/status).
      const locked = ['id','timestamp','Photo (data URL)','Status','Authorized By','Authorized MDA','Authorized At'];
      Object.keys(fields).forEach(k=>{
        const ci = headers.indexOf(k);
        // Only rewrite cells that actually changed (the client sends every field).
        if (ci !== -1 && locked.indexOf(k) === -1 && String(fmtCell(row[ci])) !== String(fields[k])){
          row[ci] = String(fields[k]);
          sheet.getRange(i+2, ci+1).setNumberFormat('@').setValue(row[ci]);
        }
      });
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
  if (lastRow < 2) return jsonOut({ success:false, message:'Form A record not found.' });
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);
  const idIdx = headers.indexOf('id');
  const mdaIdx = headers.indexOf('Department/Ministry');
  const values = sheet.getRange(2,1,lastRow-1,sheet.getLastColumn()).getValues();
  for (let i=0;i<values.length;i++){
    if (String(values[i][idIdx]) === id){
      if (!isAdmin && !sameMda(values[i][mdaIdx], session.mda))
        return jsonOut({ success:false, message:'You can only authorize Form A records for your own MDA.' });
      // Write only the four workflow cells so the officer's own values are untouched.
      const set = (h,v)=>{ const ci=headers.indexOf(h); if(ci!==-1) sheet.getRange(i+2, ci+1).setValue(v); };
      set('Status','Sent');
      set('Authorized By', session.name + ' (' + session.email + ')');
      set('Authorized MDA', session.mda);
      set('Authorized At', new Date());
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

/* ========================================================================
   MDA PRINT LINKS — a passwordless link per MDA, tied to that MDA's email
   address(es). Opening the link shows nothing until the holder types one of
   those addresses; 5 wrong addresses lock the link for 15 minutes. A match
   opens a 1-hour session that can only list, print and download that MDA's
   slips. Replacing or switching off the link, or removing the email, ends the
   session at once. Every sign-in, print and download is written to the log.
   ======================================================================== */
const MDA_LINKS_SHEET = 'MDA Links', MDA_LINK_TRIES_SHEET = 'MDA Link Tries', MDA_LINK_SESSIONS_SHEET = 'MDA Link Sessions';
const MDA_LINK_COLUMNS = ['mda', 'link_id', 'emails', 'active', 'created_by', 'created_at', 'last_used'];
const MDA_TRIES_COLUMNS = ['link_id', 'fails', 'window_start'];
const MDA_SESSION_COLUMNS = ['token', 'link_id', 'mda', 'email', 'expiry'];
const MDA_LINK_SESSION_MS = 60 * 60 * 1000;   // 1 hour
const MDA_LINK_TRIES = 5, MDA_LINK_LOCK_MS = 15 * 60 * 1000;
const MDA_LINK_FIELDS = ['brief_id', 'seap_no', 'surname_first', 'mda', 'csc_file_no', 'oracle_no', 'post_1st_appt', 'grade_1st', 'date_1st_appt',
  'date_confirmation', 'present_post', 'grade_present', 'date_present_appt', 'promotion_post', 'grade_promotion'];
const MDA_LINK_EVENTS = { print: 'MDA link: slips printed', pdf: 'MDA link: slips downloaded (PDF)', xlsx: 'MDA link: list downloaded (Excel)' };
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const MDA_LINK_GONE = "This link is not valid. It may have been replaced or switched off — please ask the Civil Service Commission for your MDA's current link.";

// A small table on its own sheet: rows as objects (with their sheet row number in _row).
function mdaTable(name, cols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) { sheet = ss.insertSheet(name); sheet.getRange(1, 1, 1, cols.length).setValues([cols]); sheet.setFrozenRows(1); }
  const n = sheet.getLastRow() - 1;
  const rows = n > 0 ? sheet.getRange(2, 1, n, cols.length).getValues().map((r, i) => {
    const o = { _row: i + 2 }; cols.forEach((c, j) => { o[c] = r[j] == null ? '' : String(fmtCell(r[j])); }); return o; }) : [];
  return {
    sheet: sheet, rows: rows,
    put: o => { const vals = [cols.map(c => o[c] === undefined ? '' : o[c])];
      if (o._row) writeRowsAsText(sheet, o._row, vals, cols.length); else { o._row = sheet.getLastRow() + 1; writeRowsAsText(sheet, o._row, vals, cols.length); } },
    remove: pred => { for (let i = rows.length - 1; i >= 0; i--) if (pred(rows[i])) sheet.deleteRow(rows[i]._row); }
  };
}
function parseEmails(v) {
  const seen = {}, out = [];
  String(v || '').split(/[\s,;]+/).forEach(e => { e = e.trim().toLowerCase(); if (e && !seen[e]) { seen[e] = true; out.push(e); } });
  return out;
}
function randomHex32() { return Utilities.getUuid().replace(/-/g, ''); }
function mdaActiveLink(linkId) {
  const id = String(linkId || '').trim();
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const l = mdaTable(MDA_LINKS_SHEET, MDA_LINK_COLUMNS).rows.filter(r => r.link_id === id)[0];
  return l && l.active === '1' ? l : null;
}
function mdaLinkSession(token) {
  const t = String(token || '');
  const s = t ? mdaTable(MDA_LINK_SESSIONS_SHEET, MDA_SESSION_COLUMNS).rows.filter(r => r.token === t)[0] : null;
  if (!s) throw new Error('Your session has ended — please sign in again with a new code.');
  const l = mdaActiveLink(s.link_id);
  if (Number(s.expiry) < Date.now()) throw new Error('Your 1-hour session has ended — please sign in again with a new code.');
  if (!l || !sameMda(l.mda, s.mda) || parseEmails(l.emails).indexOf(String(s.email).toLowerCase()) === -1) throw new Error(MDA_LINK_GONE);
  return s;
}
function mdaLinkAudit(s, status, detail, count) {
  const log = { id: Utilities.getUuid(), timestamp: new Date(), checked_by: s.email + ' (MDA link)', mda: s.mda, source: 'MDA print link', file_name: '', officer_name: '',
    oracle_no: '', csc_file_no: '', record_id: '', status: status, match_method: '', fields_compared: '', fields_matched: '',
    discrepancies: count === undefined ? '' : String(count), discrepancy_details: String(detail || '') };
  const vs = getOrCreateVerificationsSheet();
  writeRowsAsText(vs, vs.getLastRow() + 1, [VERIFICATION_COLUMNS.map(c => log[c] === undefined ? '' : log[c])], VERIFICATION_COLUMNS.length);
}
function handleMdaLinkStart(body) {
  const l = mdaActiveLink(body.link);
  return jsonOut(l ? { success: true, mda: l.mda } : { success: false, message: MDA_LINK_GONE });
}
function handleMdaLinkOpen(body) {
  const l = mdaActiveLink(body.link);
  if (!l) return jsonOut({ success: false, message: MDA_LINK_GONE });
  const email = String(body.email || '').trim().toLowerCase(), now = Date.now();
  const triesTab = mdaTable(MDA_LINK_TRIES_SHEET, MDA_TRIES_COLUMNS);
  const tries = triesTab.rows.filter(r => r.link_id === l.link_id)[0] || { link_id: l.link_id, fails: '0', window_start: '0' };
  const fresh = now - Number(tries.window_start) > MDA_LINK_LOCK_MS;
  const fails = fresh ? 0 : Number(tries.fails) || 0;
  const locked = 'Too many wrong email addresses were tried on this link. Please wait 15 minutes and try again.';
  if (fails >= MDA_LINK_TRIES) return jsonOut({ success: false, message: locked });
  if (!EMAIL_RE.test(email) || parseEmails(l.emails).indexOf(email) === -1) {
    tries.fails = String(fails + 1); if (fresh) tries.window_start = String(now); triesTab.put(tries);
    const left = MDA_LINK_TRIES - fails - 1;
    return jsonOut({ success: false, message: left > 0 ? 'That email address is not registered for this link. ' + left + ' more tr' + (left === 1 ? 'y' : 'ies') + ' before the link is locked for 15 minutes.' : locked });
  }
  triesTab.remove(r => r.link_id === l.link_id);
  const sessions = mdaTable(MDA_LINK_SESSIONS_SHEET, MDA_SESSION_COLUMNS);
  sessions.remove(r => Number(r.expiry) < now);
  const token = randomHex32() + randomHex32().slice(0, 16), expiry = now + MDA_LINK_SESSION_MS;
  sessions.put({ token: token, link_id: l.link_id, mda: l.mda, email: email, expiry: String(expiry) });
  const links = mdaTable(MDA_LINKS_SHEET, MDA_LINK_COLUMNS);
  const lr = links.rows.filter(r => r.link_id === l.link_id)[0];
  lr.last_used = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') + ' · ' + email; links.put(lr);
  mdaLinkAudit({ email: email, mda: l.mda }, 'MDA link: signed in', '');
  return jsonOut({ success: true, mdaToken: token, mda: l.mda, email: email, expiresAt: expiry });
}
function mdaVerifiedRows(mda) {
  const sheet = getOrCreateVerifiedSheet();
  if (sheet.getLastRow() < 2) return [];
  const mdaCol = VERIFIED_COLUMNS.indexOf('mda');
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, VERIFIED_COLUMNS.length).getValues().filter(row => sameMda(row[mdaCol], mda))
    .map(row => { const o = {}; VERIFIED_COLUMNS.forEach((c, i) => { o[c] = fmtCell(row[i]); }); return o; });
}
function mdaBriefPhotos(ids) {
  const want = {}; ids.forEach(id => { want[String(id)] = true; });
  const photos = {};
  const bs = getOrCreateBriefsSheet();
  if (bs.getLastRow() >= 2) {
    const headers = bs.getRange(1, 1, 1, bs.getLastColumn()).getValues()[0].map(String);
    const idIdx = headers.indexOf('id'), photoIdx = headers.indexOf('Photo (data URL)');
    bs.getRange(2, 1, bs.getLastRow() - 1, bs.getLastColumn()).getValues().forEach(r => { if (want[String(r[idIdx])] && r[photoIdx]) photos[String(r[idIdx])] = String(r[photoIdx]); });
  }
  return photos;
}
function handleMdaLinkData(body) {
  const s = mdaLinkSession(body.mdaToken);
  const rows = mdaVerifiedRows(s.mda);
  const photos = mdaBriefPhotos(rows.map(r => r.brief_id));
  const records = rows.map(r => {
    const o = {}; MDA_LINK_FIELDS.forEach(c => { o[c] = r[c] == null ? '' : String(r[c]); });
    o.has_photo = !!(photos[String(r.brief_id)] || r.photo); o.verify_code = String(r.brief_id) + '.' + slipSignature(r.brief_id);
    return o;
  });
  return jsonOut({ success: true, mda: s.mda, email: s.email, expiresAt: Number(s.expiry), records: records });
}
function handleMdaLinkPhotos(body) {
  const s = mdaLinkSession(body.mdaToken);
  const want = {}; (Array.isArray(body.ids) ? body.ids : []).slice(0, 25).forEach(id => { want[String(id)] = true; });
  const rows = mdaVerifiedRows(s.mda).filter(r => want[String(r.brief_id)]);
  const fromBriefs = mdaBriefPhotos(rows.map(r => r.brief_id));
  const photos = {}; rows.forEach(r => { photos[String(r.brief_id)] = fromBriefs[String(r.brief_id)] || String(r.photo || ''); });
  return jsonOut({ success: true, photos: photos });
}
function handleMdaLinkLog(body) {
  const s = mdaLinkSession(body.mdaToken);
  const status = MDA_LINK_EVENTS[String(body.event || '')];
  if (!status) return jsonOut({ success: false, message: 'Unknown event.' });
  mdaLinkAudit(s, status, String(body.detail || '').slice(0, 200), Math.max(0, parseInt(body.count, 10) || 0));
  return jsonOut({ success: true });
}
function handleMdaLinkSignOut(body) {
  const t = String(body.mdaToken || '');
  if (t) mdaTable(MDA_LINK_SESSIONS_SHEET, MDA_SESSION_COLUMNS).remove(r => r.token === t);
  return jsonOut({ success: true });
}
// ---- Administrators: one link per MDA in Verified and Authentic Data ----
function handleListMdaLinks(body) {
  requireAdmin(body.token);
  const counts = {}, names = {};
  const vs = getOrCreateVerifiedSheet();
  if (vs.getLastRow() >= 2) {
    const mdaCol = VERIFIED_COLUMNS.indexOf('mda');
    vs.getRange(2, mdaCol + 1, vs.getLastRow() - 1, 1).getValues().forEach(r => {
      const m = String(r[0] || '').trim(); if (!m) return; const k = m.toLowerCase(); counts[k] = (counts[k] || 0) + 1; if (!names[k]) names[k] = m; });
  }
  const links = mdaTable(MDA_LINKS_SHEET, MDA_LINK_COLUMNS).rows;
  links.forEach(l => { const k = String(l.mda).trim().toLowerCase(); if (!names[k]) { names[k] = String(l.mda).trim(); counts[k] = 0; } });
  const us = getOrCreateUsersSheet();
  const users = us.getLastRow() >= 2 ? us.getRange(2, 1, us.getLastRow() - 1, USER_COLUMNS.length).getValues()
    .filter(r => String(r[USER_COLUMNS.indexOf('role')]) === 'user').map(r => ({ email: String(r[USER_COLUMNS.indexOf('email')]).toLowerCase(), mda: r[USER_COLUMNS.indexOf('mda')] })) : [];
  const out = Object.keys(names).map(k => {
    const l = links.filter(x => sameMda(x.mda, names[k]))[0];
    return { mda: names[k], officers: counts[k], link: l ? l.link_id : '', emails: l ? parseEmails(l.emails) : [], active: !!(l && l.active === '1'),
      createdAt: l ? l.created_at : '', createdBy: l ? l.created_by : '', lastUsed: l ? l.last_used : '',
      suggested: users.filter(u => sameMda(u.mda, names[k])).map(u => u.email) };
  }).sort((a, b) => a.mda.localeCompare(b.mda));
  return jsonOut({ success: true, links: out });
}
function handleSaveMdaLink(body) {
  const s = requireAdmin(body.token);
  const mda = String(body.mda || '').trim(), emails = parseEmails(body.emails);
  if (!mda) return jsonOut({ success: false, message: 'MDA is required.' });
  if (!emails.length) return jsonOut({ success: false, message: 'Enter at least one email address for this MDA.' });
  const badEmail = emails.filter(e => !EMAIL_RE.test(e))[0];
  if (badEmail) return jsonOut({ success: false, message: '"' + badEmail + '" is not a valid email address.' });
  const links = mdaTable(MDA_LINKS_SHEET, MDA_LINK_COLUMNS);
  const old = links.rows.filter(r => sameMda(r.mda, mda))[0];
  const replace = !old || !!body.newLink;
  const row = old || { mda: mda, last_used: '' };
  const oldId = old ? old.link_id : '';
  if (replace) { row.link_id = randomHex32(); row.created_by = s.name + ' (' + s.email + ')'; row.created_at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }
  row.emails = emails.join(', '); row.active = '1';
  links.put(row);
  if (old && replace) {
    mdaTable(MDA_LINK_SESSIONS_SHEET, MDA_SESSION_COLUMNS).remove(r => r.link_id === oldId);
    mdaTable(MDA_LINK_TRIES_SHEET, MDA_TRIES_COLUMNS).remove(r => r.link_id === oldId);
  }
  return jsonOut({ success: true, mda: row.mda, link: row.link_id, emails: emails, replaced: !!(old && replace) });
}
function handleSetMdaLinkActive(body) {
  requireAdmin(body.token);
  const links = mdaTable(MDA_LINKS_SHEET, MDA_LINK_COLUMNS);
  const l = links.rows.filter(r => sameMda(r.mda, body.mda))[0];
  if (!l) return jsonOut({ success: false, message: 'This MDA has no link yet.' });
  const on = !!body.active;
  l.active = on ? '1' : '0'; links.put(l);
  if (!on) mdaTable(MDA_LINK_SESSIONS_SHEET, MDA_SESSION_COLUMNS).remove(r => r.link_id === l.link_id);
  return jsonOut({ success: true, active: on });
}

/* ========================================================================
   VERIFICATION — MDA checks what officers submitted online (Form A, and the
   eligibility records) against an Excel sheet of the officers' details.
   The comparison itself runs in the browser; the backend supplies the
   online records (scoped to the user's MDA) and keeps an audit log.
   ======================================================================== */
function getOrCreateVerificationsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(VERIFICATIONS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(VERIFICATIONS_SHEET);
    sheet.getRange(1, 1, 1, VERIFICATION_COLUMNS.length).setValues([VERIFICATION_COLUMNS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Returns the Form A submissions (with photos, for the individual summaries) and
// the eligibility records for one MDA. MDA users always get their own MDA;
// administrators may pass body.mda, or leave it blank for every MDA.
function handleGetVerificationData(body) {
  const session = requireUser(body.token);
  const isAdmin = isAdminSession(session);
  const mda = isAdmin ? String(body.mda || '').trim() : String(session.mda || '').trim();
  const inScope = v => !mda || sameMda(v, mda);
  const superEmails = getSuperAdminEmails();

  const briefs = [];
  const briefSheet = getOrCreateBriefsSheet();
  ensureBriefWorkflowColumns(briefSheet);
  if (briefSheet.getLastRow() >= 2) {
    const headers = briefSheet.getRange(1, 1, 1, briefSheet.getLastColumn()).getValues()[0].map(String);
    const mdaIdx = headers.indexOf('Department/Ministry');
    briefSheet.getRange(2, 1, briefSheet.getLastRow() - 1, briefSheet.getLastColumn()).getValues().forEach(row => {
      if (inScope(row[mdaIdx])) briefs.push(briefRowToObj(headers, row.map(fmtCell)));
    });
  }

  const eligibility = [];
  const recSheet = getOrCreateSubmissionsSheet();
  if (recSheet.getLastRow() >= 2) {
    const mdaIdx = RECORD_COLUMNS.indexOf('mda');
    const subIdx = RECORD_COLUMNS.indexOf('submitted_by');
    recSheet.getRange(2, 1, recSheet.getLastRow() - 1, RECORD_COLUMNS.length).getValues().forEach(row => {
      if (superEmails.indexOf(String(row[subIdx]).toLowerCase()) !== -1) return;
      if (!inScope(row[mdaIdx])) return;
      const o = {};
      RECORD_COLUMNS.forEach((c, i) => { o[c] = fmtCell(row[i]); });
      eligibility.push(o);
    });
  }
  return jsonOut({ success: true, mda: mda, isAdmin: isAdmin, briefs: briefs, eligibility: eligibility });
}

// Appends one audit row per officer checked. MDA users can only log results for
// their own MDA.
function handleSaveVerification(body) {
  const session = requireUser(body.token);
  const results = Array.isArray(body.results) ? body.results : [];
  if (!results.length) return jsonOut({ success: false, message: 'No verification results supplied.' });
  const mda = isAdminSession(session) ? String(body.mda || session.mda || '') : String(session.mda || '');
  const now = new Date();
  const checkedBy = session.name + ' (' + session.email + ')';
  const rows = results.map(r => {
    const rec = {
      id: Utilities.getUuid(), timestamp: now, checked_by: checkedBy,
      mda: isAdminSession(session) ? String(r.mda || mda) : mda,
      source: body.source || '', file_name: body.fileName || ''
    };
    VERIFICATION_COLUMNS.forEach(c => { if (rec[c] === undefined) rec[c] = r[c] === undefined ? '' : r[c]; });
    return VERIFICATION_COLUMNS.map(c => rec[c]);
  });
  const sheet = getOrCreateVerificationsSheet();
  writeRowsAsText(sheet, sheet.getLastRow() + 1, rows, VERIFICATION_COLUMNS.length);
  return jsonOut({ success: true, saved: rows.length });
}

/* ========================================================================
   VERIFIED AND AUTHENTIC DATA — officers whose uploaded eligibility-list row
   matched their Form A on every compared field. The sheet always reflects the
   latest check: a re-check updates the officer's row, and an officer whose
   latest check found a discrepancy is removed.
   ======================================================================== */
function getOrCreateVerifiedSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(VERIFIED_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(VERIFIED_SHEET);
    sheet.getRange(1, 1, 1, VERIFIED_COLUMNS.length).setValues([VERIFIED_COLUMNS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // Sheet created by an earlier version: add any newer trailing headers.
    const have = sheet.getLastColumn();
    if (have < VERIFIED_COLUMNS.length)
      sheet.getRange(1, have + 1, 1, VERIFIED_COLUMNS.length - have).setValues([VERIFIED_COLUMNS.slice(have)]).setFontWeight('bold');
  }
  return sheet;
}
function digitsOnly(v) { return String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+/, ''); }

// body.verified: [{brief_id, fields_compared, <VERIFIED_SHEET_FIELDS from the uploaded sheet>}]
// body.revoke:   [brief_id, ...] — officers whose latest check found a discrepancy.
// Saves EVERY officer on the uploaded list (the slip uses the list's details). Officers
// with a Form A are linked to it (photo + Form A details); officers without one get a
// stable id from their MDA + Oracle No (or File No, or name), so re-uploading updates
// them instead of duplicating. MDA users can only save officers of their own MDA.
function officerIdentity(rec) {
  const oracle = digitsOnly(rec.oracle_no);
  if (oracle) return 'o:' + oracle;
  const csc = String(rec.csc_file_no || '').toUpperCase().replace(/[\s.,]/g, '');
  if (csc) return 'c:' + csc;
  const name = String(rec.surname_first || '').toUpperCase().replace(/[.,'’\-]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  return name ? 'n:' + name : '';
}
function listOnlyId(mda, identity) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(mda).trim().toLowerCase() + '|' + identity, Utilities.Charset.UTF_8);
  return 'L-' + raw.slice(0, 12).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
function handleSaveVerifiedData(body) {
  const session = requireUser(body.token);
  const isAdmin = isAdminSession(session);
  const verified = Array.isArray(body.verified) ? body.verified : [];
  const revoke = Array.isArray(body.revoke) ? body.revoke.map(String) : [];

  const briefSheet = getOrCreateBriefsSheet();
  ensureBriefWorkflowColumns(briefSheet);
  const briefs = {};
  if (briefSheet.getLastRow() >= 2) {
    const headers = briefSheet.getRange(1, 1, 1, briefSheet.getLastColumn()).getValues()[0].map(String);
    const pIdx = headers.indexOf('Photo (data URL)');
    briefSheet.getRange(2, 1, briefSheet.getLastRow() - 1, briefSheet.getLastColumn()).getValues()
      .forEach(row => { const o = briefRowToObj(headers, row.map(fmtCell)); delete o['Photo (data URL)']; briefs[String(o.id)] = o; });
  }
  const inScope = b => b && (isAdmin || sameMda(b['Department/Ministry'], session.mda));

  const sheet = getOrCreateVerifiedSheet();
  const values = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, VERIFIED_COLUMNS.length).getValues() : [];
  const idCol = VERIFIED_COLUMNS.indexOf('brief_id'), oracleCol = VERIFIED_COLUMNS.indexOf('oracle_no'), mdaCol = VERIFIED_COLUMNS.indexOf('mda');
  const drop = new Set();
  const markOfficer = (id, mda, oracleRaw) => {
    const oracle = digitsOnly(oracleRaw);
    values.forEach((row, i) => {
      if (String(row[idCol]) === String(id)) drop.add(i);
      else if (oracle && digitsOnly(row[oracleCol]) === oracle && sameMda(row[mdaCol], mda)) drop.add(i);
    });
  };
  const now = new Date();
  const verifiedBy = session.name + ' (' + session.email + ')';
  const newRows = []; const rejected = []; const storedIds = []; const seen = {};
  let withFormA = 0, withoutFormA = 0;
  verified.forEach(rec => {
    const b = rec.brief_id ? briefs[String(rec.brief_id)] : null;
    if (b && !inScope(b)) { rejected.push((rec.surname_first || '?') + ': that Form A belongs to another MDA'); return; }
    // Placement follows the uploaded list: the MDA on the sheet's "MDA:" line (MDA users: their own MDA).
    // The Form A's MDA is only a fallback when the sheet names none.
    let id, mda = isAdmin ? (String(rec.mda || '').trim() || (b ? String(b['Department/Ministry'] || '').trim() : '')) : String(session.mda || '').trim();
    if (!mda) { rejected.push((rec.surname_first || '?') + ': MDA not known (write it beside "MDA:" on the sheet)'); return; }
    if (b) id = String(b.id);
    else {
      const identity = officerIdentity(rec);
      if (!identity) { rejected.push('Row with no name, Oracle No or File No skipped'); return; }
      id = listOnlyId(mda, identity);
    }
    if (seen[id]) return; seen[id] = true;   // the same officer twice on one list: keep the first row
    markOfficer(id, mda, rec.oracle_no || (b && b['Oracle No.']));
    const out = { brief_id: id, verified_at: now, verified_by: verifiedBy, mda: mda,
      source_file: String(body.fileName || ''), fields_compared: String(rec.fields_compared || '') };
    VERIFIED_SHEET_FIELDS.forEach(k => { out[k] = rec[k] == null ? '' : String(rec[k]); });
    if (b) {
      if (!out.surname_first) out.surname_first = b['Name (Surname first)'];
      if (!out.oracle_no) out.oracle_no = b['Oracle No.'];
      if (!out.csc_file_no) out.csc_file_no = b['CSC File No.'];
      VERIFIED_BRIEF_FIELDS.forEach(p => { out[p[0]] = b[p[1]] == null ? '' : b[p[1]]; });
    }
    out.form_a_check = b ? (FORM_A_CHECKS.indexOf(rec.form_a_check) > -1 && rec.form_a_check !== 'No Form A' ? rec.form_a_check : 'Matches Form A') : 'No Form A';
    out.photo = '';
    if (b) withFormA++; else withoutFormA++;
    newRows.push(VERIFIED_COLUMNS.map(c => out[c] === undefined ? '' : out[c]));
    storedIds.push(id);
  });
  let revoked = 0;
  revoke.forEach(rid => { const b = briefs[rid]; if (inScope(b)) { const before = drop.size; markOfficer(b.id, b['Department/Ministry'], b['Oracle No.']); revoked += drop.size - before; } });

  // Rewrite the sheet in one go (kept rows + new rows) — far faster than deleting row by row.
  if (drop.size) {
    const keep = values.filter((row, i) => !drop.has(i));
    sheet.getRange(2, 1, values.length, VERIFIED_COLUMNS.length).clearContent();
    if (keep.length) writeRowsAsText(sheet, 2, keep, VERIFIED_COLUMNS.length);
  }
  if (newRows.length) writeRowsAsText(sheet, sheet.getLastRow() + 1, newRows, VERIFIED_COLUMNS.length);
  return jsonOut({ success: true, stored: newRows.length, storedIds: storedIds, withFormA: withFormA, withoutFormA: withoutFormA, revoked: revoked, rejected: rejected });
}

function handleListVerifiedData(body) {
  const session = requireUser(body.token);
  const isAdmin = isAdminSession(session);
  const mda = isAdmin ? String(body.mda || '').trim() : String(session.mda || '').trim();
  const sheet = getOrCreateVerifiedSheet();
  const records = [];
  if (sheet.getLastRow() >= 2) {
    const mdaCol = VERIFIED_COLUMNS.indexOf('mda');
    sheet.getRange(2, 1, sheet.getLastRow() - 1, VERIFIED_COLUMNS.length).getValues().forEach(row => {
      if (mda && !sameMda(row[mdaCol], mda)) return;
      const o = {};
      VERIFIED_COLUMNS.forEach((c, i) => { o[c] = fmtCell(row[i]); });
      records.push(o);
    });
  }
  // Attach the passport photograph from the officer's Form A (used on the slip).
  if (records.length) {
    const briefSheet = getOrCreateBriefsSheet();
    if (briefSheet.getLastRow() >= 2) {
      const headers = briefSheet.getRange(1, 1, 1, briefSheet.getLastColumn()).getValues()[0].map(String);
      const idIdx = headers.indexOf('id'), photoIdx = headers.indexOf('Photo (data URL)');
      const photos = {};
      briefSheet.getRange(2, 1, briefSheet.getLastRow() - 1, briefSheet.getLastColumn()).getValues()
        .forEach(row => { photos[String(row[idIdx])] = String(row[photoIdx] || ''); });
      records.forEach(r => { r.photo = photos[String(r.brief_id)] || r.photo || ''; });
    }
  }
  // Signed code printed on each slip as a QR code: "<brief_id>.<signature>".
  records.forEach(r => { r.verify_code = String(r.brief_id) + '.' + slipSignature(r.brief_id); });
  return jsonOut({ success: true, mda: mda, records: records });
}

/* ========================================================================
   SLIP VERIFICATION — each slip carries a QR code with "<brief_id>.<signature>".
   The signature is an HMAC with the server-side secret, so a slip cannot be
   forged by guessing an id. Anyone holding the slip can check it (no login);
   the answer is VALID only while the officer is still in Verified and Authentic Data.
   ======================================================================== */
function slipSignature(briefId) {
  const raw = Utilities.computeHmacSha256Signature('slip:' + String(briefId), getDownloadSecret());
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '').slice(0, 22);
}
function handleVerifySlip(body) {
  const code = String(body.code || '').trim();
  const dot = code.lastIndexOf('.');
  const id = dot > 0 ? code.slice(0, dot) : '', sig = dot > 0 ? code.slice(dot + 1) : '';
  if (!id || !sig || sig !== slipSignature(id))
    return jsonOut({ success: true, valid: false, reason: 'not_genuine', message: 'This slip was NOT issued by the portal — the verification code is not genuine.' });
  const sheet = getOrCreateVerifiedSheet();
  if (sheet.getLastRow() >= 2) {
    const idCol = VERIFIED_COLUMNS.indexOf('brief_id');
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, VERIFIED_COLUMNS.length).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][idCol]) !== id) continue;
      const o = {};
      VERIFIED_COLUMNS.forEach((c, j) => { o[c] = fmtCell(rows[i][j]); });
      return jsonOut({ success: true, valid: true, record: publicSlipRecord(o, briefPhoto(id) || o.photo) });
    }
  }
  return jsonOut({ success: true, valid: false, reason: 'revoked', message: 'This slip was issued by the portal but is NO LONGER VALID — the officer is not currently in Verified and Authentic Data.' });
}
// Only what is printed on the slip is returned to a public verifier.
var PUBLIC_SLIP_FIELDS = ['seap_no','surname_first','mda','csc_file_no','oracle_no','post_1st_appt','grade_1st',
  'date_1st_appt','date_confirmation','present_post','grade_present','date_present_appt','promotion_post','grade_promotion','verified_at'];
function publicSlipRecord(o, photo) {
  const out = {};
  PUBLIC_SLIP_FIELDS.forEach(k => { out[k] = o[k] == null ? '' : o[k]; });
  out.photo = photo || '';
  return out;
}
function briefPhoto(id) {
  const sheet = getOrCreateBriefsSheet();
  if (sheet.getLastRow() < 2) return '';
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const idIdx = headers.indexOf('id'), photoIdx = headers.indexOf('Photo (data URL)');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  for (let i = 0; i < rows.length; i++) if (String(rows[i][idIdx]) === String(id)) return String(rows[i][photoIdx] || '');
  return '';
}

/* ========================================================================
   FULL BACKUP / MIGRATION EXPORT (super administrator only)
   Returns one tab at a time, in pages, as objects keyed by the header row, with
   dates formatted by fmtCell. The portal assembles the pages into one .json file
   that cloudflare/migrate/import-backup.js loads into Cloudflare D1. (An .xlsx
   download is not used because Excel truncates cells over 32,767 characters,
   which would corrupt passport photographs.)
   ======================================================================== */
var EXPORT_TABS = ['AdminConfig', USERS_SHEET, SUBMISSIONS_SHEET, 'Briefs', VERIFICATIONS_SHEET, VERIFIED_SHEET];
function handleExportTab(body) {
  const s = requireAdmin(body.token);
  if (s.role !== 'superadmin' && !isSuperAdminEmail(s.email)) return jsonOut({ success: false, message: 'Only the super administrator can download a full backup.' });
  const tab = String(body.tab || '');
  if (EXPORT_TABS.indexOf(tab) === -1) return jsonOut({ success: false, message: 'Unknown tab: ' + tab });
  if (tab === 'AdminConfig') {
    const cfg = getOrCreateAdminConfigSheet();
    const v = a => String(cfg.getRange(a).getValue() || '').trim();
    return jsonOut({ success: true, tab: tab, config: { bootstrap_password: v('B1'), bootstrap_email: v('B2').toLowerCase(), portal_url: v('B3'), download_secret: getDownloadSecret() } });
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab);
  if (!sheet || sheet.getLastRow() < 2) return jsonOut({ success: true, tab: tab, total: 0, rows: [] });
  const total = sheet.getLastRow() - 1;
  const offset = Math.max(0, parseInt(body.offset, 10) || 0);
  const limit = Math.min(500, Math.max(1, parseInt(body.limit, 10) || 200));
  if (offset >= total) return jsonOut({ success: true, tab: tab, total: total, rows: [] });
  const n = Math.min(limit, total - offset);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const rows = sheet.getRange(2 + offset, 1, n, headers.length).getValues().map(r => {
    const o = {}; headers.forEach((h, i) => { if (h) o[h] = fmtCell(r[i]); }); return o;
  });
  return jsonOut({ success: true, tab: tab, total: total, rows: rows });
}

// Passport photographs for up to 25 Form As (the Cloudflare version lists Form As
// without photos; the page asks for the ones it needs). Own MDA only, admins any.
function handleGetPhotos(body) {
  const session = requireUser(body.token);
  const isAdmin = isAdminSession(session);
  const want = {}; (Array.isArray(body.ids) ? body.ids : []).slice(0, 25).forEach(id => { want[String(id)] = true; });
  const photos = {};
  // An officer placed in the user's MDA by its list may have a Form A filed under another MDA name.
  const placed = {};
  const vs = getOrCreateVerifiedSheet();
  const vRows = vs.getLastRow() >= 2 ? vs.getRange(2, 1, vs.getLastRow() - 1, VERIFIED_COLUMNS.length).getValues() : [];
  const idC = VERIFIED_COLUMNS.indexOf('brief_id'), mdaC = VERIFIED_COLUMNS.indexOf('mda'), phC = VERIFIED_COLUMNS.indexOf('photo');
  vRows.forEach(row => { if (want[String(row[idC])] && (isAdmin || sameMda(row[mdaC], session.mda))) placed[String(row[idC])] = true; });
  const sheet = getOrCreateBriefsSheet();
  if (sheet.getLastRow() >= 2) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const idIdx = headers.indexOf('id'), mdaIdx = headers.indexOf('Department/Ministry'), photoIdx = headers.indexOf('Photo (data URL)');
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues().forEach(row => {
      const id = String(row[idIdx]);
      if (want[id] && (isAdmin || placed[id] || sameMda(row[mdaIdx], session.mda))) photos[id] = String(row[photoIdx] || '');
    });
  }
  vRows.forEach(row => {
    const id = String(row[idC]);
    if (want[id] && !photos[id] && row[phC] && (isAdmin || sameMda(row[mdaC], session.mda))) photos[id] = String(row[phC]);
  });
  return jsonOut({ success: true, photos: photos });
}

// Edit a verified officer (administrators only): corrects what the slip prints and
// optionally replaces the passport photograph; every change goes to the Verifications log.
var SLIP_EDITABLE = ['seap_no','surname_first','mda','csc_file_no','oracle_no','post_1st_appt','grade_1st','date_1st_appt',
  'date_confirmation','present_post','grade_present','date_present_appt','promotion_post','grade_promotion'];
function handleUpdateVerifiedRecord(body) {
  const session = requireAdmin(body.token);
  const sheet = getOrCreateVerifiedSheet();
  const id = String(body.brief_id || '');
  const idCol = VERIFIED_COLUMNS.indexOf('brief_id');
  const n = sheet.getLastRow() - 1;
  const rows = n > 0 ? sheet.getRange(2, 1, n, VERIFIED_COLUMNS.length).getValues() : [];
  let r = -1;
  for (let i = 0; i < rows.length; i++) if (String(rows[i][idCol]) === id) { r = i; break; }
  if (r === -1) return jsonOut({ success: false, message: 'This officer is no longer in Verified and Authentic Data.' });
  const fields = body.fields || {};
  const before = {}; VERIFIED_COLUMNS.forEach((c, j) => { before[c] = String(fmtCell(rows[r][j]) == null ? '' : fmtCell(rows[r][j])); });
  const cols = SLIP_EDITABLE.filter(k => fields[k] !== undefined && String(fields[k]).trim() !== before[k]);
  if (cols.indexOf('surname_first') !== -1 && !String(fields.surname_first).trim()) return jsonOut({ success: false, message: 'Name cannot be empty.' });
  const photo = String(body.photo || '');
  if (photo && (!/^data:image\//.test(photo) || photo.length > 50000)) return jsonOut({ success: false, message: 'The photograph is not a valid image (or is too large).' });
  if (!cols.length && !photo) return jsonOut({ success: true, changed: 0 });
  cols.forEach(c => { sheet.getRange(r + 2, VERIFIED_COLUMNS.indexOf(c) + 1).setNumberFormat('@').setValue(String(fields[c]).trim()); });
  if (photo) {
    const bs = getOrCreateBriefsSheet();
    const headers = bs.getRange(1, 1, 1, bs.getLastColumn()).getValues()[0].map(String);
    const bIdIdx = headers.indexOf('id'), photoIdx = headers.indexOf('Photo (data URL)');
    const ids = bs.getRange(2, bIdIdx + 1, Math.max(1, bs.getLastRow() - 1), 1).getValues();
    let found = false;
    for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) { bs.getRange(i + 2, photoIdx + 1).setValue(photo); found = true; break; }
    if (!found) sheet.getRange(r + 2, VERIFIED_COLUMNS.indexOf('photo') + 1).setValue(photo);   // officer without a Form A
  }
  const after = Object.assign({}, before); cols.forEach(c => { after[c] = String(fields[c]).trim(); });
  const changes = cols.map(c => c + ': "' + before[c] + '" → "' + after[c] + '"').concat(photo ? ['photo: replaced'] : []);
  const log = { id: Utilities.getUuid(), timestamp: new Date(), checked_by: session.name + ' (' + session.email + ')', mda: after.mda,
    source: 'Edited slip record', file_name: '', officer_name: after.surname_first, oracle_no: after.oracle_no, csc_file_no: after.csc_file_no,
    record_id: id, status: 'Edited', match_method: '', fields_compared: '', fields_matched: '', discrepancies: String(changes.length), discrepancy_details: changes.join('; ') };
  const vs = getOrCreateVerificationsSheet();
  writeRowsAsText(vs, vs.getLastRow() + 1, [VERIFICATION_COLUMNS.map(c => log[c] === undefined ? '' : log[c])], VERIFICATION_COLUMNS.length);
  return jsonOut({ success: true, changed: changes.length });
}

// Fix MDA grouping (administrators only). Officers uploaded before placement followed the
// list were filed under the MDA on their own Form A. Each upload (same file, same uploader)
// came from one sheet; its officers without a Form A were filed under that sheet's MDA, so
// every officer of the upload moves there. Uploads whose sheet MDA can't be told need an MDA
// chosen in `choices`. Officers whose MDA an administrator changed with Edit are left alone.
function planRegroup(rows, editedIds, choices) {
  const key = r => String(r.source_file || '') + '\u0001' + String(r.verified_by || '');
  const norm = m => String(m || '').trim().toLowerCase();
  const order = [], byKey = {};
  rows.forEach(r => { const k = key(r); if (!byKey[k]) { byKey[k] = []; order.push(k); } byKey[k].push(r); });
  const groups = [], moves = [];
  order.forEach(k => {
    const list = byKey[k];
    const count = m => list.filter(r => norm(r.mda) === norm(m)).length;
    const distinct = rs => { const seen = {}, out = []; rs.forEach(r => { const n = norm(r.mda); if (n && !seen[n]) { seen[n] = true; out.push(String(r.mda).trim()); } }); return out; };
    const mdas = distinct(list).sort((a, b) => count(b) - count(a));
    const sheetMdas = distinct(list.filter(r => String(r.form_a_check) === 'No Form A'));
    const g = { key: k, file: String(list[0].source_file || ''), by: String(list[0].verified_by || ''), total: list.length, mdas: mdas, moves: [] };
    let target = '';
    if (!g.file) { g.status = 'unknown'; g.reason = 'no file name recorded'; }
    else if (sheetMdas.length === 1) { g.status = 'auto'; target = sheetMdas[0]; }
    else if (mdas.length <= 1) { g.status = 'ok'; target = mdas[0] || ''; }
    else { g.status = 'choose'; g.reason = sheetMdas.length ? 'officers without a Form A on this list are under different MDAs' : "every officer on this list has a Form A, so the sheet's MDA is not recorded"; }
    const chosen = choices && String(choices[k] || '').trim();
    if (chosen) { target = chosen; g.status = 'chosen'; }
    g.sheetMda = target; g.suggested = target || mdas[0] || '';
    if (target) {
      const from = {};
      list.forEach(r => {
        const m = String(r.mda || '').trim();
        if (norm(m) === norm(target) || editedIds[String(r.brief_id)]) return;
        moves.push({ row: r, from: m, to: target }); from[m] = (from[m] || 0) + 1;
      });
      g.moves = Object.keys(from).map(m => ({ from: m, count: from[m] }));
    }
    groups.push(g);
  });
  // After the moves, the same officer (same Oracle No) now twice in one MDA from two different
  // uploads keeps only the latest entry. Two rows of one upload are never merged.
  const moved = {}; moves.forEach(m => { moved[m.row.seq] = m.to; });
  const latest = {}, dupes = [];
  rows.slice().sort((a, b) => b.seq - a.seq).forEach(r => {
    const o = digitsOnly(r.oracle_no); if (!o) return;
    const k = norm(moved[r.seq] || r.mda) + '|' + o;
    if (!latest[k]) latest[k] = r;
    else if (key(latest[k]) !== key(r) && (moved[r.seq] !== undefined || moved[latest[k].seq] !== undefined)) dupes.push(r);
  });
  groups.sort((a, b) => (b.moves.length - a.moves.length) || a.file.localeCompare(b.file));
  return { groups: groups, moves: moves, dupes: dupes };
}

function handleRegroupVerifiedMda(body) {
  const session = requireAdmin(body.token);
  const sheet = getOrCreateVerifiedSheet();
  const n = sheet.getLastRow() - 1;
  const values = n > 0 ? sheet.getRange(2, 1, n, VERIFIED_COLUMNS.length).getValues() : [];
  const rows = values.map((row, i) => { const o = { seq: i }; VERIFIED_COLUMNS.forEach((c, j) => { if (c !== 'photo') o[c] = fmtCell(row[j]); }); return o; });
  const edited = {};
  const vs = getOrCreateVerificationsSheet();
  if (vs.getLastRow() >= 2) {
    const sC = VERIFICATION_COLUMNS.indexOf('status'), rC = VERIFICATION_COLUMNS.indexOf('record_id'), dC = VERIFICATION_COLUMNS.indexOf('discrepancy_details');
    vs.getRange(2, 1, vs.getLastRow() - 1, VERIFICATION_COLUMNS.length).getValues().forEach(r => {
      if (String(r[sC]) === 'Edited' && /(^|; )mda: /.test(String(r[dC]))) edited[String(r[rC])] = true;
    });
  }
  const plan = planRegroup(rows, edited, body.choices || {});
  const summary = { success: true, groups: plan.groups.filter(g => g.status !== 'ok' || g.moves.length).map(g => ({ key: g.key, file: g.file, by: g.by, total: g.total, status: g.status,
      reason: g.reason, sheetMda: g.sheetMda, suggested: g.suggested, mdas: g.mdas, moves: g.moves })),
    toMove: plan.moves.length, duplicates: plan.dupes.length, editedKept: Object.keys(edited).length };
  if (!body.apply) return jsonOut(summary);
  const mdaCol = VERIFIED_COLUMNS.indexOf('mda');
  plan.moves.forEach(m => { values[m.row.seq][mdaCol] = m.to; });
  const drop = {}; plan.dupes.forEach(r => { drop[r.seq] = true; });
  const keep = values.filter((row, i) => !drop[i]);
  if (values.length) sheet.getRange(2, 1, values.length, VERIFIED_COLUMNS.length).clearContent();
  if (keep.length) writeRowsAsText(sheet, 2, keep, VERIFIED_COLUMNS.length);
  const now = new Date(), by = session.name + ' (' + session.email + ')';
  const logs = plan.moves.map(m => {
    const log = { id: Utilities.getUuid(), timestamp: now, checked_by: by, mda: m.to, source: 'Fix MDA grouping', file_name: m.row.source_file, officer_name: m.row.surname_first,
      oracle_no: m.row.oracle_no, csc_file_no: m.row.csc_file_no, record_id: m.row.brief_id, status: 'MDA corrected', match_method: '', fields_compared: '', fields_matched: '',
      discrepancies: '1', discrepancy_details: 'mda: "' + m.from + '" → "' + m.to + '" (placed by its eligibility list)' };
    return VERIFICATION_COLUMNS.map(c => log[c] === undefined ? '' : log[c]);
  });
  if (logs.length) writeRowsAsText(vs, vs.getLastRow() + 1, logs, VERIFICATION_COLUMNS.length);
  summary.applied = true; summary.moved = plan.moves.length; summary.duplicatesRemoved = plan.dupes.length;
  return jsonOut(summary);
}
