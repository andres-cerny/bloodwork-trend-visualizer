-- Edge cases found in the 2026-09-27 audit. Additive, applied once, BEFORE
-- the worker that reads the columns is deployed (`npm run check:schema` says
-- whether it has been):
--   cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-27-edge-cases.sql
-- schema.sql carries the same shape for a fresh database.

-- The webhook's credit and this mark now run in one transaction, so a
-- purchase row without a mark is one that was never credited. Every row that
-- exists today was credited (or repaired by hand), so it is marked as such.
ALTER TABLE purchases ADD COLUMN credited_at TEXT;
UPDATE purchases SET credited_at = created_at WHERE credited_at IS NULL;
