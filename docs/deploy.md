# Deploying

Four Workers on Cloudflare's free plan, no custom domain — two `*.workers.dev`
URLs to send people. Claude usage is the only thing that costs money, and [the
spend ceiling](#the-spend-ceiling) bounds it.

```
bloodwork-demo  ──┐                      bloodwork-chat ──┐
  assets + shell  ├─→ bloodwork-agent      assets + shell ─┤
                  └─→ bloodwork-extract                    └─→ bloodwork-agent
```

The two app shells serve static assets and forward `/api/*` over service
bindings. The capability workers have `workers_dev: false` and no route, so they
are reachable only through those bindings — there is no second public origin and
no CORS. The chat app has no `EXTRACT` binding at all, because it cannot upload
a PDF.

## One-time setup

```sh
npm install
npx wrangler login
```

### 1. KV namespace (the spend ledger lives here)

```sh
npx wrangler kv namespace create BUDGET
```

Paste the returned `id` into the `BUDGET` binding in **both**
`workers/agent/wrangler.jsonc` and `workers/extract/wrangler.jsonc`. They share
one namespace and key their spend apart inside it. The id committed there
belongs to the existing deployment — replace it only if you are standing up your
own.

### 2. Turnstile keys

Cloudflare dashboard → **Turnstile** → *Add site*, widget mode **Managed**. Add
both `*.workers.dev` hostnames to the one widget; the two apps share a key.

- **Site key** (public) → `.env` at the repo root, read by both apps:
  ```sh
  echo 'VITE_TURNSTILE_SITE_KEY=0x4AAA...' > .env
  ```
- **Secret key** → a Worker secret (step 3).

### 3. Secrets

Secrets are per-Worker and do not migrate. Both capability workers need all
three; neither app shell needs any, because neither holds a key.

```sh
for w in agent extract; do
  npx wrangler secret put ANTHROPIC_API_KEY    -c workers/$w/wrangler.jsonc
  npx wrangler secret put TURNSTILE_SECRET_KEY -c workers/$w/wrangler.jsonc
  npx wrangler secret put SESSION_SECRET       -c workers/$w/wrangler.jsonc
done
```

`SESSION_SECRET` must be **the same string in both**: a session minted by the
extractor is verified by the agent, and they only agree if the HMAC key does.
Generate it rather than inventing it:

```sh
openssl rand -base64 32
```

### 4. The chat demo's data (D1 + evidence KV)

The two practices live in two D1 databases; the ids committed in
`workers/agent/wrangler.jsonc` belong to the existing deployment — create your
own only when standing one up fresh:

```sh
npx wrangler d1 create bloodwork-chat-sport
npx wrangler d1 create bloodwork-chat-orto
npx wrangler kv namespace create EVIDENCE   # real-patient page images
```

Schema, then the committed synthetic seeds (regenerable by
`python3 -m scripts.make_chat_demo` and `make_chat_docs` from `tools/pipeline`):

```sh
cd workers/agent
for db in bloodwork-chat-sport bloodwork-chat-orto; do
  npx wrangler d1 execute $db --remote --file schema.sql -y
done
npx wrangler d1 execute bloodwork-chat-sport --remote --file ../../tools/pipeline/out/seed_sport.sql -y
npx wrangler d1 execute bloodwork-chat-orto  --remote --file ../../tools/pipeline/out/seed_orto.sql  -y
npx wrangler d1 execute bloodwork-chat-sport --remote --file ../../tools/pipeline/out/seed_docs_sport.sql -y
npx wrangler d1 execute bloodwork-chat-orto  --remote --file ../../tools/pipeline/out/seed_docs_orto.sql  -y
```

The documents go **after** the labs: `seed_<tenant>.sql` clears the document
tables along with the patients they reference, so the reverse order seeds a
practice with no documents and no error.

The synthetic seeds open with **bare** `DELETE FROM`, so they wipe the whole
database — including the real patient. **Order is therefore not optional:**
synthetic seeds first, then the real record, every time either changes. The
real record is seeded from `samples/` by a machine that holds it
(`python3 -m scripts.seed_real_patient` from `tools/pipeline`, which needs the
git-ignored `data/real_seed_docs.json` sidecar — keep a backup of that file
outside the repo). It exists in D1 and the EVIDENCE KV namespace only, never
in git; its own deletes are scoped to `p-cerny-1999`, so re-running it alone
is safe.

### 5. Deploy

```sh
npm run deploy
```

Order matters and the script encodes it: **the capability workers ship before
the shells**, because a service binding to a Worker that does not exist yet
fails to deploy. On the very first deploy the site's `/api/*` is briefly 5xx
between the two halves.

Each app's deploy builds, then runs `check-bundle.mjs` against its own `dist`.
That check exists because its failures are silent — a missing
`VITE_TURNSTILE_SITE_KEY` renders "not enabled in this demo", which reads as a
deliberate setting, and server-only code reaching a browser bundle only shows up
as a number nobody is watching.

Individual targets: `npm run deploy:agent`, `deploy:extract`,
`deploy:bloodwork`, `deploy:chat`.

## Local development

```sh
npm run dev:extract     # :8787
npm run dev:agent       # :8788
npm run dev:bloodwork   # Vite, proxies /api to both
```

One terminal per Worker — `wrangler dev` connects siblings through its dev
registry, and `-c` takes a single config. The Vite proxy means the dev server is
the whole app; before the split, `npm run dev` served the SPA and 404'd every AI
route.

Secrets go in a git-ignored `.dev.vars` **inside each worker's directory**
(`workers/agent/.dev.vars`), since wrangler reads it relative to the config.

Turnstile publishes test keys that always pass: site
`1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

## The spend ceiling

`BUDGET_USD_LIMIT` is a hard stop on Claude spend across all visitors, for the
life of the KV namespace. Every call is priced from the token usage the API
reports and added to the ledger; once the total reaches the ceiling the route
returns 402 and the UI disables the feature. The pre-baked demo keeps working,
because serving it costs nothing.

**Every capability has its own ledger.** They used to share one, which meant a
batch of uploads could freeze the chat. Keys are `spend_usd_agent_*`,
`spend_usd_extract_*`, and — one per practice — `spend_usd_clinical-sport_*` /
`spend_usd_clinical-orto_*`, each clinical ledger capped by
`CLINICAL_USD_LIMIT` (default $10). Pre-split `spend_usd_shard_*` keys are
still read, but only into the two ledgers that existed when they were written —
a new capability is not pre-charged with history it never spent.

```sh
# what has been spent
curl https://bloodwork-demo.workers.dev/api/status

# reset one capability's ledger (8 shards)
for i in $(seq 0 7); do
  npx wrangler kv key delete --binding BUDGET "spend_usd_agent_shard_$i"
done
```

Two knobs worth knowing:

- `SINGLE_MODEL: "1"` drops the Haiku cross-check and roughly halves upload
  cost. You lose the disagreement flagging, which is the most persuasive part of
  the verification tab — so prefer lowering `MAX_PAGES_PER_SESSION` first.
- `MAX_PAGES_PER_SESSION` (default 100) caps pages per uploaded report.

Sharding across 8 keys exists because KV throttles writes per key and a
multi-page upload writes concurrently. KV is eventually consistent, so under
heavy parallel load the ceiling can overshoot slightly — it is a budget guard,
not an accounting system.

## Swapping in your own data

The shipped demo is synthetic. To publish your own processed reports instead:

```sh
cd tools/pipeline
python3 -m scripts.export_web_data --name "Jan Ukázka" --id "800101/0006" --shift-days -37
cd ../.. && npm run deploy:bloodwork
```

It reads `data/reports/` and the source PDFs, replaces the patient identity in
the JSON, **redacts the printed name and rodné číslo from the page images before
rendering them**, and refuses to write anything if an identifier survives into
either the images' text layer or the JSON.

Check the rendered pages in `apps/bloodwork/public/demo/pages/` before
deploying. The automated check covers the PDF text layer; it cannot catch an
identifier that exists only as pixels in a scanned page.
