-- Open registration (docs/plans/multi-user.md, Goal 6). Additive, applied once:
--   cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-19-open-signup.sql
-- schema.sql carries the same shape for a fresh database.
--
-- NULL on every existing row and every operator-minted code, which is what
-- the worker already assumes: an account an invite code opened has no
-- consent_at and no email_verified_at, and a code without an e-mail takes
-- whatever address is typed. Nothing anyone can do today changes until
-- OPEN_SIGNUP is set to "true" on the worker.

-- When the person ticked the two boxes at registration, and when the
-- address opened the link mailed to it.
ALTER TABLE users ADD COLUMN consent_at TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;

-- A code the worker mailed to an address with no account yet: which
-- address, and the consent given on the form that asked for the mail.
ALTER TABLE invites ADD COLUMN email TEXT;
ALTER TABLE invites ADD COLUMN consent_at TEXT;

-- Registration and forgotten-password mails asked for, per IP (hashed).
CREATE TABLE IF NOT EXISTS signup_attempts (
  ip_hash TEXT NOT NULL,
  at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS signup_attempts_by_ip ON signup_attempts (ip_hash, at);
