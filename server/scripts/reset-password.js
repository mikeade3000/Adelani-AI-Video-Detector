/* Emergency password reset, e.g. when every admin is locked out.
 * STOP the SQL Quest server first, then run:
 *   DATABASE_URL=postgres://... node server/scripts/reset-password.js <username> <new-password> [--make-admin]
 * then start the server again. */
'use strict';
const crypto = require('crypto');
const { Client } = require('pg');

(async () => {
  const [username, password] = process.argv.slice(2);
  const makeAdmin = process.argv.includes('--make-admin');
  if (!process.env.DATABASE_URL || !username || !password) {
    console.error('Usage: DATABASE_URL=postgres://... node server/scripts/reset-password.js <username> <new-password> [--make-admin]');
    process.exit(1);
  }
  if (password.length < 6) { console.error('Password must be at least 6 characters.'); process.exit(1); }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = 'scrypt$' + crypto.scryptSync(password, salt, 64).toString('hex');
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined });
  await c.connect();
  const r = await c.query(
    "UPDATE users SET salt = $2, pass_hash = $3, active = TRUE, " +
    (makeAdmin ? "role = 'admin', doc = jsonb_set(jsonb_set(doc, '{active}', 'true'::jsonb), '{role}', '\"admin\"'::jsonb)" : "doc = jsonb_set(doc, '{active}', 'true'::jsonb)") +
    ' WHERE username = $1 RETURNING id, role', [username.toLowerCase(), salt, hash]);
  if (!r.rowCount) { console.error('No user called "' + username + '".'); await c.end(); process.exit(1); }
  await c.query('DELETE FROM sessions WHERE user_id = $1', [r.rows[0].id]);
  await c.end();
  console.log('Password reset for "' + username + '" (role: ' + r.rows[0].role + '). Start the server again and log in.');
})().catch((e) => { console.error(e.message); process.exit(1); });
