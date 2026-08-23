# Plan: the chat demo — two practices over one clinical agent

Design settled 2026-08-23 (brainstorm with Ondřej). Target: ~1.5 weeks.
**A good demo is the number-one priority** — production will be a new repo, so
every trade-off below favours the demo, but along the seams the repo already
drew, so nothing has to be un-built.

## What is being built

Two fictional practices, one deployment of `apps/chat`:

- **`/sport`** — a sports-medicine doctor for endurance athletes. Six synthetic
  patients: blood work (hemoglobin/ferritin/hematocrit arcs) **plus**
  performance-evaluation documents (VO₂max, spiroergometry).
- **`/orto`** — an orthopedic clinic with physiotherapy. Six synthetic
  patients: physio session notes and imaging/operation reports, plus pre-op
  blood work for one or two so this tenant also gets a trend-and-chart moment.

The doctor types *"dej mi souhrn Michala Nováka"* and gets a summary with
numbered citations that open the actual report row or document excerpt, as an
image crop. That sixty seconds is the demo.

## Decisions already made (do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Storage | D1, seeded server-side | The pitch is "connected to your database"; data in the request body demos the wrong thing |
| Tenancy | Two D1 databases, path per practice | Isolation by construction is itself a demo answer; D1 is free |
| Identity | Model **names** a patient, never **opens** one | Analogue of the `propose_chart` rule; unique match auto-resolves + chip, ambiguity asks |
| Cohort | One bounded SQL tool over a precomputed summary table | The model must never iterate the panel patient-by-patient |
| Evidence | All 12 patients get generated PDFs + page images | At 12, "story patients only" and "everyone" converged |
| Citations | Numbered `[n]` markers + sources panel with image crops | `bbox` already exists on Measurement; VerifyTab proves the crop pattern |
| Transcripts | Ephemeral, browser-only | No conversation store; a demo restarting clean is a feature |
| Ledger | Split per profile+tenant | A doctor's session must not freeze the public bloodwork demo |
| Access | Turnstile + budget only, unlisted workers.dev URL | Ondřej's explicit call |
| Prompt | One `clinical` profile, clinician-addressed copy | Drop "doporuč konzultaci s lékařem" — the reader IS the doctor |
| Model | **Claude Sonnet 5, final (2026-08-23)** | Gemini 3.6 Flash examined in depth and rejected: ~16s TTFT in reasoning mode vs Sonnet's ~1–2s, 1–2 days of client work, ~$10 total savings; provider re-evaluation is a POST-demo decision, gated on the eval suite |
| Ondřej's real record | HE IS A DEMO PATIENT (sport tenant), by his explicit 2026-08-23 decision | His real labs + evals seeded from `samples/` at deploy time, page images to R2 — **never committed**; the other 5 sport patients and all of orto stay synthetic; privacy guards unchanged |

## Invariants this plan must not break

- **Apps render; they do not reason.** `apps/chat` imports neither lab-core
  nor tools; `check:bundle:chat` stays green. Crops are drawn client-side from
  `bbox` + image URL that *arrived in an event* — that is rendering, not reasoning.
- **Tools are adapters over lab-core**, reading through `PatientDataSource` /
  the new `DocumentStore`, never asking which implementation they hold.
- **Unknown anything is refused, never defaulted** — profile, tenant, patient.
- **Every generator is font-locked** (`_fonts.py`); output regenerates
  byte-identically; never Arial, never a system font.
- **No real data seeds the demo.** Real names seen in `samples/` (patient,
  ordering physicians, real labs like SPADIA/AGILAB/CASRI) must not appear in
  synthetic output — fictional lab names, fictional doctors, fictional athletes.
- **Node tests stay plain node** — fake D1 like the existing fake KV, no
  miniflare, `@cloudflare/workers-types` alone in `types`.

---

## Phase 1 — D1 schema and `DatabaseSource`

The stub in `packages/agent/datasource/src/database.ts` becomes real. First
demoable moment: the five existing tools work over a seeded database.

**Schema** (one file, `workers/agent/schema.sql`, applied to both DBs):

```sql
patients(id TEXT PK, full_name, name_norm,        -- lowercased, diacritics stripped
         birth_date, sex, note)
reports (id TEXT PK, patient_id → patients, report_date, lab_name,
         payload TEXT)                            -- full LabReport JSON, source of truth
measurements(patient_id, report_id, canonical_id, display_name, unit,
         value REAL, flag, ref_low, ref_high, report_date)   -- derived INDEX for SQL
patient_analyte_summary(patient_id, canonical_id, display_name, unit,
         last_value, last_date, delta, direction)  -- precomputed at seed time, for cohort
documents(id TEXT PK, patient_id → patients, doc_date, kind,  -- 'perf_eval'|'physio_note'|'imaging'|'op_report'
         title, body_text)
document_pages(document_id → documents, page_num, image_url, width, height)
```

`reports.payload` is lossless (full `LabReport` incl. `bbox`, snippets,
confidence); the `measurements` and summary tables are *derived indexes*
rebuilt by the seeder — SQL never becomes a second implementation of a
clinical rule, it only filters what lab-core already computed.

**Work items**

1. `DatabaseSource(db: D1Database, patientRef: string)` implementing
   `PatientDataSource` — `reports()` parses payloads; `listAnalytes`/`getTrend`
   delegate to the same lab-core trend building `SessionSource` uses. Keep the
   descriptive throw for the *unbound* case (no DB, no patientRef).
2. New `DocumentStore` interface in `@bw/datasource` (declared now, implemented
   Phase 4): `searchDocuments(query)`, `getDocument(id)`.
3. `workers/agent/wrangler.jsonc`: `d1_databases` bindings `DB_SPORT`, `DB_ORTO`.
4. Fake D1 for tests (`prepare/bind/first/all/run` over an in-memory table map),
   next to the existing fake KV. Tests: trends match a `SessionSource` fed the
   same reports (the parity that matters); unbound source still throws.

**Gate:** `npm test` + `npm run typecheck`; a scratch script proves
`get_trend` over a hand-inserted patient.

## Phase 2 — corpus and seed pipeline

`tools/pipeline/scripts/make_chat_demo.py`, same discipline as
`make_demo_data.py`: font-locked via `_fonts.py`, real render path (220 DPI
PyMuPDF), values normalised through `src/normalize.py` — the shipped corpus is
produced by the deterministic pipeline, not hand-written JSON.

1. **Patient stories** in a data table at the top of the script: per patient a
   name, birth date, and an arc (sport: overtraining ferritin decline, altitude
   response, an anemia workup, a clean season…; orto: post-op TEP rehab, an ACL
   reconstruction timeline, chronic back pain with contradictory notes…).
   At least one ambiguity pair — **two Michal Nováks in `/orto`** with
   different birth years, so the disambiguation moment is demoable on demand.
   **Sport patient #6 is Ondřej himself, real record** (his call, on the
   record): a second script, `seed_real_patient.py`, descends from
   `export_web_data.py` — extracts his lab PDFs and performance evals from
   `samples/` locally, emits INSERTs + page images **at deploy time only**.
   Real artifacts go to D1 and an R2 bucket (agent serves evidence images via
   a route with an R2 binding); nothing real is ever committed — the
   committed `public/demo` holds synthetic patients only, and the privacy
   guard stays untouched. His 4 image-only scans are skipped for document
   search (no text layer) unless OCR proves trivial; noted, not blocking.
2. Lab PDFs → rendered pages → located rows (`bbox`) → normalized
   measurements, exactly as the bloodwork demo. Fictional lab letterheads.
3. Documents (Phase 4 fills in templates): rendered as PDFs too, so every
   citation has a page image; body text extracted for FTS.
4. **Outputs:** `apps/chat/public/demo/{sport,orto}/pages/*.png` +
   `tools/pipeline/out/seed_{sport,orto}.sql` (INSERTs incl. derived tables).
   Seeding: `wrangler d1 execute` — wire into `npm run deploy` pre-flight.
5. Byte-identical regeneration; add to CI's zero-diff check alongside the
   bloodwork demo data.

**Gate:** regenerate twice, `git diff --exit-code`; eyeball every page PNG
(the privacy check that can't be automated).

## Phase 3 — identity and tenancy

1. **Tenant routing.** Chat shell serves `/sport` and `/orto` (SPA handles the
   path); client sends `tenant` in the request body; the agent worker validates
   against an allowlist and picks `DB_SPORT`/`DB_ORTO`. Unknown tenant → 400,
   never a default — same posture as profiles. Practice name in the header
   (Czech copy: "Sportovní medicína" / "Ortopedie a fyzioterapie").
2. **`find_patient` tool** — the only tool that touches the directory. Runs a
   deterministic, diacritic-insensitive search over `name_norm` server-side.
   The model's argument is the *query string*; the resolved `patientRef` never
   comes from model text.
   - unique match → tool result carries the ref; the client pins it and sends
     `patientRef` with every subsequent turn (ephemeral design: the client is
     the conversation state); UI shows a chip "Michal Novák · nar. 1988 ✕".
   - multiple → candidates with birth years; the agent asks; picking one (by
     reply or click) pins it.
   - zero → says so. No guessing.
3. Server scopes `DatabaseSource` to the pinned `patientRef` from the request
   body (validated to exist in *this tenant's* DB — a ref from the other
   tenant is a 400 and a pinned test).
4. Suggestions per tenant (sport: "Jak se vyvíjí hemoglobin Michala Nováka?";
   orto: "Shrň rehabilitaci po operaci kolene…").
5. Demo footer gains one line: "Ukázka — nezadávejte údaje skutečných
   pacientů." The corpus is consented; what a testing doctor might TYPE about
   their own patients is not, and the footer is the mitigation Ondřej chose.

**Gate:** tests — unknown tenant refused; cross-tenant ref refused;
`find_patient` resolves "novak" → "Novák"; ambiguity returns candidates, not a
pick. Manual: the Michal Novák flow end-to-end in `npm run dev:*`.

## Phase 4 — documents

1. **Templates.** Surveyed from the real evals in `samples/performance/`
   (2026-08-23; shapes only — no real value, name, clinic or physician may
   reach the generators). Two synthetic sport document types:
   - **"Zpráva ze sportovní prohlídky"** — the flagship, modeled on the annual
     sports-medicine exam report: anamnesis sections (RA/OA/SA), objective
     findings, resting + exercise EKG lines, a spirometry table (FVC/FEV1 with
     % of norm), **an inline blood panel as running text** (`S_Ferritin: …;
     B_Hemoglobin: …`), a narrative "Závěr z vyšetření", and a "Doporučení"
     with a training-intensity table (I0–I4 zones, TF ranges, RPE). The inline
     panel is the demo's crown: the same analyte cited from a document excerpt
     *and* from a structured trend, in one answer.
   - **"Tréninková pásma"** — the zones protocol: header block (name, ID, age,
     height, weight, test date, protocol), an A–E zone table (TF /min, speed
     km/h, V'O₂ L/min, %VO₂max bands), per-zone narrative, and the per-sport
     HR-offset note (−10 cycling, −20 swimming).
   Orto: physio session notes (date, subjective, pain 0–10, exercises, plan)
   and imaging/op reports (narrative findings, conclusion).
2. `D1DocumentStore` implementing `DocumentStore`. FTS5 virtual table over
   `documents.body_text` if D1 cooperates; `LIKE` over 12 patients is an
   acceptable fallback — note which one shipped.
3. Tools `search_documents` / `get_document` (Czech descriptions, mirroring the
   existing five), registered on the `clinical` profile. Excerpt-sized returns;
   `get_document` returns full text + page refs.
4. Prompt: the clinical profile learns it has two kinds of memory — measured
   values (deterministic, charted) and documents (quoted, cited, never
   paraphrased into numbers that aren't in the text).

**Gate:** eval-style checks — "jaké je VO₂max…" answers from the document with
a citation; a metric absent from any document is answered with "není v
dokumentaci", not an estimate.

## Phase 5 — citations

1. **Server side:** tool results register sources (report row: `reportId`,
   `page`, `bbox`, `imageUrl`, lab, date; document: `documentId`, page,
   excerpt). New SSE event `sources` on `done`; prompt instructs `[n]` markers
   keyed to the source numbers the tool results carried.
2. **Client side:** `[n]` rendered as superscript chips; sources panel under
   the answer — lab source = row crop from `bbox` (lift the VerifyTab
   crop/zoom math into `@bw/ui-kit` rather than importing app-to-app), document
   source = excerpt + page thumbnail, tap to open full page.
3. Cohort answers degrade to a table of refs (Phase 6), each row linking into
   its patient — same provenance, different rendering.

**Gate:** `npm run test:audit` over the new screens (five widths, both
palettes); a turn with 2 lab + 1 document citation renders all three crops.

## Phase 6 — cohort, ledger, hardening

1. **`cohort_query` tool:** filters `patient_analyte_summary`
   (analyte × direction × threshold), returns refs + aggregates — *patient,
   analyte, direction, last value, date* — never full records. Bounded result
   size. The direction column was computed at seed time by lab-core logic; the
   tool is a filter, not an analyst.
2. **Ledger split:** capability becomes data on the profile+tenant
   (`agent` stays for bloodwork chat; `clinical-sport` / `clinical-orto` are
   new keys in `@bw/gate` budget). Status route takes the capability. Pinned
   test: spend booked under one never freezes another.
   **Ceilings (agreed 2026-08-23):** $10 per clinical tenant (≈15–30 full
   doctor sessions; a session costs $0.30–0.80, the 40-message session cap
   bounds any one visitor). Eval budget $10 for the whole build
   ($15 permitted if a promotion genuinely needs it — but $10 is the border),
   `EVAL_MAX_USD=3` per run: tier 1 absorbs iteration, gates run subsets at
   1 rep, full suite at 3 reps only at baseline promotion — expected spend
   ~$7. Never skip a promotion run to save a dollar.
3. **Turnstile:** chat's workers.dev hostname into `TURNSTILE_HOSTNAMES` and
   registered on the widget; test pinning that a token solved elsewhere is
   refused and localhost is absent from the production var. Write the test
   *before* deploying — this bit us once.
4. **Prompt divergence + evals:** clinician-addressed clause replaces the
   patient-facing one; new eval cases (identity: unique / ambiguous / absent;
   document metric present / absent; cohort bounded; every number cited).
   Run `/eval` against the baseline before and after.
5. `docs/constraints.md` gains the new invariants (model names/never opens a
   patient; SQL indexes derive, never compute; seed data is the only data).

**Gate:** full suite — `npm test`, `typecheck`, `docs:check`, both bundle
checks, `test:audit` — then `npm run deploy` and the Michal Novák flow on the
live URL from a phone.

---

## Execution model — one session, four custom agents

The build runs as **one Claude session** acting as orchestrator: it holds this
plan, delegates, and never lets a subagent decide scope. Custom agents in
`.claude/agents/` carry the repo's invariants so quality does not depend on
re-explaining them per task:

| Agent | Job | Used in |
|---|---|---|
| [`corpus-builder`](../../.claude/agents/corpus-builder.md) | Synthetic corpora through the font-locked pipeline; determinism + privacy checks built in | Phases 2, 4 |
| [`eval-loop`](../../.claude/agents/eval-loop.md) | Run evals after ANY prompt/tool change, judge vs. baseline, iterate until proven better; authors the new eval cases | Phases 3–6, every prompt touch |
| [`ui-auditor`](../../.claude/agents/ui-auditor.md) | test:audit sweep, Czech copy rules, token discipline, bundle purity | Phases 3, 5 gates |
| [`invariant-reviewer`](../../.claude/agents/invariant-reviewer.md) | Phase diff vs. docs/constraints.md + package rulebooks | Every phase gate |

Session mechanics:

- **This file is the state.** The orchestrator appends a dated `[x]` log line
  under each phase as its gate passes — a compacted or resumed session
  re-reads the plan and continues from the last checked gate, losing nothing.
- **Phase gates are agent runs, not vibes.** A phase ends when
  `invariant-reviewer` returns clean on its diff AND the phase's listed checks
  pass; UI phases add `ui-auditor`; prompt-touching phases add `eval-loop`.
- **The eval loop is mandatory, not advisory:** any edit to
  `packages/agent/core/src/profiles.ts` or `tools/` goes through `eval-loop`
  before its phase gate. Two tiers: prompt ITERATION runs on spawned Sonnet
  subagents against the real tool code run locally (subscription-billed,
  iterate freely); the GATE is `npm run eval` through the real API path
  (EVAL_MAX_USD-capped, ~$1/run) — and only a gate run ever promotes a
  baseline. Chart answers are never model-drawn: propose_chart names, the
  server fills — an eval case pins that a chart answer contains no
  model-supplied numbers.
- **Commit per phase**, on a branch, so a wrong turn rolls back a phase, not
  a week.
- Heavy independent work (e.g. Phase 2 corpus generation for the two tenants)
  may fan out in parallel; sequential phases stay sequential — each depends on
  the previous one's schema or events.

## Build log

- [x] 2026-08-23 Phase 1 — schema, DatabaseSource, directory, document store;
  reviewer's finding (unguarded document store) closed with a throw + test.
- [x] 2026-08-23 Phase 2 (labs) — 11 synthetic patients through the font-locked
  pipeline; determinism proven three ways; remote D1s seeded.
- [x] 2026-08-23 Phase 3 — tenancy by path, find_patient, mid-turn bind (one
  ask = one turn), patient chip; refusals pinned by tests.
- [x] 2026-08-23 Phase 4 (tools) — search_documents/get_document; document
  corpus generation ran separately.
- [x] 2026-08-23 Phase 5 — source registry, [n] markers, sources event, crops
  panel; live test proves markers only point at registered sources.
- [x] 2026-08-23 Phase 6 (partial) — ledger split per tenant (+ pinned test),
  agent /api/session door, Turnstile hostnames (worker var + widget via API),
  evidence route (KV — R2 needs a dashboard opt-in the account lacks).
- [x] 2026-08-23 Phase 4 (corpus) — 24 prose documents over the same pipeline;
  inline panels quote the committed lab values verbatim.
- [x] 2026-08-23 Browser walkthrough — four defects found and fixed, chief
  among them cross-patient mislabeling on rebind; row crops now show the full
  printed row; dev Turnstile un-broken (testing-key flag).
- [x] 2026-08-23 Evals — the suite had silently skipped since the restructure
  (ROOT bug); fixed, 7 clinical cases added, baseline promoted 14/14 at
  3 reps, $1.07.
- [x] 2026-08-23 DEPLOYED — https://bloodwork-chat.andres-cerny.workers.dev
  (/sport, /orto). Ledgers verified live.
- [x] 2026-08-23 Real patient seeded — 15 lab reports (875/878 values with row
  bboxes, $0: the archive's content-addressed cache held), 14 documents, 66
  evidence images in KV; scoped deletes proved the synthetic corpus survives;
  live /api/evidence serves. Seeding ORDER matters: synthetic seeds wipe
  whole tables — real record always re-seeds after them (deploy.md §4).
  Open: human Turnstile click on the new hostname; optional UI audit pass.

## Cut lines (in order, if the 1.5 weeks compress)

1. Inline `[n]` markers — keep the sources panel per turn (most of the trust,
   half the work).
2. `cohort_query` — single-patient demo stands alone.
3. FTS5 → `LIKE`.
4. Orto pre-op labs — orto becomes documents-only.

**Not cuttable:** identity rules, tenant refusal, ledger split, Turnstile
hostname test, the privacy line on synthetic-only data.

## Open items

- ~~Performance evals~~ — landed in `samples/performance/` 2026-08-23
  (18 PDFs + 1 xlsx; 4 are image-only scans, the rest carry text layers).
  Template spec extracted into Phase 4 above.
- FTS5-on-D1 confirmation (5-minute spike in Phase 1, decides Phase 4 detail).
- Fictional lab/doctor/practice names — Ondřej may want a say; defaults will
  be proposed in the Phase 2 story table.
