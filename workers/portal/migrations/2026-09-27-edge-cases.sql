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

-- Documents a demo visitor opened took no slot; the hourly sweep that gives
-- back abandoned documents must know which, or it would hand the owner a
-- document nobody took. Every existing row is counted as having taken one:
-- a demo document from before this column is at worst given back once.
ALTER TABLE documents ADD COLUMN took_slot INTEGER NOT NULL DEFAULT 1;

-- A read that produced nothing to store — no values, or a report the
-- account already holds — is marked here. Two in 30 days are given back;
-- every third is kept (apps/portal: „třetí takové nahrání za 30 dní se
-- počítá"), so a document cannot become a free read on demand.
ALTER TABLE documents ADD COLUMN empty_at TEXT;
