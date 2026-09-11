-- A per-person monthly ceiling. Additive, applied once:
--   cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-11-budget.sql
-- schema.sql carries the same shape for a fresh database.
--
-- NULL on every existing row, which is what the worker already assumed:
-- an account with no number here spends against PORTAL_USD_LIMIT exactly as
-- before, so this migration changes nobody's budget until one is set.
ALTER TABLE users ADD COLUMN budget_usd REAL;
