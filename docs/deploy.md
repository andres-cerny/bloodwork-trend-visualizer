# Deploying the web demo

One Worker serves the built SPA and the three API routes. Free plan throughout;
no custom domain — you get a `*.workers.dev` URL to send people.

## One-time setup

```sh
npm install
npx wrangler login
```

### 1. KV namespace (the spend ledger lives here)

```sh
npx wrangler kv namespace create BUDGET
```

Paste the returned `id` into `wrangler.jsonc`, replacing
`REPLACE_WITH_KV_NAMESPACE_ID`.

### 2. Turnstile keys

In the Cloudflare dashboard → **Turnstile** → *Add site*. Widget mode
**Managed**. You get two keys:

- **Site key** (public) → put it in `.env` at the repo root:
  ```sh
  echo 'VITE_TURNSTILE_SITE_KEY=0x4AAA...' > .env
  ```
- **Secret key** → a Worker secret (step 3).

### 3. Secrets

Never in a file — `wrangler` reads these from your terminal and stores them
encrypted:

```sh
npx wrangler secret put ANTHROPIC_API_KEY      # your Claude key
npx wrangler secret put TURNSTILE_SECRET_KEY   # from step 2
npx wrangler secret put SESSION_SECRET         # any long random string
```

For `SESSION_SECRET`, generate one rather than inventing it:

```sh
openssl rand -base64 32
```

### 4. Deploy

```sh
npm run deploy
```

That builds the SPA into `dist/` and pushes the Worker. The URL it prints is
the link you send.

## Local development

```sh
npm run dev        # SPA only — pre-baked demo works, AI routes 404
npx wrangler dev   # full stack including the API routes
```

For `wrangler dev`, put the secrets in a git-ignored `.dev.vars`:

```
ANTHROPIC_API_KEY=sk-ant-...
TURNSTILE_SECRET_KEY=0x4AAA...
SESSION_SECRET=...
```

Turnstile has official test keys that always pass, useful locally:
site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

## The spend ceiling

`BUDGET_USD_LIMIT` in `wrangler.jsonc` (default `20`) is a hard stop on total
Claude spend for the whole site, across all visitors, for the life of the KV
namespace. Every call is priced from the token usage the API reports and added
to the ledger. Once the total reaches the ceiling, `/api/extract` and
`/api/chat` return 402 and the UI disables upload and chat — the pre-baked demo
keeps working, because serving it costs nothing.

Check or reset it:

```sh
# what has been spent
curl https://<your-worker>.workers.dev/api/status

# raise the ceiling: edit BUDGET_USD_LIMIT in wrangler.jsonc, then
npm run deploy

# reset the ledger to zero (8 shards)
for i in $(seq 0 7); do npx wrangler kv key delete --binding BUDGET "spend_usd_shard_$i"; done
```

Two knobs worth knowing:

- `SINGLE_MODEL: "1"` drops the Opus cross-check and roughly halves upload
  cost. You lose the disagreement flagging, which is the most persuasive part
  of the verification tab — so prefer lowering `MAX_PAGES_PER_SESSION` first.
- `MAX_PAGES_PER_SESSION` (default 12) caps pages per uploaded report.

The ledger is sharded across 8 KV keys because KV throttles writes per key and
a multi-page upload writes concurrently. KV is eventually consistent, so under
heavy parallel load the ceiling can overshoot slightly — it is a budget guard,
not an accounting system.

## Swapping in your own data

The shipped demo is synthetic (`scripts/make_demo_data.py`). To use your own
processed reports instead:

```sh
python3 -m scripts.export_web_data --name "Jan Ukázka" --id "800101/0011" --shift-days -37
npm run deploy
```

It reads `data/reports/` and the source PDFs, replaces the patient identity in
the JSON, **redacts the printed name and rodné číslo from the page images
before rendering them**, and refuses to write anything if an identifier
survives into either the images' text layer or the JSON.

Check the rendered pages in `web/public/demo/pages/` before deploying. The
automated check covers the PDF text layer; it cannot catch an identifier that
exists only as pixels in a scanned page.
