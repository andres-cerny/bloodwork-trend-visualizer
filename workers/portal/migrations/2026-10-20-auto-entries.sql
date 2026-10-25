-- Catalog entries added without a person, from the NČLP code table
-- (docs/plans/model-loop.md round 6). Additive, applied once:
--   cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-10-20-auto-entries.sql
-- schema.sql carries the same shape for a fresh database.
--
-- Empty on creation; nothing writes to it unless the portal is built with
-- VITE_AUTO_ENTRIES=1. Ondřej lists and withdraws rows from the CLI (the
-- commands are in the playbook).
CREATE TABLE IF NOT EXISTS auto_entries (
  code         TEXT PRIMARY KEY,
  name_cs      TEXT NOT NULL,
  unit         TEXT NOT NULL DEFAULT '',
  raw_name     TEXT NOT NULL,
  model        TEXT,
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL
);
