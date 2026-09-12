# workers — agent and extract

Split by capability, not by app. Both app shells reach the agent; only bloodwork
reaches the extractor.

## What each may bind to

**`extract` holds the model keys and nothing else.** Reopened twice, each time
for a model call with no more reach than a page read: Gemini as the photo
path's second reader, and `POST /api/map`, the mapping fallback (names, units
and intervals to Haiku — never a value; one call spends one page). Anything
that needs more than a key does not belong here.

**`agent` grew its future**: three D1 practices (`DB_SPORT`, `DB_ORTO`,
`DB_CSM` — isolation by binding, not by a WHERE clause), a KV evidence shelf,
read-only `/api/card/*` routes (session-gated, never ledger-gated), and its own
`/api/session` door. The split still holds the other way: **extraction must
never grow a database binding**, and the way to keep that true is to give it
nowhere to put one.

Neither has a public origin (`workers_dev: false`, no route). They are reachable
only through the shells' service bindings, so there is no CORS.

## The gate

`guard()` runs both checks before anything expensive: the session is valid, and
that capability's ledger is not frozen. Identical between workers.

- **`consumePage` is never called on an agent route.** A test pins it.
- **A Turnstile token proves three things:** solved, on this deployment's
  hostname, for this action. `TURNSTILE_HOSTNAMES` never lists localhost in
  production; unset means refuse everything.
- **The ledgers are separate**, one per capability and one per clinical
  practice; a test pins that no demo can freeze another.
- **`SESSION_SECRET` must be the same string in both workers.**

Why each rule exists, and the ledger keys: [docs/deploy.md](../docs/deploy.md).

## Deploy order

Capability workers first, shells second — a service binding to a Worker that
does not exist fails to deploy. `npm run deploy` encodes it.

## Tests run in plain node

Map-backed fake KV, `vi.stubGlobal("fetch")`, no miniflare. Keep it that way —
`@cloudflare/workers-types` must stay alone in `types`, because with
`@types/node` it collides on `Request`, `Response` and `fetch`.
