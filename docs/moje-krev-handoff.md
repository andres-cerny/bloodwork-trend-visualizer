# Moje krev — running it locally

The cloud dev container has no real lab PDFs (`samples/` and `data/` are
git-ignored, by design) and its network policy blocks `api.cloudflare.com`,
so two things only work on your machine: trying the app against real
reports, and anything that touches Cloudflare. This file is the complete
path from `git pull` to a working local Moje krev, and from there to a real
deploy. The design and phase plan live in [plans/portal.md](plans/portal.md).

## What works today (end of Phase 1)

Invite-only registration, magic-link login, 90-day sessions, and a
placeholder home screen. Upload/verify/trends are Phases 2–3; the current
gate to see working is: register → link → logged in → survives restart.

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
registered across restarts.

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
npx wrangler secret put RESEND_API_KEY       # from resend.com, free tier

cd ../portal-extract                          # needed from Phase 3 on; harmless now
npx wrangler kv namespace create moje-krev-budget   # paste id into wrangler.jsonc
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SESSION_SECRET       # its own pairing with the portal, Phase 3
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
