# workers — agent and extract

Split by capability, not by app. Both app shells reach the agent; only bloodwork
reaches the extractor.

## What each may bind to

**`extract` was finished; it has reopened twice, both times additively.** Stable
prompts, bursty parallel load, now two model keys — the image path may pair
Sonnet with Google's Gemini (`PHOTO_READERS`, images only; default
`sonnet+haiku`, so a deploy changes nothing), one more outbound host. Two
switches ride along (2026-09-02): `stream: true` answers NDJSON — rows as
written, the buffered answer last — and `TEXT_READERS="cheap"` reads born-digital
pages with Haiku alone (unset everywhere, Moje krev included; kept for the day
cost outranks the second opinion). Then stop again.

**`agent` grew its future**: two D1 practices (`DB_SPORT`, `DB_ORTO`, one per
tenant so isolation is by binding, not by a WHERE clause), a KV evidence shelf
for the one real record git never holds, and its own `/api/session` door — the
chat shell binds only this worker, so a Turnstile token must be tradeable here.
The split holds the other way too: **extraction must never grow a database
binding** — keep that true by giving it nowhere to put one.

Neither has a public origin (`workers_dev: false`, no route). They are reachable
only through the shells' service bindings, so there is no CORS.

## The gate

`guard()` runs both checks before anything expensive: the session is valid, and
that capability's ledger is not frozen. Identical between workers; only the
capability argument differs.

- **`consumePage` is never called on an agent route.** A test pins it.
- **A Turnstile token proves three things, not one:** solved, on a hostname this
  deployment serves, for this action. A token belongs to the widget, not the
  page, and the widget registers localhost for development — so checking only
  `success` let a local solve mint production sessions. Hence
  `TURNSTILE_HOSTNAMES`: per-deployment, never localhost live, unset refuses all.
- **The ledgers are separate.** They used to share one counter, so a batch of
  uploads could freeze the chat. Pre-split `spend_usd_shard_*` keys are still
  read, so history survives — but only into `agent` and `extract`: the clinical
  ledgers (`clinical-sport`, `clinical-orto`, per practice, `CLINICAL_USD_LIMIT`
  each) are new and start empty, never pre-charged with history they did not
  spend. One demo cannot freeze the other; a test pins both ways.
- **Secrets are per-Worker and do not migrate.** `SESSION_SECRET` must be the
  same string in both, or a session minted by one fails in the other.

## Deploy order

Capability workers first, shells second. A service binding to a Worker that does
not exist fails to deploy. `npm run deploy` encodes it.

## Tests run in plain node

Map-backed fake KV, `vi.stubGlobal("fetch")`, no miniflare. Keep it that way —
`@cloudflare/workers-types` must stay alone in `types`, because combined with
`@types/node` it collides on `Request`, `Response` and `fetch`.

Deployment, secrets, ledger: [docs/deploy.md](../docs/deploy.md).
