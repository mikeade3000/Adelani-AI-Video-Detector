#!/usr/bin/env node
/**
 * One-command deployment of the Y2027 Eligibility Portal to Cloudflare.
 *
 *   node scripts/deploy.mjs                          set up (first time) or update, then publish
 *   node scripts/deploy.mjs --backup backup.json     ...and load a portal backup into the database
 *   node scripts/deploy.mjs --ci                     non-interactive (GitHub Actions); needs
 *                                                    CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
 *
 * Steps (each is safe to repeat):
 *   1. Make sure we are signed in to Cloudflare (browser login, or an API token).
 *   2. Find the D1 database "eligibility_portal" — create it if it does not exist —
 *      and write its id into wrangler.toml.
 *   3. Create any missing tables (schema.sql only uses CREATE ... IF NOT EXISTS).
 *   4. Optionally import a backup (.json from "Download Full Backup"); only new rows are added.
 *   5. Copy the latest portal page into the Worker and publish it.
 *   6. Store settings found in the environment as Worker secrets: BOOTSTRAP_ADMIN_EMAIL /
 *      BOOTSTRAP_ADMIN_PASSWORD (first super admin on an EMPTY database), RESEND_API_KEY,
 *      MAIL_FROM, PORTAL_URL. Interactive runs with no backup ask for a first admin password.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_NAME = 'eligibility_portal';
const TOML = join(ROOT, 'wrangler.toml');
const PORTAL_HTML = resolve(ROOT, '..', 'Y2027_Eligibility_List_Portal.html');
const SECRET_NAMES = ['BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD', 'RESEND_API_KEY', 'MAIL_FROM']; // PORTAL_URL is set in wrangler.toml

const args = process.argv.slice(2);
const CI = args.includes('--ci') || process.env.CI === 'true';
const YES = CI || args.includes('--yes');
const backupArg = (() => { const i = args.indexOf('--backup'); return i !== -1 ? args[i + 1] : (args.find(a => a.startsWith('--backup=')) || '').slice(9); })();

// Run wrangler from this project's node_modules (WRANGLER_BIN overrides it, e.g. for tests).
const WRANGLER = process.env.WRANGLER_BIN || join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
function wrangler(argv, { capture = false, input } = {}) {
  const r = spawnSync(process.execPath, [WRANGLER, ...argv], {
    cwd: ROOT, encoding: 'utf8', input,
    stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.error) throw r.error;
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
const step = (n, text) => console.log(`\n\x1b[1m[${n}/6] ${text}\x1b[0m`);
const ok = text => console.log(`  \x1b[32m✓\x1b[0m ${text}`);
function fail(text) { console.error(`\n\x1b[31m✗ ${text}\x1b[0m`); process.exit(1); }
async function confirm(question) {
  if (YES) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`  ${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return a === 'y' || a === 'yes';
}

// Wrangler may print warnings (e.g. "▲ [WARNING] Proxy ...") before the JSON: parse from the
// first line that itself starts with "[" or "{".
function parseJsonOut(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*[\[{]/.test(lines[i])) continue;
    try { return JSON.parse(lines.slice(i).join('\n')); } catch (e) { /* keep looking */ }
  }
  throw new Error('no JSON in wrangler output');
}
// True when the URL answers with the portal's JSON (retries for about a minute).
async function answers(target) {
  const checkUrl = process.env.DEPLOY_CHECK_URL || target;   // override for tests
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(checkUrl, { signal: AbortSignal.timeout(10000) });
      if (r.ok && /backend is running/.test(await r.text())) return true;
    } catch (e) { /* not ready yet */ }
    if (i < 5) await new Promise(res => setTimeout(res, Number(process.env.DEPLOY_CHECK_WAIT_MS || 10000)));
  }
  return false;
}
function remoteUserCount() {
  const r = wrangler(['d1', 'execute', DB_NAME, '--remote', '--json', '--command', 'SELECT COUNT(*) AS n FROM users'], { capture: true });
  try { return parseJsonOut(r.stdout)[0].results[0].n; } catch (e) { return -1; } // -1 = unknown
}
// Prompt without echoing what is typed (raw keyboard mode on a terminal; plain line read otherwise).
function askHidden(question) {
  process.stdout.write(question);
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise(res => {
      const rl = createInterface({ input: stdin, terminal: false });
      rl.once('line', line => { rl.close(); process.stdout.write('\n'); res(line.trim()); });
      rl.once('close', () => res(''));
    });
  }
  return new Promise(res => {
    let value = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = ch => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); return res(value.trim()); }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }            // Ctrl+C
        if (c === '\u007f' || c === '\b') { if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        value += c; process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  console.log('Y2027 Eligibility Portal → Cloudflare' + (CI ? ' (CI mode)' : ''));
  if (!existsSync(WRANGLER)) fail('Wrangler is not installed here. Run "npm install" in the cloudflare folder first.');
  if (!existsSync(PORTAL_HTML)) fail(`Portal page not found: ${PORTAL_HTML}`);
  if (backupArg && !existsSync(backupArg)) fail(`Backup file not found: ${backupArg}`);

  // 1. Sign-in
  step(1, 'Checking the Cloudflare sign-in');
  let who = wrangler(['whoami'], { capture: true });
  if (/not authenticated|not logged in/i.test(who.out) || who.code !== 0) {
    if (CI) fail('Not signed in. Set the CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets (see CLOUDFLARE_MIGRATION.md).');
    console.log('  Opening your browser to sign in to Cloudflare…');
    if (wrangler(['login']).code !== 0) fail('Cloudflare sign-in did not complete.');
    who = wrangler(['whoami'], { capture: true });
    if (who.code !== 0) fail('Still not signed in to Cloudflare.\n' + who.out);
  }
  const account = (who.out.match(/associated with the email ([^\s.]+@[^\s]+?)\.?\s/) || [])[1];
  ok(account ? `Signed in as ${account}` : 'Signed in');

  // 2. Database
  step(2, `Finding the "${DB_NAME}" database`);
  const findDb = () => {
    const r = wrangler(['d1', 'list', '--json'], { capture: true });
    if (r.code !== 0) fail('Could not list D1 databases:\n' + r.out);
    let list;
    try { list = parseJsonOut(r.stdout); } catch (e) { fail('Unexpected output from "wrangler d1 list --json":\n' + r.out); }
    return list.find(d => d.name === DB_NAME);
  };
  let db = findDb();
  if (!db) {
    console.log('  Not found — creating it…');
    const r = wrangler(['d1', 'create', DB_NAME], { capture: true });
    if (r.code !== 0) fail('Could not create the database:\n' + r.out);
    db = findDb();
    if (!db) fail('The database was created but could not be found afterwards. Run this script again.');
    ok(`Created database ${db.uuid}`);
  } else ok(`Found database ${db.uuid}`);
  const toml = readFileSync(TOML, 'utf8');
  const updated = toml.replace(/(database_id\s*=\s*")[^"]*(")/, `$1${db.uuid}$2`);
  if (updated !== toml) { writeFileSync(TOML, updated); ok('Saved the database id in wrangler.toml'); }
  else if (!toml.includes(db.uuid)) fail('Could not find a database_id line in wrangler.toml.');

  // 3. Tables
  step(3, 'Creating any missing tables');
  if (wrangler(['d1', 'execute', DB_NAME, '--remote', '--yes', `--file=${join(ROOT, 'schema.sql')}`], { capture: true }).code !== 0)
    fail('Could not apply schema.sql to the database.');
  // Databases created by an earlier version: add newer columns (CREATE ... IF NOT EXISTS leaves old tables as they are).
  const info = wrangler(['d1', 'execute', DB_NAME, '--remote', '--json', '--command', 'PRAGMA table_info(verified)'], { capture: true });
  let have = [];
  try { have = parseJsonOut(info.stdout)[0].results.map(r => r.name); } catch (e) { /* unknown: the Worker adds them on first use */ }
  for (const c of (have.length ? ['seap_no', 'form_a_check', 'photo'].filter(c => !have.includes(c)) : [])) {
    if (wrangler(['d1', 'execute', DB_NAME, '--remote', '--yes', '--command', `ALTER TABLE verified ADD COLUMN ${c} TEXT`], { capture: true }).code !== 0) fail(`Could not add the ${c} column.`);
    ok(`Added the new "${c}" column`);
  }
  ok('Tables are in place (existing data untouched)');

  // 4. Backup import (optional)
  step(4, 'Importing a backup');
  if (!backupArg) ok('Skipped (no --backup file given)');
  else {
    const counts = JSON.parse(readFileSync(backupArg, 'utf8'));
    const n = t => ((counts.tabs || {})[t] || []).length;
    console.log(`  ${backupArg}: ${n('Users')} users, ${n('Briefs')} Form As, ${n('Submissions')} records, ${n('Verified and Authentic Data')} verified officers.`);
    if (!(await confirm('Import it? Only rows not already in Cloudflare are added; nothing is overwritten.'))) ok('Import skipped');
    else {
      const sqlFile = join(ROOT, 'import.sql');
      const gen = spawnSync(process.execPath, [join(ROOT, 'migrate', 'import-backup.js'), backupArg, `--out=${sqlFile}`], { cwd: ROOT, encoding: 'utf8' });
      if (gen.status !== 0) fail('Could not read the backup:\n' + gen.stdout + gen.stderr);
      if (wrangler(['d1', 'execute', DB_NAME, '--remote', '--yes', `--file=${sqlFile}`], { capture: true }).code !== 0) fail('Importing the backup into the database failed.');
      ok('Backup imported');
    }
  }

  // 5. Publish
  step(5, 'Publishing the portal');
  mkdirSync(join(ROOT, 'public'), { recursive: true });
  copyFileSync(PORTAL_HTML, join(ROOT, 'public', 'index.html'));
  const canonical = (readFileSync(TOML, 'utf8').match(/^CANONICAL_HOST\s*=\s*"([^"]+)"/m) || [])[1];
  // Phase 1: publish with the redirect OFF (the old address keeps serving the portal directly).
  const dep = wrangler(['deploy', ...(canonical ? ['--var', 'CANONICAL_HOST:off', '--var', 'PORTAL_URL:off'] : [])], { capture: true });
  process.stdout.write(dep.out.split('\n').filter(l => /https?:\/\/|Uploaded|Deployed|custom domain|✘/i.test(l)).map(l => '  ' + l.trim()).join('\n') + '\n');
  const dnsConflict = /externally managed DNS records|code: 100117/i.test(dep.out);
  const uploaded = /Uploaded /.test(dep.out);
  if (dep.code !== 0 && !(dnsConflict && uploaded)) fail('Publishing failed:\n' + dep.out);
  const oldUrl = (dep.out.match(/https:\/\/[^\s]+\.workers\.dev/) || [])[0];
  let url = oldUrl;
  if (dnsConflict) {
    console.log(`\n  \x1b[33m! The portal is live at its current address${oldUrl ? ' (' + oldUrl + ')' : ''}, but the new address`);
    console.log(`    ${canonical} could not be attached: a DNS record with that name already exists.`);
    console.log('    To fix: Cloudflare dashboard → portals.com.ng → DNS → Records → delete the record');
    console.log(`    named "${canonical.split('.')[0]}", then run this again.\x1b[0m`);
  } else if (canonical) {
    // Phase 2: only once the new address really answers over HTTPS, publish with the redirect ON.
    console.log(`  Checking https://${canonical} (a brand-new address can take a few minutes)…`);
    if (await answers(`https://${canonical}/api`)) {
      const dep2 = wrangler(['deploy'], { capture: true });
      if (dep2.code !== 0) fail('Switching on the redirect failed:\n' + dep2.out);
      ok(`New address working; the old address now redirects to https://${canonical}`);
      url = `https://${canonical}`;
    } else {
      console.log(`\n  \x1b[33m! https://${canonical} is attached but not answering yet (its security certificate is`);
      console.log('    probably still being issued). The portal stays on the current address for now.');
      console.log('    Run this again in 10–15 minutes to switch everyone to the new address.\x1b[0m');
    }
  }

  // 6. Settings (after publishing: secrets can only be added to an existing Worker)
  step(6, 'Settings');
  // An empty database needs a first super-admin password (there is no default password).
  const users = remoteUserCount();
  if (users === 0 && !process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    if (CI) console.log('  ! The database has no accounts yet: set the BOOTSTRAP_ADMIN_PASSWORD secret, or import a backup.');
    else {
      console.log('  The database has no accounts yet, so a first super administrator is needed.');
      const pw = await askHidden(`  Choose a password (8+ characters) for ${process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@portal.local'}: `);
      if (pw.length < 8) fail('Choose a password of at least 8 characters, then run the script again.');
      process.env.BOOTSTRAP_ADMIN_PASSWORD = pw;
    }
  }
  const present = SECRET_NAMES.filter(k => process.env[k]);
  if (!present.length) ok('None set (email sending stays off until RESEND_API_KEY is provided — see CLOUDFLARE_MIGRATION.md)');
  else if (!present.includes('RESEND_API_KEY')) ok('Email sending stays off until RESEND_API_KEY is provided');
  for (const k of present) {
    if (k === 'BOOTSTRAP_ADMIN_EMAIL') process.env[k] = process.env[k].trim().toLowerCase();
    if (wrangler(['secret', 'put', k], { input: process.env[k] + '\n' }).code !== 0) fail(`Could not store ${k}.`);
    ok(`Stored ${k}`);
  }

  console.log(`\n\x1b[32m✓ Done.\x1b[0m The portal is live${url ? ` at:\n\n    ${url}\n` : '.'}`);
  if (url && !backupArg) console.log('  (To load your data, run again with: --backup path/to/Y2027_Portal_Backup.json)');
}
main().catch(e => fail(e.message));
