-- Moje krev: one database, one person per login. The account IS the patient —
-- there is deliberately no name, birth date or rodné číslo anywhere in this
-- schema. Identity is redacted in the browser before upload; the only
-- identifier at rest is the login e-mail.
--
-- This file is the schema for a fresh database. The live database is moved
-- forward by the files in migrations/, which are additive and each applied
-- once — a column added here must also be added there.

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,      -- crypto.randomUUID()
  email          TEXT UNIQUE NOT NULL,  -- lowercased
  created_at     TEXT NOT NULL,         -- ISO 8601
  settings       TEXT,                  -- JSON: learned synonyms, the AI context, prefs
  -- PBKDF2-SHA256 (src/password.ts): hex digest, hex 16-byte salt, and the
  -- iteration count the row was hashed with, so the count can rise without
  -- re-hashing everyone. All three NULL means the account cannot log in
  -- until a set-password link is used.
  password_hash  TEXT,
  password_salt  TEXT,
  password_iters INTEGER,
  -- This person's monthly extraction ceiling in USD. NULL means "whatever
  -- PORTAL_USD_LIMIT says", which is the answer for almost everyone; a
  -- number here overrides it for this account alone, so one person can be
  -- raised without raising the family. 0 is a real value — it freezes the
  -- account's uploads without touching anyone else's.
  budget_usd     REAL,
  -- Which generation of this account's sessions is live. The login cookie
  -- is a stateless signed claim and carries this number; a cookie whose
  -- number is not the row's is refused. Logout and a set-password link add
  -- one, which is how a copied cookie stops working when the person meant
  -- it to (src/session.ts).
  session_epoch  INTEGER NOT NULL DEFAULT 0,
  -- The allowance, counted in documents (src/allowance.ts). A document is
  -- one upload — a PDF or one set of photos, up to MAX_PAGES_PER_REPORT
  -- pages. Every account starts with 5, for good; a purchase or the
  -- operator adds to doc_allowance, and doc_used moves up by one when a
  -- document is accepted for extraction — never per page, and never back
  -- down when a report is deleted (a read was paid for). The one way down
  -- is a document no page of which could be read.
  doc_allowance  INTEGER NOT NULL DEFAULT 5,
  doc_used       INTEGER NOT NULL DEFAULT 0
);

-- Every door into an account is a code the operator mints: unbound (user_id
-- NULL) it opens a new account, bound it sets that account's password. Both
-- live 24 hours (expires_at; NULL on codes minted before links expired) and
-- both burn on exactly one use — used_at is set atomically (UPDATE ... WHERE
-- used_at IS NULL), which is what makes a code single-use under a race.
CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  note       TEXT,                      -- who this was minted for, free text
  created_at TEXT NOT NULL,
  used_by    TEXT REFERENCES users(id),
  used_at    TEXT,
  expires_at TEXT,                      -- ISO 8601
  user_id    TEXT REFERENCES users(id)  -- set on a set-password link
);

-- Failed logins per e-mail, whether or not the e-mail has an account: ten in
-- fifteen minutes and the address waits. Rows are pruned as they age out
-- and cleared on a successful login.
CREATE TABLE IF NOT EXISTS login_failures (
  email TEXT NOT NULL,
  at    INTEGER NOT NULL                -- epoch seconds
);

CREATE INDEX IF NOT EXISTS login_failures_by_email ON login_failures (email, at);

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

-- Sdílet s AI: a snapshot of the person's values as one text page, behind
-- a random token their AI assistant fetches. The text is built in the
-- browser and stored verbatim — the worker never reads a value out of a
-- payload — so the preview is exactly what is served. Only the SHA-256 of
-- the token is stored, like login tokens; the link lives 24 hours, one live
-- link per person (minting revokes the previous), and can be revoked.
CREATE TABLE IF NOT EXISTS ai_shares (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  snapshot   TEXT NOT NULL,
  created_at INTEGER NOT NULL,          -- epoch seconds
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS ai_shares_by_user ON ai_shares (user_id, created_at);

-- A printed name one person filed under a shipped analyte, for everyone: the
-- next account from the same laboratory maps it with no click. Only names
-- filed under an id the shipped catalog holds land here — a parameter a
-- person founded exists in their settings alone. The teacher can withdraw
-- it; when their account goes, the fact stays and the link is dropped.
CREATE TABLE IF NOT EXISTS synonyms (
  raw_name     TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL,
  taught_by    TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL
);

-- One row per document an account opened for extraction, keyed by the report
-- id the browser minted. The row is the slot: inserting it takes one from
-- doc_used, atomically, so eight pages arriving at once cannot take eight.
-- pages_sent caps the pages one document may spend on the extractor;
-- pages_read is what decides whether a release gives the slot back (only a
-- document nothing was read from). The row outlives the report — deleting
-- a report does not free its document, and the row is why.
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  pages_sent  INTEGER NOT NULL DEFAULT 0,
  pages_read  INTEGER NOT NULL DEFAULT 0,
  released_at TEXT                      -- set when the slot was given back
);

CREATE INDEX IF NOT EXISTS documents_by_user ON documents (user_id, created_at);

-- What Stripe told us, one row per event (src/stripe.ts). The event id is
-- the idempotency key: a webhook delivered twice inserts nothing the second
-- time and credits nothing. user_id has no foreign key on purpose — the
-- record of a payment outlives the account it paid for; deletion unlinks it.
CREATE TABLE IF NOT EXISTS purchases (
  event_id   TEXT PRIMARY KEY,
  user_id    TEXT,
  package    TEXT NOT NULL,             -- "5" | "15"
  amount_czk INTEGER NOT NULL,          -- whole crowns, as Stripe reported
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS purchases_by_user ON purchases (user_id, created_at);
