-- Y2027 Promotion Eligibility List Portal — Cloudflare D1 schema.
-- One table per tab of the original Google Sheet. Every value is stored as TEXT,
-- exactly as the portal sends it (so phone numbers keep their leading zero).
-- Timestamps are Lagos time, formatted 'YYYY-MM-DD HH:mm' like the Apps Script backend.

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,   -- bootstrap_email, bootstrap_password, portal_url, download_secret
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,   -- stored lower-case
  password_hash TEXT NOT NULL,          -- hex SHA-256 of "password:salt" (same as Code.gs)
  salt          TEXT NOT NULL,
  name          TEXT,
  mda           TEXT,
  role          TEXT,                   -- user | admin | superadmin
  created_at    TEXT,
  reset_token   TEXT,
  reset_expiry  INTEGER                 -- epoch ms
);

CREATE TABLE IF NOT EXISTS sessions (
  token  TEXT PRIMARY KEY,
  email  TEXT,
  role   TEXT,
  name   TEXT,
  mda    TEXT,
  expiry INTEGER                        -- epoch ms
);

-- Eligibility records (Single Entry / Bulk Upload). Column names = RECORD_COLUMNS.
CREATE TABLE IF NOT EXISTS submissions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,  -- keeps the original sheet order
  id TEXT NOT NULL UNIQUE, timestamp TEXT, submitted_by TEXT, mda TEXT, surname_first TEXT,
  csc_file_no TEXT, oracle_no TEXT, post_1st_appt TEXT, grade_1st TEXT, date_1st_appt TEXT,
  date_confirmation TEXT, present_post TEXT, grade_present TEXT, date_present_appt TEXT,
  promotion_post TEXT, grade_promotion TEXT, proposed_notional_date TEXT, proposed_financial_date TEXT,
  official_email TEXT, mobile_no TEXT, disability TEXT, remarks TEXT
);
CREATE INDEX IF NOT EXISTS submissions_mda ON submissions (mda COLLATE NOCASE);

-- Form A (Brief on Candidate). The 30 form fields are kept as one JSON object
-- keyed by the form's labels, exactly as the portal sends them.
CREATE TABLE IF NOT EXISTS briefs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id             TEXT NOT NULL UNIQUE,
  timestamp      TEXT,
  mda            TEXT,                  -- copy of fields["Department/Ministry"], for filtering
  fields         TEXT NOT NULL,         -- JSON
  photo          TEXT,                  -- passport photograph (JPEG data URL, ~45 KB max)
  status         TEXT DEFAULT 'Pending',
  authorized_by  TEXT,
  authorized_mda TEXT,
  authorized_at  TEXT
);
CREATE INDEX IF NOT EXISTS briefs_mda ON briefs (mda COLLATE NOCASE);

-- Audit log of verification checks. Column names = VERIFICATION_COLUMNS.
CREATE TABLE IF NOT EXISTS verifications (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE, timestamp TEXT, checked_by TEXT, mda TEXT, source TEXT, file_name TEXT, officer_name TEXT,
  oracle_no TEXT, csc_file_no TEXT, record_id TEXT, status TEXT, match_method TEXT, fields_compared TEXT,
  fields_matched TEXT, discrepancies TEXT, discrepancy_details TEXT
);

-- "Verified and Authentic Data". Column names = VERIFIED_COLUMNS.
CREATE TABLE IF NOT EXISTS verified (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_id TEXT NOT NULL UNIQUE, verified_at TEXT, verified_by TEXT, mda TEXT, source_file TEXT, fields_compared TEXT,
  surname_first TEXT, oracle_no TEXT, csc_file_no TEXT, post_1st_appt TEXT, grade_1st TEXT, date_1st_appt TEXT,
  date_confirmation TEXT, present_post TEXT, grade_present TEXT, date_present_appt TEXT, promotion_post TEXT,
  grade_promotion TEXT, proposed_notional_date TEXT, proposed_financial_date TEXT, official_email TEXT,
  mobile_no TEXT, disability TEXT, remarks TEXT, date_of_birth TEXT, state_of_origin TEXT, nationality TEXT,
  age TEXT, conversion_post TEXT, educ_post_primary TEXT, educ_secondary TEXT, educ_university TEXT,
  educ_professional TEXT, educ_additional TEXT, last_query TEXT, disciplinary_action TEXT, pending_request TEXT,
  appraisal_2023 TEXT, appraisal_2024 TEXT, appraisal_2025 TEXT, appraisal_2026 TEXT, certifying_officer TEXT,
  certifying_rank TEXT, certifying_phone TEXT, certification_date TEXT, form_a_status TEXT, form_a_submitted TEXT,
  seap_no TEXT, form_a_check TEXT, photo TEXT
);
CREATE INDEX IF NOT EXISTS verified_mda ON verified (mda COLLATE NOCASE);

-- MDA print links: one passwordless link per MDA, opened by typing one of the
-- MDA's email addresses. Sessions last 1 hour. (Also created by the Worker on first use.)
CREATE TABLE IF NOT EXISTS mda_links (
  mda TEXT PRIMARY KEY COLLATE NOCASE, link_id TEXT UNIQUE, emails TEXT, active INTEGER DEFAULT 1,
  created_by TEXT, created_at TEXT, last_used TEXT
);
CREATE TABLE IF NOT EXISTS mda_link_tries (   -- wrong email addresses typed; 5 lock the link for 15 minutes
  link_id TEXT PRIMARY KEY, fails INTEGER DEFAULT 0, window_start INTEGER
);
CREATE TABLE IF NOT EXISTS mda_link_sessions (
  token TEXT PRIMARY KEY, link_id TEXT, mda TEXT, email TEXT, expiry INTEGER
);

-- Examination results: entered by panels (Draft), confirmed by the Director CMD, amended only by the
-- Permanent Secretary or the super administrator. Officers view their confirmed result with their
-- Eligibility/SEAP number and email. (Also created by the Worker on first use.)
CREATE TABLE IF NOT EXISTS results (
  brief_id TEXT PRIMARY KEY, email TEXT, written TEXT, oral TEXT, total TEXT, remark TEXT, comment TEXT,
  status TEXT, entered_by TEXT, entered_at TEXT, confirmed_by TEXT, confirmed_at TEXT,
  amended_by TEXT, amended_at TEXT, updated INTEGER
);
CREATE TABLE IF NOT EXISTS result_tries (   -- unsuccessful candidate sign-ins; 5 lock that number for 15 minutes
  seap TEXT PRIMARY KEY, fails INTEGER DEFAULT 0, window_start INTEGER
);
