# Plan: Moje krev goes public — open sign-up, a hard quota, and photos

Decided 2026-09-02 (Ondřej with Claude). Moje krev today is invite-only for
friends and family ([portal.md](portal.md), all five phases live since
2026-08-31). This plan takes it to a **public web app**: anyone can register
with e-mail and password, each account gets a fixed allowance of
**5 reports of at most 4 pages**, and a report can be a **photo** as well as
a PDF. Nothing is rebuilt; every phase extends what is deployed.

## The decision this plan records

**Web app first. No store apps now.** The question was web versus a native
iOS/Android app with photo capture. The web app won on four grounds:

1. **Photo capture needs no native app.** A file input with
   `capture="environment"` opens the camera in Safari and Chrome, and the
   extractor already receives every page as a JPEG — the scan path
   (`prepareFile` → manual redaction → vision read) exists and is live.
   A photo is a one-page scan that skips pdf.js.
2. **The stores add review latency, not users.** Apple treats health data
   strictly (privacy labels, deletion flow, days per review round). The
   portal has shipped fixes in minutes since day one; that is worth more
   than an icon on a store page while demand is unmeasured.
3. **Demand is unmeasured.** A public web app with sign-up answers in weeks
   whether anyone uploads a second report. That answer decides whether store
   presence is worth paying for.
4. **Everything already runs on Cloudflare.** Auth on D1, ledgers in KV, the
   extract binding — a native client would need the same backend plus a
   second client kept in step.

If store presence later matters, the same app is wrapped with Capacitor.
Nothing built here is thrown away; a PWA manifest (Phase 3) gives an
installable home-screen icon in the meantime.

## Decisions already made (do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Platform | Public web app, `apps/portal` + `workers/portal` as deployed | See above; nothing is rebuilt |
| Sign-up | **Open**, e-mail + password; the e-mail is verified by the existing magic link *before* the password is set | An unverified address must never be able to spend extraction; the verify step is the link flow that already exists |
| Login | Password **or** magic link; „Zapomenuté heslo" *is* the magic link, followed by a set-password screen | No separate reset machinery; the flow that logs a person in already proves they own the address |
| Password hashing | PBKDF2-SHA-256 via WebCrypto, per-user salt, plus a server-side pepper secret (`PASSWORD_PEPPER`); no auth library | Workers WebCrypto is native and cheap on CPU; scrypt/argon2 in JS (Better Auth, Lucia patterns) blows the free plan's 10 ms CPU budget. **Verify the iteration cap at phase start** — Workers limits PBKDF2 iterations (believed 100 000); use the max allowed |
| Sessions | Unchanged: 90-day HMAC cookie (`session.ts`), uid re-read from D1 on every request | Already reviewed; deletion already invalidates |
| Invites | Kept as a table, no longer required; `OPEN_SIGNUP` var flips the check | Invites still let Ondřej hand a friend a code that skips Turnstile friction; nothing to delete |
| Bot gate | Turnstile on register, login and forgot-password (**not** on upload — a logged-in user is the gate there) | Open sign-up without a CAPTCHA is a mail-bomb and a budget drain; the portal already binds the widget code path via `@bw/gate` |
| Allowance | **5 reports per account, 4 pages per report**, enforced in the worker; deleting a report frees its slot | Real Czech reports are 2–3 pages, so 4 rarely bites; 5 covers about a year of draws. Slots return on delete because "I uploaded the wrong file" must not cost the allowance |
| The money fuses | Both existing ledgers stay: per-person monthly USD (`PORTAL_USD_LIMIT`) and the extract deployment's global cap (`BUDGET_USD_LIMIT`) | A churned slot still costs a read; the USD ledger is what stops upload/delete loops. The global cap is the ceiling on the whole product's monthly spend and is raised only by hand |
| Photos | Accepted as `image/jpeg`, `image/png`, `image/webp`; HEIC converted by iOS at pick time; downscaled in the browser to ≤ 2000 px long edge, EXIF-oriented, JPEG ≈ 0.85; several photos = one report's pages in pick order | The scan path expects a page image; the browser already renders PDF pages to JPEG, so a photo joins at the same point |
| Photo verification | Photo pages carry `source: "photo"` and every value from them is **unverified** — the same withheld semantics `review.ts` applies to scans, and the verify tab says „z fotografie" | There is no text layer, so the printed-text guard cannot run; the honest state is "the model read it, you check it" |
| Identity on photos | Manual redaction, mandatory, exactly as for scans; the photo original never leaves the device | The redaction review is the guard; a photo is a scan |
| Domain and mail | A real domain **before** the first stranger; Resend domain verified (SPF, DKIM), `MAIL_FROM` set | Without it login mail reaches only Ondřej's address; this is the blocking operator step and it is listed first |
| Hosting plan | Stay on the free plan until a limit bites; observability alerts on 5xx and on CPU-limit errors | Nothing measured says paid is needed; the PBKDF2 check in Phase 1 is where that would show first |
| Legal posture | Not a medical device: the app shows the lab's own reference ranges and flags, no diagnosis, no advice text; this is stated on the landing and privacy pages | The existing product principle ("the app only knows what the record says") is also the regulatory line |
| Language | Czech only, unchanged | The audience; the PDFs |

## Invariants this plan must not break

- **Identity never leaves the browser.** Photos go through the same
  redaction review as scans; the server stores redacted images and numbers
  keyed to an e-mail. No new identity field appears anywhere.
- **`extract` is finished.** Photo pages arrive as the `imageBase64` page
  the contract already accepts. Quotas, photo bookkeeping and auth live in
  `workers/portal`. Extraction still never grows a database binding.
- **The parsing layer exists twice, not three times.** Quota counting is
  bookkeeping, not clinical logic; no SQL re-derives a rule.
- **`review.ts` is the single authority on doubt** — a photo value is
  withheld the way a scan value is, by the same rule.
- **Signal colours draw, ink colours type; both palettes; five widths** —
  every new screen (register, set-password, landing, quota chip, photo
  capture) goes through `npm run test:audit:portal`.
- **Tests stay plain node** — fake D1/KV, fake Resend, fake Turnstile; no
  miniflare. The password path is tested with the real WebCrypto in node.
- **Czech, nominative, no verbs** in labels; vykání in the portal's frames.
- **Secrets never enter git or chat.** `PASSWORD_PEPPER` and the Turnstile
  secret are `wrangler secret put`, listed in the launch checklist only.

## Cost shape

| Path | Per page | Worst case per account (5 × 4) |
|---|---|---|
| Born-digital PDF (text layer) | fractions of a cent | ≈ 0.05 USD |
| Scan or photo (vision) | ≈ 0.05 USD | ≈ 1 USD |

Cloudflare and Resend stay at 0 Kč at this scale. The global extract cap
is the product's monthly ceiling; set it to what Ondřej is willing to lose
to abuse in a month, and raise it deliberately as real usage shows up.

---

## Phase 0 — reconcile what is already built

Nothing public can ship on top of an unshipped tree.

1. **Land the UI redesign.** The `ui-redesign` worktree (off `8f3531e`)
   holds the redesigned charts, Souhrn regrouping and Potvrdit flow,
   uncommitted and previewed at `292fa6ac-moje-krev`. Ondřej signs off on
   the preview, then: commit, `npm run deploy:moje-krev`, merge to `main`.
2. **Bring local `main` level with `origin/main`** (local is at `939dfea`,
   origin at `8f3531e`); this plan and all following work branch from there.
3. **Domain.** Buy or pick the domain, add it to Cloudflare, add it in
   Resend, let DNS verify, `wrangler secret put MAIL_FROM` with
   `Moje krev <noreply@…>`. Route `apps/portal` to the domain in its
   wrangler file. Until this is done, Phase 1 can be built but not tested
   with a stranger's address.

**Gate:** the redesign is live on the real domain, login mail arrives at a
non-Ondřej address, `npm run test:all` green on `main`.

## Phase 1 — accounts for strangers

`workers/portal` gains a password and an open door; `apps/portal` gains the
screens. The magic link stays the proof of address.

1. **Schema:** `users` gains `password_hash TEXT`, `password_salt TEXT`,
   `password_set_at TEXT`; a new `auth_events (user_id, kind, at, ip_hash)`
   table for rate limiting and for the security review's audit trail.
   Migration as a second `.sql` file applied with `wrangler d1 execute`.
2. **Routes:** `POST /api/auth/register` accepts `{email, turnstile}` (plus
   `invite` when `OPEN_SIGNUP` is off) and sends the link; the existing
   `POST /api/auth/confirm` gains `{password}` on the login step, so the
   first confirmation sets the password and mints the session in one POST.
   `POST /api/auth/password` — `{email, password, turnstile}` → session.
   `POST /api/auth/forgot` — `{email, turnstile}` → link; the confirm screen
   then shows „Nové heslo". Same 200 whether the address exists or not, on
   every route, as today.
3. **Hashing:** `password.ts` — PBKDF2-SHA-256 via `crypto.subtle`, 32-byte
   salt, the deployment's max iterations, HMAC-peppered before derivation;
   constant-time compare. Measured against the Workers CPU limit in a
   deployed preview before the phase closes.
4. **Rate limits:** per address and per IP hash — 5 links/hour (exists),
   10 password attempts/15 min, 20 registrations/hour/IP; refusals are
   Czech and say when to retry.
5. **Turnstile:** the widget on the three forms; the worker verifies with
   the hostname check `@bw/gate/turnstile` already does (never localhost in
   production).
6. **Screens:** the login door grows a password field and „Zapomenuté
   heslo"; a register screen; the confirm interstitial gains the set-password
   step. Passwords: minimum 10 characters, no composition rules, checked
   against a short common-password list in the client and the worker.
7. **Tests (plain node):** wrong password refused with the same message as
   unknown e-mail; set-password only after a spent link; pepper rotation
   documented; rate limits trip; a tampered cookie is 401; an invite still
   works when `OPEN_SIGNUP` is off.

**Gate:** a stranger's address registers, gets mail, sets a password, logs
in on a second device with it, resets it via the link; Turnstile refuses a
headless browser; `/security-review` over the auth diff clean.

## Phase 2 — the allowance

The monthly USD ledger stays as the fuse; the thing a user sees is
reports and pages.

1. **Worker:** `MAX_REPORTS_PER_ACCOUNT=5`, `MAX_PAGES_PER_REPORT=4`
   (from 30). `PUT /api/reports/:id` refuses a sixth report for a new id
   with `quota_reports`; `POST /api/extract` gains a `reportId` and
   `pageNum` and refuses page 5 of any report with `quota_pages`, counting
   in D1 (`report_pages`) so the count survives a retry. `GET /api/me`
   returns `{reports: {used, max}, pagesPerReport}`.
2. **Client:** `prepareFile` truncates at the new cap and says so
   („nejvýše 4 strany na report — další strany se nepřečtou"); the upload
   panel shows „3 z 5 reportů" and disables the drop zone at 5 with the
   sentence that deleting a report frees a slot. Refusals from the worker
   render as the same chip, so the client is never the only guard.
3. **Delete frees the slot** — already true by construction once the count
   is a D1 `COUNT(*)`; a test pins that a deleted report's pages are gone
   from KV and the count drops.
4. **Tests:** 5th report accepted, 6th refused, delete then 6th accepted;
   page 5 refused while page 4 lands; a retried page 3 does not count
   twice; the USD ledger still freezes a churn loop.

**Gate:** the walkthrough on phone — fill five slots, hit the wall, delete
one, upload again — reads clean; `test:audit:portal` green with the chip
in both palettes.

## Phase 3 — photos and the home screen

1. **Accept images.** The file input accepts PDF and `image/*`; on touch
   devices a second button „Vyfotit" opens the camera
   (`capture="environment"`). `prepareFile` gets a sibling `prepareImages`
   that turns N picked images into one `PreparedFile` of N scan pages:
   `createImageBitmap(file, {imageOrientation: "from-image"})`, downscale to
   ≤ 2000 px long edge, re-encode JPEG ≈ 0.85, `hasTextLayer: false`, every
   page in `scanPages`. The existing redaction review then runs unchanged
   (drawing mode on, „začerněte ručně").
2. **Mark the source.** `LabReport` pages carry `source: "pdf" | "scan" |
   "photo"`; `review.ts` treats photo exactly as scan (one rule, one test
   asserting they are the same set); the verify tab and the summary say
   „z fotografie" where they say „sken" today.
3. **Quality hints, not rejections.** Before the redaction screen a photo
   below 1200 px on its long edge or with a very dark histogram gets one
   sentence („Snímek je malý nebo tmavý — čtení může být nepřesné") and a
   retake button; the upload is never blocked on it.
4. **PWA:** `manifest.webmanifest` (name, icons, `display: standalone`,
   theme colours per palette), a minimal service worker that caches the
   shell only — never a page image or a payload. An install hint on the
   home screen after the first successful upload, dismissible once.
5. **Fixtures:** a JPEG rendered from `identity.pdf` at phone-like
   resolution, plus the same image rotated with an EXIF orientation tag;
   tests prove the redaction hits are found after orientation and that the
   page reaches the worker as one scan page under 4 pages.

**Gate:** a real report photographed on a phone lands as a report, its
identity painted out by hand, its values shown unverified, the verify tab
crops correctly on the stored image; `test:audit:portal` green with the
photo button at five widths; Lighthouse installability passes.

## Phase 4 — public-facing trust

1. **Landing page** for the logged-out visitor: what it does in three
   sentences, what it does not do (no diagnosis, no advice), the allowance,
   the privacy sentence, one button to register. Czech, no marketing tone.
2. **Privacy page** (`/soukromi`) updated: open registration, the password
   (hashed, peppered), photos handled like scans, the allowance, what
   deletion removes (already true), the contact address for GDPR requests,
   the sub-processors (Cloudflare, Anthropic, Resend) and where they
   process. **Terms** (`/podminky`): personal use, no medical claim, the
   right to remove abusive accounts, the allowance.
3. **Consent at registration:** one checkbox naming the privacy page —
   required, stored as `consented_at` on the user row. No cookie banner:
   the only cookie is the session, which is strictly necessary.
4. **Data export and deletion** already exist; the export is re-checked to
   include photo pages and the `source` field.
5. **Abuse surface:** report content is numbers and redacted images, so the
   exposure is spend, not content. The global cap is set; an alert fires
   at 80 % of it; the operator's runbook says how to freeze one account
   (a `frozen_at` column and one CLI flag on the invites script).

**Gate:** a reader outside the project can explain from the landing and
privacy pages what happens to their photo; the consent row is set for every
new user; `docs:check` green with the new pages linked.

## Phase 5 — launch

1. `/security-review` over `workers/portal` and the upload path, again,
   over the whole branch.
2. **Observability:** Workers logs on, alerts for 5xx rate, CPU-limit
   errors, and the 80 % spend mark; D1 Time Travel confirmed for restore.
3. **Deploy** with `npm run deploy:moje-krev`; secrets checklist below.
4. **Soft launch:** friends first through invite codes with `OPEN_SIGNUP`
   off; two weeks of logs; then flip `OPEN_SIGNUP` on and announce.
5. **Measure the one question:** accounts that upload a second report
   within 30 days. That number, not a feeling, decides whether Capacitor
   and the stores are the next plan.

**Gate:** first stranger registers with a password, uploads a photo from
their phone, and sees a trend — with no operator involvement.

## Launch checklist — operator steps outside the repo

1. Domain in Cloudflare; route in `apps/portal/wrangler.jsonc`.
2. Resend: add domain, DNS records, verify; `wrangler secret put MAIL_FROM`
   on `moje-krev-portal`.
3. Turnstile: a widget for the domain (never localhost in production);
   `TURNSTILE_SITE_KEY` in the app's env, `TURNSTILE_SECRET_KEY` and
   `TURNSTILE_HOSTNAMES` on `moje-krev-portal`.
4. `wrangler secret put PASSWORD_PEPPER` (`openssl rand -base64 32`);
   record in the deploy doc that rotating it invalidates every password.
5. Apply the Phase 1 migration to D1 `--remote`.
6. Set `BUDGET_USD_LIMIT` on `moje-krev-extract` to the monthly ceiling;
   `PORTAL_USD_LIMIT` stays per person.
7. `npm run deploy:moje-krev`; register with a fresh address; upload a
   photo; delete the account; confirm zero rows and zero KV keys.

## Post-launch, in rough order

Capacitor wrap and store listing if the 30-day number says so · passkeys
(WebAuthn) as the third login · a paid tier that raises the allowance ·
Mistral OCR on the photo path if photo volume makes the vision path the
cost driver (see `docs/extraction-speed.md`) · the chat agent over your own
data.
