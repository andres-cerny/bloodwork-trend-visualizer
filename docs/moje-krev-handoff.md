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

The app then lives at `https://moje-krev.<your-account>.workers.dev`. Until
the door is opened (next section) there is no mail: every link — sign-up or
set-password — is one you mint and send yourself, and it lives a week.

## Opening the door — registration by e-mail

With `OPEN_SIGNUP` on, a stranger registers without a code: the front page
gains **„Registrovat"** and **„Zapomenuté heslo"**, each a form that takes an
e-mail and mails a link. The link opens `/heslo?kod=…` — the set-password
screen — and the account is born when the password is set, so nothing exists
for an address that never opened its mail, and an unverified address can
spend nothing. An address that already has an account gets a set-password
link instead, with the same `{"ok":true}` answer: nothing on the screen says
which addresses are registered. The link lives 24 hours and spends once.
Turnstile guards the three public forms (register, login, forgot) and nothing
behind the login; five mails an hour and twenty a day per IP, then a 429 in
Czech. Invite codes keep working and skip Turnstile — a code is the proof.

**Locally**, nothing is mailed and there is no Turnstile site key, so the
worker prints the link and accepts the forms without a token — both only
because `.dev.vars` says so:

```sh
# workers/portal/.dev.vars — append:
OPEN_SIGNUP=true
OPEN_SIGNUP_DEV_BYPASS=true
```

Then `npm run dev:portal-api` and `npm run dev:portal`, open
`http://localhost:5173/registrace`, tick the two consents, „Poslat odkaz" —
and read the link out of the API worker's terminal (`[mail not sent —
RESEND_API_KEY unset]`, then the mail as it would have gone). Open it, set a
password, and you are in. The row carries `consent_at` (when the boxes were
ticked) and `email_verified_at` (when the link was used). A database created
before 2026-09-19 needs the columns once — locally `--local`, live
`--remote`, **before** the worker that reads them is deployed
(`npm run check:schema` says whether they are there):

```sh
cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-19-open-signup.sql
```

**In production** the door opens in this order, one step at a time, and
`OPEN_SIGNUP_DEV_BYPASS` is never set — `signup.test.ts` refuses a
`wrangler.jsonc` that names it:

```sh
cd workers/portal
npx wrangler secret put RESEND_API_KEY        # Resend → API Keys; the domain must be verified there first
npx wrangler secret put MAIL_FROM             # e.g.  Moje krev <noreply@your-domain>
npx wrangler secret put TURNSTILE_SECRET_KEY  # a Turnstile widget for the app's hostname — never localhost
# apps/portal: VITE_TURNSTILE_SITE_KEY=<the widget's site key> in the repo-root .env before `npm run build:portal`
# workers/portal/wrangler.jsonc: TURNSTILE_HOSTNAMES = the hostname(s) the app is served on; OPEN_SIGNUP = "true"
npm run deploy:moje-krev                      # from the repo root
```

Then prove it once with your own address: register, read the mail, set a
password, log in; ask for a forgotten-password link on the same address and
on one nobody has (the second mailbox is told there is no account, the
screen is not). Until the domain exists in Resend, mail can reach only the
address Resend's sandbox allows — your own. With `RESEND_API_KEY` unset in
production the worker logs the link and answers as if sent, which is a
deployment that lets nobody in: set the key before the var.

To close the door again, `OPEN_SIGNUP` back to `"false"` and deploy: the
forms answer 404, the front page shows no „Registrovat", login asks for no
token, and every account already made keeps working.

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
  A demo upload costs the fuse, not documents: it opens a document without
  taking one of the account's five, so five strangers cannot exhaust the
  account for the sixth — or for you. The USD ceiling is the only brake.
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

## Help desk a hlídač — Telegram

Two things talk to you from the deployment, both through one Telegram bot
and both off until its secrets exist: **„Napište nám"**
(`/napiste-nam`, linked from the login door and the shell's footer), whose
messages land in the `messages` table and are forwarded to a help-desk
chat; and the **scheduled check** (`workers/portal/src/watch.ts`, cron
`*/15 * * * *` in `workers/portal/wrangler.jsonc`), which posts to an ops
chat when the shell or the extractor stops answering 200, when the
extractor's spend passes 80 % and again at 100 % of `BUDGET_USD_LIMIT`,
and once more when either comes back. One line per change of state, never
a storm. Without the secrets: messages are stored and answered 200 exactly
the same, the check runs and writes its result to the Worker log.

**The bot, once:**

1. In Telegram, open `@BotFather` → `/newbot` → a name and a username
   ending in `bot`. It answers with the token (`123456:ABC-…`). Keep it as
   a secret, never in a file.
2. Two chats: create a private group for help-desk messages and one for
   ops (or one group for both — then the two secrets carry the same id),
   add the bot to each. To read a group's id, post any message in it and
   open `https://api.telegram.org/bot<token>/getUpdates` in a browser:
   `"chat":{"id":-100…}` is the number, minus sign included. (A private
   chat with the bot works too: write to it first, its id is positive.)
3. The three secrets, on the API worker:

```sh
cd workers/portal
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_HELPDESK_CHAT     # e.g. -1001234567890
npx wrangler secret put TELEGRAM_OPS_CHAT
npm run deploy:portal-api                          # from the repo root
```

The cron trigger and the `AI` binding are in `wrangler.jsonc` and deploy
with the worker; `APP_URL` there is the shell the check probes. The first
alert can be proven from the dashboard: Workers → moje-krev-portal →
Settings → Triggers → the cron's „Run now", with the extractor's ledger
seeded past 80 % — or wait for the quarter hour and read the log line
`{"watch":{…}}`.

**What the help-desk line carries:** the sender's address, whether they
were logged in, the report they named (a date or id, their choice), the
first 500 characters, and the `wrangler d1 execute` that reads the whole
text. Never a value from a report, never a page — Telegram is not a
processor of health data and `/soukromi` does not name it as one.

**Answering** is by e-mail, by hand. The script lists and marks:

```sh
node tools/scripts/moje-krev-helpdesk.mjs --list --unanswered --apply   # what is open
node tools/scripts/moje-krev-helpdesk.mjs --read <id> --apply           # one message, whole
node tools/scripts/moje-krev-helpdesk.mjs --answered <id> --apply       # after you replied
```

`--answered` is the line under each Telegram notice; `rows written: 0`
means the id was not found or was already marked. Logged-out messages
need a solved Turnstile when `TURNSTILE_SECRET_KEY` and
`TURNSTILE_HOSTNAMES` are set on the API worker (the same pair the
registration forms use; the widget's action is `helpdesk`). The limit is
five messages an hour per address and per IP, the text 4 000 characters.

**The guess under the message.** With the `AI` binding in
`wrangler.jsonc` (`"ai": { "binding": "AI" }`), Workers AI's
`@cf/zai-org/glm-5.3-flash` reads each message beside the account's last
twenty refusals from the `events` table (route, status, code — hashed to
the account, never the address, never a value) and the extractor's status,
and posts a second Telegram line beginning „Odhad (GLM): " — a probable
cause, where, how sure, what to do, and up to two questions for the
person. Same host, no new sub-processor; the free tier is 10 000 neurons a
day and one guess is a few hundred. To switch it off, remove the `ai`
block and deploy — the raw message still goes. The `events` rows are
pruned after 30 days by the scheduled check, and so is a message twelve
months after `--answered` marked it (the privacy page's „do odpovědi a
12 měsíců po ní"); an unanswered message is never pruned.

A database created before 2026-09-19 needs the two tables once, **before**
the worker that writes them is deployed (`npm run check:schema`):

```sh
cd workers/portal && npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-19-helpdesk.sql
```

## Ledger extraktoru

`BUDGET_USD_LIMIT` on `moje-krev-extract` is **30 USD** — a free account
can spend at most 5 documents × 6 pages × ~5 ¢ = 1,50 USD, so this is
twenty new accounts' worst case in a month. It counts for the life of the
KV namespace, not per month: nothing resets it on the first, and at 100 %
every upload for everyone answers „společný limit je vyčerpán". The check
tells you at 80 % and at 100 %, once each per calendar month. To start a
new month by hand:

```sh
cd workers/portal-extract
for i in $(seq 0 7); do npx wrangler kv key delete --binding BUDGET "spend_usd_extract_shard_$i"; done
```

(The per-person ledgers in the same namespace, `user_spend_*`, expire on
their own after 90 days and are not touched by this.)

## The D1 export

A Worker cannot export its own database, so the check does not watch
for it; it is a cron on your machine. `wrangler d1 export` writes the
whole database as SQL:

```sh
# ~/bin/moje-krev-export.sh — daily, from a checkout with `npx wrangler login` done
cd /path/to/bloodwork-trend-visualizer/workers/portal || exit 1
out="$HOME/moje-krev-backups/moje-krev-$(date +%F).sql"
mkdir -p "$(dirname "$out")"
npx wrangler d1 export moje-krev --remote --output "$out" || exit 1
find "$HOME/moje-krev-backups" -name 'moje-krev-*.sql' -mtime +30 -delete
```

`crontab -e` → `15 3 * * * ~/bin/moje-krev-export.sh >> ~/moje-krev-backups/export.log 2>&1`
(on a Mac that sleeps at night, a launchd agent or `caffeinate` does the
same job). The file holds every table — the payloads, the e-mails, the
messages — so the directory is as private as the database: your disk,
never the repo, and the 30-day sweep at the end is what keeps it small.
Nothing alerts when a night is missed; `ls ~/moje-krev-backups | tail -3`
is the check, and the log says why if one failed.

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
