# Plan: lab adaptability — reading any Czech or Slovak lab sheet

Design settled 2026-09-06 (session with Ondřej). No public date yet; this is
the gate before the app goes public. **The extractor must read a sheet it has
never seen, and we must be able to prove that with numbers before believing
it.** Everything below favours proof over features, along the seams the repo
already drew: the bench harness in `tests/bench/`, the font-locked generators,
the parity fixture, `review.ts` as the one authority on doubt.

## What is being built

Today extraction is Claude with two hand-written Czech prompts
(`packages/extraction/src/extract.ts`: `SYSTEM_EXTRACT` for images,
`SYSTEM_EXTRACT_TEXT` for the text layer; `MODEL_PRIMARY` Sonnet 5,
`MODEL_ESCALATION` Haiku 4.5). No trained model exists. The real corpus is 15
blood panels from four labs (AGILAB 5, SPADIA 6, CASRI 3, PREVEDIG 1), 18
performance PDFs and 2 tHb-mass PDFs, all under git-ignored `samples/`. There
is no public dataset of Czech lab PDFs.

Three public sample sheets found today (`data/public-sheets/SOURCES.md`,
git-ignored) already break assumptions the code makes:

| Sheet | What it does that we have never seen |
|---|---|
| Nemocnice Břeclav p121–122 | no material prefix; `Zkr.` abbreviation column before the name; values with four decimals (`4,9000`); ranges in spaced parentheses `( 2,5000 - 6,4000 )`; an `H` flag cell between value and unit; trailing signature cells |
| EUC Klinika Ostrava p34 | slash prefix (`S/Sodík`, `B/Hemoglobin`); a `Hodnocení` column carrying `( * )`; out-of-range values in red |
| Unilabs Slovakia p2 | Slovak (`Výsledok`, `Hodnotiace kritériá`, `negatívne`); grouped sections; a separate `Materiál` column; accreditation icons in the row |

Handbook critical-value tables add `S-Na`, `S,P-glukóza`, `U-amyláza`,
`P_Amoniak`. `materialPrefix()` in `packages/lab-core/src/mapping.ts` and the
`PREFIX` regex in `packages/lab-core/src/registry.ts` (mirrored by `_PREFIX`
in `tools/pipeline/src/matching.py`) recognise only `^[a-z]{1,4}_`.
Prefix-free labs (AGILAB) print numeric urine rows that look like serum rows.
Layout follows the LIS vendor (STAPRO OpenLIMS, LabSys, ICZ, DS Soft) more than
the lab brand, and the biggest labs — Unilabs ČR, Synlab, Citylab, Vidia,
AGEL, the university hospitals — have no sample at all.

## Decisions already made (do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Photo readers | **Two independent readers: Claude Sonnet 5 + Google Gemini 3.8 Flash** (GA 2026-09-02) | Ondřej's call 2026-09-06. A second reader from a different provider does not share the first one's failure modes — the same argument that put Haiku beside Sonnet on the text path |
| Reversibility | Primary/secondary is a Worker var (`PHOTO_READERS`), not code | Ondřej wants to flip to Gemini-first if the eval says so; a var flip is a deploy, not a rewrite |
| Digital PDFs | Text-layer path unchanged | Characters come from the file; docs/extraction-speed.md's confirmed run: Haiku alone 851/878, 0 value errors |
| Scanned PDF pages | Same reader pair as photos (assumption — confirm) | They are images; docs/extraction-speed.md: Haiku must not read alone on the image path |
| **Where Claude runs during testing** | **Subagents, not the API.** Every Claude arm (Sonnet, Haiku, Opus) is iterated through `subagent_dump.bench.ts` → `subagent_score.bench.ts` with the deployed prompt handed to the subagent verbatim. The real Anthropic API is used once per phase, for the gate | Ondřej, 2026-09-06: "use the subagents to not be so costly". Subagent reads are free; a gate run is a few dollars and is the only number that measures the deployed path |
| **Paid runs need approval** | Any run that spends money — Gemini API, Anthropic API gate runs — is proposed to Ondřej with its page count and USD estimate first, and does not start until he approves | Ondřej, 2026-09-06. `BENCH_MAX_USD` stays as the hard stop, approval is the soft one |
| Gemini SDK | `@google/genai` (official), **bench harness only** until Phase C passes; Worker gets it in Phase E | Prove before wiring; the extract worker "is finished" (workers/CLAUDE.md) and reopens once, deliberately |
| Gemini settings | Paid tier (no training on data), structured output mirroring `TOOL.input_schema`, media resolution **high**, thinking minimal, temperature 0 | Google's own guide: dense document parsing needs high media resolution; the default tier silently loses digits on a dense sheet |
| Public sheets | **Not committed.** PDFs/renders stay in `data/public-sheets/`; a manifest (URL, sha256, page) + hand-transcribed truth JSON is committed under `tests/bench/public_sheets/`; conventions are re-synthesised through `make_layout_fixtures.py` | Handbooks are the labs' copyrighted publications and name real staff; `packages/lab-core/tests/fixtures/` is owned by one generator (tools/pipeline/CLAUDE.md) and `npm test` reads it; the privacy hook blocks any edit under `data/`, so truth files could not be authored there anyway |
| Photos of real sheets | `data/photos/`, git-ignored, guarded by `.claude/hooks/privacy-guard.mjs`; truth derived from `data/reports/*.json` | Real patient data never enters git; the accepted reports already are the ground truth `loadBaseline()` keys on |
| Scoring | Three columns, never averaged, per document class (`tests/bench/score.ts`) | A single accuracy % hides the column that disqualifies |
| Prompt edits | **Last** (Phase D), each proven by the eval | Deterministic fixes are free and permanent; prompt words are neither |
| Perspective correction in the browser | Deferred until the "angle" photos are scored | Build it only if the models actually fail on skew |
| **Image resolution per reader** | Each reader gets the most it can see. Sonnet 5: long edge 2576 px (its tier; the PDF path's `MAX_EDGE` 1800 stays for PDFs). Gemini 3.x has no pixel cap — it budgets tokens per image: `high` 1120, `ultra_high` 2240 (Google media-resolution doc) — so Gemini receives the full-resolution photo with `ultra_high`, and Phase C keeps a `high` arm to measure what the extra 1,120 tokens (≈ $0.001) buy | Ondřej, 2026-09-06: "if Gemini can see more pixels, give it a clear picture" |
| **Single reader is never silent** | When only one read comes back (the other request failed), every row carries `disagreement = "druhé čtení se nezdařilo"` | Ondřej, 2026-09-06, agreed |
| Results | Hand-copied into [`docs/lab-adaptability.md`](../lab-adaptability.md) (new), like docs/extraction-speed.md | `tests/bench/results/` is git-ignored — derived from real PDFs |

## Invariants this plan must not break

- **Patient data never leaves the machine** except to the model APIs in use
  — now Anthropic *and* Google, and the privacy copy must say so (Phase E).
- **The parsing layer exists twice.** Every rule widened in Phase B lands in
  `tools/pipeline/tests/parity_cases.json` first, then both implementations.
- **The generators are font-locked.** New fixtures go through
  `scripts/_fonts.py` untouched; output regenerates byte-identically.
- **The model transcribes; lab-core computes.** No prompt addition may ask
  the model to convert, infer or prefix anything not printed.
- **`review.ts` is the single authority on doubt.** A Gemini/Sonnet
  disagreement reaches the screen through `disagreement` → `unconfirmed`,
  nowhere else.
- **Bench arms import the deployed prompt** (`tests/bench/extract.ts`
  pattern); the moment a harness restates the Czech, it stops measuring the app.
  The same holds for subagent arms: the subagent receives `SYSTEM_EXTRACT` /
  `SYSTEM_EXTRACT_TEXT` and the tool schema by import, never a paraphrase.
- **Extraction never grows a database binding** — one more secret, nothing else.

---

## Phase A — corpus

**A1. Inventory.** One table in `docs/lab-adaptability.md`: every source page
by class (real text-layer 33 pages; real scanned pages 3; synthetic fixtures
9; public scans 4; photos 0 → ~33), lab, LIS vendor where known, and which
conventions from the table above it exhibits. Fix the **nine wrong rows in
`data/reports`** named in docs/extraction-speed.md ("The accepted reports are
wrong in 9 rows") before anything is scored against them again.

**A2. Public sheets → truth + manifest.** `tests/bench/public_sheets/manifest.json`
(slug, URL, sha256, page number, language, conventions) and one
`<slug>.json` per page with the printed rows transcribed by hand — name,
value, unit, range, exactly as printed, decimal comma and all. Fictitious
patients (`Novák Jan`, `XY YZ`, blurred) so no personal data; facts, not the
publication. Rendering for the vision arms happens at run time from
`data/public-sheets/*.pdf` at 220 DPI (`RENDER_DPI` in
`packages/lab-core/src/pdf/pdf.ts`), through the scratch venv's PyMuPDF the
way `tests/live/extract.live.ts` resolves `pythonWithFitz()`.

**A3. Extend `tools/pipeline/scripts/make_layout_fixtures.py`** — one function
per convention, same `header()`/`new_page()` helpers, invented names only:

| Fixture | Models |
|---|---|
| `slash_prefix.pdf` | EUC: `S/Sodík`, `B/Hemoglobin`, a `Hodnocení` column with `( * )`, `Ref. meze` |
| `hyphen_comma_prefix.pdf` | `S-Na`, `S,P-glukóza`, `U-amyláza`, `P_Amoniak` on one page, plus `anti-TPO` and `25-OH vitamin D` (names that *look* prefixed and are not) |
| `zkr_column.pdf` | Břeclav: `Zkr.` \| name \| `4,9000` \| `H` \| unit \| `( 2,5000 - 6,4000 )` \| trailing signature cells |
| `slovak_grouped.pdf` | Unilabs SK: Slovak headers, `Materiál` column (`sérum`, `krv EDTA`), `negatívne` qualitative rows, `<1,0 negatívne` criteria |
| `urine_no_prefix.pdf` | AGILAB-shaped: prefix-free numeric urine rows under a `Moč chemicky` heading, units `mmol/l`, ranges that overlap serum ones |
| `mixed_material.pdf` | Serum and urine glucose on one page, no prefix, section headings only — the disambiguation case |
| `scanned_photo_like.pdf` | `scanned()` variant rotated 3° and lowered contrast — the one synthetic stand-in for a phone shot |

Each gets expected rows in `tests/live/fixtures.ts` (`FIXTURES`) and a
`layouts.test.ts` block. Note the size: DejaVu embeds ~1.5 MB per fixture;
seven more is ~10 MB in the repo. Accepted.

**A4. Photo-capture protocol (Ondřej, phone).** Ten pages spanning all four
labs (AGILAB 3, SPADIA 3, CASRI 3, PREVEDIG 1), printed. Per page three shots
— `flat` (daylight, straight on), `angle` (~20°, a shadow across the table),
`glare` (lamp reflection or slight blur) — plus three specials: `twopage`
(both pages of one report in one frame), `crop` (margins cut, a column
clipped), `dark` (evening room light). ~33 files. Naming:
`data/photos/<source_stem>_p<N>_<condition>.jpg` with
`data/photos/manifest.json` mapping each file to `source_file` + page(s), so
truth is `loadBaseline().get(\`${src}#${page}\`)` — the same key the existing
scorer uses; `twopage` truth is the union. Transfer by cable or AirDrop,
then delete from the camera roll and any cloud photo library. Original
resolution kept; the browser's downscale is applied *by the harness*, so the
eval measures what the app will send.

**A5. Further fetching.** `tools/pipeline/scripts/fetch_public_sheets.py`,
run from the scratch venv (path in `SOURCES.md`): a seed list of
(query, domain) pairs at the top of the file, like `make_chat_demo.py`'s
story table; downloads PDFs into `data/public-sheets/`, and for each page
scores "looks like a result sheet": ≥8 rows matching *name + number + unit
or range* in the text layer, OR a page-covering bitmap next to the words
`Výsledkový list`, `vzor`, `Výsledok`, `Ref. meze`. Candidates are rendered
to `renders/` and listed in `candidates.md` for an eye check.
Queries: `laboratorní příručka výsledkový list vzor`, `vzor výsledkového
listu`, `příloha výsledkový list`, `laboratórna príručka výsledkový list
vzor`, `OpenLIMS výsledkový list`, `LabSys výsledkový list`, `nálezový list
vzor laboratoř`. Domains: unilabs.cz, synlab.cz, citylab.cz, vidia.cz,
agellab.cz, fnmotol.cz, vfn.cz, fnbrno.cz, fnol.cz, fno.cz, medirex.sk,
alphamedical.sk (now Unilabs SK), plus the vendors stapro.cz, icz.cz,
dssoft.cz. **Most handbooks contain no sheet** — 13 of the 16 fetched today
had none; expect a few hits per twenty downloads. Every hit goes through A2.

**Gate:** inventory table written; nine baseline rows fixed; fixtures
regenerate twice with `git diff --exit-code`; `npm test` green with the new
`layouts.test.ts` blocks; photo manifest resolves every file to a baseline
key; `SOURCES.md` lists any new sheet with page and conventions. Costs nothing.

## Phase B — deterministic layer

Discipline for every item, in this order: **write the parity case or unit
test, watch it fail, fix, watch it pass, then reintroduce the fault once and
watch it fail again** (docs/constraints.md, "A guard that only runs on the
happy fixture is not a guard").

**B1. Material prefix separators.** `materialPrefix()` (mapping.ts),
`PREFIX` (registry.ts `normKey`), `_PREFIX` (matching.py `norm_key`).
Underscore stays generic (`^[a-z]{1,4}_`); hyphen, slash and comma forms are
**allowlisted** (`s`, `p`, `b`, `u`, `du`, `pk`, `pe`, `fw`, `sp`, `s,p`,
`k`, `l`) because `^[a-z]{1,4}-` would strip `anti-` from `anti-TPO`. Do the
naive widening first and watch that case fail. New parity section
`material_prefix` and a `norm_key` section in `parity_cases.json`, wired into
both `test_parity.py` and `parity.test.ts`: `S/Sodík→s`, `S-Na→s`,
`S,P-glukóza→s` (S and P are both blood; treat `s,p` as compatible with
either), `U-amyláza→u`, `P_Amoniak→p`, `dU_Kreatinin→du`, `anti-TPO→null`,
`25-OH vitamin D→null`, `Glukóza→null`.

**B2. Material from section.** `sectionMaterial(rows, index)` in
`packages/lab-core/src/pdf/rows.ts` (pure text over rows, so root-exportable):
walks upward to the nearest single-cell heading matching `moč`, `močový
sediment`, `sérum`, `plazma`, `krevní obraz`/`krvný obraz`, `biochemie`.
`UnmappedAnalyte` gains `material` = prefix ?? section, and `suggestMappings`
uses it for `materialMatch`; `MappingTab.tsx` shows it. Test on
`mixed_material.pdf`: the urine glucose must not be offered `glukoza` silently.

**B3. Range formats** (`parseRange` / `parse_range`): `( 2,5000 - 6,4000 )`,
`do 5,0`→(null,5), `nad 0,5`→(0.5,null), `≤ 5,00`, `≥ 0,5`, `0,5 až 1,5`,
`<1,0 negatívne`→text, and `3,80–10,70` (already; pin it). Parity cases first.

**B4. Values and markers** (`parseValue` / `parse_value`): `4,9000`→4.9,
`( * )`→null, `H`→null, `negatívne`→null, `5,4 ↑`→5.4 (arrows join `!`/`*`
as decoration). Parity cases first.

**B5. Candidate rows.** Promote `candidateRows` from `tests/bench/candidates.ts`
into `packages/lab-core/src/candidates.ts` (docs/extraction-speed.md already
cites that path; it does not exist yet) so the bench and the client share
one rule. Widen: Slovak qualitatives (`negatívne`, `pozitívne`,
`nevykonané`); ignore `( * )`, `(*)` and single-letter flag cells; an all-caps
2–6 char cell followed by a lowercase name cell is an abbreviation — the
*next* cell is the name. Unit-test against `zkr_column.pdf` and
`slovak_grouped.pdf` rows.

**B6. Abbreviations.** No code: Břeclav-style `URE`/`KRE`/`KM` are learned
synonyms through the existing mapping UI (`Registry.removeSynonym` rules
unchanged). Seeding them is out of scope.

**Gate:** parity green on both sides in one commit; every new guard shown
failing once (note it in the test file); `npm test`, `npm run typecheck`,
`npm run docs:check`. Costs nothing.

## Phase C — eval

Reuse `tests/bench/` — extend, never replace. `score.ts` keeps its three
columns. Two tiers, as in `tests/CLAUDE.md`:

- **Tier 1, free, the working loop.** Claude arms run as subagents:
  `subagent_dump.bench.ts` writes each page's input exactly as the API would
  see it (rendered image or `|`-joined rows, the imported system prompt, the
  tool schema), a subagent per model tier plays the reader and returns the
  tool call, `subagent_score.bench.ts` scores. Sonnet-, Haiku- and
  Opus-shaped subagents are as close to the API as we get for free; the
  known gap is that a subagent is not the deployed `messages.create` call
  (no cache, no tool-input streaming, no image tier downscale), so tier 1
  ranks candidates and tier 2 confirms the winner.
- **Tier 2, paid, the gate.** The real API, once per phase, and only after
  Ondřej has approved the page count and the USD estimate. Gemini has no
  subagent equivalent, so every Gemini read is tier 2 by definition — cheap
  (≈ $0.02/page) but still proposed before it runs.

**C1. Readers.** `Reader` in `tests/bench/extract.ts` gains
`provider: "anthropic" | "google"`; new `tests/bench/gemini.ts` wraps
`@google/genai` (root devDependency only) with the same `CallResult` shape:
`TOOL.input_schema` converted to Gemini's schema (`["string","null"]` unions
become nullable), `mediaResolution` ultra_high (a `high` arm beside it),
thinking minimal, temperature 0,
no retries (retries would read as latency, as `extract.ts` says).
`PRICING` in `extract.ts` gains `gemini-3.8-flash: [0.75, 3.75]` with a
comment that it becomes `[1.50, 7.50]` on 2027-01-01. `GEMINI_API_KEY`
sits beside `ANTHROPIC_API_KEY` in the repo-root `.env`; both reach the
harness through `process.env` as today. A `subagent` provider is the tier-1
shape of the same interface, so an arm is declared once and run at either tier.

**C2. Corpora.** Four classes, one loader each beside `corpus.ts`:
`real` (existing `realSamples()`), `synthetic`
(`packages/lab-core/tests/fixtures`, truth in `tests/live/fixtures.ts`),
`public` (A2), `photo` (A4). A new `tests/bench/adapt.bench.ts` (npm
`bench:adapt`, already matched by `spend-guard.mjs`'s `npm run bench:`
pattern) runs every class × every arm, four in flight, writes
`results/adapt.jsonl` **with raw outputs persisted** ("Paying twice").

**C3. Scoring per class.** Text-layer pages: the three columns as today
(`scoreAgainstBaseline`, `fabrications` via `isPrintedOnPage`,
`rangeIntegrity`). Image pages have no rows, so column 2 becomes **value
errors against hand-verified truth** — objective because the truth was
checked by a human, as the vision-path table in docs/extraction-speed.md
already did ("139 of 140 rows each with no value error"). For reader pairs
add two numbers, never merged: **uncaught value errors** (both readers wrong
the same way — must be 0) and **flagged rows** (disagreements — the cost of
review, reported so it can be judged, not averaged away).

| Class | Pass means |
|---|---|
| real, text | matched ≥ confirmed run (851/878), 0 fabrications, 0 collapsed, 0 decensored |
| synthetic | every expected row exact (as `extract.live.ts` asserts), all seven new fixtures included |
| public scans | 0 value errors, 0 decensored; misses only on qualitative rows, adjudicated by hand |
| photos, pair | 0 uncaught value errors on every shot incl. `angle`/`twopage`; single-reader value errors reported per condition |

**C4. Sonnet vs Gemini vs Opus 5 on photos.** Tier 1 first: Sonnet-, Haiku-
and Opus-shaped subagents over all 33 photos and the 4 public scans, which
ranks the whole Claude side for free — Opus 5 included, and Opus never
leaves tier 1: it is a candidate only if no pair reaches 0 uncaught errors,
and a subagent ranking is enough to know that. Then one proposed tier-2 run:
Gemini alone over the same 37 pages (≈ $0.75), scored against the same
truth; the pair tables (Sonnet+Gemini in both orders, Sonnet+Haiku) are
computed offline from the subagent and Gemini result sets. Only if that
table says Gemini beats Sonnet on photos does the *confirmation* run happen:
Sonnet alone on the real API over the 37 pages (≈ $3.30), once, because the
deployed path — 2576 px image tier, prompt cache, page latency — is the one
thing a subagent does not reproduce. Proposed with its estimate, not started
until approved.
**Switching primary to Gemini is justified only if:** Gemini alone has fewer
value errors than the confirmed Sonnet run on photos *and* no error class
Sonnet lacks; on the text class it shows 0 fabrications where Sonnet has its
6 unit normalisations (`10^9/l` for `10˄9/l`); its page p50 is within 1.2×
Sonnet's; and the pair still has 0 uncaught errors either way round.
Photo-only win → flip `PHOTO_READERS` only.

**C5. Cost per paid run.** Text pages from the confirmed run (docs/
extraction-speed.md, "Confirmed on the real API"): Sonnet $1.22/33 pages ≈
$0.037, Haiku $0.45/33 ≈ $0.014. Vision, derived: Sonnet 5 image 4,784 tokens
("Image resolution, corrected") + ~1,200 prefix ("The prompt cache does
engage", 1,181) ≈ $0.018 in, ~4,500 output tokens on the snippet schema
(accuracy table, sonnet5/snippet 18,123 over four probes) ≈ $0.068 → **≈
$0.09/page**; Haiku ≈ $0.026; Gemini 3.8 Flash ≈ $0.02 (assumes ≤1,200
image tokens at high resolution; ≈ $0.04 from Jan 2027). Opus 5 has no
API cost here — it runs at tier 1 only.

| Run | Pages | ≈ USD | Needs approval |
|---|---|---|---|
| tier 1, any Claude arm incl. Opus 5, any class | all | 0 | no |
| Gemini alone, photos + public scans | 37 | 0.75 | yes |
| Sonnet confirmation on photos + public scans, only if Gemini leads at tier 1 | 37 | 3.3 | yes |
| Anthropic gate run, text classes, both readers (33 real + ~15 synthetic), end of Phase D | 48 | 2.5 | yes |

`BENCH_MAX_USD=15` per run as the hard stop. Budget for the whole phase:
under $7 even if every paid row runs. Opus 5 costs nothing because it
never runs on the API.

**Gate:** `bench:adapt` completes with every class scored, tier 1 for Claude
and one approved Gemini run; per-class tables and the C4 verdict written
into `docs/lab-adaptability.md` with the JSONL they came from named; scorer
changes covered in `score.test.ts`.

## Phase D — prompt

Only after B and C, because every one of these is a sentence in
`SYSTEM_EXTRACT` / `SYSTEM_EXTRACT_TEXT` and the vision `TOOL`, and words
are the least reliable layer. The loop is the one in `tests/CLAUDE.md` and
`.claude/agents/eval-loop.md`: **tier 1** on subagents through
`subagent_dump.bench.ts` → `subagent_score.bench.ts` (free, wording
iteration); **tier 2** `bench:adapt` on the target class *and* the real text
class (paid, the gate, approved first). Adopt an addition only if its target
class moves and no column of any other class worsens; record both tables.

1. **Prefix conventions.** Replace `včetně předpony jako 'S_' nebo 'B_'`
   with the list: `S_`, `S/`, `S-`, `S,P-`, `U-`, `dU_` — copied, never added.
   Target: `slash_prefix`, `hyphen_comma_prefix`, EUC scan.
2. **Evaluation column.** `( * )`, `H`/`L`, arrows and colour are markers,
   not part of `value_raw`, `unit_raw` or `ref_range_raw`. Target: EUC and
   Břeclav scans (`( * )` must not land in the range field).
3. **Abbreviation column.** Where a short code and a full name both print,
   `raw_analyte_name` is the full name. Target: `zkr_column`, Břeclav.
4. **Slovak.** One sentence: the sheet may be Slovak; transcribe in the
   language printed. Target: `slovak_grouped`, Unilabs SK.
5. **`material_raw`** — optional verbatim field on both tool schemas
   (`TOOL_TEXT` derives from `TOOL`, so one edit) — **only if** B2's section
   inference still leaves urine rows misassigned on `mixed_material` and
   the Unilabs sheet. Carry it through `RawRead` in `reconcile.ts` and
   `Measurement` in `models.ts`. Check `cacheReadTokens` afterwards: the
   prefix clears the 1,024-token cache minimum by 157 tokens today.

**Gate:** each adopted sentence has a before/after pair in
`docs/lab-adaptability.md`; the real text class unchanged in all three
columns; `tests/live/extract.live.ts` green on the new fixtures.

## Phase E — production wiring for photos

1. **Input.** `UploadPanel.tsx` `accept="application/pdf,image/jpeg,image/png"`
   plus a `capture="environment"` input on phones. New
   `apps/bloodwork/src/lib/photo.ts`: EXIF orientation via
   `createImageBitmap(…, { imageOrientation: "from-image" })`, long edge
   **2576 px** for Sonnet (its tier; `MAX_EDGE` 1800 in `pdf.ts` stays for
   PDFs and would throw resolution away here) and the uncut original for
   Gemini at `ultra_high` — two encodes of one photo, one per reader;
   greyscale, 2nd–98th percentile contrast stretch, JPEG 0.85, manual
   rectangle crop. Perspective
   correction: only if the `angle` shots failed in C. One photo consumes one
   page in `consumePage`; a `twopage` shot is read as one page.
2. **Worker.** `extractPageGemini` in `packages/extraction/src/gemini.ts`
   using `@google/genai` — spike its workerd compatibility first; fallback is
   a hardcoded REST call to `generativelanguage.googleapis.com` (the Worker's
   outbound hosts are hardcoded by policy; add the host, then re-run
   `/security-review`). `Env` in `workers/extract/src/index.ts` gains
   `GEMINI_API_KEY`; `PHOTO_READERS` var (`sonnet+gemini` default,
   `gemini+sonnet` to reverse, `sonnet+haiku` to retreat); `mode: "photo"` in
   the response; `MODEL_PRICING` in `packages/agent/core/src/pricing.ts` gains
   the Gemini entry with the January switch so the ledger stays honest.
   Secret: `npx wrangler secret put GEMINI_API_KEY -c workers/extract/wrangler.jsonc`
   — extract only; the agent never sees it. Update `docs/deploy.md` §3 and
   the `wrangler.jsonc` secrets comment.
3. **Disagreement.** Nothing new: `reconcile()` sets `disagreement`, `review.ts`
   renders `unconfirmed` (hollow point, named reason, kept out of nothing but
   trust). One real gap: when one provider's promise rejects, `reads.length`
   is 1 and every row would look *confirmed*. A photo read by one reader gets
   `disagreement = "druhé čtení se nezdařilo"` on every row. Pinned in
   `workers/extract` tests and shown on screen by `tests/e2e/upload.e2e.ts`
   (stubbed `/api/extract`, free).
4. **Privacy copy.** `App.tsx` (~L573–583) and `UploadPanel.tsx` (~L543–547)
   name only Anthropic. Both gain: photos are also sent to the Google Gemini
   API (paid tier, not used for training, not stored). `docs/constraints.md`
   privacy section and `workers/CLAUDE.md` ("extract is finished") updated.

**Gate:** `npm test`, `typecheck`, `docs:check`, `test:audit`, `test:upload`;
`/security-review` on `workers/extract`; a phone photo of a *synthetic*
demo page read live on the deployed URL with both readers and one
deliberately forced disagreement visible in the verification tab.

---

## Risks

- **Gemini price doubles 2027-01-01** ($1.50/$7.50). Pricing table must be
  date-aware; `BUDGET_USD_LIMIT` on extract may need raising or the photo
  path throttled. Re-run C5's table then.
- **Gemini Pro stalled at 3.1 preview** — there is no Google escalation tier;
  if Flash fails the bar, the fallback is Sonnet + Haiku, not a better Gemini.
- **Media resolution default** silently loses digits on dense sheets; pin
  `high` in code and keep a `default` arm in C so the loss is measured, not
  assumed.
- **Subagents are not the API.** A subagent reader sees no image tier
  downscale and no cache; a tier-1 winner can still lose at tier 2. That is
  why the gate is paid and why the two tiers are never mixed in one table.
- **`@google/genai` inside workerd** may not run; the REST fallback is
  planned but unmeasured.
- **Structured-output dialects differ** — nullable unions, enums; a schema
  that Gemini quietly relaxes would show up as fabrications, which is why
  column 2 exists.
- **Haiku misreads digits** on images (255 → 265, `mmol/1`) — it never reads
  alone on the image path, retained from docs/extraction-speed.md.
- **Three public sheets is a thin sample**; the fetch script may find few
  more. LIS-vendor coverage stays unknown until real users upload.
- **HEIC** from iPhones: `accept` does not convert; Safari decodes it on a
  canvas, Chrome does not. Detect and ask for JPEG rather than fail silently.
- **Phone memory** at 2576 px with 64 in-flight requests: verified only on
  desktop today.

## Not in scope

Training or fine-tuning any model; OCR or layout engines (Docling scored
85% and merged rows — a fallback at best); Gemini on the text-layer path;
handwriting; languages other than Czech and Slovak; seeding abbreviation
synonyms; automatic perspective de-skew (pending C); splitting a two-page
photo into two pages; moving the vision path from `source_snippet` to
`row_index`; the chat/clinical evals; changing the demo dataset.

## Build log

(append `[x] date — phase — what the gate showed`)

## Open items

- Confirm scanned PDF pages take the photo reader pair (assumed above).
- Confirm Gemini's per-image token count at high resolution before trusting
  the $0.02/page figure.
- Whether `data/reports` corrections (A1) are re-exported to the demo.
