-- Duplicate uploads: the file's fingerprint on the report row. Additive,
-- applied once:
--   cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-06-fingerprint.sql
-- schema.sql carries the same shape for a fresh database.
--
-- The column is the SHA-256 of the original PDF, hashed in the browser
-- before redaction (the bytes never reach the worker). Existing rows stay
-- NULL — the index is partial, so they neither collide nor block anything;
-- a report re-uploaded through Nahradit gains its fingerprint then.

ALTER TABLE reports ADD COLUMN fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS reports_fingerprint_per_user
  ON reports (user_id, fingerprint) WHERE fingerprint IS NOT NULL;
