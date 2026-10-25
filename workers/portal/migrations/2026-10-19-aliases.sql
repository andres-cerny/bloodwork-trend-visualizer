-- Saved mapping decisions scoped to one laboratory's printed name in one unit,
-- shared by every account (docs/plans/model-loop.md, "Mapping design").
-- Additive, applied once:
--   cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-10-19-aliases.sql
-- schema.sql carries the same shape for a fresh database.
--
-- Empty on creation, and nothing writes to it unless the portal is built
-- with VITE_SHARE_AI_MAPPINGS=1 or VITE_SECOND_OPINION=1, so applying this
-- changes nobody's mapping. The older `synonyms` table (printed name only,
-- person-taught) is left as it is.
CREATE TABLE IF NOT EXISTS aliases (
  lab          TEXT NOT NULL DEFAULT '',
  raw_name     TEXT NOT NULL,
  unit         TEXT NOT NULL DEFAULT '',
  canonical_id TEXT,
  source       TEXT NOT NULL,
  model        TEXT,
  code         TEXT,
  taught_by    TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL,
  PRIMARY KEY (lab, raw_name, unit)
);

CREATE INDEX IF NOT EXISTS aliases_by_source ON aliases (source, created_at);
