-- What one person taught the app about a lab's spelling, shared with the
-- next person from that lab. Additive, applied once:
--   cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-12-synonyms.sql
-- schema.sql carries the same shape for a fresh database.
--
-- Empty on creation; the worker reads it as an empty list, so this migration
-- changes nobody's mapping until someone accepts one.
CREATE TABLE IF NOT EXISTS synonyms (
  raw_name     TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL,
  taught_by    TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL
);
