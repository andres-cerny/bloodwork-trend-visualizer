# Moje krev for many people — the goals

Branch `claude/multi-user-hardening`, 2026-09-19. Ondřej wants Moje krev
to work for people from laboratories the app has never seen, with the
name mapping done by a model rather than a lookup, an information "i" on
every analyte, and the whole UI proven — registration included — before
it is opened to more people. This file is the contract between the
orchestrating session and the agents doing the work: each goal has a
condition that says when it is done, and nothing is "done" without it.

Money: **15 USD** for end-to-end runs through the real extractor. The
ledger at the bottom is kept by whoever spends.

## Goal 1 — a name from any Czech lab lands in the catalog, or is left alone

**Done when** the mapping bench runs over the BioLAB fixture *and* the
four synthetic labs of Goal 2 and reports **0 wrong**, with the model's
`unknown`/`low` answers counted separately as "left for the person".

- Mapping runs **on its own** after every upload, and once on load for
  names never asked. No click. The click button stays as "ask again".
  ([apps/portal/src/ui/MappingTab.tsx](../../apps/portal/src/ui/MappingTab.tsx),
  [Portal.tsx](../../apps/portal/src/ui/Portal.tsx))
- Applied without a click only when the model says `catalog`, is
  `high`-confident, and `canApplyUnasked` holds (unit known to agree,
  nothing else disagreeing). Everything else — `medium`, `low`, `new`,
  `unknown` — stays in the mapping tab with the model's reason, for the
  person. **When unsure, do not map**: the prompt says so and the eval
  tests that it obeys.
- Each name is asked once per account; the answer (decision, id,
  confidence, reason, model, date) is stored in `users.settings.aiAsked`
  so a reload does not spend again. "Ask again" clears it for the
  pending names.
- The model is Haiku 4.5 through `/api/map` (unchanged: 30 names per
  call, names/units/intervals only, priced on the person's ledger).
- Evaluation is a subagent handed `mapPrompt()` verbatim plus one
  confirming run through the API. The near-miss traps in Goal 2 are the
  point: free vs total T4, conjugated vs total bilirubin, serum vs urine,
  mg/dl vs mmol/l.
- *Product code done 2026-09-19*: the run is
  [apps/portal/src/lib/aiMapping.ts](../../apps/portal/src/lib/aiMapping.ts)
  (who is asked, what is filed, what is stored; never rejects), Portal
  owns it, the tab renders the record. Tests: `aiMapping.test.ts`,
  `mappingTabAi.test.ts`, the prompt sentences in
  `packages/extraction/tests/map.test.ts`.
- *Eval done 2026-09-19* — `tests/bench/map_eval.ts` and its three steps
  (`bench:map:dump` → answers → `bench:map:score`, plus `bench:map:api`):
  the names the catalog leaves null on all five fixtures (84 per pass),
  the exact `SYSTEM_MAP` + `mapPrompt()`, the exact portal `judge()`.

  | arm | names | applied wrong | applied right | shown right | shown wrong | left alone | parked/new right | traps taken |
  |---|---|---|---|---|---|---|---|---|
  | Haiku 4.5, API ($0.10) | 84 | **0** | 60 | 9 | 0 | 7 | 8 | 0 |
  | Haiku subagent × 2 | 168 | **0** | 119 | 9 | 0 | 17 | 23 | 0 |
  | Sonnet subagent | 84 | **0** | 59 | 3 | 0 | 12 | 10 | 0 |

  "Shown right" is the mg/dl, g/dl, U/l and pg/ml rows: the model said
  `medium`/`low` or named the right id and the unit gate refused it — both
  the intended answer. "Left alone" is `unknown` on tests the catalog lacks
  (Q10, iodine, riboflavin) and on BMI — conservative, the person decides.
  The scorer was proven to fail: a planted `K (Potassium)` → `glukoza` at
  `high` (same unit, overlapping interval) is the one fault the evidence
  gate cannot catch, and it throws; four planted traps with a disagreeing
  interval were all caught by the gate and counted as "shown wrong".

## Goal 2 — four synthetic labs the catalog has never seen

**Done when** four PDF fixtures with hand-authored truth exist under
`packages/lab-core/tests/fixtures/labs/<lab>/` (synthetic, committable,
byte-identical on regeneration) and `npm run bench:mapping` accepts a
fixture directory holding a PDF as well as one holding payloads.

Each lab differs in vocabulary and layout from the five known (AGILAB,
SPADIA, CASRI, PREVEDIG, BioLAB): a Slovak sheet, a hospital LIS with
abbreviation-only names and English echoes, a lab printing `mg/dl` and
`g/dl`, a lab with a "Materiál" column and no prefixes. Every lab has
rows in all four classes — catalog analytes under unseen spellings,
analytes the catalog lacks, urine and non-measurements, and near-miss
traps. `truth.json` names each printed name's `canonicalId`, `NEW:<id>`,
`NOT_BLOOD` or `IGNORE`, and each trap's *wrong* answer, so "wrong" is
scored, not just "unmatched".

## Goal 3 — a catalog wide enough for the Czech Republic, with an "i" on every analyte

**Done when** the catalog holds every analyte a Czech blood panel commonly
reports (target ≥ 250 entries, each with printed-name synonyms, canonical
unit, and a typical adult interval where one exists), every entry carries
`about`, and the "i" opens next to every analyte in Trendy and Souhrn.

- `AnalyteDef.about?: { what: string; usedFor: string }` — Czech, each
  one or two sentences: **what** the analyte is and measures, and **what
  it is usually used for** (which organ or system it reflects). Never a
  verdict on the person's numbers, never a disclaimer saying so, never a
  diagnosis. Written by one agent, reviewed by another against those
  rules, merged by `seed_registry.py` from a committed JSON so the
  registry stays the one source of truth.
- The "i" is a small round button after the analyte name in Trendy and
  Souhrn; tap opens a popover (or a sheet under 480 px) with the two
  paragraphs and closes on outside tap, Escape, and the button again.
  Keyboard reachable, `aria-expanded`, tokens only, Czech copy rules
  ([apps/CLAUDE.md](../../apps/CLAUDE.md)). An analyte without `about`
  (one a person founded) shows no "i".
- Sources for the catalog: labtestsonline.cz, the public price lists and
  sample reports of Czech laboratories, and the model's own knowledge.
  Ids are lowercase ASCII snake case; units use `µ` (U+00B5).

## Goal 4 — two strangers can register, upload, and never see each other

**Done when** a written test log shows, on a local stack with the real
extractor (`workers/portal-extract` run beside `workers/portal` under one
`wrangler dev`, keys from `.dev.vars`): two invite codes minted, two
accounts registered, each uploading a synthetic report, each seeing only
its own data through every tab and every API route (including
`/api/pages/*`, `/api/map`, `/api/share`, export and delete), the
password reset link, the ten-failures lockout, and the budget freeze.

Every button on every screen is pressed; every screen is swept at 360,
414, 768, 1024 and 1440 px in both palettes. What breaks is fixed when
it is a class of defect (and guarded), listed when it is cosmetic. The
list lives in [multi-user-findings.md](multi-user-findings.md) — written
2026-09-19: every proof above holds; five classes fixed and guarded (money
with a decimal point in Czech copy, a report row outgrowing its list on a
phone, Souhrn saying nothing about out-of-range values while an account
has a single draw, a session outliving logout and a password reset, the
settings cap a few hundred unmapped names could pass).

## Round two, 2026-09-19 evening — opening the door

Ondřej's decisions after seeing the branch (his call, not to be re-argued
by an agent): open registration with the address verified by mail before
the password; Turnstile on the three public forms; **5 documents free,
for ever, per account** — a document is one PDF or one set of photos up
to 6 pages, and deleting a report does not give the slot back; packages
of **5 for 49 Kč** and **15 for 99 Kč** through Stripe Checkout; a help
desk whose messages are stored and forwarded to Telegram; legal texts
and a landing page; operational fuses sized to the price. The Stripe
account and the Telegram bot do not exist yet — everything bound to them
is built behind a secret and proven with a fake, so switching on is
`wrangler secret put`, not a code change. The domain is his, separately;
until it exists mail can only reach his own address.

## Goal 6 — a stranger registers with an e-mail and a password

**Done when** `OPEN_SIGNUP=true` lets an address register with no invite:
the address gets a link (Resend, `MAIL_FROM`), the link opens the
set-password screen, Turnstile guards register / login / forgot-password
(not upload), and an unverified address can spend nothing. Invites keep
working as a code that skips Turnstile. Fake Resend and fake Turnstile in
plain-node tests; the real flow proven once against Ondřej's own address.
Rate limit: 5 registrations per IP per hour, 20 per day; the lockout on
login stays.

- *Done 2026-09-19* (the code; the real mail to Ondřej's address waits on
  the domain and the secrets). Worker: `workers/portal/src/signup.ts`
  (register / forgot / opening the account), `mail.ts` (Resend, plain
  text, logs the link without a key), `ratelimit.ts` (D1, not KV — the
  count must be read-after-write exact); `index.ts` gained the route lines
  and `Env extends SignupEnv`. `POST /api/auth/register {email, consent,
  turnstile}` mails a `/heslo?kod=…` link; `POST /api/auth/forgot {email,
  turnstile}` the same path; `GET /api/auth/signup` says whether the door
  is open; a mailed code carries `invites.email` + `consent_at` and
  `POST /api/auth/password` creates the row from it with `consent_at` and
  `email_verified_at`. Migration `2026-09-19-open-signup.sql`. App:
  `RegisterPage.tsx` (both moods), `VerifyMailPage.tsx`, `lib/turnstile.ts`;
  `Door.tsx` draws „Registrovat" / „Zapomenuté heslo" and the widget;
  `InvitePage.tsx` reads the mailed code's address. Tests:
  `workers/portal/tests/signup.test.ts` (26: the mail and its link, no row
  before the link, the link opens the account and logs in once, a taken
  address answered word for word like a free one, the two forms' actions,
  siteverify refusals, no secret fails closed, the dev bypass and its
  absence from wrangler.jsonc, 5/hour and 20/day per IP hash, Resend unset
  and Resend refusing, everything 404 and Turnstile-free with the var off),
  `schemaDrift.test.ts` „the migrations and schema.sql agree",
  `apps/portal/tests/registerPage.test.tsx` (7: the consents' wording and
  links, refusal without both, what is posted, the sent sentence, the
  widget's action and reset), five screens in `audit-portal.e2e.ts`.

## Goal 7 — documents, not dollars

**Done when** the account's allowance is counted in documents: `5` free
on creation, `+5`/`+15` per purchase, one taken at the moment a document
is accepted for extraction (not per page; a failed extraction gives it
back, a deleted report does not), and the shell shows „Dokumenty: 3 z 5"
with „Přikoupit" and a „Proč přikoupit?" link of the same kind as „co
ukládáme a co ne". The per-person USD ledger stays as a fuse behind it.
Stripe: Checkout sessions for the two packages, the webhook that credits
the account (idempotent on the event id), a `purchases` table — all behind
`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`; without them the buy sheet
says the shop is not open yet. Fake Stripe in tests, the signature check
tested with a real HMAC.

- *Done 2026-09-19*: `workers/portal/src/allowance.ts` (the count; the
  slot is taken by `POST /api/documents` before the first page, every page
  carries `x-document`, `DELETE /api/documents/:id` gives it back only
  while `pages_read` is 0 and no page is still out at the extractor —
  `pages_failed = pages_sent`, added 2026-09-19 after the invariant review
  found that a release fired with pages in flight got the slot back and the
  reads both) and `src/stripe.ts` (Checkout over `fetch`, the
  webhook's t + v1 HMAC with a five-minute tolerance, `purchases` keyed by
  event id; four secrets, `STRIPE_PRICE_5`/`STRIPE_PRICE_15` beside the two
  named). Migration `2026-09-19-documents.sql`; existing accounts start at
  0 used. `PORTAL_USD_LIMIT` raised to 10 USD as the fuse. App:
  `AllowanceChip.tsx` (the line, the return from Checkout), `BuySheet.tsx`
  (two packages with Ondřej's comparison lines, „Obchod zatím není
  otevřený."), `WhyPayPage.tsx` at `/proc-prikoupit`; the refusal at zero
  on the upload card. Operator: `moje-krev-budget.mjs --documents <n>`;
  the Stripe steps in `docs/moje-krev-handoff.md`. Tests:
  `workers/portal/tests/allowance.test.ts` (taken once per document not
  per page, the seventh page refused, given back on total failure and not
  after a read or a delete, 402 at zero in Czech, existing accounts' five,
  buy → Checkout form, demo may not buy, shop closed 503, webhook credits,
  idempotent on event id, bad signature 400, tolerance ±300 s, unpaid
  ignored), `schemaDrift.test.ts` (migration ↔ schema.sql),
  `apps/portal/tests/allowanceCopy.test.ts` (chip states, refusal copy,
  packages, page, copy rules), three screens in `audit-portal.e2e.ts`.

## Goal 8 — someone to write to, and someone who is told

**Done when** a logged-in or logged-out person can send a message
(„Napište nám": e-mail, text, optional report id) that lands in a
`messages` table and, when `TELEGRAM_BOT_TOKEN` + `TELEGRAM_HELPDESK_CHAT`
are set, in a Telegram chat; and a scheduled check (cron trigger) posts to
`TELEGRAM_OPS_CHAT` when the app or the extractor answers anything but
200, when the month's extract spend passes 80 % of `BUDGET_USD_LIMIT`, or
when the D1 export failed. Fake Telegram in tests. Fuses sized to the
price: `BUDGET_USD_LIMIT` 30 USD a month global (a free account can cost
at most 5 × 6 × 5 ¢ = 1,50 USD), alert at 80 %.

- *Done 2026-09-19.* `POST /api/helpdesk` →
  [workers/portal/src/helpdesk.ts](../../workers/portal/src/helpdesk.ts)
  (session's address or a typed one, Turnstile when `TURNSTILE_SECRET_KEY`
  is set, 4 000 chars, 5/hour per address and per IP, `messages` table);
  [telegram.ts](../../workers/portal/src/telegram.ts) is one `notify` over
  `sendMessage`; [watch.ts](../../workers/portal/src/watch.ts) runs from
  the cron (`*/15 * * * *`) — the shell end to end, the extractor's
  `/api/status` for reachability and spend, 80 % and 100 % once a month,
  up/down state in the BUDGET KV under `ops_` keys, a recovery line; the
  page is [ContactPage.tsx](../../apps/portal/src/ui/ContactPage.tsx) at
  `/napiste-nam`; the script `tools/scripts/moje-krev-helpdesk.mjs`. Grown
  the same evening on Ondřej's ask:
  [triage.ts](../../workers/portal/src/triage.ts) — GLM 5.3 Flash through
  the `AI` binding reads the message beside the account's last refusals
  ([events.ts](../../workers/portal/src/events.ts), every 4xx/5xx and every
  refused upload, hashed to the account, pruned after 30 days) and posts a
  second line prefixed „Odhad (GLM): "; skipped without the binding. The
  D1 export cannot be watched from a Worker — the handoff has the cron for
  Ondřej's machine. Migration `2026-09-19-helpdesk.sql`. Tests:
  `helpdesk.test.ts` (stored with/without session, Turnstile required /
  verified / refused, 429, the 4 000 cap, Telegram called with the chat and
  the d1 hint and not without secrets, the triage asked with events and
  posted second, skipped without `AI`, events on 402/413/429 and on both
  upload paths, no address in events, schema ↔ migration), `watch.test.ts`
  (down once, recovery once, unreachable, 80 % once a month, 100 % once,
  silent under 80 %, silent without the bot, prune, the `scheduled`
  export), `schemaDrift.test.ts` widened to nine tables; the contact page
  swept at five widths in `test:audit:portal` (two screens).

## Goal 9 — the words a stranger reads first

**Done when** `/` logged-out is a landing page (what this is, what is
stored and what never leaves the device, the demo patient, „Registrovat",
„Přihlásit"), `/podminky` holds terms of use, `/soukromi` names every
sub-processor (Cloudflare, Anthropic, Google, Resend, Stripe) and the
legal basis for health data (explicit consent — a checkbox at
registration, its wording here), the age line (18+), the „není
zdravotnický prostředek" sentence, and a support contact (the help desk).
Czech, plain, no marketing; drafts for Ondřej to approve, marked as such
in the page until he does.

- *Built 2026-09-19*: [LandingPage.tsx](../../apps/portal/src/ui/LandingPage.tsx)
  at `/` logged out (the login form moved one link on, to `/prihlaseni`),
  [TermsPage.tsx](../../apps/portal/src/ui/TermsPage.tsx) at `/podminky`,
  [Privacy.tsx](../../apps/portal/src/ui/Privacy.tsx) rewritten. What the
  three share — the draft banner, the operator placeholder, the allowance
  numbers, the consent sentences, the footer — is
  [legal.tsx](../../apps/portal/src/ui/legal.tsx): `LEGAL_DRAFT = false`
  removes the banner from both pages, `OPERATOR` fills every
  `[provozovatel]`. The processor clause stays dynamic
  (`processorPhrase`, `sendsToGoogle`) on the landing and the privacy page;
  `legalPages.test.tsx` renders both and fails on a vendor name in the copy.
- **The consent sentences** (the registration form imports them from
  `legal.tsx`; the privacy page quotes the first as the čl. 9 basis):
  1. „Souhlasím se zpracováním svých zdravotních údajů — hodnot z
     laboratorních zpráv a začerněných stránek — za účelem jejich zobrazení
     a sledování v čase, jak popisují Zásady ochrany soukromí."
  2. „Souhlasím s Podmínkami užití."
- Sub-processors the privacy page names: Cloudflare, Anthropic, Google
  (only while the deployment's pair reaches it), Resend, Stripe — and
  Telegram, because Goal 8 forwards a help-desk message (address, text,
  report id) into the operator's chat, which makes it one.

## Goal 10 — the gate, again, then live

`test:all`, the mapping bench, `portal-auditor`, `invariant-reviewer`;
Ondřej reviews; then the live D1 takes the migrations of this branch and
`deploy:moje-krev` ships it. The secrets that open registration, the
shop and Telegram are set by hand afterwards, one at a time.

## Goal 5 — the gate (round one, passed 2026-09-19)

`npm run test:all`, `bench:mapping` over all fixtures, `portal-auditor`
over the mapping, trends and summary tabs, `invariant-reviewer` over the
whole diff. Then Ondřej reviews the branch. Deploy is his call.

## Ledger (USD)

| who | what | pages / calls | spent |
|---|---|---|---|
| Goal 4 agent | A uploads `identity.pdf` (text path, Sonnet + Haiku) | 1 page | 0.0244 |
| Goal 4 agent | B uploads `slovak_grouped.pdf` (text path) | 1 page | 0.0250 |
| Goal 4 agent | B's „Nechat AI navrhnout přiřazení" (Haiku, 1 name) | 1 call | 0.0048 |
| orchestrator | `bench:map:api` — Haiku over 6 batches, 84 names | 6 calls | 0.1045 |
| | **total** | | **0.1587** |
