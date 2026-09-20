# Moje krev — what only Ondřej can do

The `claude/multi-user-hardening` branch was merged to `main` on
2026-09-20 (PR #3) and **steps 1 and 2 are done**: the four migrations are
on live D1, all three workers are deployed from `main`, and the legal texts
are approved. Steps 3–6 still need a browser login, a key, or a decision —
none of it can be done by an agent in the cloud. Do them in this order;
each one is safe to stop after. The details of every step are in
[moje-krev-handoff.md](moje-krev-handoff.md) under the section named.

## 1. Deploy the merged main — done 2026-09-20

Live D1 was created before 2026-09-19, so it needs four migrations **before**
the worker that reads them is deployed. `check:schema` says which are missing.

```sh
git checkout main && git pull
npm install && npm test
npx wrangler login                                   # browser OAuth
cd workers/portal
npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-19-session-epoch.sql
npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-19-open-signup.sql
npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-19-documents.sql
npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-19-helpdesk.sql
cd ../.. && npm run check:schema                     # must say every table and column is there
npm run deploy:moje-krev                             # extract → API → shell, in order
```

Done 2026-09-20: `check:schema` reads 12 tables, 74 columns; versions
extract `73bfb590`, API `1af439f3`, app `b713c99e`. The live D1 was
exported to a local file first — do that before any future migration too.

After this: every existing account has 5 documents and 0 used; the landing
page, `/podminky`, `/soukromi`, `/napiste-nam` and `/proc-prikoupit` are
up; the 15-minute check runs and logs (no Telegram yet); registration,
the shop and mail are still off. `OPEN_SIGNUP` is `"false"` in
`workers/portal/wrangler.jsonc`, so invite links keep being the only door.
→ handoff: *Cloudflare setup*, *Documents: the allowance*.

Then log in with your own account and click through Souhrn, Trendy,
Ověření and Přiřazení once — the catalog grew from 139 to 344 analytes and
every row now carries an "i".

## 2. Approve the legal texts — done 2026-09-20

`apps/portal/src/ui/legal.tsx` names Ondřej Černý, Hákova 15, 109 00
Praha 15, andres.cerny@gmail.com as the operator, version „20. 9. 2026",
`LEGAL_DRAFT = false`. Read `/podminky` and `/soukromi` once yourself
anyway — the texts describe what the code does and a test holds them to
it, but nobody with legal training has read them. To revise: edit, bump
`LEGAL_VERSION`, `npm run deploy:portal`.

## 3. Open registration (Resend + Turnstile accounts)

Two accounts to create, then three secrets, one build variable, one var.

1. **Resend** (resend.com): add and verify a sending domain, create an
   API key. Until the domain is verified, mail reaches only your own
   address.
2. **Cloudflare Turnstile** (dashboard → Turnstile → Add widget) for
   hostname `moje-krev.andres-cerny.workers.dev` — never `localhost`. It
   gives a site key and a secret key.
3. Set them:

```sh
cd workers/portal
npx wrangler secret put RESEND_API_KEY               # already set on the API worker (2026-09-20) — re-put only if the domain changed
npx wrangler secret put MAIL_FROM                    # Moje krev <noreply@your-domain>
npx wrangler secret put TURNSTILE_SECRET_KEY
# repo-root .env (git-ignored):  VITE_TURNSTILE_SITE_KEY=<site key>
# workers/portal/wrangler.jsonc:  "OPEN_SIGNUP": "true"    (TURNSTILE_HOSTNAMES is already set)
cd ../.. && npm run deploy:moje-krev
```

Set the key before flipping the var: without `RESEND_API_KEY` the forms
answer 503 and mint nothing. Never set `OPEN_SIGNUP_DEV_BYPASS` in
`wrangler.jsonc` — a test refuses the file. Then prove it once with your
own address: register, read the mail, set a password, log in; ask for a
forgotten-password link on your address and on one nobody has.
→ handoff: *Opening the door — registration by e-mail*.

## 4. Telegram — the help desk and the watcher (10 min)

Without this, „Napište nám" messages land in D1 and nobody is told, and
the 15-minute check writes only to the Worker log.

1. `@BotFather` → `/newbot` → the token.
2. One private group (or two: help desk and ops), bot added; read the
   chat id from `https://api.telegram.org/bot<token>/getUpdates`.
3. `cd workers/portal` and `npx wrangler secret put` for
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_HELPDESK_CHAT`, `TELEGRAM_OPS_CHAT`,
   then `npm run deploy:portal-api`.

Open messages: `node tools/scripts/moje-krev-helpdesk.mjs --list --unanswered --apply`;
after you replied, `--answered <id> --apply` (the line under each Telegram
notice says it).
→ handoff: *Help desk a hlídač — Telegram*.

## 5. The shop — only when you want to sell (Stripe account)

Off until four secrets exist; the sheet says „Obchod zatím není otevřený."
until then and that is fine. Stripe dashboard: two one-time products in
CZK („5 dokumentů" 49 Kč, „15 dokumentů" 99 Kč), the secret key, a webhook
endpoint at `/api/stripe/webhook` for `checkout.session.completed` +
`checkout.session.async_payment_succeeded`. Then in `workers/portal`:
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_5`,
`STRIPE_PRICE_15`. Test mode first (`sk_test_…`, card 4242…).
→ handoff: *Opening the shop*.

## 6. Housekeeping (any time)

- **Daily D1 export** on this Mac: `~/bin/moje-krev-export.sh` + a crontab
  line — the Worker cannot back itself up. → handoff: *The D1 export*.
- **Extractor ledger**: `BUDGET_USD_LIMIT` on `moje-krev-extract` is 30 USD
  for the life of the KV namespace; the watcher tells you at 80 % and
  100 %. Resetting it is the eight-key loop under *Ledger extraktoru*.
- **Demo patient**: `DEMO_EMAIL` secret on the API worker opens one
  account read-only from the front page; unset means no demo link.
- **Worktrees**: the 22 `agent-*` worktrees were removed 2026-09-20; five
  of their branches (`worktree-agent-a02a7d…`, `a75f54…`, `a7c6b6…`,
  `aa5737…`, `aeaacb…`) are kept — August UI variants A/B/C never merged,
  `git branch -D` them when sure. The nine named worktrees (`lab-adapt`,
  `moje-krev`, `polish-a`, `refine-*`, …) are older experiments — check
  `git log main..<branch>` before removing any.

## What is deliberately not done

- Mail, Turnstile, Telegram and Stripe are all **off by default** and each
  turns on by its secrets alone; no code change opens any of them.
- The legal texts were written by an agent and approved by their operator
  on 2026-09-20. They describe what the code does (a test holds them to
  it) but nobody with legal training has read them.
- Only `moje-krev.andres-cerny.workers.dev` is in `TURNSTILE_HOSTNAMES`;
  a custom domain needs adding there before Turnstile will pass on it.
