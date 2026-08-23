# workers — agent and extract

Split by capability, not by app. Both app shells reach the agent; only bloodwork
reaches the extractor.

## What each may bind to

**`extract` is finished.** Stable prompts, one secret, bursty parallel load. It
should stop changing.

**`agent` grew its future**: two D1 practices (`DB_SPORT`, `DB_ORTO`, one per
tenant so isolation is by binding, not by a WHERE clause), an R2 shelf for the
one real record git never holds, and its own `/api/session` door — the chat
shell binds only this worker, so a Turnstile token must be tradeable here.
The split still holds the other way: **extraction must never grow a database
binding**, and the way to keep that true is to give it nowhere to put one.

Neither has a public origin (`workers_dev: false`, no route). They are reachable
only through the shells' service bindings, so there is no CORS.

## The gate

`guard()` runs both checks before anything expensive: the session is valid, and
that capability's ledger is not frozen. Identical between workers — only the
capability argument differs.

- **`consumePage` is never called on an agent route.** A test pins it.
- **A Turnstile token proves three things, not one:** solved, on a hostname
  this deployment serves, for this action. The widget registers localhost for
  development, and a token belongs to the widget rather than the page — so
  checking only `success` let a locally-solved challenge mint production
  sessions. `TURNSTILE_HOSTNAMES` is per-deployment and must never list
  localhost in production; unset means refuse everything.
- **The ledgers are separate.** They used to share one counter, so a batch of
  uploads could freeze the chat. Pre-split `spend_usd_shard_*` keys are still
  read, so an existing deployment's history survives — but only into `agent`
  and `extract`: the clinical ledgers (`clinical-sport`, `clinical-orto`, one
  per practice, `CLINICAL_USD_LIMIT` each) are new and must not be pre-charged
  with history they never spent. A doctor exploring one demo cannot freeze the
  other; a test pins it in both directions.
- **Secrets are per-Worker and do not migrate.** `SESSION_SECRET` must be the
  same string in both, or a session minted by one fails in the other.

## Deploy order

Capability workers first, shells second. A service binding to a Worker that
does not exist fails to deploy. `npm run deploy` encodes it.

## Tests run in plain node

Map-backed fake KV, `vi.stubGlobal("fetch")`, no miniflare. Keep it that way —
`@cloudflare/workers-types` must stay alone in `types`, because combined with
`@types/node` it collides on `Request`, `Response` and `fetch`.

Deployment, secrets, ledger: [docs/deploy.md](../docs/deploy.md).
