/**
 * Y2027 PROMOTION ELIGIBILITY LIST — CLOUDFLARE WORKER BACKEND
 * ------------------------------------------------------------------------
 * A drop-in replacement for Code.gs (Google Apps Script + Google Sheet):
 *   POST /api   the same JSON actions as Code.gs's doPost, backed by Cloudflare D1
 *   GET  /*     the portal page itself (public/index.html), told to use /api
 *
 * Behaviour mirrors Code.gs action for action so the portal page works unchanged.
 * Passwords use the same hash (hex SHA-256 of "password:salt"), and the per-MDA
 * download tokens and slip codes use the same HMAC secret, so data imported from
 * the Google Sheet keeps working: users keep their passwords and links stay valid.
 */

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000; // 8 hours
const RESET_LIFETIME_MS = 60 * 60 * 1000;       // 1 hour
const LAGOS_OFFSET_MS = 60 * 60 * 1000;         // Africa/Lagos is UTC+1 all year (no DST)

const RECORD_COLUMNS = [
  'id','timestamp','submitted_by','mda','surname_first','csc_file_no','oracle_no',
  'post_1st_appt','grade_1st','date_1st_appt','date_confirmation','present_post',
  'grade_present','date_present_appt','promotion_post','grade_promotion',
  'proposed_notional_date','proposed_financial_date','official_email','mobile_no',
  'disability','remarks'
];
const VERIFICATION_COLUMNS = ['id','timestamp','checked_by','mda','source','file_name','officer_name',
  'oracle_no','csc_file_no','record_id','status','match_method','fields_compared','fields_matched',
  'discrepancies','discrepancy_details'];
const VERIFIED_SHEET_FIELDS = ['seap_no','surname_first','oracle_no','csc_file_no','post_1st_appt','grade_1st',
  'date_1st_appt','date_confirmation','present_post','grade_present','date_present_appt','promotion_post',
  'grade_promotion','proposed_notional_date','proposed_financial_date','official_email','mobile_no',
  'disability','remarks'];
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
const VERIFIED_COLUMNS = ['brief_id','verified_at','verified_by','mda','source_file','fields_compared']
  .concat(VERIFIED_SHEET_FIELDS.filter(k => k !== 'seap_no'))
  .concat(VERIFIED_BRIEF_FIELDS.map(p => p[0]))
  .concat(['seap_no', 'form_a_check', 'photo']);   // later columns go last (added to older databases automatically)
// Listing never carries photographs (memory); they come from getPhotos.
const VERIFIED_LIST_COLS = VERIFIED_COLUMNS.filter(c => c !== 'photo').map(c => 'v.' + c).join(', ');
const FORM_A_CHECKS = ['Matches Form A', 'Differs from Form A', 'No Form A'];
// Databases created before a column existed get it added once per Worker instance.
let verifiedSchemaReady = false;
async function ensureVerifiedSchema(ctx) {
  if (verifiedSchemaReady) return;
  const cols = (await ctx.all('PRAGMA table_info(verified)')).map(r => r.name);
  for (const c of ['seap_no', 'form_a_check', 'photo']) if (!cols.includes(c)) await ctx.run(`ALTER TABLE verified ADD COLUMN ${c} TEXT`);
  verifiedSchemaReady = true;
}
const VERIFIED_ACTIONS = ['saveVerifiedData', 'listVerifiedData', 'verifySlip', 'updateVerifiedRecord', 'getPhotos', 'exportTab', 'regroupVerifiedMda'];
const BRIEF_FIELD_KEYS = [
  'Name (Surname first)','Department/Ministry','Date of 1st Appt','Designation at 1st Appt',
  'Date of Confirmation','Date of Present Appt','Present Designation','Conversion Post',
  'Educ: Post Primary','Educ: Secondary School','Educ: University etc','Educ: Professional Certificates',
  'Educ: Additional Qualification','Date of Birth','State of Origin','Nationality','Age',
  'CSC File No.','Oracle No.','Date issued last query','Facing disciplinary action?',
  'Pending request/appeal/appraisal','Appraisal 2023 Score','Appraisal 2024 Score','Appraisal 2025 Score','Appraisal 2026 Score',
  'Certifying Officer Name','Certifying Officer Rank','Certifying Officer Telephone','Certification Date'
];
const BRIEF_OPTIONAL_KEYS = ['Appraisal 2023 Score','Appraisal 2024 Score','Appraisal 2025 Score','Appraisal 2026 Score'];
const PUBLIC_SLIP_FIELDS = ['seap_no','surname_first','mda','csc_file_no','oracle_no','post_1st_appt','grade_1st',
  'date_1st_appt','date_confirmation','present_post','grade_present','date_present_appt','promotion_post','grade_promotion','verified_at'];

/* ========================================================================
   ENTRY POINT
   ======================================================================== */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Old *.workers.dev address → the portal's own domain (CANONICAL_HOST in wrangler.toml).
    // Page visits (GET) get a permanent redirect that keeps the path and query, so old
    // bookmarks and the QR codes on slips already printed keep working. API calls are
    // still answered on both addresses, so a page left open on the old address never breaks.
    let canonical = String(env.CANONICAL_HOST || '').trim().toLowerCase();
    if (canonical === 'off' || canonical === 'none') canonical = '';   // the deploy script's "not ready yet" setting
    if (canonical && url.hostname.endsWith('.workers.dev') && url.hostname !== canonical
        && (request.method === 'GET' || request.method === 'HEAD') && url.pathname !== '/api' && url.pathname !== '/exec') {
      return Response.redirect(`https://${canonical}${url.pathname}${url.search}`, 301);
    }
    if (url.pathname === '/api' || url.pathname === '/exec') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method === 'GET') return json({ success: true, message: 'Y2027 Eligibility List backend is running.' });
      if (request.method !== 'POST') return json({ success: false, message: 'Method not allowed.' }, 405);
      let body;
      try { body = JSON.parse(await request.text()); }
      catch (e) { return json({ success: false, message: 'Invalid request body.' }); }
      const ctx = new Ctx(env, request);
      try { return json(await route(ctx, body || {})); }
      catch (err) { return json({ success: false, message: (err instanceof UserError ? '' : 'Server error: ') + err.message }); }
    }
    return servePortal(request, env);
  },
};

// The portal page is served from the same Worker; tell it to use this API.
async function servePortal(request, env) {
  const res = await env.ASSETS.fetch(request);
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
  return new HTMLRewriter()
    .on('head', { element(el) { el.prepend('<script>window.PORTAL_API_URL="/api";</script>', { html: true }); } })
    .transform(res);
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
class UserError extends Error {}

async function route(ctx, body) {
  if (VERIFIED_ACTIONS.includes(body.action) || /mdaLink|MdaLink/.test(str(body.action))) await ensureVerifiedSchema(ctx);
  if (/mdaLink|MdaLink/.test(str(body.action))) await ensureMdaLinkSchema(ctx);
  switch (body.action) {
    case 'ping': return { success: true, message: 'pong' };
    case 'getAnalytics': return handleGetAnalytics(ctx);
    case 'getMdaDownloadToken': case 'mdaDownload':
      return { success: false, message: 'This download link has been replaced. Please ask the Civil Service Commission for your MDA\'s new print link.' };
    case 'mdaLinkStart': return handleMdaLinkStart(ctx, body);
    case 'mdaLinkOpen': return handleMdaLinkOpen(ctx, body);
    case 'mdaLinkData': return handleMdaLinkData(ctx, body);
    case 'mdaLinkPhotos': return handleMdaLinkPhotos(ctx, body);
    case 'mdaLinkBriefs': return handleMdaLinkBriefs(ctx, body);
    case 'mdaLinkLog': return handleMdaLinkLog(ctx, body);
    case 'mdaLinkSignOut': return handleMdaLinkSignOut(ctx, body);
    case 'listMdaLinks': return handleListMdaLinks(ctx, body);
    case 'saveMdaLink': return handleSaveMdaLink(ctx, body);
    case 'setMdaLinkActive': return handleSetMdaLinkActive(ctx, body);
    case 'login': return handleLogin(ctx, body);
    case 'logout': return handleLogout(ctx, body);
    case 'requestPasswordReset': return handleRequestPasswordReset(ctx, body);
    case 'resetPassword': return handleResetPassword(ctx, body);
    case 'changePassword': return handleChangePassword(ctx, body);
    case 'submitRecords': return handleSubmit(ctx, body);
    case 'getAllRecords': return handleGetAll(ctx, body);
    case 'adminCreateUser': return handleAdminCreateUser(ctx, body);
    case 'adminListUsers': return handleAdminListUsers(ctx, body);
    case 'adminDeleteUser': return handleAdminDeleteUser(ctx, body);
    case 'adminUpdateRecord': return handleAdminUpdateRecord(ctx, body);
    case 'adminDeleteRecord': return handleAdminDeleteRecord(ctx, body);
    case 'submitBrief': return handleSubmitBrief(ctx, body);
    case 'listBriefs': return handleListBriefs(ctx, body);
    case 'updateBrief': return handleUpdateBrief(ctx, body);
    case 'authorizeBrief': return handleAuthorizeBrief(ctx, body);
    case 'getVerificationData': return handleGetVerificationData(ctx, body);
    case 'saveVerification': return handleSaveVerification(ctx, body);
    case 'saveVerifiedData': return handleSaveVerifiedData(ctx, body);
    case 'listVerifiedData': return handleListVerifiedData(ctx, body);
    case 'verifySlip': return handleVerifySlip(ctx, body);
    case 'exportTab': return handleExportTab(ctx, body);
    case 'getPhotos': return handleGetPhotos(ctx, body);
    case 'updateVerifiedRecord': return handleUpdateVerifiedRecord(ctx, body);
    case 'regroupVerifiedMda': return handleRegroupVerifiedMda(ctx, body);
    default: return { success: false, message: 'Unknown action: ' + body.action };
  }
}

/* ========================================================================
   HELPERS
   ======================================================================== */
class Ctx {
  constructor(env, request) { this.env = env; this.db = env.DB; this.request = request; this._config = null; }
  async config(key) {
    if (!this._config) {
      const { results } = await this.db.prepare('SELECT key, value FROM config').all();
      this._config = {}; results.forEach(r => { this._config[r.key] = r.value; });
    }
    return this._config[key];
  }
  async setConfig(key, value) {
    await this.db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
    if (this._config) this._config[key] = value;
  }
  all(sql, ...args) { return this.db.prepare(sql).bind(...args).all().then(r => r.results); }
  first(sql, ...args) { return this.db.prepare(sql).bind(...args).first(); }
  run(sql, ...args) { return this.db.prepare(sql).bind(...args).run(); }
}
const str = v => (v === null || v === undefined) ? '' : String(v);
const lower = v => str(v).trim().toLowerCase();
const sameMda = (a, b) => lower(a) === lower(b);
const digitsOnly = v => str(v).replace(/\D/g, '').replace(/^0+/, '');
// 'YYYY-MM-DD HH:mm' in Lagos time — the format Code.gs returned for timestamps.
function lagosNow() { return new Date(Date.now() + LAGOS_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' '); }
const uuid = () => crypto.randomUUID();
const enc = new TextEncoder();
async function hashPassword(password, salt) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(password + ':' + salt));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmacWebSafe(value, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
  let bin = ''; sig.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomPassword(len) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map(b => chars[b % chars.length]).join('');
}
const isAdminRole = role => role === 'admin' || role === 'superadmin';

async function bootstrapEmail(ctx) {
  return lower((await ctx.config('bootstrap_email')) || ctx.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@portal.local');
}
async function superAdminEmails(ctx) {
  const boot = await bootstrapEmail(ctx);
  const rows = await ctx.all("SELECT email FROM users WHERE role = 'superadmin' OR lower(email) = ?", boot);
  return rows.map(r => lower(r.email));
}
async function isSuperAdminUser(ctx, u) { return u.role === 'superadmin' || lower(u.email) === await bootstrapEmail(ctx); }
// First run on an empty database: create the hidden super administrator (as Code.gs did).
async function ensureBootstrap(ctx) {
  const n = await ctx.first('SELECT COUNT(*) AS n FROM users');
  if (n && n.n > 0) return;
  const email = await bootstrapEmail(ctx);
  // No default password on a public site: a brand-new database needs BOOTSTRAP_ADMIN_PASSWORD
  // (or an imported backup, which brings its own accounts).
  const password = ctx.env.BOOTSTRAP_ADMIN_PASSWORD || (await ctx.config('bootstrap_password'));
  if (!password) throw new UserError('This portal has no accounts yet. The administrator must set the BOOTSTRAP_ADMIN_PASSWORD secret (or import a backup) before anyone can sign in.');
  const salt = uuid();
  await ctx.run('INSERT OR IGNORE INTO users (id, email, password_hash, salt, name, mda, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    uuid(), email, await hashPassword(password, salt), salt, 'Super Admin', 'ALL', 'superadmin', lagosNow());
}
async function downloadSecret(ctx) {
  let secret = str(await ctx.config('download_secret')).trim();
  if (!secret) { secret = uuid() + uuid(); await ctx.setConfig('download_secret', secret); }
  return secret;
}
async function slipSignature(ctx, briefId) { return (await hmacWebSafe('slip:' + str(briefId), await downloadSecret(ctx))).slice(0, 22); }
async function portalUrl(ctx) {
  const env = str(ctx.env.PORTAL_URL).trim();
  const v = str(await ctx.config('portal_url')).trim() || (env === 'off' ? '' : env);
  return v || new URL(ctx.request.url).origin + '/';
}
// Email is optional: set RESEND_API_KEY (and MAIL_FROM) to send account and reset emails.
async function sendMail(ctx, to, subject, text) {
  if (!ctx.env.RESEND_API_KEY) return false;
  try {
    const res = await fetch(str(ctx.env.RESEND_API_URL) || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ctx.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ctx.env.MAIL_FROM || 'Y2027 Eligibility Portal <onboarding@resend.dev>', to: [to], subject, text }),
      // RESEND_API_URL only exists for local testing against a stand-in mail server.
    });
    if (!res.ok) {   // keep Resend's reason (e.g. sender domain not verified) to show the administrator
      let why = 'HTTP ' + res.status;
      try { const j = await res.json(); why = str(j.message || j.error || why); } catch (e) {}
      ctx.lastMailError = why;
    }
    return res.ok;
  } catch (e) { ctx.lastMailError = e.message; return false; }
}

async function getSession(ctx, token) {
  if (!token) return null;
  const s = await ctx.first('SELECT * FROM sessions WHERE token = ?', str(token));
  if (!s) return null;
  if (Number(s.expiry) < Date.now()) { await ctx.run('DELETE FROM sessions WHERE token = ?', s.token); return null; }
  return s;
}
async function requireUser(ctx, token) {
  const s = await getSession(ctx, token);
  if (!s) throw new UserError('Session expired or invalid — please sign in again.');
  return s;
}
async function requireAdmin(ctx, token) {
  const s = await requireUser(ctx, token);
  if (!isAdminRole(s.role)) throw new UserError('This action requires an administrator account.');
  return s;
}

/* ========================================================================
   LOGIN / SESSIONS / PASSWORDS
   ======================================================================== */
async function handleLogin(ctx, body) {
  const email = lower(body.email), password = str(body.password);
  if (!email || !password) return { success: false, message: 'Email and password are required.' };
  await ensureBootstrap(ctx);
  const u = await ctx.first('SELECT * FROM users WHERE lower(email) = ?', email);
  if (!u || await hashPassword(password, u.salt) !== u.password_hash) return { success: false, message: 'Incorrect email or password.' };
  await ctx.run('DELETE FROM sessions WHERE expiry < ?', Date.now());
  const token = uuid();
  await ctx.run('INSERT INTO sessions (token, email, role, name, mda, expiry) VALUES (?, ?, ?, ?, ?, ?)',
    token, email, u.role, u.name, u.mda, Date.now() + SESSION_LIFETIME_MS);
  return { success: true, token, user: { email, name: u.name, mda: u.mda, role: u.role } };
}
async function handleLogout(ctx, body) {
  await ctx.run('DELETE FROM sessions WHERE token = ?', str(body.token));
  return { success: true };
}
async function handleRequestPasswordReset(ctx, body) {
  const email = lower(body.email);
  const u = email ? await ctx.first('SELECT id FROM users WHERE lower(email) = ?', email) : null;
  if (u) {
    const token = uuid();
    await ctx.run('UPDATE users SET reset_token = ?, reset_expiry = ? WHERE id = ?', token, Date.now() + RESET_LIFETIME_MS, u.id);
    const link = `${await portalUrl(ctx)}?reset=${token}&email=${encodeURIComponent(email)}`;
    await sendMail(ctx, email, 'Y2027 Eligibility Portal — Password Reset',
      `A password reset was requested for the Y2027 Eligibility List Portal.\n\nClick to reset your password:\n${link}\n\nOr open the portal, go to "Forgot Password" > "I have a code" and enter this code: ${token}\n\nThis expires in 1 hour. If you did not request this, ignore this email.`);
  }
  return { success: true, message: 'If that email is registered, a reset link has been sent.' };
}
async function handleResetPassword(ctx, body) {
  const email = lower(body.email), token = str(body.token).trim(), newPassword = str(body.newPassword);
  if (!email || !token || newPassword.length < 6) return { success: false, message: 'Email, code, and a password of at least 6 characters are required.' };
  const u = await ctx.first('SELECT * FROM users WHERE lower(email) = ?', email);
  if (!u) return { success: false, message: 'No account found for that email.' };
  if (!u.reset_token || u.reset_token !== token) return { success: false, message: 'Invalid or already-used reset code.' };
  if (Number(u.reset_expiry) < Date.now()) return { success: false, message: 'This reset code has expired — request a new one.' };
  const salt = uuid();
  await ctx.run('UPDATE users SET password_hash = ?, salt = ?, reset_token = NULL, reset_expiry = NULL WHERE id = ?', await hashPassword(newPassword, salt), salt, u.id);
  return { success: true, message: 'Password updated — you can now sign in.' };
}
async function handleChangePassword(ctx, body) {
  const s = await requireUser(ctx, body.token);
  const newPassword = str(body.newPassword);
  if (newPassword.length < 6) return { success: false, message: 'New password must be at least 6 characters.' };
  const u = await ctx.first('SELECT * FROM users WHERE lower(email) = ?', lower(s.email));
  if (!u) return { success: false, message: 'Account not found.' };
  if (await hashPassword(str(body.oldPassword), u.salt) !== u.password_hash) return { success: false, message: 'Current password is incorrect.' };
  const salt = uuid();
  await ctx.run('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?', await hashPassword(newPassword, salt), salt, u.id);
  return { success: true, message: 'Password changed.' };
}

/* ========================================================================
   ADMIN — USERS
   ======================================================================== */
async function handleAdminCreateUser(ctx, body) {
  await requireAdmin(ctx, body.token);
  const email = lower(body.email), name = str(body.name).trim(), mda = str(body.mda).trim();
  const role = body.role === 'admin' ? 'admin' : 'user';
  if (!email || !name || !mda) return { success: false, message: 'Name, email, and MDA are required.' };
  const existing = await ctx.first('SELECT * FROM users WHERE lower(email) = ?', email);
  if (existing) {
    if (await isSuperAdminUser(ctx, existing)) return { success: false, message: 'That email cannot be used. Please choose another.' };
    return { success: false, message: 'An account with that email already exists.' };
  }
  const tempPassword = randomPassword(10), salt = uuid();
  await ctx.run('INSERT INTO users (id, email, password_hash, salt, name, mda, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    uuid(), email, await hashPassword(tempPassword, salt), salt, name, mda, role, lagosNow());
  const sent = await sendMail(ctx, email, 'Y2027 Eligibility Portal — Your Account',
    `An account has been created for you on the Y2027 Eligibility List Portal.\n\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nSign in at ${await portalUrl(ctx)} and change your password from the Account panel.`);
  return { success: true, tempPassword, message: sent ? 'Account created and emailed to the user.' : 'Account created. Give the user the temporary password shown.' };
}
async function handleAdminListUsers(ctx, body) {
  await requireAdmin(ctx, body.token);
  const boot = await bootstrapEmail(ctx);
  const rows = await ctx.all("SELECT id, email, name, mda, role, created_at FROM users WHERE role != 'superadmin' AND lower(email) != ? ORDER BY rowid", boot);
  return { success: true, users: rows.map(u => ({ id: u.id, email: u.email, name: u.name, mda: u.mda, role: u.role, createdAt: u.created_at })) };
}
async function handleAdminDeleteUser(ctx, body) {
  await requireAdmin(ctx, body.token);
  const u = await ctx.first('SELECT * FROM users WHERE lower(email) = ?', lower(body.email));
  if (!u || await isSuperAdminUser(ctx, u)) return { success: false, message: 'Account not found.' };
  await ctx.run('DELETE FROM users WHERE id = ?', u.id);
  return { success: true };
}

/* ========================================================================
   ELIGIBILITY RECORDS
   ======================================================================== */
const RECORD_INSERT = `INSERT INTO submissions (${RECORD_COLUMNS.join(', ')}) VALUES (${RECORD_COLUMNS.map(() => '?').join(', ')})`;
async function handleSubmit(ctx, body) {
  const s = await requireUser(ctx, body.token);
  const records = body.records;
  if (!Array.isArray(records) || !records.length) return { success: false, message: 'No records supplied.' };
  const now = lagosNow();
  const stmts = records.map(r => {
    const rec = { ...r, id: uuid(), timestamp: now, submitted_by: s.email };
    if (!isAdminRole(s.role)) rec.mda = s.mda; // non-admins can't spoof another MDA
    return ctx.db.prepare(RECORD_INSERT).bind(...RECORD_COLUMNS.map(c => str(rec[c])));
  });
  await ctx.db.batch(stmts);
  return { success: true, inserted: stmts.length };
}
function recordOut(row) { const o = {}; RECORD_COLUMNS.forEach(c => { o[c] = str(row[c]); }); return o; }
async function visibleRecords(ctx, mda) {
  const supers = await superAdminEmails(ctx);
  const rows = mda
    ? await ctx.all('SELECT * FROM submissions WHERE lower(trim(mda)) = ? ORDER BY seq', lower(mda))
    : await ctx.all('SELECT * FROM submissions ORDER BY seq');
  return rows.filter(r => supers.indexOf(lower(r.submitted_by)) === -1).map(recordOut);
}
async function handleGetAll(ctx, body) {
  await requireAdmin(ctx, body.token);
  return { success: true, records: await visibleRecords(ctx, '') };
}
async function handleAdminUpdateRecord(ctx, body) {
  await requireAdmin(ctx, body.token);
  const fields = body.fields || {};
  const cols = RECORD_COLUMNS.filter(c => !['id','timestamp','submitted_by'].includes(c) && fields[c] !== undefined);
  const row = await ctx.first('SELECT id FROM submissions WHERE id = ?', str(body.id));
  if (!row) return { success: false, message: 'Record not found.' };
  if (cols.length) await ctx.run(`UPDATE submissions SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`, ...cols.map(c => str(fields[c])), row.id);
  return { success: true };
}
async function handleAdminDeleteRecord(ctx, body) {
  await requireAdmin(ctx, body.token);
  const r = await ctx.run('DELETE FROM submissions WHERE id = ?', str(body.id));
  return r.meta.changes ? { success: true } : { success: false, message: 'Record not found.' };
}
// Public aggregate analytics — counts only, no personal data, no login.
async function handleGetAnalytics(ctx) {
  const recs = await visibleRecords(ctx, '');
  const byMda = {}, byGrade = {}, notional = { jan: 0, jul: 0, other: 0 }, bracket = { low: 0, high: 0, other: 0 };
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  recs.forEach(r => {
    const mda = str(r.mda).trim() || '(Unspecified)';
    byMda[mda] = (byMda[mda] || 0) + 1;
    let g = str(r.grade_promotion).replace(/[^\d]/g, '');
    if (g) { g = ('0' + parseInt(g, 10)).slice(-2); byGrade[g] = (byGrade[g] || 0) + 1; }
    const gi = parseInt(g, 10);
    if (!isNaN(gi)) { if (gi >= 6 && gi <= 10) bracket.low++; else if (gi >= 12 && gi <= 16) bracket.high++; else bracket.other++; } else bracket.other++;
    const s = str(r.proposed_notional_date); let month = -1, m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) month = +m[2] - 1;
    else if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/))) month = +m[2] - 1;
    else if ((m = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i))) month = months.indexOf(m[1].toLowerCase());
    if (month === 0) notional.jan++; else if (month === 6) notional.jul++; else notional.other++;
  });
  return { success: true, total: recs.length, byMda, byPromotionGrade: byGrade, notional, bracket };
}

/* ========================================================================
   FORM A — BRIEF ON CANDIDATE
   ======================================================================== */
function briefOut(row, withPhoto = true) {
  let fields = {};
  try { fields = JSON.parse(row.fields || '{}'); } catch (e) { fields = {}; }
  const o = { id: row.id, timestamp: str(row.timestamp) };
  BRIEF_FIELD_KEYS.forEach(k => { o[k] = str(fields[k]); });
  // Lists are loaded WITHOUT photographs (thousands of ~45 KB photos in one query exceed
  // D1's memory limit); the page fetches the ones it needs with getPhotos.
  if (withPhoto && row.photo !== undefined) o['Photo (data URL)'] = str(row.photo);
  if (row.has_photo !== undefined) o.has_photo = !!row.has_photo;
  o['Status'] = str(row.status) || 'Pending';
  o['Authorized By'] = str(row.authorized_by);
  o['Authorized MDA'] = str(row.authorized_mda);
  o['Authorized At'] = str(row.authorized_at);
  return o;
}
const BRIEF_LIST_COLS = "seq, id, timestamp, mda, fields, status, authorized_by, authorized_mda, authorized_at, (photo IS NOT NULL AND photo != '') AS has_photo";
async function briefsFor(ctx, mda) {
  return mda
    ? ctx.all(`SELECT ${BRIEF_LIST_COLS} FROM briefs WHERE lower(trim(mda)) = ? ORDER BY seq`, lower(mda))
    : ctx.all(`SELECT ${BRIEF_LIST_COLS} FROM briefs ORDER BY seq`);
}
async function handleSubmitBrief(ctx, body) {
  const brief = body.brief || {};
  const missing = BRIEF_FIELD_KEYS.filter(k => !BRIEF_OPTIONAL_KEYS.includes(k) && !str(brief[k]).trim());
  if (missing.length) return { success: false, message: 'Required fields are missing: ' + missing.join(', ') };
  const photo = str(body.photo);
  if (!photo) return { success: false, message: 'Passport photograph is required.' };
  const fields = {}; BRIEF_FIELD_KEYS.forEach(k => { fields[k] = str(brief[k]).trim(); });
  const id = uuid();
  await ctx.run("INSERT INTO briefs (id, timestamp, mda, fields, photo, status) VALUES (?, ?, ?, ?, ?, 'Pending')",
    id, lagosNow(), fields['Department/Ministry'], JSON.stringify(fields), photo);
  return { success: true, id, message: 'Brief on Candidate saved.' };
}
async function handleListBriefs(ctx, body) {
  const s = await requireUser(ctx, body.token);
  const isAdmin = isAdminRole(s.role);
  const rows = await briefsFor(ctx, isAdmin ? '' : s.mda);
  return { success: true, briefs: rows.map(r => briefOut(r)), isAdmin };
}
async function handleUpdateBrief(ctx, body) {
  const s = await requireUser(ctx, body.token);
  const isAdmin = isAdminRole(s.role);
  const row = await ctx.first('SELECT * FROM briefs WHERE id = ?', str(body.id));
  if (!row) return { success: false, message: 'Form A record not found.' };
  if (!isAdmin) {
    if (!sameMda(row.mda, s.mda)) return { success: false, message: 'You can only edit Form A records for your own MDA.' };
    if (row.status === 'Sent') return { success: false, message: 'This Form A has already been sent to the Commission and can no longer be edited.' };
  }
  const fields = JSON.parse(row.fields || '{}');
  const edits = body.fields || {};
  Object.keys(edits).forEach(k => { if (BRIEF_FIELD_KEYS.includes(k)) fields[k] = str(edits[k]); });
  await ctx.run('UPDATE briefs SET fields = ?, mda = ? WHERE id = ?', JSON.stringify(fields), fields['Department/Ministry'], row.id);
  return { success: true };
}
async function handleAuthorizeBrief(ctx, body) {
  const s = await requireUser(ctx, body.token);
  const row = await ctx.first('SELECT id, mda FROM briefs WHERE id = ?', str(body.id));
  if (!row) return { success: false, message: 'Form A record not found.' };
  if (!isAdminRole(s.role) && !sameMda(row.mda, s.mda)) return { success: false, message: 'You can only authorize Form A records for your own MDA.' };
  await ctx.run("UPDATE briefs SET status = 'Sent', authorized_by = ?, authorized_mda = ?, authorized_at = ? WHERE id = ?",
    `${s.name} (${s.email})`, s.mda, lagosNow(), row.id);
  return { success: true };
}

/* ========================================================================
   MDA PRINT LINKS — a passwordless link per MDA, tied to that MDA's email
   address(es). Opening the link shows nothing until the holder types one of
   those addresses; 5 wrong addresses lock the link for 15 minutes. A match
   opens a 1-hour session that can only list, print and download that MDA's
   slips. Replacing or switching off the link, or removing the email, ends the
   session at once. Every sign-in, print and download is written to the log.
   ======================================================================== */
const MDA_LINK_SESSION_MS = 60 * 60 * 1000;   // 1 hour
const MDA_LINK_TRIES = 5, MDA_LINK_LOCK_MS = 15 * 60 * 1000;
const MDA_LINK_FIELDS = ['brief_id', 'seap_no', 'surname_first', 'mda', 'csc_file_no', 'oracle_no', 'post_1st_appt', 'grade_1st', 'date_1st_appt',
  'date_confirmation', 'present_post', 'grade_present', 'date_present_appt', 'promotion_post', 'grade_promotion'];
const MDA_LINK_EVENTS = { print: 'MDA link: slips printed', pdf: 'MDA link: slips downloaded (PDF)', xlsx: 'MDA link: list downloaded (Excel)',
  forma_print: 'MDA link: Form A printed', forma_pdf: 'MDA link: Form A downloaded (PDF)' };
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
let mdaLinkSchemaReady = false;
async function ensureMdaLinkSchema(ctx) {
  if (mdaLinkSchemaReady) return;
  await ctx.db.batch([
    ctx.db.prepare('CREATE TABLE IF NOT EXISTS mda_links (mda TEXT PRIMARY KEY COLLATE NOCASE, link_id TEXT UNIQUE, emails TEXT, active INTEGER DEFAULT 1, created_by TEXT, created_at TEXT, last_used TEXT)'),
    ctx.db.prepare('CREATE TABLE IF NOT EXISTS mda_link_tries (link_id TEXT PRIMARY KEY, fails INTEGER DEFAULT 0, window_start INTEGER)'),
    ctx.db.prepare('CREATE TABLE IF NOT EXISTS mda_link_sessions (token TEXT PRIMARY KEY, link_id TEXT, mda TEXT, email TEXT, expiry INTEGER)'),
  ]);
  mdaLinkSchemaReady = true;
}
const parseEmails = v => [...new Set(str(v).split(/[\s,;]+/).map(e => lower(e)).filter(Boolean))];
const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
async function activeLink(ctx, linkId) {
  const id = str(linkId).trim();
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const l = await ctx.first('SELECT * FROM mda_links WHERE link_id = ?', id);
  return l && Number(l.active) ? l : null;
}
const LINK_GONE = 'This link is not valid. It may have been replaced or switched off — please ask the Civil Service Commission for your MDA\'s current link.';
async function mdaLinkSession(ctx, token) {
  const t = str(token);
  const s = t ? await ctx.first('SELECT * FROM mda_link_sessions WHERE token = ?', t) : null;
  if (!s) throw new UserError('Your session has ended — please sign in again with a new code.');
  const l = await activeLink(ctx, s.link_id);
  if (Number(s.expiry) < Date.now() || !l || !sameMda(l.mda, s.mda) || !parseEmails(l.emails).includes(lower(s.email))) {
    await ctx.run('DELETE FROM mda_link_sessions WHERE token = ?', t);
    throw new UserError(Number(s.expiry) < Date.now() ? 'Your 1-hour session has ended — please sign in again with a new code.' : LINK_GONE);
  }
  return s;
}
async function mdaLinkAudit(ctx, s, status, detail, count) {
  const log = { id: uuid(), timestamp: lagosNow(), checked_by: `${s.email} (MDA link)`, mda: s.mda, source: 'MDA print link', file_name: '', officer_name: '',
    oracle_no: '', csc_file_no: '', record_id: '', status, match_method: '', fields_compared: '', fields_matched: '', discrepancies: count === undefined ? '' : String(count), discrepancy_details: str(detail) };
  await ctx.run(VERIFICATION_INSERT, ...VERIFICATION_COLUMNS.map(c => str(log[c])));
}
async function handleMdaLinkStart(ctx, body) {
  const l = await activeLink(ctx, body.link);
  return l ? { success: true, mda: l.mda } : { success: false, message: LINK_GONE };
}
async function handleMdaLinkOpen(ctx, body) {
  const l = await activeLink(ctx, body.link);
  if (!l) return { success: false, message: LINK_GONE };
  const email = lower(body.email), now = Date.now();
  const tries = await ctx.first('SELECT * FROM mda_link_tries WHERE link_id = ?', l.link_id);
  const fresh = !tries || now - Number(tries.window_start) > MDA_LINK_LOCK_MS;
  const fails = fresh ? 0 : Number(tries.fails) || 0;
  if (fails >= MDA_LINK_TRIES) return { success: false, message: 'Too many wrong email addresses were tried on this link. Please wait 15 minutes and try again.' };
  if (!EMAIL_RE.test(email) || !parseEmails(l.emails).includes(email)) {
    await ctx.run('INSERT OR REPLACE INTO mda_link_tries (link_id, fails, window_start) VALUES (?, ?, ?)', l.link_id, fails + 1, fresh ? now : Number(tries.window_start));
    const left = MDA_LINK_TRIES - fails - 1;
    return { success: false, message: left > 0 ? `That email address is not registered for this link. ${left} more tr${left === 1 ? 'y' : 'ies'} before the link is locked for 15 minutes.` : 'Too many wrong email addresses were tried on this link. Please wait 15 minutes and try again.' };
  }
  const token = randomHex(24), expiry = now + MDA_LINK_SESSION_MS;
  await ctx.db.batch([
    ctx.db.prepare('DELETE FROM mda_link_tries WHERE link_id = ?').bind(l.link_id),
    ctx.db.prepare('DELETE FROM mda_link_sessions WHERE expiry < ?').bind(now),
    ctx.db.prepare('INSERT INTO mda_link_sessions (token, link_id, mda, email, expiry) VALUES (?, ?, ?, ?, ?)').bind(token, l.link_id, l.mda, email, expiry),
    ctx.db.prepare('UPDATE mda_links SET last_used = ? WHERE link_id = ?').bind(`${lagosNow()} · ${email}`, l.link_id),
  ]);
  await mdaLinkAudit(ctx, { email, mda: l.mda }, 'MDA link: signed in', '');
  return { success: true, mdaToken: token, mda: l.mda, email, expiresAt: expiry };
}
async function handleMdaLinkData(ctx, body) {
  const s = await mdaLinkSession(ctx, body.mdaToken);
  const rows = await ctx.all(`SELECT ${MDA_LINK_FIELDS.map(c => 'v.' + c).join(', ')}, v.form_a_check, (b.id IS NOT NULL) AS form_a,
    ((b.photo IS NOT NULL AND b.photo != '') OR (v.photo IS NOT NULL AND v.photo != '')) AS has_photo
    FROM verified v LEFT JOIN briefs b ON b.id = v.brief_id WHERE lower(trim(v.mda)) = ? ORDER BY v.seq`, lower(s.mda));
  const records = [];
  for (const r of rows) {
    const o = {}; MDA_LINK_FIELDS.forEach(c => { o[c] = str(r[c]); });
    o.has_photo = !!r.has_photo; o.form_a = !!r.form_a; o.form_a_check = str(r.form_a_check) || (r.form_a ? 'Matches Form A' : 'No Form A');
    o.verify_code = `${r.brief_id}.${await slipSignature(ctx, r.brief_id)}`;
    records.push(o);
  }
  return { success: true, mda: s.mda, email: s.email, expiresAt: Number(s.expiry), records };
}
async function handleMdaLinkPhotos(ctx, body) {
  const s = await mdaLinkSession(ctx, body.mdaToken);
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))].slice(0, 25);
  const photos = {};
  if (ids.length) {
    (await ctx.all(`SELECT v.brief_id AS id, COALESCE(NULLIF(b.photo, ''), v.photo) AS photo FROM verified v LEFT JOIN briefs b ON b.id = v.brief_id
      WHERE v.brief_id IN (${ids.map(() => '?').join(',')}) AND lower(trim(v.mda)) = ?`, ...ids, lower(s.mda))).forEach(r => { photos[r.id] = str(r.photo); });
  }
  return { success: true, photos };
}
// The Form A (Brief on Candidate) of each officer on the session's MDA list who submitted one: the
// officer's own details, shown beside the slip. Photographs come separately from mdaLinkPhotos.
async function handleMdaLinkBriefs(ctx, body) {
  const s = await mdaLinkSession(ctx, body.mdaToken);
  const rows = await ctx.all(`SELECT b.id, b.timestamp, b.fields, b.status, b.authorized_by, b.authorized_mda, b.authorized_at
    FROM verified v JOIN briefs b ON b.id = v.brief_id WHERE lower(trim(v.mda)) = ?`, lower(s.mda));
  const briefs = {}; rows.forEach(r => { briefs[r.id] = briefOut(r, false); });
  return { success: true, briefs };
}
async function handleMdaLinkLog(ctx, body) {
  const s = await mdaLinkSession(ctx, body.mdaToken);
  const status = MDA_LINK_EVENTS[str(body.event)];
  if (!status) return { success: false, message: 'Unknown event.' };
  const n = Math.max(0, parseInt(body.count, 10) || 0);
  await mdaLinkAudit(ctx, s, status, str(body.detail).slice(0, 200), n);
  return { success: true };
}
async function handleMdaLinkSignOut(ctx, body) {
  await ctx.run('DELETE FROM mda_link_sessions WHERE token = ?', str(body.mdaToken));
  return { success: true };
}
// ---- Administrators: one link per MDA in Verified and Authentic Data ----
async function mdaLinkView(ctx) {
  const counts = await ctx.all("SELECT trim(mda) AS mda, COUNT(*) AS n FROM verified WHERE trim(COALESCE(mda, '')) != '' GROUP BY lower(trim(mda)) ORDER BY lower(trim(mda))");
  const links = await ctx.all('SELECT * FROM mda_links');
  const users = await ctx.all("SELECT email, mda FROM users WHERE role = 'user'");
  const byMda = new Map();
  counts.forEach(c => byMda.set(lower(c.mda), { mda: str(c.mda), officers: Number(c.n) }));
  links.forEach(l => { if (!byMda.has(lower(l.mda))) byMda.set(lower(l.mda), { mda: str(l.mda), officers: 0 }); });
  return [...byMda.values()].sort((a, b) => a.mda.localeCompare(b.mda)).map(m => {
    const l = links.find(x => sameMda(x.mda, m.mda));
    return { ...m, link: l ? str(l.link_id) : '', emails: l ? parseEmails(l.emails) : [], active: !!(l && Number(l.active)),
      createdAt: l ? str(l.created_at) : '', createdBy: l ? str(l.created_by) : '', lastUsed: l ? str(l.last_used) : '',
      suggested: users.filter(u => sameMda(u.mda, m.mda)).map(u => lower(u.email)) };
  });
}
async function handleListMdaLinks(ctx, body) {
  await requireAdmin(ctx, body.token);
  return { success: true, links: await mdaLinkView(ctx) };
}
async function handleSaveMdaLink(ctx, body) {
  const s = await requireAdmin(ctx, body.token);
  const mda = str(body.mda).trim(), emails = parseEmails(body.emails);
  if (!mda) return { success: false, message: 'MDA is required.' };
  if (!emails.length) return { success: false, message: 'Enter at least one email address for this MDA.' };
  const badEmail = emails.find(e => !EMAIL_RE.test(e));
  if (badEmail) return { success: false, message: `"${badEmail}" is not a valid email address.` };
  const old = await ctx.first('SELECT * FROM mda_links WHERE mda = ?', mda);
  const replace = !old || !!body.newLink;
  const linkId = replace ? randomHex(16) : old.link_id;
  const stmts = [];
  if (old) stmts.push(ctx.db.prepare('UPDATE mda_links SET link_id = ?, emails = ?, active = 1' + (replace ? ', created_by = ?, created_at = ?' : '') + ' WHERE mda = ?')
    .bind(...[linkId, emails.join(', ')].concat(replace ? [`${s.name} (${s.email})`, lagosNow()] : []).concat([old.mda])));
  else stmts.push(ctx.db.prepare('INSERT INTO mda_links (mda, link_id, emails, active, created_by, created_at, last_used) VALUES (?, ?, ?, 1, ?, ?, ?)').bind(mda, linkId, emails.join(', '), `${s.name} (${s.email})`, lagosNow(), ''));
  if (old && replace) stmts.push(ctx.db.prepare('DELETE FROM mda_link_sessions WHERE link_id = ?').bind(old.link_id), ctx.db.prepare('DELETE FROM mda_link_tries WHERE link_id = ?').bind(old.link_id));
  await ctx.db.batch(stmts);
  return { success: true, mda: old ? old.mda : mda, link: linkId, emails, replaced: !!(old && replace) };
}
async function handleSetMdaLinkActive(ctx, body) {
  await requireAdmin(ctx, body.token);
  const l = await ctx.first('SELECT * FROM mda_links WHERE mda = ?', str(body.mda).trim());
  if (!l) return { success: false, message: 'This MDA has no link yet.' };
  const on = !!body.active;
  const stmts = [ctx.db.prepare('UPDATE mda_links SET active = ? WHERE mda = ?').bind(on ? 1 : 0, l.mda)];
  if (!on) stmts.push(ctx.db.prepare('DELETE FROM mda_link_sessions WHERE link_id = ?').bind(l.link_id));
  await ctx.db.batch(stmts);
  return { success: true, active: on };
}

/* ========================================================================
   VERIFICATION
   ======================================================================== */
async function handleGetVerificationData(ctx, body) {
  const s = await requireUser(ctx, body.token);
  const isAdmin = isAdminRole(s.role);
  const mda = isAdmin ? str(body.mda).trim() : str(s.mda).trim();
  const briefs = (await briefsFor(ctx, mda)).map(r => briefOut(r));
  const eligibility = await visibleRecords(ctx, mda);
  return { success: true, mda, isAdmin, briefs, eligibility };
}
const VERIFICATION_INSERT = `INSERT INTO verifications (${VERIFICATION_COLUMNS.join(', ')}) VALUES (${VERIFICATION_COLUMNS.map(() => '?').join(', ')})`;
async function handleSaveVerification(ctx, body) {
  const s = await requireUser(ctx, body.token);
  const results = Array.isArray(body.results) ? body.results : [];
  if (!results.length) return { success: false, message: 'No verification results supplied.' };
  const isAdmin = isAdminRole(s.role);
  const mda = isAdmin ? str(body.mda || s.mda) : str(s.mda);
  const now = lagosNow(), checkedBy = `${s.name} (${s.email})`;
  const stmts = results.map(r => {
    const rec = { id: uuid(), timestamp: now, checked_by: checkedBy, mda: isAdmin ? str(r.mda || mda) : mda, source: str(body.source), file_name: str(body.fileName) };
    VERIFICATION_COLUMNS.forEach(c => { if (rec[c] === undefined) rec[c] = str(r[c]); });
    return ctx.db.prepare(VERIFICATION_INSERT).bind(...VERIFICATION_COLUMNS.map(c => str(rec[c])));
  });
  await ctx.db.batch(stmts);
  return { success: true, saved: stmts.length };
}
const VERIFIED_INSERT = `INSERT INTO verified (${VERIFIED_COLUMNS.join(', ')}) VALUES (${VERIFIED_COLUMNS.map(() => '?').join(', ')})`;
// Same rules as Code.gs: only officers whose Form A belongs to the user's MDA and
// whose Oracle No agrees with it are stored; Form A details are copied server-side.
// Saves EVERY officer on the uploaded list (the slip uses the list's details). Officers
// with a Form A are linked to it (photo + Form A details); officers without one get a
// stable id from their MDA + Oracle No (or File No, or name), so re-uploading updates
// them instead of duplicating. MDA users can only save officers of their own MDA.
function officerIdentity(rec) {
  const oracle = digitsOnly(rec.oracle_no);
  if (oracle) return 'o:' + oracle;
  const csc = str(rec.csc_file_no).toUpperCase().replace(/[\s.,]/g, '');
  if (csc) return 'c:' + csc;
  const name = str(rec.surname_first).toUpperCase().replace(/[.,'’\-]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  return name ? 'n:' + name : '';
}
async function listOnlyId(mda, identity) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(lower(mda) + '|' + identity));
  return 'L-' + [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function handleSaveVerifiedData(ctx, body) {
  const s = await requireUser(ctx, body.token);
  const isAdmin = isAdminRole(s.role);
  const verified = Array.isArray(body.verified) ? body.verified : [];
  const revoke = Array.isArray(body.revoke) ? body.revoke.map(String) : [];
  const ids = [...new Set(verified.map(v => str(v.brief_id)).concat(revoke))].filter(Boolean);
  const briefs = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    (await ctx.all(`SELECT ${BRIEF_LIST_COLS} FROM briefs WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk)).forEach(r => { briefs[r.id] = briefOut(r, false); });
  }
  const inScope = b => b && (isAdmin || sameMda(b['Department/Ministry'], s.mda));
  const existing = await ctx.all('SELECT seq, brief_id, mda, oracle_no FROM verified');
  // Rows to drop: the officer's previous entry (same id, or same Oracle No in the same MDA).
  const drop = new Set();
  const markOfficer = (id, mda, oracleRaw) => {
    const oracle = digitsOnly(oracleRaw);
    existing.forEach(row => {
      if (str(row.brief_id) === str(id)) drop.add(row.seq);
      else if (oracle && digitsOnly(row.oracle_no) === oracle && sameMda(row.mda, mda)) drop.add(row.seq);
    });
  };
  const now = lagosNow(), verifiedBy = `${s.name} (${s.email})`;
  const inserts = []; const rejected = []; const storedIds = []; const seen = new Set();
  let withFormA = 0, withoutFormA = 0;
  for (const rec of verified) {
    let b = rec.brief_id ? briefs[str(rec.brief_id)] : null;
    if (b && !inScope(b)) { rejected.push(`${rec.surname_first || '?'}: that Form A belongs to another MDA`); continue; }
    // Placement follows the uploaded list: the MDA on the sheet's "MDA:" line (MDA users: their own MDA).
    // The Form A's MDA is only a fallback when the sheet names none.
    let id, mda = isAdmin ? (str(rec.mda).trim() || (b ? str(b['Department/Ministry']).trim() : '')) : str(s.mda).trim();
    if (!mda) { rejected.push(`${rec.surname_first || '?'}: MDA not known (write it beside "MDA:" on the sheet)`); continue; }
    if (b) id = b.id;
    else {
      const identity = officerIdentity(rec);
      if (!identity) { rejected.push(`Row with no name, Oracle No or File No skipped`); continue; }
      id = await listOnlyId(mda, identity);
    }
    if (seen.has(id)) continue; // the same officer twice on one list: keep the first row
    seen.add(id);
    markOfficer(id, mda, rec.oracle_no || (b && b['Oracle No.']));
    const out = { brief_id: id, verified_at: now, verified_by: verifiedBy, mda, source_file: str(body.fileName), fields_compared: str(rec.fields_compared) };
    VERIFIED_SHEET_FIELDS.forEach(k => { out[k] = str(rec[k]); });
    if (b) {
      if (!out.surname_first) out.surname_first = b['Name (Surname first)'];
      if (!out.oracle_no) out.oracle_no = b['Oracle No.'];
      if (!out.csc_file_no) out.csc_file_no = b['CSC File No.'];
      VERIFIED_BRIEF_FIELDS.forEach(([col, key]) => { out[col] = str(b[key]); });
    }
    out.form_a_check = b ? (FORM_A_CHECKS.includes(rec.form_a_check) && rec.form_a_check !== 'No Form A' ? rec.form_a_check : 'Matches Form A') : 'No Form A';
    out.photo = '';
    b ? withFormA++ : withoutFormA++;
    inserts.push(ctx.db.prepare(VERIFIED_INSERT).bind(...VERIFIED_COLUMNS.map(c => str(out[c]))));
    storedIds.push(id);
  }
  let revoked = 0;
  revoke.forEach(rid => { const b = briefs[rid]; if (inScope(b)) { const before = drop.size; markOfficer(b.id, b['Department/Ministry'], b['Oracle No.']); revoked += drop.size - before; } });
  // One atomic batch: delete the old entries, then insert the fresh ones.
  const stmts = [...drop].map(seq => ctx.db.prepare('DELETE FROM verified WHERE seq = ?').bind(seq)).concat(inserts);
  if (stmts.length) await ctx.db.batch(stmts);
  return { success: true, stored: storedIds.length, storedIds, withFormA, withoutFormA, revoked, rejected };
}
// Photographs for up to 25 officers: from their Form A, or one added with Edit (officers without a Form A).
async function handleGetPhotos(ctx, body) {
  const s = await requireUser(ctx, body.token);
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))].slice(0, 25);
  const photos = {};
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    const ok = mda => isAdminRole(s.role) || sameMda(mda, s.mda);
    // An officer placed in the user's MDA by its list may have a Form A filed under another MDA name.
    const placed = new Set();
    (await ctx.all(`SELECT brief_id AS id, mda, photo FROM verified WHERE brief_id IN (${marks})`, ...ids))
      .forEach(r => { if (!ok(r.mda)) return; placed.add(r.id); if (str(r.photo)) photos[r.id] = str(r.photo); });
    (await ctx.all(`SELECT id, mda, photo FROM briefs WHERE id IN (${marks})`, ...ids))
      .forEach(r => { if ((ok(r.mda) || placed.has(r.id)) && !photos[r.id]) photos[r.id] = str(r.photo); });
  }
  return { success: true, photos };
}
async function handleListVerifiedData(ctx, body) {
  const s = await requireUser(ctx, body.token);
  const mda = isAdminRole(s.role) ? str(body.mda).trim() : str(s.mda).trim();
  const HAS = "((b.photo IS NOT NULL AND b.photo != '') OR (v.photo IS NOT NULL AND v.photo != '')) AS has_photo";
  const rows = mda
    ? await ctx.all(`SELECT ${VERIFIED_LIST_COLS}, ${HAS} FROM verified v LEFT JOIN briefs b ON b.id = v.brief_id WHERE lower(trim(v.mda)) = ? ORDER BY v.seq`, lower(mda))
    : await ctx.all(`SELECT ${VERIFIED_LIST_COLS}, ${HAS} FROM verified v LEFT JOIN briefs b ON b.id = v.brief_id ORDER BY v.seq`);
  const records = [];
  for (const r of rows) {
    const o = {}; VERIFIED_COLUMNS.forEach(c => { if (c !== 'photo') o[c] = str(r[c]); });
    o.has_photo = !!r.has_photo;
    o.verify_code = `${r.brief_id}.${await slipSignature(ctx, r.brief_id)}`;
    records.push(o);
  }
  return { success: true, mda, records };
}
// Public: checks the QR code printed on a slip. Returns only what the slip shows.
async function handleVerifySlip(ctx, body) {
  const code = str(body.code).trim(), dot = code.lastIndexOf('.');
  const id = dot > 0 ? code.slice(0, dot) : '', sig = dot > 0 ? code.slice(dot + 1) : '';
  if (!id || !sig || sig !== await slipSignature(ctx, id))
    return { success: true, valid: false, reason: 'not_genuine', message: 'This slip was NOT issued by the portal — the verification code is not genuine.' };
  const r = await ctx.first("SELECT v.*, COALESCE(NULLIF(b.photo, ''), v.photo) AS photo FROM verified v LEFT JOIN briefs b ON b.id = v.brief_id WHERE v.brief_id = ?", id);
  if (!r) return { success: true, valid: false, reason: 'revoked', message: 'This slip was issued by the portal but is NO LONGER VALID — the officer is not currently in Verified and Authentic Data.' };
  const record = {}; PUBLIC_SLIP_FIELDS.forEach(k => { record[k] = str(r[k]); });
  record.photo = str(r.photo);
  return { success: true, valid: true, record };
}

/* ========================================================================
   FIX MDA GROUPING (administrators only). Officers uploaded before placement
   followed the list were filed under the MDA on their own Form A. Each upload
   (same file, same uploader) came from one sheet; its officers without a Form A
   were filed under that sheet's MDA, so every officer of the upload moves there.
   Uploads whose sheet MDA can't be told need an MDA chosen in `choices`.
   Officers whose MDA an administrator changed with Edit are left alone.
   ======================================================================== */
function planRegroup(rows, editedIds, choices) {
  const key = r => str(r.source_file) + '\u0001' + str(r.verified_by);
  const norm = m => lower(str(m).trim());
  const byKey = new Map();
  rows.forEach(r => { const k = key(r); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); });
  const groups = [], moves = [];
  for (const [k, list] of byKey) {
    const count = m => list.filter(r => norm(r.mda) === norm(m)).length;
    const mdas = [...new Map(list.map(r => [norm(r.mda), str(r.mda).trim()])).values()].filter(Boolean).sort((a, b) => count(b) - count(a));
    const sheetMdas = [...new Map(list.filter(r => str(r.form_a_check) === 'No Form A').map(r => [norm(r.mda), str(r.mda).trim()])).values()].filter(Boolean);
    const g = { key: k, file: str(list[0].source_file), by: str(list[0].verified_by), total: list.length, mdas, moves: [] };
    let target = '';
    if (!str(list[0].source_file)) { g.status = 'unknown'; g.reason = 'no file name recorded'; }
    else if (sheetMdas.length === 1) { g.status = 'auto'; target = sheetMdas[0]; }
    else if (mdas.length <= 1) { g.status = 'ok'; target = mdas[0] || ''; }
    else { g.status = 'choose'; g.reason = sheetMdas.length ? 'officers without a Form A on this list are under different MDAs' : 'every officer on this list has a Form A, so the sheet\'s MDA is not recorded'; }
    const chosen = choices && str(choices[k]).trim();
    if (chosen) { target = chosen; g.status = 'chosen'; }
    g.sheetMda = target; g.suggested = target || mdas[0] || '';
    if (target) {
      const from = {};
      list.forEach(r => {
        if (norm(r.mda) === norm(target) || editedIds.has(str(r.brief_id))) return;
        moves.push({ row: r, from: str(r.mda).trim(), to: target });
        from[str(r.mda).trim()] = (from[str(r.mda).trim()] || 0) + 1;
      });
      g.moves = Object.entries(from).map(([m, n]) => ({ from: m, count: n }));
    }
    groups.push(g);
  }
  // After the moves, the same officer (same Oracle No) now twice in one MDA from two different uploads
  // keeps only the latest entry. Two rows of one upload are never merged (that is the list's own data).
  const moved = new Map(moves.map(m => [m.row.seq, m.to]));
  const latest = new Map(), dupes = [];
  rows.slice().sort((a, b) => b.seq - a.seq).forEach(r => {
    const o = digitsOnly(r.oracle_no); if (!o) return;
    const k = norm(moved.get(r.seq) || r.mda) + '|' + o;
    if (!latest.has(k)) latest.set(k, r);
    else if (key(latest.get(k)) !== key(r) && (moved.has(r.seq) || moved.has(latest.get(k).seq))) dupes.push(r);
  });
  groups.sort((a, b) => (b.moves.length - a.moves.length) || a.file.localeCompare(b.file));
  return { groups, moves, dupes };
}
async function handleRegroupVerifiedMda(ctx, body) {
  const s = await requireAdmin(ctx, body.token);
  const rows = await ctx.all('SELECT seq, brief_id, mda, source_file, verified_by, form_a_check, surname_first, oracle_no, csc_file_no FROM verified ORDER BY seq');
  const edited = new Set((await ctx.all("SELECT record_id, discrepancy_details FROM verifications WHERE status = 'Edited'"))
    .filter(r => /(^|; )mda: /.test(str(r.discrepancy_details))).map(r => str(r.record_id)));
  const plan = planRegroup(rows, edited, body.choices || {});
  const summary = { success: true, groups: plan.groups.filter(g => g.status !== 'ok' || g.moves.length).map(({ key, file, by, total, status, reason, sheetMda, suggested, mdas, moves }) => ({ key, file, by, total, status, reason, sheetMda, suggested, mdas, moves })),
    toMove: plan.moves.length, duplicates: plan.dupes.length, editedKept: edited.size };
  if (!body.apply) return summary;
  const now = lagosNow(), by = `${s.name} (${s.email})`;
  const stmts = [];
  plan.moves.forEach(m => {
    stmts.push(ctx.db.prepare('UPDATE verified SET mda = ? WHERE seq = ?').bind(m.to, m.row.seq));
    const log = { id: uuid(), timestamp: now, checked_by: by, mda: m.to, source: 'Fix MDA grouping', file_name: str(m.row.source_file), officer_name: str(m.row.surname_first),
      oracle_no: str(m.row.oracle_no), csc_file_no: str(m.row.csc_file_no), record_id: str(m.row.brief_id), status: 'MDA corrected', match_method: '', fields_compared: '',
      fields_matched: '', discrepancies: '1', discrepancy_details: `mda: "${m.from}" → "${m.to}" (placed by its eligibility list)` };
    stmts.push(ctx.db.prepare(VERIFICATION_INSERT).bind(...VERIFICATION_COLUMNS.map(c => str(log[c]))));
  });
  plan.dupes.forEach(r => stmts.push(ctx.db.prepare('DELETE FROM verified WHERE seq = ?').bind(r.seq)));
  for (let i = 0; i < stmts.length; i += 100) await ctx.db.batch(stmts.slice(i, i + 100));
  return { ...summary, applied: true, moved: plan.moves.length, duplicatesRemoved: plan.dupes.length };
}

/* ========================================================================
   FULL BACKUP (super administrator only) — same format as Code.gs's exportTab,
   so a backup taken here can be re-imported with migrate/import-backup.js.
   ======================================================================== */
const EXPORT_QUERIES = {
  Users: ['SELECT * FROM users ORDER BY rowid', u => ({ id: u.id, email: u.email, passwordHash: u.password_hash, salt: u.salt, name: u.name, mda: u.mda, role: u.role, createdAt: str(u.created_at), resetToken: '', resetTokenExpiry: '' })],
  Submissions: ['SELECT * FROM submissions ORDER BY seq', recordOut],
  Briefs: ['SELECT * FROM briefs ORDER BY seq', r => briefOut(r, true)],
  Verifications: ['SELECT * FROM verifications ORDER BY seq', r => { const o = {}; VERIFICATION_COLUMNS.forEach(c => { o[c] = str(r[c]); }); return o; }],
  'Verified and Authentic Data': ['SELECT * FROM verified ORDER BY seq', r => { const o = {}; VERIFIED_COLUMNS.forEach(c => { o[c] = str(r[c]); }); return o; }],
};
async function handleExportTab(ctx, body) {
  const s = await requireAdmin(ctx, body.token);
  if (s.role !== 'superadmin' && lower(s.email) !== await bootstrapEmail(ctx)) return { success: false, message: 'Only the super administrator can download a full backup.' };
  const tab = str(body.tab);
  if (tab === 'AdminConfig') {
    return { success: true, tab, config: {
      bootstrap_password: str((await ctx.config('bootstrap_password')) || ctx.env.BOOTSTRAP_ADMIN_PASSWORD || ''),
      bootstrap_email: await bootstrapEmail(ctx), portal_url: str(await ctx.config('portal_url')), download_secret: await downloadSecret(ctx) } };
  }
  const q = EXPORT_QUERIES[tab];
  if (!q) return { success: false, message: 'Unknown tab: ' + tab };
  const table = q[0].match(/FROM (\w+)/)[1];
  const total = (await ctx.first(`SELECT COUNT(*) AS n FROM ${table}`)).n;
  const offset = Math.max(0, parseInt(body.offset, 10) || 0);
  const cap = tab === 'Briefs' ? 20 : (tab === 'Verified and Authentic Data' ? 100 : 500); // tabs with photographs: small pages
  const limit = Math.min(cap, Math.max(1, parseInt(body.limit, 10) || 200));
  const rows = (await ctx.all(`${q[0]} LIMIT ? OFFSET ?`, limit, offset)).map(q[1]);
  return { success: true, tab, total, rows };
}

/* ========================================================================
   EDIT A VERIFIED OFFICER (administrators only) — corrects what is printed on
   the slip, and optionally replaces the passport photograph. Every change is
   written to the verification log ("field: old → new").
   ======================================================================== */
const SLIP_EDITABLE = ['seap_no','surname_first','mda','csc_file_no','oracle_no','post_1st_appt','grade_1st','date_1st_appt',
  'date_confirmation','present_post','grade_present','date_present_appt','promotion_post','grade_promotion'];
async function handleUpdateVerifiedRecord(ctx, body) {
  const s = await requireAdmin(ctx, body.token);
  const row = await ctx.first('SELECT * FROM verified WHERE brief_id = ?', str(body.brief_id));
  if (!row) return { success: false, message: 'This officer is no longer in Verified and Authentic Data.' };
  const fields = body.fields || {};
  const cols = SLIP_EDITABLE.filter(k => fields[k] !== undefined && str(fields[k]).trim() !== str(row[k]));
  if (cols.includes('surname_first') && !str(fields.surname_first).trim()) return { success: false, message: 'Name cannot be empty.' };
  const photo = str(body.photo);
  if (photo && (!/^data:image\//.test(photo) || photo.length > 200000)) return { success: false, message: 'The photograph is not a valid image (or is too large).' };
  if (!cols.length && !photo) return { success: true, changed: 0 };
  const stmts = [];
  if (cols.length) stmts.push(ctx.db.prepare(`UPDATE verified SET ${cols.map(c => c + ' = ?').join(', ')} WHERE brief_id = ?`).bind(...cols.map(c => str(fields[c]).trim()), row.brief_id));
  if (photo) {
    const hasBrief = await ctx.first('SELECT id FROM briefs WHERE id = ?', row.brief_id);
    stmts.push(hasBrief ? ctx.db.prepare('UPDATE briefs SET photo = ? WHERE id = ?').bind(photo, row.brief_id)
                        : ctx.db.prepare('UPDATE verified SET photo = ? WHERE brief_id = ?').bind(photo, row.brief_id));
  }
  const changes = cols.map(c => `${c}: "${str(row[c])}" → "${str(fields[c]).trim()}"`).concat(photo ? ['photo: replaced'] : []);
  const after = { ...row }; cols.forEach(c => { after[c] = str(fields[c]).trim(); });
  const log = { id: uuid(), timestamp: lagosNow(), checked_by: `${s.name} (${s.email})`, mda: after.mda, source: 'Edited slip record', file_name: '',
    officer_name: after.surname_first, oracle_no: after.oracle_no, csc_file_no: after.csc_file_no, record_id: row.brief_id, status: 'Edited',
    match_method: '', fields_compared: '', fields_matched: '', discrepancies: String(changes.length), discrepancy_details: changes.join('; ') };
  stmts.push(ctx.db.prepare(VERIFICATION_INSERT).bind(...VERIFICATION_COLUMNS.map(c => str(log[c]))));
  await ctx.db.batch(stmts);
  return { success: true, changed: changes.length };
}
