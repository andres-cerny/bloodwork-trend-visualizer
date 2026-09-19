# Goal 4 — two strangers on one local stack: the test log

2026-09-19, branch `claude/multi-user-hardening`, worktree
`agent-a1cc24b312333dfda`. The stack was the real one: Vite on :5173 in
front of one `wrangler dev` running `workers/portal` and
`workers/portal-extract` together (the command is in
[moje-krev-handoff.md](../moje-krev-handoff.md)), keys from `.dev.vars`, a
fresh local D1 from `schema.sql`. Two accounts, `a@example.test` (A) and
`b@example.test` (B), registered through the browser from codes minted with
`tools/scripts/moje-krev-invites.mjs`. Spend: **0,05 USD** of the 8 allowed
— three model calls, all in the ledger of [multi-user.md](multi-user.md).

Screenshots live under the session scratchpad,
`/private/tmp/claude-501/-Users-ondrejcerny-dev-bloodwork-app/9788c846-2834-4b4f-8924-4d9c7254e514/scratchpad/shots/`:
`steps/` for the eight walkthrough shots named below, `sweep/` for the 250
full-page shots of the width sweep (`<screen>-<width>-<palette>.png`), and
`sweep*.json` for the machine record of every run.

## What was proved

| step | result | evidence |
|---|---|---|
| 1 · weak password | refused on the sign-up form: „Heslo musí mít nejméně 8 znaků." | form kept, no request sent |
| 1 · mismatched password | refused: „Hesla se neshodují." | same |
| 1 · registration | A registered as `A@Example.TEST`, stored and shown as `a@example.test`; B as `b@example.test` | top bar, `/api/me` |
| 1 · used code | the same link a second time: „Odkaz už neplatí. Napište mi a pošlu nový." | `steps/01-used-invite.png` |
| 1 · expired code | `expires_at` set to 2020 in D1: probe 404, register 403, page shows the dead-link sentence; restored afterwards | curl + browser |
| 1 · e-mail case | login with `a@EXAMPLE.test` → 200; a second sign-up with `A@example.test` on a fresh code → the dead-link sentence (by design, no address disclosure) and the code stays live | curl |
| 1 · session cookie | reload → `/api/me` 200; cookie is `HttpOnly; Secure; SameSite=Lax; Max-Age=7776000`; a tampered value → 401 | curl `-D` |
| 2 · set-password link | `/heslo?kod=…` minted with `--email`, used in the browser; old password 401, new 200; the link 404 on probe and 403 on reuse | browser + curl |
| 3 · lockout | ten wrong passwords for B → ten 401; the eleventh, correct, → 429 „Příliš mnoho pokusů. Zkuste to znovu za 15 minut."; A logs in meanwhile; failures aged 16 min in D1 → 200 and the rows cleared | `steps/02-lockout.png` |
| 4 · A uploads `identity.pdf` | review finds 6 boxes (name, rodné číslo, birth date, address, two footer repeats); the pencil draws a box and ✕ removes it; the stored page is opaque black; 8 rows, all mapped, `patientName`/`patientId` null, `sourceFile` rewritten to `report-2025-06-03.pdf`; 0,0244 USD | `steps/03-redact-review-A.png`, `steps/04-overeni-A-page.png` |
| 4 · B uploads `slovak_grouped.pdf` | 1 box; 10 rows, 9 mapped, the serology row unmapped and (correctly) not offered; 0,025 USD | `/api/reports` |
| 4 · four tabs | Souhrn, Trendy (8 parameters, out-of-range shortcuts ALT + Cholesterol), Ověření (rows + page image), Přiřazení („není co řešit") show the rows for both | snapshots |
| 5 · B with A's ids | `GET /api/reports/<A>` 404 · `GET /api/pages/<A>/1` 404 · `PUT /api/reports/<A>` 403 „Report nepatří k tomuto účtu." · `PUT /api/reports/<A>/1` 404 · `DELETE /api/reports/<A>` 404 · `GET /api/reports`, `/api/export`, `/api/export?format=csv`, `/api/settings`, `/api/ai-share` → B's own only, never A's id, e-mail or rows | script in B's context |
| 5 · A's share link | `/ai/<token>` without a cookie: A's seven numeric rows, no e-mail, no report id, no B; `.md` → 301 to the bare address; a wrong token → the same 404 | curl |
| 5 · B against A's link | B's `DELETE /api/ai-share` (200, its own no-op) and `PUT` (404) leave A's page serving | curl |
| 5 · revoke | „Zrušit odkaz" → 404 | curl |
| 5 · logged out | all 22 private routes → 401 without a cookie | curl loop |
| 6 · budget | `moje-krev-budget.mjs b@example.test 0` (its SQL run on local D1): B's upload card reads „Měsíční limit zpracování je vyčerpán…", `/api/extract` and `/api/map` → 402; A's status unchanged; `--default` restores | `steps/05-budget-frozen-B.png` |
| 7 · export | JSON: 2 reports, e-mail, `aiContext: null`, no inline images, none of B's; CSV: BOM (`EF BB BF`), 10 columns, 16 rows, both parse with `json`/`csv` | scratchpad `export-A.*` |
| 7 · delete | „Smazat účet" disabled until exactly `SMAZAT`; after: users/reports/report_pages/ai_shares/linked invites/synonyms-by-A all 0, both spent invites stay spent, PAGES KV holds only B's key, the share page 404, the login 401, the cookie 401, the door shows; `DEMO_EMAIL` naming the deleted account → both demo routes 404 | D1 query, KV explorer |
| 8 · demo link | with `DEMO_EMAIL=a@example.test`: door shows „Zobrazit demo pacienta"; inside: „Demo pacient", `/api/me` e-mail null, no ✕ on reports, no account delete, `DELETE /api/account` and `DELETE /api/reports/<id>` 403 „V demu nelze mazat…", export e-mail null, „Odhlásit se" returns to the door | `steps/07-demo-reporty.png` |
| 8 · width sweep | 25 screens × 360/414/768/1024/1440 × light/dark through `tests/e2e/lib/audit.ts`'s invariants on the real stack: **0 layout flaws, 0 overflow**, console clean, no unprovoked 4xx/5xx (the door's own `/api/me` probe answers 401 when logged out — by design, see below) | `sweep/*.png`, `sweep*.json` |
| 8 · buttons | ⋯ opens the three hidden tabs and holds the selected look; ArrowRight/Left move and focus; theme cycles Světlý → Tmavý → Systém; camera button only under `(pointer: coarse)`; „Otevřít v Ověření" from the list; Trendy shortcuts, „Zobrazit parametr" + picker, chip ✕, „Vyčistit", table „ověřit →" lands on the row with the zoom strip; Ověření search, correction 5,62 → 5,72 persisted and „Vrátit původní" persisted, `abc` rejected with the sentence, page zoom in/out, „jen řádky k ověření"; Přiřazení: „Založit nový parametr" (settings + report updated) and „Vrátit zpět" (both cleared), „Vybrat jiný parametr…" teaches a synonym everyone sees (`mine:false` for A) and its undo withdraws it, „Nechat AI navrhnout" mapped Urikémia XY → Kyselina močová for this account only (0,0048 USD); AI konzultace mint / Zkopírovat / Zrušit; Reporty ✕ → Smazat/Zrušit; „Co ukládáme, a co ne" | `steps/06-reporty-360-camera.png` |

## What was fixed

| defect | class | fix | guard (seen failing with the fix reverted) |
|---|---|---|---|
| „Zpracování tento měsíc: 0.02 / 5 USD" — a decimal point in Czech copy; the worker's frozen message printed `2.5 USD` the same way | every money amount rendered through `toFixed` or a template literal | `czUsd` in `packages/lab-core/src/czech.ts`; `Portal.tsx` uses it; the worker restates it in `frozenMessage` | `czUsd` in `packages/lab-core/tests/czech.test.ts`; „refuses a frozen person in Czech, with a decimal comma" in `workers/portal/tests/reports.test.ts` |
| Reporty, 360 and 414, both palettes: with a row's „Smazat / Zrušit" open the row outgrew the list (46 px at 360), „Zrušit" clipped, the next row's ✕ scrolled out of reach; the meta line clipped without an ellipsis | a grid item keeping its content min-width; `text-overflow` on an inline | `min-width: 0` on `.reportlist li`, `.rl-meta` as a block (`apps/portal/src/styles.css`) | „reporty (mazání reportu potvrzované)" in `tests/e2e/audit-portal.e2e.ts` measures the list's sideways scroll (46 px at 360, 16 px at 390 before) — `steps/08-reporty-360-delete-confirm-fixed.png` |
| a share link minted on localhost opened the SPA: Vite proxied only `/api`, the production shell forwards `/ai/` too | dev config | `/ai` added to both proxies in `apps/portal/vite.config.ts` | none — configuration |
| the handoff said real extraction could only be tested against the deployed stack | doc | the two-config `wrangler dev` command and its proof | `docs:check` |
| **Souhrn with one draw said nothing about values out of range.** `records` comes from `summarizeChanges`, which needs two draws per parameter; with one report the whole „Mimo rozmezí / V rozmezí" block was skipped and a new account's first screen read „Žádný přesun…" + „Zatím není dost měření na porovnání" while A's Cholesterol 6,01 (2,9–5) and ALT 0,93 (0,17–0,78) sat out of range — Trendy listed them, Souhrn did not. Every width, both palettes. | a block gated on a comparison it does not need | `SummaryTab.tsx` lists the latest draw's rows while `records` is empty (`latestRows`): out of range first, furthest past its limit at the top, flag and printed range, no change column, the head „jediný odběr · 14. 4. 2026"; the change tables return with the second draw. The flag chip stays a desktop detail, as in the change table: at every width it scrolled the card 29 px at 360 | „Souhrn with one report" in `apps/portal/tests/summaryTab.test.ts` (four fail with the fix reverted); „souhrn (jediný report)" in `tests/e2e/audit-portal.e2e.ts` seeds one report, counts the rows and the "i" after every name, and measures the tables' sideways scroll |
| A session token outlived logout and a password reset: `POST /api/auth/logout` cleared the browser cookie, but a copy of the value kept answering `/api/me` 200 for 90 days; a set-password link did not end it either | a stateless signed claim with nothing on the server to refuse it against | `users.session_epoch` (`schema.sql`, `migrations/2026-09-19-session-epoch.sql`) is in every cookie's claims and compared on every request; logout and the set-password link add one, deletion takes the row; a demo visitor's logout moves nothing. Cookies from before the deploy are refused once — [moje-krev-handoff.md](../moje-krev-handoff.md) says so beside the migration to apply first | „a session ends when it should" in `workers/portal/tests/auth.test.ts` (four fail with `index.ts` and `session.ts` reverted); „leaving the demo logs nobody out but the visitor" in `demo.test.ts`; the users column list in `schemaDrift.test.ts` |
| `MAX_SETTINGS_BYTES` was 64 kB while `settings.aiAsked` costs ~200 B per name: a few hundred unmapped names and every save failed behind „Přiřazení se nepodařilo uložit." over a bare `{ "error": "too_large" }` (not seen in the sweep — found reading the worker) | a cap set before the thing it caps grew | 512 kB, measured in bytes; the 413 says what is too large and by how much: „Nastavení účtu (přiřazení názvů, vlastní parametry a AI kontext) je příliš velké: 600 kB, nejvýše 512 kB." | „keeps a 300 kB settings body, and refuses a 600 kB one saying what is too large" in `workers/portal/tests/reports.test.ts` (fails with the whole change reverted, and with the cap alone put back) |

## What is left

| finding | where | why not fixed here |
|---|---|---|
| The banner under a failed settings save prints the client's own sentence („Přiřazení se nepodařilo uložit.") and not the worker's, so the 413's „…je příliš velké: 600 kB, nejvýše 512 kB" reaches the network tab only | `apps/portal/src/ui/Portal.tsx`, the `saveSettings` callers' `.catch` | four catch sites under another agent's edit; the fix is one helper that prefers an `ApiError`'s message when its code is `too_large` |
| The door's `/api/me` probe answers 401 on every logged-out visit, which the browser logs as „Failed to load resource: 401" (twice in dev, StrictMode) | `apps/portal/src/App.tsx` `fetchMe` | cosmetic; an `{ "user": null }` 200 for an anonymous probe would keep the console clean but changes the route's contract |
| A second sign-up with an address that already has an account answers „Odkaz už neplatí. Napište mi a pošlu nový." and the code stays live — deliberate (no address disclosure), but the person with a legitimate link learns nothing they can act on | `workers/portal/src/index.ts` `handleRegister` | product decision, listed for Ondřej |
| The CSV's `stav` column carries the machine tokens `normal` / `high` / `low` beside Czech headers | `exportAccount` | cosmetic; a spreadsheet column, and the JSON is the lossless copy |
| Trendy with a single draw shows a card (`jediné měření … Křivka od druhého odběru`) rather than a chart; the „mimo rozmezí" shortcut buttons appear only while nothing is displayed | `TrendsTab.tsx` | by design; noted so the next reader does not file it |
| A share link minted on one device shows „elsewhere" on another (the sentence lives in that browser's sessionStorage; the other device offers to mint anew or revoke) | `ShareTab.tsx` | by design; the audit now covers that state |
| Playwright's full-page capture on a touch context drops `(pointer: coarse)` while it captures, so the camera button is absent from `sweep/reporty-360-*.png` although the DOM (and real Chrome, `steps/06-reporty-360-camera.png`) has it | tooling | note for whoever reads the sweep shots |

## Console and network

Console: clean on every logged-in screen at every width and palette. The
only lines logged out are the door's own 401 probe (above). Network: no
4xx/5xx other than the ones provoked on purpose (401 probe, the dead link's
404, the wrong-password 401, and the isolation and budget refusals listed
above).
