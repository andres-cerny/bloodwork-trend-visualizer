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
claude "Set up Moje krev end to end per docs/moje-krev-handoff.md: (1) npm install, copy workers/portal/.dev.vars.example to .dev.vars, run npm test, then prove the local loop — apply schema.sql to local D1, insert a sign-up code, start the API worker, register via curl with e-mail and password and confirm the cookie reads /api/me. (2) Run npx wrangler login and wait for me to finish the browser step. (3) Create the D1 database moje-krev and KV namespace moje-krev-budget, paste the returned ids into workers/portal/wrangler.jsonc and workers/portal-extract/wrangler.jsonc, apply schema.sql --remote. (4) Secrets — moje-krev-portal gets a randomly generated SESSION_SECRET; moje-krev-extract gets ANTHROPIC_API_KEY (ask me to paste it), its own randomly generated SESSION_SECRET, and a placeholder TURNSTILE_SECRET_KEY. (5) npm run deploy:moje-krev. (6) Mint one sign-up link via tools/scripts/moje-krev-invites.mjs 1 Andres --apply and print it. (7) Commit ONLY the wrangler.jsonc id changes and push to this branch. Never put a secret in a file, commit, or chat log."
```

(Already cloned? Start from the `git checkout` line, after
`git fetch origin claude/bloodwork-visualizer-planning-kn3vv5`.)

## What works today (end of Phase 5)

Invite-only registration through a link that lives a week, e-mail +
password login, 90-day sessions — and the whole upload path: a PDF opens in the browser, the identity on it (name, rodné
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

# 2. Local database — schema plus one sign-up link:
cd workers/portal
npx wrangler d1 execute moje-krev --local --file=schema.sql
cd ../..
node tools/scripts/moje-krev-invites.mjs 1 "já" --origin http://localhost:5173
#   prints an INSERT and a link; run the INSERT against the local database:
#   npx wrangler d1 execute moje-krev --local --command "<the INSERT>"   (from workers/portal)

# 3. Two terminals:
npm run dev:portal-api     # the API worker on :8789
npm run dev:portal         # Vite on :5173, /api proxied to :8789
```

Open the printed link (`/registrace?kod=…`) → e-mail, password twice,
„Vytvořit účet" — and you are in. From then on the front page logs you in
with e-mail and password; a forgotten password is a second link, minted with
`--email you@example.com`, that opens `/heslo?kod=…`. Local D1 state persists
in `workers/portal/.wrangler/`, so you stay registered across restarts. (It is keyed by the `database_id` in
wrangler.jsonc — change that and you start from an empty local database.)

With `dev:portal-api` alone, everything up to the extractor works: the
redaction review, the painted pages, storage in the local D1 and KV. The
extract call itself needs `moje-krev-extract`, which that one process cannot
reach (`EXTRACT` shows "not connected"), so an upload ends with „žádnou
stranu se nepodařilo přečíst".

**The whole loop locally, extractor included** — one wrangler process runs
both workers, and the service binding resolves between them:

```sh
# workers/portal-extract/.dev.vars (git-ignored): ANTHROPIC_API_KEY and
# GEMINI_API_KEY, plus SESSION_SECRET=local-dev-secret-change-me and
# TURNSTILE_SECRET_KEY=unused. The portal's .dev.vars adds
# EXTRACT_SESSION_SECRET=local-dev-secret-change-me — the same string.
npx wrangler dev -c workers/portal/wrangler.jsonc -c workers/portal-extract/wrangler.jsonc \
  --port 8789 --persist-to workers/portal/.wrangler/state
npm run dev:portal        # second terminal, as before
```

The first `-c` is the one the port serves. `--persist-to` points both at the
D1 that `wrangler d1 execute --local` wrote from `workers/portal`, so the
invites and accounts you minted are the ones the API sees. The binding table
prints `env.EXTRACT … [not connected]` before the second worker is up; a
`GET /api/processors` answering `{"photoReaders":"sonnet+gemini"}` is the
proof it is wired, because that route asks the extractor. Every page then
spends real money (about 2,5 ¢ on the text path), booked on the account's
own ledger exactly as in production. `DEMO_EMAIL=…` in the portal's
`.dev.vars` turns on the demo link locally; wrangler needs a restart to read
it.

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
npx wrangler kv namespace create moje-krev-pages    # paste id into wrangler.jsonc (PAGES)

cd ../portal-extract                          # needed from Phase 3 on; harmless now
npx wrangler kv namespace create moje-krev-budget   # paste id into wrangler.jsonc
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SESSION_SECRET       # = the portal's EXTRACT_SESSION_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY # any placeholder; route unused

cd ../..
npm run deploy:moje-krev                      # extract → portal API → shell, in order
node tools/scripts/moje-krev-invites.mjs 1 "Andres" --apply    # prints the link to send
```

The app then lives at `https://moje-krev.<your-account>.workers.dev`. There
is no mail: every link — sign-up or set-password — is one you mint and send
yourself, and it lives a week.

## The public demo patient

The front page can carry a second way in — **„Zobrazit demo pacienta"**, a
link that logs anyone who clicks it into one named account, with no password
and nothing to type. It is off unless a deployment names the account:

```sh
cd workers/portal
npx wrangler secret put DEMO_EMAIL      # the e-mail of the account to open
npm run deploy:portal-api               # from the repo root
```

A secret rather than a var, so no address is committed. Unset — the default,
and the state of a fresh clone — the link is not drawn and both of its routes
answer 404, so an ordinary deployment looks exactly as it did before this
existed. To take the demo down again, `npx wrangler secret delete DEMO_EMAIL`
and deploy; every demo cookie already minted stops mattering within a day.

**What a visitor gets is a real login to that real account.** They see the
trends, the summary, the stored pages, the mapping; they can upload, correct
a misread value, teach a name and mint an AI share link. Two things they
cannot do: delete a report, and delete the account. That is a claim in the
cookie the link mints, not a property of the account — the same account's
own e-mail-and-password login deletes as it always did.

So choose the account deliberately:

- **It is shared.** Anything a stranger uploads lands in it and every later
  visitor sees it. The door and the upload card both say so in Czech, but
  the account will still collect other people's reports.
- **It spends your money.** Uploads run on that account's monthly ceiling —
  `PORTAL_USD_LIMIT`, or the account's own `budget_usd` if it has one. Set
  it deliberately before publishing the link: `moje-krev-budget.mjs` below.
  A budget of `0` leaves the demo readable and stops its uploads outright.
- **Its e-mail stays private.** `/api/me` withholds the address from a demo
  session and the top bar reads „Demo pacient"; the account's own login
  still shows it.

The session it mints lasts one day, not ninety — a stranger's browser, often
a borrowed one, should forget.

## Documents: the allowance, and the shop

What an account is charged in is documents (`docs/plans/multi-user.md`,
Goal 7): one document is one upload — a PDF or one set of photos, up to
`MAX_PAGES_PER_REPORT` pages — and every account has **5 for good**. The
slot is taken when the browser opens the document for extraction (`POST
/api/documents`, before the first page), given back only if no page of it
could be read, and never given back for deleting the report. The shell
shows „Dokumenty: 3 z 5" under the report list with „Přikoupit" and „Proč
přikoupit?" (`/proc-prikoupit`); at zero the upload card refuses in Czech
and the worker answers 402 `no_documents`.

A database created before 2026-09-19 needs the columns and the two tables
once, **before** the worker that reads them is deployed (`npm run
check:schema` says whether it has them):

```sh
cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-19-documents.sql
```

Every existing account then has 5 documents and 0 used, whatever it
uploaded before — those reads were paid for under the USD ledger. To grant
more by hand (family, a refund):

```sh
node tools/scripts/moje-krev-budget.mjs kdo@example.com --documents 5 --apply    # +5
node tools/scripts/moje-krev-budget.mjs kdo@example.com --documents -5 --apply   # a refund; never under what is used
node tools/scripts/moje-krev-budget.mjs --show --apply                            # budget, used, allowance per account
```

### Opening the shop, once the Stripe account exists

The shop (`workers/portal/src/stripe.ts`) is off until four secrets are
set; nothing else changes. In the Stripe dashboard:

1. **Products → Add product**, twice, in **CZK**: „5 dokumentů" as a
   one-time price of **49 Kč**, „15 dokumentů" as a one-time price of
   **99 Kč**. Copy each price id (`price_…`). The prices carry the currency —
   the worker sends only the id, so a price in another currency would sell
   in that currency.
2. **Developers → API keys**: the secret key (`sk_live_…`; `sk_test_…`
   while testing).
3. **Developers → Webhooks → Add endpoint**: URL
   `https://moje-krev.<account>.workers.dev/api/stripe/webhook`, events
   `checkout.session.completed` and
   `checkout.session.async_payment_succeeded`. Copy the signing secret
   (`whsec_…`).
4. Set the four, in `workers/portal`:

```sh
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_5
npx wrangler secret put STRIPE_PRICE_15
```

From the next request on `POST /api/buy` mints Checkout Sessions and the
sheet redirects; Apple Pay and Google Pay come with Checkout and need no
code. The return URL (`/?koupeno=1`) proves nothing — the account is
credited by the signed webhook alone, once per event id, so a delivery
retried by Stripe credits nothing twice. `purchases` in D1 is the record;
a row with no matching credit (a worker that died between the two writes)
is repaired with `--documents`. To close the shop again, delete any one of
the four secrets: the sheet then says „Obchod zatím není otevřený." and
still shows the two packages.

Test mode first: `sk_test_…`, test prices, a test webhook endpoint, card
`4242 4242 4242 4242` — the worker cannot tell the modes apart and does not
need to.

## Raising one person's budget

The USD ledger is the fuse behind the document count, not what anyone is
meant to reach. Everyone spends against `PORTAL_USD_LIMIT` (10 USD a
month — above what 20 documents of 6 photo pages can cost) until they are
given a number of their own. That number lives on the account, so it is set
after the person has registered, not on the link that invited them:

```sh
node tools/scripts/moje-krev-budget.mjs kdo@example.com 20 --apply
node tools/scripts/moje-krev-budget.mjs kdo@example.com --default --apply  # back to the shared limit
node tools/scripts/moje-krev-budget.mjs --show --apply                     # who is on what
```

Read wrangler's row count: `rows written: 0` means that e-mail has no
account, not that the budget was already right. A budget of `0` is a real
setting and not the same as `--default` — it pauses that account's uploads
and leaves everyone else alone. Nothing is retroactive: the month's spend
lives in KV and is untouched, so raising a frozen person lets their next
upload through immediately.

A database created before 2026-09-11 needs the column once:

```sh
cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-11-budget.sql
```

## Ending a session for good

The login cookie is a signed claim, and the worker keeps no list of them.
What it keeps instead is one number per account, `users.session_epoch`:
every cookie carries the number it was minted under, „Odhlásit se" and a
set-password link add one to the row, and a cookie naming an older number
is a 401 on its next request — a copy of it included, on every device.
Deleting the account takes the row and the number with it. A visitor
leaving the demo moves nothing: their cookie is a stranger's, not the
owner's.

A database created before 2026-09-19 needs the column once, **before** the
worker that reads it is deployed (`npm run check:schema` says whether it is
there):

```sh
cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-19-session-epoch.sql
```

Every cookie minted before that deploy lacks the number and is refused, so
everyone logs in once more. Nothing else moves.

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
