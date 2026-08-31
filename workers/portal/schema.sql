-- Moje krev: one database, one person per login. The account IS the patient —
-- there is deliberately no name, birth date or rodné číslo anywhere in this
-- schema. Identity is redacted in the browser before upload; the only
-- identifier at rest is the login e-mail.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,          -- crypto.randomUUID()
  email      TEXT UNIQUE NOT NULL,      -- lowercased
  created_at TEXT NOT NULL,             -- ISO 8601
  settings   TEXT                       -- JSON: learned synonyms, prefs
);

-- Signup is invite-only: a code is minted by the operator, burned by exactly
-- one registration. used_by is set atomically (UPDATE ... WHERE used_by IS
-- NULL), which is what makes a code single-use under a race.
CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  note       TEXT,                      -- who this was minted for, free text
  created_at TEXT NOT NULL,
  used_by    TEXT REFERENCES users(id),
  used_at    TEXT
);

-- Magic-link tokens. Only the SHA-256 of the token is stored, so a database
-- read never yields a working login link. Single-use, enforced the same way
-- as invites (UPDATE ... WHERE used_at IS NULL).
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,          -- epoch seconds
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

-- The lossless truth: one LabReport JSON per upload, exactly the shape
-- lab-core produced it in. Trends, review, derived values are computed from
-- payloads in the client — SQL never re-derives a clinical rule.
CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  report_date TEXT,
  lab_name    TEXT,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS reports_by_user ON reports (user_id, report_date);

-- Redacted page images live in KV (this account has no R2 opt-in; a page
-- sits far under KV's value cap). The row is the owner check: a page is
-- served only through its report's user_id.
CREATE TABLE IF NOT EXISTS report_pages (
  report_id TEXT NOT NULL REFERENCES reports(id),
  page_num  INTEGER NOT NULL,
  kv_key    TEXT NOT NULL,
  width     INTEGER,
  height    INTEGER,
  PRIMARY KEY (report_id, page_num)
);
