-- Password login (docs/plans/moje-krev-login.md). Additive, applied once:
--   cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-05-password.sql
-- schema.sql carries the same shape for a fresh database.

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_iters INTEGER;

ALTER TABLE invites ADD COLUMN expires_at TEXT;
ALTER TABLE invites ADD COLUMN user_id TEXT REFERENCES users(id);

CREATE TABLE IF NOT EXISTS login_failures (
  email TEXT NOT NULL,
  at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS login_failures_by_email ON login_failures (email, at);

-- The magic link is gone with its table. It held only hashes of tokens that
-- lived fifteen minutes; nothing reads it after this deploy.
DROP TABLE IF EXISTS login_tokens;
