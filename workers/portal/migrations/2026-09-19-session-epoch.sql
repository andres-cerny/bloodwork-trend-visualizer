-- A generation number for each account's sessions. Additive, applied once:
--   cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-19-session-epoch.sql
-- schema.sql carries the same shape for a fresh database.
--
-- 0 on every existing row. The worker from this deploy on mints cookies
-- that carry the number and refuses any that do not — so every cookie
-- minted before it is a 401 once, and everyone logs in again once. Nothing
-- else changes: the reports, settings and budgets stay where they are.
ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;
