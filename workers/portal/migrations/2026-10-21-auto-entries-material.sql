-- The NČLP specimen of an auto-added entry (round 7 of docs/plans/model-loop.md):
-- without it an entry founded by a bare name ("pH") took every specimen's
-- name. Additive, applied once, after 2026-10-20-auto-entries.sql:
--   cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-10-21-auto-entries-material.sql
-- schema.sql carries the same shape for a fresh database.
ALTER TABLE auto_entries ADD COLUMN mat TEXT NOT NULL DEFAULT '';
