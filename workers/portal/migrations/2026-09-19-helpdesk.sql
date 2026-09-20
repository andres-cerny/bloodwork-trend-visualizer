-- The help desk and the events it is read beside. Additive, applied once:
--   cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-19-helpdesk.sql
-- schema.sql carries the same shape for a fresh database.
--
-- Two new tables, no change to any existing one. A worker deployed before
-- this is applied answers POST /api/helpdesk with a 500 and writes no
-- events; nothing else it does touches these tables, so the rest of the app
-- is unaffected either way — but apply it first (`npm run check:schema`).
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  user_id     TEXT REFERENCES users(id),
  email       TEXT NOT NULL,
  text        TEXT NOT NULL,
  report_id   TEXT,
  user_agent  TEXT,
  answered_at TEXT
);

CREATE INDEX IF NOT EXISTS messages_open ON messages (answered_at, created_at);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  at         INTEGER NOT NULL,
  route      TEXT NOT NULL,
  status     INTEGER NOT NULL,
  code       TEXT,
  user_hash  TEXT,
  request_id TEXT
);

CREATE INDEX IF NOT EXISTS events_by_user ON events (user_hash, at);
CREATE INDEX IF NOT EXISTS events_by_time ON events (at);
