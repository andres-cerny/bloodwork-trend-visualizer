# Plan: the CSM pitch — doctor and patient over one record

Design settled 2026-08-24 (brainstorm with Ondřej). No demo date yet; the
first pitch is to **Centrum sportovní medicíny (centrumsportmed.cz)** — the
clinic that produced Ondřej's own record. The demo's decisive moment: the
clinic recognizes *their own patient's* seven years of data, turned into a
product they could sell to every athlete they treat.

**What ships:** two new surfaces over the existing agent worker and a new CSM
tenant. `apps/bloodwork` is frozen — it stays as the PDF-extraction proof for
the day we learn how the clinic actually stores data.

- **Doctor app** — `apps/chat` evolved in place: the existing chat (citations,
  follow-ups, evidence rail) **plus** a structured patient card, a patient
  switcher, „náhled pacienta", and cohort questions.
- **Patient app** — new `apps/csm-portal`: the *same card*, scoped to one patient,
  read-only, no AI. A patient picker stands in for auth. One fake button.

The product principle both apps obey, named once and enforced everywhere:
**the app only knows what the record says.** No invented annotations (the 2020
dip stays unexplained — the doctor explains it live), no metrics that don't
appear in the clinic's own protocols, no AI-generated text anywhere a patient
can see.

## Decisions already made (do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Third app vs. extended bloodwork | Two surfaces: evolve `apps/chat` into the doctor app; new `apps/csm-portal` for patients | One doctor UI, not two; bloodwork stays untouched as the extraction pitch |
| The shared card | One package, `@bw/patient-card` — pure rendering over API data, imported by both apps | "Doctor sees what the patient sees" true by construction, not discipline |
| Ingestion | **Deferred.** Data reaches D1 via seed scripts; no PDF upload, no matching UI in either new app | Ondřej doesn't yet know how CSM stores data; whatever it is lands in the same D1 shape |
| Tenant | New third tenant `/csm`, own D1 (`DB_CSM`); `/sport` and `/orto` survive unchanged | The CSM corpus follows CSM's real protocols; the generic sport tenant serves the earlier pitch |
| Branding | CSM name/logo/colours as a tenant theme in the header; their website's design is **not** an inspiration | "This is your app" moment; their site is old-school by Ondřej's own account |
| Patients | Ondřej's real record (labs + performance + tHb) as the anchor; **three fictional XC skiers/runners** on the same test protocol | He knows only his own protocol; same tests are run on runners — three of those is honest |
| Ghost patients carry the pathology | Ferritin-decline arc · worsening-trend athlete with out-of-range panel · sparse/irregular masters athlete | Ondřej's record is mostly healthy; the flags story needs someone to happen to |
| Real record path | Deploy-time seeding, never committed — extend the existing `seed_real_patient` pattern to `/csm`, now including performance docs and tHb | Privacy guard stays untouched, no exceptions; the mechanism already exists and is proven |
| Doctor names | Real CSM doctors' names stay in **Ondřej's real documents** (his explicit call, 2026-08-24 — they are friends and consent). Ghost patients' notes signed by **fictional** doctors | Fabricated words under a real doctor's signature is the one place consent gets murky — and the ghosts are fictional anyway |
| Doctor notes | Real where they exist; honest gaps on Ondřej's timeline; ghosts get full note coverage, fabricated | His instruction verbatim: fabricate "not for me, but for the other ghost patients" |
| tHb mass | First-class metric: CO-rebreathing log shape confirmed in `samples/thbmass/` (Hb mass g, rel. g/kg, erythrocyte/plasma/blood volumes); the xlsx export carries history the lost PDFs don't | The clinic-specific measurement no generic portal can show — the differentiator |
| Performance metrics | Fixed by **inventory of the actual protocols** in `samples/performance/` — VO₂max, HR at thresholds, speed/power at thresholds, spirometry, weight, tHb set; nothing not printed in a CSM report | The app only knows what the record says |
| Patient-side interpretation | Same flag semantics as bloodwork (lab's own reference ranges, review.ts doubt rules); per-visit summary is **deterministic** (counts and deltas, not prose) | No AI text reaches a patient; doctors' hallucination worry is answered by construction |
| Patient app scope | Read-only + one fake „Objednat se" button → „Objednávání připravujeme". No messages, no meds/allergies/diagnoses, no PDF export, no notifications | Empty tabs demo worse than absence; production notifications belong to the future mobile app |
| „Nové" chip / live-arrival demo trick | **Cut** (Ondřej, 2026-08-24) | Complexity without pitch value; notifications differ on mobile anyway |
| Event markers on charts | Only events documented in the record — in practice none for v1 | No COVID label unless a note says COVID; the dip is the doctor's story to tell |
| Cohort | In — `cohort_query` (the unbuilt Phase-6 item of chat-demo) lands for `/csm`: "kteří atleti mají nízký ferritin?" through the agent, bounded, refs not records | Ondřej: "more important to them" than demo theatrics |
| Auth | Patient picker for the demo; server still scopes every route to the picked patient | The security answer must be "the server never sends other patients' data", even in a demo |
| Access | Same posture as chat: Turnstile-gated, unlisted workers.dev — **mandatory here**, the portal serves Ondřej's real record | Consented ≠ crawlable |
| Copy tone (patient app) | Vykání, warm section frames („Vaše poslední návštěva"), clinical values — labels stay nominative | A deliberate, documented bend of the apps/CLAUDE.md rule for one app |
| Charts | The UI tournament may depart from the current chart style — free rein on form, ui-kit tokens and the green-free palette stay law | Ondřej: "if you don't like the way we graph, use different graphs" |
| Build process | The proven chat-ui tournament: three variants in worktrees, camera + rubric, per-candidate polish loops until the critic runs dry, then **Ondřej picks** | His explicit instruction: three UIs, loop each, he decides |
| Product name | **„Moje CSM"** (Ondřej, 2026-08-24) | Clinic-owned feel; generalizes to „Moje {klinika}" for the next customer |
| Eval spend | **Subagent-only** (Ondřej, 2026-08-24): all prompt evaluation — cohort included — runs on spawned subagents of the app's own model, given the app's system prompt, against the real tool code run locally. No real-API promotion runs | Subscription-billed, $0 of API; the promoted prompt is then used verbatim by the live app |

## Invariants this plan must not break

- **Apps render; they do not reason.** Neither `apps/chat` nor `apps/csm-portal`
  imports lab-core or agent tools. Every number arrives from the worker; the
  card package receives typed API data and draws it. `check-bundle` gains a
  portal variant and both stay green.
- **The app only knows what the record says** (new, this plan): no annotation,
  metric, or narrative without a source document or measurement behind it.
- **Every generator is font-locked**; corpus regenerates byte-identically;
  never Arial. Ghost corpus is committed; the real record never is.
- **Unknown anything is refused** — tenant, patient, profile. A portal request
  for a patient outside `/csm` is a 400 with a pinned test.
- **`review.ts` stays the single authority on doubt** — the patient card shows
  a withheld value the same way the doctor's view does, or not at all.
- **Signal colours draw, ink colours type; both palettes for every rule** —
  the theme test's discipline extends to the portal and the tenant theme.
- **Node tests stay plain node** — fake D1/KV, no miniflare.
- **extract never grows a database binding.** The portal shell binds `agent`
  only, exactly like chat.

---

## Phase 0 — reconcile against the deployed UI

**The new chat UI is already deployed** (Ondřej, 2026-08-24) at
https://bloodwork-chat.andres-cerny.workers.dev — Round 4 is not re-run; that
deployment is the baseline everything below builds on.

1. Reconcile this branch with what shipped: the uncommitted files
   (`sources.ts`, `citations.ts`, tests, `loop.ts`) are either part of the
   deployed state (commit them) or superseded (discard, with a note). The
   branch must build exactly what the live URL serves.
2. Close out `docs/plans/chat-ui.md`'s build log (pick + Round 4 lines);
   carry any of the three Round-3 server-side findings that did *not* ship
   into this plan's Phase 5 work list.
3. `npm test`, `typecheck`, both bundle checks green on the reconciled tree.

**Gate:** clean tree on `chat-demo` that reproduces the live deployment;
chat-ui build log closed.

## Phase 1 — the CSM tenant and the visit model

1. **Protocol inventory** (read-only, from `samples/`): enumerate every metric
   CSM's own reports print — spiro table, ergometry thresholds, tHb log
   columns, anthropometrics. Output: `docs/csm-protocol.md`, the closed list
   the corpus and the card both build from. Includes the tHb xlsx column map.
2. **Schema extension** (`workers/agent/schema.sql`, additive):

```sql
visits  (id TEXT PK, patient_id → patients, visit_date, kind,   -- 'annual'|'blood'|'perf_test'|'thb'
         title, note_document_id → documents NULL)              -- the visit's zpráva, if one exists
perf_metrics (patient_id, visit_id → visits, metric_id,          -- from the protocol inventory
         display_name, unit, value REAL, ref_low, ref_high, test_date)
```

   Visits are **derived at seed time** by grouping reports + documents + tests
   by date — the seeder computes, SQL only stores. `perf_metrics` rows carry
   reference bounds only where a CSM protocol prints them.
3. `DB_CSM` binding + tenant allowlist entry `/csm`; tenant theme tokens
   (CSM name, logo asset, accent colour pulled from their site) defined in
   ui-kit as a tenant layer — both palettes, theme test extended.
4. Fake-D1 tests for the new tables; cross-tenant refusal re-pinned for the
   third DB.

**Gate:** `npm test` + `typecheck`; a scratch script lists a hand-inserted
patient's visits with kinds and a perf metric trend.

## Phase 2 — corpus: three ghost skiers and the full real record

Corpus work runs through **corpus-builder**; the real-record work is local
scripting on the same machine, never committed.

1. **Ghost stories** (committed, synthetic, font-locked pipeline):
   - *Skier A — the ferritin arc:* 5 years, 3–4 visits/year, declining
     ferritin into a flagged winter, recovery after; full notes tracking it.
   - *Skier B — the worsening trend:* out-of-range panel now (the flags
     story), a VO₂max plateau-then-decline; notes grow concerned.
   - *Skier C — sparse masters athlete:* 6 years but irregular — gaps, a
     blood-only year, age-typical findings; the real-world-data story.
   Each gets: lab PDFs (existing generators), performance reports + zone
   protocols (Phase-4 templates from chat-demo, re-skinned to the CSM shapes),
   tHb measurement logs (new small generator from the `samples/thbmass/`
   shape), notes for **every** visit signed by fictional doctors, page images,
   and derived `visits` + `perf_metrics` + summary rows in the seed SQL.
2. **Real record:** extend the deploy-time seeder to `/csm` — his 15 lab
   reports (extraction cache makes this ~$0), the performance PDFs
   transcribed into `perf_metrics` (LLM-assisted locally, **verified by hand
   against the source PDFs** — a wrong number in front of the clinic that
   measured it kills the pitch), tHb history from the xlsx, documents + page
   images to the KV shelf. Notes only where they exist; image-only scans
   remain page images without text.
3. Ghost values calibrated against the real record (plausible neighbours, not
   clones); regeneration byte-identical, twice, `git diff --exit-code`;
   eyeball every page PNG.

**Gate:** determinism proven; corpus-builder's privacy sweep confirms no real
name, value, or lab mark in committed output; local D1 seeded and queryable.

## Phase 3 — the card API

Read-only JSON routes on `workers/agent`, behind the same `guard()`; the
tenant and `patientRef` come validated from the request, and every query is
scoped server-side. No LLM anywhere on these routes.

- `GET /api/card/patients` — the picker list (portal) / switcher (doctor).
- `GET /api/card/:patient/visits` — the timeline: date, kind, title, flag
  counts, has-note.
- `GET /api/card/:patient/visit/:id` — one visit: note text + page refs, that
  day's measurements with flags, perf results, **deltas vs. the previous
  comparable visit** (computed here, via lab-core, not in the client).
- `GET /api/card/:patient/trend/:metric` — chart series (lab analyte or perf
  metric), reference band, sparkline-reduced form included.
- `GET /api/card/:patient/documents/:id` — note/report body + page images.

Trends and flags go through lab-core exactly as the tools do; the card API
and the agent's tools must disagree about nothing — one pinned parity test
(same trend through `get_trend` and through the route, identical numbers).

**Gate:** route tests incl. cross-tenant/cross-patient refusal; the parity
test; `npm run dev:agent` serves a full card for a seeded ghost.

## Phase 4 — the patient app: tournament, polish loops, Ondřej picks

`apps/csm-portal` (Vite + shell worker `csm-portal`, binds `agent` only) and
`@bw/patient-card`. Mobile-first: designed at 390px, desktop is the
adaptation. PWA manifest so „add to home screen" works in the pitch.

**What the card contains** (every variant, fixed scope):
- **Home = last visit**, not a dashboard: newest note, that day's results
  with flags, „od minulé návštěvy" deltas, then the timeline.
- **Timeline** with visit-type badges (krev / spiroergometrie / tHb /
  zpráva), honest gaps included.
- **Results table** with per-row **sparklines** (a word-sized trend beside
  every value); row → full chart with reference band.
- **Performance section**: VO₂max and tHb trends as headline charts, the
  protocol's remaining metrics behind them.
- **Note viewer**: the doctor's text, „Uvolněno" timestamp, page images.
- Deterministic per-visit summary („2 parametry mimo rozmezí · vše ostatní
  v normě"), severity vocabulary from the flag semantics only.
- The fake „Objednat se" button and its polite dead-end.
- Czech per the tone decision; theme switch; both palettes.

**Process** — the chat-ui §5 machinery, reused as-is where possible:
1. **Round 0 — harness.** Card-API fixtures captured from the seeded local
   D1 (ghosts only — fixtures are committed; the real record never enters
   one). Camera script: scripted states — home, timeline, visit detail,
   chart, note, picker, fake-button dead-end, empty/error — at the audit's
   five widths, both palettes. Rubric committed (`tools/ui-loop/portal-rubric.md`):
   hierarchy, calm-not-clinical, chart legibility at 390px, Czech copy fit,
   flag restraint (no panic wall), palette parity, PWA chrome, wow.
2. **Round 1 — three variants in parallel worktrees**, one temperament each:
   **A** editorial-calm (a health magazine's restraint, generous type),
   **B** athlete-dashboard (trends first, numbers big, training-app energy),
   **C** clinical-familiar (closest to the bloodwork app's language, softened
   for patients). Builders build to green typecheck + production build; the
   orchestrator alone drives the one browser, sequentially.
3. **Round 2 — blind critique** per variant (rubric, screenshots, no code,
   no temperament names) — not to eliminate, but to seed each candidate's
   fix list. All three continue; this is Ondřej's explicit shape: three UIs,
   each looped.
4. **Round 3 — polish loops, per candidate:** critic names concrete defects →
   fixer applies on that candidate's branch → camera reshoots — until the
   critic finds nothing consequential, max three passes each.
5. **Round 4 — Ondřej decides:** all three, side-by-side per state, score
   tables attached. His pick + grafts + notes; the build continues on that.
   If he wants another generation, the loop branches — his call.

**Gate:** the pick recorded here; merged variant passes `typecheck`,
`npm test`, portal bundle check, and the audit sweep (portal states join
`test:audit` — five widths, both palettes, fixture-fed).

## Phase 5 — the doctor app grows the card and the cohort

1. **Card view in `apps/chat`:** a „Karta" tab/zone rendering
   `@bw/patient-card` for the pinned patient — same components, doctor
   framing. Patient switcher fed by the card API. „Náhled pacienta" opens the
   portal's exact view (portal URL with the patientRef) in one click.
2. **`/csm` tenant in chat:** suggestions re-written for the sports context;
   the clinical profile is told about `perf_metrics` and visits; document
   search covers the notes.
   Also the two findings carried from chat-ui Round 3 (confirmed unshipped in
   Phase 0): `get_document`/`search_documents` excerpts must contain the cited
   passage (today: `bodyText.slice(0, 240)`), and the internal `p-…` ref must
   never reach an excerpt payload server-side.
3. **`cohort_query`** as specified in chat-demo Phase 6 — a bounded filter
   over `patient_analyte_summary` (extended with key perf metrics), returning
   refs + aggregates, never records; the answer renders as a ref table, each
   row linking into a patient card. Registered for `/csm` (and `/sport`,
   where the summary table already waits).
4. **eval-loop, mandatory — subagent-only (the 2026-08-24 decision):** every
   run spawns subagents of the app's own model, given the exact system prompt
   under test, exercising the real tool code locally; graders stay the
   deterministic ones from the harness. New cases — cohort bounded (never
   patient-by-patient iteration); perf metric cited from a document vs.
   answered "není v dokumentaci"; card-vs-agent number agreement; the
   existing 19-case baseline rides along and must not regress. Promotion =
   the subagent suite clean at 3 reps; the promoted prompt is deployed
   verbatim. **$0 of API.** One honest caveat, accepted: subagents share the
   model but not the API serving path, so the final sanity check is a single
   live cohort turn on the deployed app (cents, on the app's own ledger) —
   the only API spend in this plan.

**Gate:** eval promotion clean; ui-auditor over the chat changes; the
Skier-B cohort flow ("kdo má nízký ferritin?" → table → card) works in dev.

## Phase 6 — hardening and deploy

1. Ledger: `clinical-csm` capability + budget key, pinned isolation test
   (the CSM pitch session must never freeze `/sport`'s, and vice versa).
   Card-API routes are $0 but still session-gated.
2. Turnstile: portal hostname into `TURNSTILE_HOSTNAMES` + widget, the
   solved-elsewhere-refused test **written before deploying** (the standing
   lesson). Portal is gated even though it costs nothing — it serves the
   real record.
3. `invariant-reviewer` over the full diff; `docs/constraints.md` gains: the
   card API and tools may not disagree; the record-only principle; the
   portal's no-AI rule.
4. Deploy order: `agent` → shells (`bloodwork-chat`, `csm-portal`);
   `npm run deploy` extended; D1 seed + real-record re-seed **in that
   order** (synthetic wipes tables — deploy.md §4 rule now covers `/csm`).
5. Live walkthrough on a phone: picker → Ondřej's card → 7-year hemoglobin
   with the tHb chart → a note with real letterhead → doctor app: same card,
   cohort question, náhled pacienta. That is the pitch, rehearsed.

**Gate:** full suite (`npm test`, `typecheck`, `docs:check`, all bundle
checks, `test:audit`) then the live URLs from a phone, and the pitch flow
walked end-to-end twice.

---

## Execution model

One orchestrator session; this file is the state — dated `[x]` log lines
under each phase as gates pass. The standing agents carry the invariants:

| Agent | Used in |
|---|---|
| corpus-builder | Phase 2 (ghost corpus, tHb generator) |
| eval-loop | Phase 5 (cohort + perf cases), any prompt/tool touch |
| ui-auditor | Phase 4 rounds (blind critic + polish critics), Phase 5–6 gates |
| invariant-reviewer | Every phase gate |

Tournament mechanics as proven in chat-ui: builders in worktrees never
screenshot; one browser, driven sequentially by the orchestrator; critiques
are committed artifacts; taste calls on the shipped look are Ondřej's.
Commit per phase, on this branch. UI loops are $0 (fixture-fed) and evals are
$0 (subagent-only, per the decisions table); the only API spend is the
real-record transcription (small, local) and the single live smoke turns
(cents, on the app's own ledgers).

## Build log

- [x] 2026-08-24 Phase 0 — branch reconciled: the in-flight citation work had
  landed as `da8e490`+`939dfea` before this plan started executing; chat-ui
  build log closed (pick + Round 4); two unshipped findings carried into
  Phase 5. typecheck 0 · 477 tests · chat bundle check · docs:check green.
  Live baseline confirmed serving: bloodwork-chat.andres-cerny.workers.dev.
- [x] 2026-08-24 Phase 1 — `visits` + `perf_metrics` (PK-guarded) in the
  schema, proven on local D1; `CardStore` with the sibling stores' refusal
  posture; `/csm` tenant (D1 created: `bloodwork-chat-csm`), `clinical-csm`
  capability; CSM brand tokens + tenant layer + `CsmMark`, theme test
  extended (coverage regex now guards the brand constants);
  `docs/csm-protocol.md` — 14 charted metrics, shapes only, privacy-swept.
  invariant-reviewer: 2 findings, both fixed in-phase. 495 tests.
- [x] 2026-08-24 Phase 2 (ghosts) — three skiers through the font-locked
  pipeline (Dvořáková: ferritin arc dips to low and recovers; Svoboda:
  out-of-range panel now + VO₂max decline; Beneš: sparse masters): 23 draws,
  38 documents, 50 pages, 29 visits, 192 perf rows over the inventory's
  metric ids. Proven: byte-identical regeneration; privacy grep clean
  (no real name or lab); every report/document date maps to a visit; 174/174
  inline-panel values match the committed lab values. Doctor names fictional
  (Kolář, Procházková); every page carries the smyšlený-pacient footer.
  Generator agent was cut off by the session usage limit at the finish —
  verification completed by the orchestrator. Real-record half: transcription
  done into git-ignored data/csm-real/ (75 values, 13 ⚠ for Ondřej's
  spot-check in VERIFY.md, 3 image-only scans listed for OCR); the deploy-time
  seeder extension is still open (Phase 6 work).
- [x] 2026-08-25 Phase 5 (agent half) — get_perf_trend with passage-level
  citations; /csm in the chat client; the two carried chat-ui findings closed
  (substantive excerpts, server-side ref scrubbing). Evals SUBAGENT-ONLY per
  the decision: 23/23 at 3 reps, 343 local invocations, $0 API. Three prompt
  clauses earned by captured failures — chart is lab-only, an unreachable
  mode is not an absent record, and no identifier beyond the name (the model
  had fabricated a rodné číslo from the birth date). Open: canonical ids leak
  into prose; candidate line awaits its own ride.
- [x] 2026-08-25 Phase 6 (partial) — csm ledger isolation pinned both ways;
  portal hostname in TURNSTILE_HOSTNAMES; constraints.md gains the pitch's
  three rules; deploy.md covers three databases and the portal. Remote csm
  seeded (3 ghosts, 29 visits, 192 perf rows, 38 documents); agent + chat
  deployed — /csm live, card routes refuse without a session, ledger $0/$10.
- [x] 2026-08-25 Phase 4 rounds 1–3 — three variants built in worktrees
  (editorial-calm / athlete-dashboard / clinical-familiar), 32-state camera,
  blind critiques (A 22 · B 22 · C 14), then per-candidate polish loops:
  A CLEAN at 28/30 (pass 2), B 26/30 → pass 3 on a clipped table, C 25/30 →
  pass 3 on a chart overprint and the note-as-letter. The camera gained a
  results-rows state after a critic could not see sparklines the code drew.
- [x] 2026-08-24 Phase 3 (built early, same sitting) — `/api/card/*` routes:
  patients / visits / visit / trend / document; session-gated but NOT
  ledger-gated (a frozen AI budget keeps the card serving — pinned);
  cross-tenant refusal pinned; the lab-trend parity test (route ≡ tool,
  number for number) pinned. Deferred to after Phase 2: the dev-server
  full-card check over a seeded ghost.

## Cut lines (in order, if time compresses before the pitch)

1. Doctor-app card *tab* — keep „náhled pacienta" (the portal link) as the
   doctor's card view; the shared package already guarantees fidelity.
2. Cohort perf metrics — cohort over lab analytes only.
3. PWA manifest.
4. Skier C — two ghosts still tell both stories.

**Not cuttable:** the patient picker's server-side scoping, Turnstile on the
portal, real-record verification against source PDFs, the record-only
principle, per-candidate polish loops (Ondřej's explicit process).

## Open items

- **Ghost-note signatures** — plan says fictional doctors (real names only in
  the real record); Ondřej may override to real names knowingly.
- CSM logo/colour extraction from centrumsportmed.cz (Phase 1, cosmetic).
- Older tHb PDFs are lost; the xlsx is the history's source of truth —
  acceptable, noted.
- Demo date — none yet; phases are ordered so the demo is pitchable from the
  end of Phase 4 (patient app alone) if a date lands early.
