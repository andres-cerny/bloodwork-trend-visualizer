# Plan: Moje krev — bloodwork trends with accounts

Design settled 2026-08-31 (planning session with Andres); named **Moje krev**
the same day. A third app over the
same deterministic layer: people log in, upload their Czech lab PDFs, verify
the extraction, and see their trends again on every later visit. Friends and
family first; built so growing doesn't mean rebuilding.

## What is being built

**`apps/portal`** — a logged-in bloodwork trend visualizer. Same clinical core
as `apps/bloodwork` (extract → verify → trend), but:

- **Accounts.** Invite-only signup, email magic-link login, ~90-day sessions.
  One person per login; the account *is* the patient.
- **Persistence.** Extracted results and redacted page images survive logout.
  Upload once, see the trend forever.
- **A fresh UI.** Mobile-first, cleaner than the current app — especially the
  charts. Czech only, same token discipline, new layout and chart design.

**`workers/portal`** — its API worker: auth, D1, KV for page images, and a
service binding to **`workers/portal-extract`** — a config-only second
deployment (`moje-krev-extract`) of the finished extract worker, so family
uploads and the public demo can never freeze each other's ledger.

## Decisions already made (do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Where | This monorepo: `apps/portal` + `workers/portal` | Reuses lab-core, extraction, gate, ui-kit; the parity CI keeps protecting the shared parsing layer |
| Name | **Moje krev** | Plain Czech, says exactly what it holds; workers `moje-krev` / `moje-krev-portal` / `moje-krev-extract` |
| Hosting | Cloudflare free tier: Workers + D1 + KV | Free at F&F scale; KV rather than R2 because this account has no R2 opt-in (the agent worker's EVIDENCE store made the same call) — R2 is the growth path if images outgrow KV's free 1 GB |
| Domain | `moje-krev.<account>.workers.dev` for now | A real domain later changes one wrangler file and the Resend sender, nothing else |
| Extraction budget | Second deployment `moje-krev-extract`, own KV ledger | The demo freezing the family (or the reverse) is the cross-freeze the per-capability split exists to prevent; isolation by deployment needs zero changes to the finished worker |
| First user | Andres, via the product itself | Real PDFs are uploaded through the app on his own device once deployed — the seed IS the first honest test; real data never enters the repo or a cloud dev container |
| Signup | Invite codes issued by Andres | No open registration — nobody random spends the Claude API budget |
| Login | Email magic link (Resend free tier), ~90-day sessions | No passwords to store or reset for a medical-data app; same HMAC construction as `@bw/gate`, portal-local claims |
| Identity at rest | **None.** Redact in the browser; the original PDF never leaves the device | Name, rodné číslo, address and birth date are painted out of the page images and stripped from the text layer *client-side*, before upload. The server holds health numbers keyed to an email, linked to no identity |
| Consent-based storage of rodné číslo | Rejected | GDPR special-category data + national identifier on the weakest legal basis, for a field nothing needs — the login is the identity |
| Original PDFs | Never stored, never uploaded | Verification uses redacted page images, exactly like the demo's verify tab; re-extraction later means re-uploading, an accepted cost |
| Scans (no text layer) | Accepted, redacted by hand (revised 2026-08-31; was "refused in MVP") | Auto-redaction reads the text layer, so on a scan it finds nothing and says so; the reader draws the boxes and confirms each such page explicitly before the painted image goes to the vision path. Andres's call after the first real upload — some people only have scans |
| MVP scope | Upload → verify → trends. Nothing else | Chat agent, export, doctor share-links are all post-MVP |
| Profiles | One person per login | Family members get their own invite code |
| Language | Czech only | The existing hard rule; the audience; the PDFs |

## Invariants this plan must not break

- **Patient data never leaves the machine** becomes, for the portal: *identity
  never leaves the browser*. The upload path carries redacted images and a
  redacted text layer only. `data/` and `samples/` guards are untouched.
- **`extract` is finished and must not change.** The portal reaches it through
  a service binding and the existing session contract; extraction still never
  grows a database binding. Anything the portal needs beyond what extract
  offers lives in `workers/portal`.
- **The parsing layer exists twice, not three times.** The portal's client
  imports `@bw/lab-core` like `apps/bloodwork` does — trends, review, derived
  values, plausibility are computed in the client from stored `LabReport`
  payloads, never re-implemented in SQL or in the worker.
- **`review.ts` stays the single authority on doubt**; the portal's trend and
  summary surfaces inherit the withheld-set obligation ("žádná *ověřená*
  hodnota…").
- **Signal colours draw, ink colours are for type**; every rule ships in both
  palettes; the layout audit gates UI phases at five widths.
- **Tests stay plain node** — fake D1/KV, no miniflare;
  `@cloudflare/workers-types` stays alone in `types`.
- **Czech, nominative, no verbs** in labels; parametr, never analyt.

## The privacy pipeline, end to end

```
browser                                          server
───────                                          ──────
1. open PDF (pdf.js, @bw/lab-core/pdf)
2. detect identity: rodné číslo (pattern),
   birth date, name + address (label anchors:
   Pacient/Jméno/Bydliště + the RČ line's block)
3. redact: paint boxes on rendered pages,
   strip the same strings from the text layer
4. MANDATORY review screen: user sees the
   redacted pages, taps anything missed to
   black it out, confirms
5. upload redacted text layer ──────────────────▶ workers/portal ──▶ moje-krev-extract (service binding)
   upload redacted page images ─────────────────▶ KV
                                                  results (LabReport JSON) ──▶ D1
6. original PDF is dropped; nothing with a
   name on it ever left the device
```

Step 4 is not optional UX polish — it is the guard for what detection cannot
see (a stamp, a signature), and the honest answer to "finding zero identifiers
is only reassuring if it could have found them". A page the user has looked at
and confirmed is the strongest check available.

Detection logic descends from `tools/pipeline/scripts/export_web_data.py`. The
detection rules (not the painting) land as a pure module with fixture-based
tests; if the Python and TS rule sets ever both matter, shared fixtures follow
the parity_cases pattern — but the Python script serves the demo export and
the TS module serves the portal, so they are siblings, not mirrors.

## Schema (`workers/portal/schema.sql`, one D1 database)

```sql
users        (id TEXT PK, email UNIQUE, created_at,
              settings TEXT)                 -- registry learned synonyms, prefs
invites      (code TEXT PK, note, created_at, used_by → users, used_at)
login_tokens (token_hash TEXT PK, user_id → users, expires_at, used_at)
reports      (id TEXT PK, user_id → users, report_date, lab_name,
              payload TEXT, created_at)      -- full LabReport JSON, source of truth
report_pages (report_id → reports, page_num, kv_key, width, height)
```

The authoritative copy is `workers/portal/schema.sql`.

No `measurements` index: the chat demo needed SQL cohort queries; the portal
reads one user's payloads into lab-core in the client, exactly as
`apps/bloodwork` reads session state today. Sessions are stateless HMAC
cookies (`@bw/gate`), not rows. Deleting a user deletes their reports, their
page-image KV keys, and nothing else — because nothing else exists.

## Phases

Status (2026-08-31): Phases 1–3 are built and deployed. Phase 4 starts with
the design pass, as written; Phase 5 follows it.

### Phase 1 — worker skeleton, auth, deploy

`workers/portal` + a walking-skeleton `apps/portal` (login → empty home).

1. Scaffold both from the bloodwork app/worker pair; wrangler bindings:
   `DB` (D1), `PAGES` (KV), `EXTRACT` (service binding), `BUDGET` (KV),
   secrets `SESSION_SECRET`, `RESEND_API_KEY`. `workers_dev: false` on the
   worker; the app shell is the only public origin.
2. Auth routes: `POST /api/register` (invite code + email → user, burn code),
   `POST /api/login` (email → magic link via Resend; same 200 for unknown
   email), `GET /api/login/confirm` (token → 90-day HMAC cookie),
   `POST /api/logout`. Tokens stored hashed, single-use, 15-minute expiry.
3. Invite management: a tiny CLI (`tools/scripts/moje-krev-invites.mjs` via wrangler d1
   execute) — no admin UI in MVP.
4. Extend the deploy script: portal worker after extract, shell last.
5. Tests: fake D1 (exists from the chat demo work) + fake Resend fetch;
   token reuse refused, expired refused, invite reuse refused, cookie
   tampering refused.

**Gate:** a real invite code registers a real email, the link arrives, the
cookie survives a restart, `npm test` + typecheck green.

### Phase 2 — client-side redaction

The privacy pipeline's browser half, behind no server dependency — testable
on local PDFs before auth even matters.

1. `packages/lab-core/src/redact.ts` (pure, root export): given the text layer
   with coordinates, return identity boxes + strings — rodné číslo pattern,
   birth date, label-anchored name/address block. Fixtures from the synthetic
   demo PDFs (which carry fake identities precisely for this).
2. Painting in the pdf subpath: render page → fill boxes → re-encode; strip
   the matched strings from the text layer sent onward.
3. The review screen: redacted pages full-width, tap/drag to add a box,
   tap a box to remove a false positive, explicit Czech confirm. A page
   with no text layer is marked as a scan, gets no automatic boxes, and
   needs its own tick before the upload may go on (decision revised
   2026-08-31 — see the table).
4. **Reintroduce the fault:** a fixture whose name appears twice (header +
   footer) with the second occurrence initially missed — the test must fail
   before the rule that catches it, per the repo's guard-testing habit.

**Gate:** every synthetic demo PDF comes out with zero identity strings in
text layer and no identity pixels at the known coordinates; a real sample
checked by eye locally.

### Phase 3 — upload, extract, store, verify

*As built:* extraction is proxied a page at a time (`POST /api/extract`)
rather than assembled server-side — the worker mints a one-page session for
the binding, books the extractor's reported cost to the person's monthly
ledger, and hands the reads back; the client keeps interpreting them with
lab-core exactly as the demo does, then stores the finished `LabReport`
(`PUT /api/reports/:id`) and each painted page. Same contract, same ledger,
progress per page for free, and the parsing layer stays in the client where
it already lives. The worker's one look inside a payload is to empty the
identity fields.

1. `POST /api/reports`: redacted text layer in, extract via service binding
   (portal worker holds the extract session contract; `consumePage` stays
   extract's), normalized `LabReport` back, payload to D1, images to KV
   (`user_id/report_id/page_n.webp`), spend recorded against a per-user
   monthly ledger (`PORTAL_USD_LIMIT`, the existing KV ledger pattern).
2. `GET /api/reports` (payload list), `GET /api/pages/:report/:n` (KV
   read, owner-checked), `DELETE /api/reports/:id` (row + KV keys).
3. The verify screen reads stored images + payload — same bbox-crop pattern
   the demo's VerifyTab proved; corrections re-derive through lab-core in the
   client and persist as a payload update.
4. Registry learned synonyms persist into `users.settings`.

**Gate:** upload on phone → logout → login on laptop → same report, same
verification view, same chips. Ledger freezes a user at the cap without
freezing anyone else.

### Phase 4 — the fresh UI

The reason this app exists twice. Desktop and mobile are BOTH first-class
(Andres's explicit call, 2026-08-31): it will be used daily on both, so
"impressive" is the bar on each — a phone layout that is a squeezed desktop
fails, and a desktop layout that is a stretched phone fails the same way.
The charts are the centrepiece on both.

1. Design pass first: mockups for home (latest draw summary + sparkline
   grid), trend detail (one parametr, full-bleed chart, reference band,
   draw markers, hollow unconfirmed points), upload flow, verify — each
   screen designed twice, at phone width and at desktop width (where the
   extra room buys comparison: multi-parametr grids, chart + source side
   by side), not scaled once. Approved before code.
2. Chart work happens in `@bw/ui-kit` (a redesigned `Chart`), not a portal
   fork — both apps inherit the improvement, and "the model may name a
   chart, never fill one" stays enforced once. Bloodwork app adoption is a
   separate later change.
3. Layout: bottom tab bar on mobile, side rail on desktop; panels keep the
   `hidden`-attribute pattern. All copy Czech, nominative, no verbs.
4. Extend the layout auditor to the portal's screens; five widths, both
   palettes, 4.5:1 on type — the audit is the phase gate, not a suggestion.

**Gate:** `npm run test:audit` green over portal screens; the
upload → verify → trend walkthrough reads clean twice — once phone-sized,
once desktop-sized.

### Phase 5 — trust, GDPR, launch

1. Account deletion: one button, deletes user + reports + page images +
   learned synonyms, immediately and verifiably (test walks the fake KV).
2. Data export: `GET /api/export` — the user's payloads as one JSON/CSV.
   Their data is theirs; this also makes "we store no identity" auditable.
3. A plain-Czech privacy page: what is stored (numbers + redacted images,
   keyed to an email), what never leaves the device, what deletion does.
4. `/security-review` over `workers/portal` + the upload path; the session
   secret is portal-specific (NOT shared with extract/agent — different
   audience, different lifetime).
5. Deploy, mint the first invite codes, onboard the family.

**Gate:** security review clean; a deleted account leaves zero rows and zero
objects; first real user round-trips on their own phone.

## Costs at F&F scale

Cloudflare, Resend: 0 Kč on free tiers. Claude API: extraction only — the
text-layer path is cheap (fractions of a cent per page); a family uploading
a decade of reports is a few dollars once, then near-zero. The per-user
ledger caps the blast radius of any surprise.

## Launch checklist — the operator steps

Step-by-step local instructions, from `git pull` to a deployed app, live in
[../moje-krev-handoff.md](../moje-krev-handoff.md) — the cloud container
cannot reach `api.cloudflare.com`, so deploys are local (or the environment's
network policy is widened first).

Everything below happens once, outside the repo; development never blocks on
it. Secrets go into the claude.ai/code environment settings (for Claude to
deploy) or stay on Andres's machine (self-deploy) — never into chat or git.

1. **Cloudflare API token** — dash.cloudflare.com → My Profile → API Tokens →
   Create Token → Custom, scoped to this account only: Workers Scripts:Edit,
   D1:Edit, Workers KV Storage:Edit, Account Settings:Read. Store as
   `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`, from the dashboard's
   right rail) in the environment settings — or skip and run deploys locally.
2. **Resend** — resend.com, free tier. An API key alone delivers only to the
   account owner's address — enough for the first weeks. Verifying a real
   domain (DNS records Resend prints) lifts that for the family; the sender
   then changes from `onboarding@resend.dev` in one place (`MAIL_FROM`).
3. **First deploy** — create resources, paste ids into the two wrangler
   files, apply schema, set secrets, deploy in binding order:
   `wrangler d1 create moje-krev` · `wrangler kv namespace create moje-krev-budget` ·
   `wrangler d1 execute moje-krev --remote --file=schema.sql` ·
   `wrangler secret put` (SESSION_SECRET on moje-krev-portal; ANTHROPIC_API_KEY +
   SESSION_SECRET + TURNSTILE_SECRET_KEY placeholder on moje-krev-extract) ·
   `npm run deploy:moje-krev`.
4. **Invites** — `node tools/scripts/moje-krev-invites.mjs 1 "Andres" --apply`,
   register on the phone, upload the first real PDF through the app.

## Post-MVP, in rough order

Chat agent over your own data (the seams exist: `PatientDataSource` over the
portal DB) · manual tap-to-redact for scans · CSV/PDF export polish · doctor
share-links · passkeys · profiles per account if one-login-per-person chafes.
