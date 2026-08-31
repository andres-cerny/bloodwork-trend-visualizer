# Moje krev — running it locally

The cloud dev container has no real lab PDFs (`samples/` and `data/` are
git-ignored, by design) and its network policy blocks `api.cloudflare.com`,
so two things only work on your machine: trying the app against real
reports, and anything that touches Cloudflare. This file is the complete
path from `git pull` to a working local Moje krev, and from there to a real
deploy. The design and phase plan live in [plans/portal.md](plans/portal.md).

## One command, Claude does the rest

With Claude Code installed locally (`npm install -g @anthropic-ai/claude-code`),
one paste runs the whole file — local smoke test, Cloudflare login, resources,
secrets, deploy, first invite. Claude stops to let you click the wrangler
browser login and to paste the two API keys; it never commits a secret.

```sh
git clone https://github.com/andres-cerny/bloodwork-trend-visualizer.git
cd bloodwork-trend-visualizer
git checkout claude/bloodwork-visualizer-planning-kn3vv5
claude "Set up Moje krev end to end per docs/moje-krev-handoff.md: (1) npm install, copy workers/portal/.dev.vars.example to .dev.vars, run npm test, then prove the local loop — apply schema.sql to local D1, insert an invite, start the API worker, register via curl and confirm the dev link logs in. (2) Run npx wrangler login and wait for me to finish the browser step. (3) Create the D1 database moje-krev and KV namespace moje-krev-budget, paste the returned ids into workers/portal/wrangler.jsonc and workers/portal-extract/wrangler.jsonc, apply schema.sql --remote. (4) Secrets — moje-krev-portal gets a randomly generated SESSION_SECRET and RESEND_API_KEY (ask me to paste it; skip if I say later); moje-krev-extract gets ANTHROPIC_API_KEY (ask me to paste it), its own randomly generated SESSION_SECRET, and a placeholder TURNSTILE_SECRET_KEY. (5) npm run deploy:moje-krev. (6) Mint one invite via tools/scripts/moje-krev-invites.mjs 1 Andres --apply and print the live URL and the code. (7) Commit ONLY the wrangler.jsonc id changes and push to this branch. Never put a secret in a file, commit, or chat log."
```

(Already cloned? Start from the `git checkout` line, after
`git fetch origin claude/bloodwork-visualizer-planning-kn3vv5`.)

## What works today (end of Phase 5)

Invite-only registration, magic-link login, 90-day sessions — and the whole
upload path: a PDF opens in the browser, the identity on it (name, rodné
číslo, birth date, address, and every repeat of them) is found and painted
out, the reader confirms the boxes, and only the painted pages and the
stripped rows go to the extractor; a scanned page is redacted by hand and
read from its painted image. Results are stored per account and read back on
any device: an overview of what is out of range with the facts beside it,
trend charts with the out-of-range zones tinted, the change summary over two
tables, verification against the stored page, name mapping. The account can
export everything (JSON/CSV) and delete itself completely;
[/soukromi](https://moje-krev.andres-cerny.workers.dev/soukromi) says in
plain Czech what is stored and what never leaves the device.

A synthetic report to try it on, with an invented identity to redact:
`packages/lab-core/tests/fixtures/identity.pdf`. Your own reports go in
through the same screen; the original file never leaves the device.

## Run it locally

```sh
git fetch origin claude/bloodwork-visualizer-planning-kn3vv5
git checkout claude/bloodwork-visualizer-planning-kn3vv5
npm install

# 1. Local secrets (git-ignored):
cp workers/portal/.dev.vars.example workers/portal/.dev.vars

# 2. Local database — schema plus one invite code:
cd workers/portal
npx wrangler d1 execute moje-krev --local --file=schema.sql
npx wrangler d1 execute moje-krev --local \
  --command "INSERT INTO invites (code, note, created_at) VALUES ('moje-prvni-42','já','2026-08-31')"
cd ../..

# 3. Two terminals:
npm run dev:portal-api     # the API worker on :8789
npm run dev:portal         # Vite on :5173, /api proxied to :8789
```

Open http://localhost:5173 → „Mám pozvánkový kód" → code `moje-prvni-42` +
your e-mail. With `DEV_MAGIC_LINK=1` the confirmation screen shows a
„Vývojové přihlášení" link instead of sending mail — click it and you are
in. Local D1 state persists in `workers/portal/.wrangler/`, so you stay
registered across restarts. (It is keyed by the `database_id` in
wrangler.jsonc — change that and you start from an empty local database.)

Locally, everything up to the extractor works: the redaction review, the
painted pages, storage in the local D1 and KV. The extract call itself needs
`moje-krev-extract`, which the local worker cannot reach (`EXTRACT` shows
"not connected"), so a local upload ends with „žádnou stranu se nepodařilo
přečíst". Real extraction is tested against the deployed stack.

Tests and checks, same as CI: `npm test` (the portal suite is
`npx vitest run --project portal`) · `npm run typecheck` · `npm run docs:check`.

## Cloudflare setup — do this locally

The steps below follow Cloudflare's agent-setup guidance
(https://developers.cloudflare.com/agent-setup/prompt.md — unreachable from
the cloud container, readable on your machine; point local Claude Code at it
and it can drive these steps for you).

**Quickest look, no account needed:** wrangler ≥ 4.102 can deploy to a
60-minute temporary preview account — `npx wrangler deploy --temporary` from
`apps/portal` — and prints a claim URL that moves the result into your real
account when you sign in. Good for a peek; the real setup is below.

**The real setup (once):**

```sh
npx wrangler login                # browser OAuth, simplest on your machine

cd workers/portal
npx wrangler d1 create moje-krev             # paste database_id into wrangler.jsonc
npx wrangler d1 execute moje-krev --remote --file=schema.sql
npx wrangler secret put SESSION_SECRET       # e.g. output of: openssl rand -base64 32
npx wrangler secret put EXTRACT_SESSION_SECRET  # the SAME string as moje-krev-extract's SESSION_SECRET
npx wrangler secret put RESEND_API_KEY       # from resend.com, free tier
npx wrangler kv namespace create moje-krev-pages    # paste id into wrangler.jsonc (PAGES)

cd ../portal-extract                          # needed from Phase 3 on; harmless now
npx wrangler kv namespace create moje-krev-budget   # paste id into wrangler.jsonc
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SESSION_SECRET       # = the portal's EXTRACT_SESSION_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY # any placeholder; route unused

cd ../..
npm run deploy:moje-krev                      # extract → portal API → shell, in order
node tools/scripts/moje-krev-invites.mjs 1 "Andres" --apply
```

The app then lives at `https://moje-krev.<your-account>.workers.dev`.
Resend note: an API key alone delivers only to your own address — enough
while you are the only user; verify a domain in Resend before family joins,
then set `MAIL_FROM` on moje-krev-portal.

**To let the cloud session deploy instead:** in claude.ai/code environment
settings, allow `api.cloudflare.com` in the network policy and add
`CLOUDFLARE_API_TOKEN` (custom token: Workers Scripts:Edit, D1:Edit,
Workers KV Storage:Edit, Account Settings:Read) and `CLOUDFLARE_ACCOUNT_ID`
as environment variables. Never paste tokens into chat.

## Your own PDFs

Once deployed, upload through the app itself (from Phase 3): that is the
seeding path, and identity never leaves your device. For local development
against a real report before then, put PDFs in `samples/` — git-ignored,
never committed, and the privacy hook refuses them at staging if something
goes wrong.
