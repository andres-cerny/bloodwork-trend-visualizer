# workers — agent and extract

Split by capability, not by app. Both app shells reach the agent; only bloodwork
reaches the extractor.

## What each may bind to

**`extract` is finished.** Stable prompts, one secret, bursty parallel load. It
should stop changing.

**`agent` is the one with a future** — a doctor's database, a vector index, a
conversation store. That is the whole reason for the split: **extraction must
never grow a database binding**, and the way to keep that true is to give it
nowhere to put one.

Neither has a public origin (`workers_dev: false`, no route). They are reachable
only through the shells' service bindings, so there is no CORS.

## The gate

`guard()` runs both checks before anything expensive: the session is valid, and
that capability's ledger is not frozen. Identical between workers — only the
capability argument differs.

- **`consumePage` is never called on an agent route.** A test pins it.
- **The ledgers are separate.** They used to share one counter, so a batch of
  uploads could freeze the chat. Pre-split `spend_usd_shard_*` keys are still
  read, so an existing deployment's history survives.
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
