#!/usr/bin/env node
/**
 * Migration: portal backup (.json) -> SQL for Cloudflare D1.
 *
 *   1. On the CURRENT portal, sign in as the super administrator →
 *      Admin Dashboard → "Download Full Backup (.json)".
 *   2. node migrate/import-backup.js Y2027_Portal_Backup_YYYY-MM-DD.json      (writes import.sql)
 *   3. npx wrangler d1 execute eligibility_portal --remote --file=import.sql
 *
 * Copies users (with their existing passwords), Form A submissions and photos,
 * eligibility records, the verification log, Verified and Authentic Data, and the
 * secret behind per-MDA download links and slip QR codes (so those keep working).
 * Sessions are not copied — everyone simply signs in again.
 *
 * Every row is inserted with INSERT OR IGNORE, so importing a LATER backup on top
 * adds only what is new (e.g. Form As submitted between the first import and the
 * switch-over) and never duplicates. Rows already in D1 are not changed.
 * --replace wipes the tables first (only before go-live: it deletes anything already in D1).
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const replace = args.includes('--replace');
const outFile = (args.find(a => a.startsWith('--out=')) || '--out=import.sql').slice(6);
if (!file) { console.error('Usage: node migrate/import-backup.js <backup.json> [--out=import.sql] [--replace]'); process.exit(1); }

const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!backup || !backup.tabs) { console.error('That file is not a portal backup (no "tabs").'); process.exit(1); }

const RECORD_COLUMNS = ['id','timestamp','submitted_by','mda','surname_first','csc_file_no','oracle_no','post_1st_appt','grade_1st',
  'date_1st_appt','date_confirmation','present_post','grade_present','date_present_appt','promotion_post','grade_promotion',
  'proposed_notional_date','proposed_financial_date','official_email','mobile_no','disability','remarks'];
const VERIFICATION_COLUMNS = ['id','timestamp','checked_by','mda','source','file_name','officer_name','oracle_no','csc_file_no',
  'record_id','status','match_method','fields_compared','fields_matched','discrepancies','discrepancy_details'];
const VERIFIED_COLUMNS = ['brief_id','verified_at','verified_by','mda','source_file','fields_compared','surname_first','oracle_no',
  'csc_file_no','post_1st_appt','grade_1st','date_1st_appt','date_confirmation','present_post','grade_present','date_present_appt',
  'promotion_post','grade_promotion','proposed_notional_date','proposed_financial_date','official_email','mobile_no','disability',
  'remarks','date_of_birth','state_of_origin','nationality','age','conversion_post','educ_post_primary','educ_secondary',
  'educ_university','educ_professional','educ_additional','last_query','disciplinary_action','pending_request','appraisal_2023',
  'appraisal_2024','appraisal_2025','appraisal_2026','certifying_officer','certifying_rank','certifying_phone','certification_date',
  'form_a_status','form_a_submitted','seap_no','form_a_check','photo'];
const BRIEF_FIELD_KEYS = ['Name (Surname first)','Department/Ministry','Date of 1st Appt','Designation at 1st Appt',
  'Date of Confirmation','Date of Present Appt','Present Designation','Conversion Post','Educ: Post Primary','Educ: Secondary School',
  'Educ: University etc','Educ: Professional Certificates','Educ: Additional Qualification','Date of Birth','State of Origin',
  'Nationality','Age','CSC File No.','Oracle No.','Date issued last query','Facing disciplinary action?',
  'Pending request/appeal/appraisal','Appraisal 2023 Score','Appraisal 2024 Score','Appraisal 2025 Score','Appraisal 2026 Score',
  'Certifying Officer Name','Certifying Officer Rank','Certifying Officer Telephone','Certification Date'];
// Phone columns whose leading 0 Google Sheets dropped in rows saved before the plain-text fix.
const PHONE_COLUMNS = new Set(['mobile_no', 'certifying_phone', 'Certifying Officer Telephone']);

const text = (key, v) => {
  let s = (v === null || v === undefined) ? '' : String(v);
  if (PHONE_COLUMNS.has(key) && /^[789]\d{9}$/.test(s)) s = '0' + s;
  return s;
};
const q = v => (v === null || v === undefined) ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'";
const insert = (table, cols, vals, verb = 'INSERT OR IGNORE') => `${verb} INTO ${table} (${cols.join(', ')}) VALUES (${vals.map(q).join(', ')});`;
const tab = name => Array.isArray(backup.tabs[name]) ? backup.tabs[name] : [];

const sql = [];
const counts = {};
if (replace) ['results', 'verified', 'verifications', 'briefs', 'submissions', 'sessions', 'users', 'config'].forEach(t => sql.push(`DELETE FROM ${t};`));

// Config: the super-admin email (keeps that account hidden) and the HMAC secret
// behind per-MDA links and slip QR codes. The old portal URL is not copied, so
// password-reset links point at the new Cloudflare address.
const cfg = backup.config || {};
[['bootstrap_password', cfg.bootstrap_password], ['bootstrap_email', String(cfg.bootstrap_email || '').toLowerCase()], ['download_secret', cfg.download_secret]]
  .filter(([, v]) => v).forEach(([k, v]) => sql.push(insert('config', ['key', 'value'], [k, v], 'INSERT OR REPLACE')));

counts.users = 0;
tab('Users').forEach(u => {
  if (!u.email) return;
  sql.push(insert('users', ['id', 'email', 'password_hash', 'salt', 'name', 'mda', 'role', 'created_at'],
    [text('id', u.id) || require('crypto').randomUUID(), String(u.email).trim().toLowerCase(), text('', u.passwordHash), text('', u.salt),
     text('', u.name), text('', u.mda), text('', u.role), text('', u.createdAt)]));
  counts.users++;
});
counts.submissions = 0;
tab('Submissions').forEach(r => { if (!r.id) return; sql.push(insert('submissions', RECORD_COLUMNS, RECORD_COLUMNS.map(c => text(c, r[c])))); counts.submissions++; });
counts.briefs = 0; counts.photos = 0;
tab('Briefs').forEach(b => {
  if (!b.id) return;
  const fields = {}; BRIEF_FIELD_KEYS.forEach(k => { fields[k] = text(k, b[k]); });
  const photo = text('', b['Photo (data URL)']);
  if (photo) counts.photos++;
  sql.push(insert('briefs', ['id', 'timestamp', 'mda', 'fields', 'photo', 'status', 'authorized_by', 'authorized_mda', 'authorized_at'],
    [text('id', b.id), text('', b.timestamp), fields['Department/Ministry'], JSON.stringify(fields), photo, text('', b.Status) || 'Pending',
     text('', b['Authorized By']), text('', b['Authorized MDA']), text('', b['Authorized At'])]));
  counts.briefs++;
});
counts.verifications = 0;
tab('Verifications').forEach(r => { sql.push(insert('verifications', VERIFICATION_COLUMNS, VERIFICATION_COLUMNS.map(c => text(c, r[c])))); counts.verifications++; });
const RESULT_COLUMNS = ['brief_id','email','written','oral','total','remark','comment','status','entered_by','entered_at','confirmed_by','confirmed_at','amended_by','amended_at'];
counts.results = 0;
tab('Results').forEach(r => { if (!r.brief_id) return; sql.push(insert('results', RESULT_COLUMNS.concat(['updated']), RESULT_COLUMNS.map(c => text(c, r[c])).concat([String(Date.now())]))); counts.results++; });
counts.verified = 0;
tab('Verified and Authentic Data').forEach(r => { if (!r.brief_id) return; sql.push(insert('verified', VERIFIED_COLUMNS, VERIFIED_COLUMNS.map(c => text(c, r[c])))); counts.verified++; });

fs.writeFileSync(outFile, sql.join('\n') + '\n');
console.log(`Wrote ${path.resolve(outFile)}  (backup taken ${backup.exportedAt || 'unknown'})`);
Object.entries(counts).forEach(([k, n]) => console.log(`  ${k.padEnd(14)} ${n}`));
if (!cfg.download_secret) console.log('  WARNING: no download secret in the backup — existing per-MDA links and slip QR codes will stop working.');
console.log(`\nNext: npx wrangler d1 execute eligibility_portal --remote --file=${outFile}`);
