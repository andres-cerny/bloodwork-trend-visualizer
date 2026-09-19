-- Documents, not dollars (docs/plans/multi-user.md, Goal 7). Additive,
-- applied once, BEFORE the worker that reads the columns is deployed
-- (`npm run check:schema` says whether it has been):
--   cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-19-documents.sql
-- schema.sql carries the same shape for a fresh database.
--
-- Every existing row gets 5 free documents and 0 used. Not their report
-- count: the reports already there were read under the USD ledger and paid
-- for from the operator's own budget, before this rule existed — counting
-- them would put a family member with six reports at zero on the day the
-- rule arrives, and „5 zdarma, natrvalo" is a promise made from the switch
-- onward. The operator grants more by hand with
-- tools/scripts/moje-krev-budget.mjs <e-mail> --documents <n>.
ALTER TABLE users ADD COLUMN doc_allowance INTEGER NOT NULL DEFAULT 5;
ALTER TABLE users ADD COLUMN doc_used INTEGER NOT NULL DEFAULT 0;

-- One row per document the account opened for extraction: the slot is taken
-- when the row is inserted, and given back only if no page was ever read.
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  pages_sent  INTEGER NOT NULL DEFAULT 0,
  pages_read  INTEGER NOT NULL DEFAULT 0,
  released_at TEXT
);

CREATE INDEX IF NOT EXISTS documents_by_user ON documents (user_id, created_at);

-- What Stripe told us, once per event: the event id is the idempotency key.
CREATE TABLE IF NOT EXISTS purchases (
  event_id   TEXT PRIMARY KEY,
  user_id    TEXT,
  package    TEXT NOT NULL,
  amount_czk INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS purchases_by_user ON purchases (user_id, created_at);
