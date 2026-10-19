# The model-pipeline loop — playbook, log, ledger

A loop of rounds that makes the model side of the pipeline (upload → readers →
mapping → flags/verification → chat agent) better and, where it holds, cheaper.
No UI work. Branch `claude/model-pipeline-loop`; the orchestrator opens the PR.

## Playbook

- **Budget:** $10 of real API spend for the whole loop, $3.50 per round at most.
  Every paid command goes in the ledger below, with what it actually cost.
  Keys: `with-secrets bloodwork -- …` (shared with other projects — log every run).
- **Judgment over metrics.** Bench pages are probes, not targets. Read the rows
  (misses, units, disagreements), name the root cause, prefer a general fix.
- **The cross-check is judged on what it catches**, not on raw accuracy: a second
  reader is worth what it witnesses of the primary's errors (UNCAUGHT must be 0).
- **Every experiment comes from the hypothesis list.** Free tests first (unit
  test, fixture, script over stored outputs), paid runs only for what needs one.
- No deploys, no secrets, no live Cloudflare changes. Model swaps ship as Worker
  vars (`MODEL_PRIMARY`, `MODEL_SECOND`, `MODEL_MAP`, `AGENT_MODEL`), unset by
  default, so a decision is a reversible config flip for Ondřej.

### The corpus on this server

`data/` holds no patient reports here (the real corpus and the BioLAB mapping
fixture live on Ondřej's Mac). What runs here:

- **synthetic** — `packages/lab-core/tests/fixtures/*.pdf`, 10 pages with exact
  truth (`tests/live/fixtures.ts`), 8 text-path and 2 scans. Clean; they show
  breakage, not fine differences.
- **public** — 11 real labs' sample sheets (`tests/bench/public_sheets/`), fetched
  from their public URLs into git-ignored `data/public-sheets/` (sha256 verified
  2026-10-19), hand-transcribed truth, all on the image path. These are the
  pages that discriminate.

Command shape (persisted outputs are reused, so a re-score is free):

```sh
BENCH_DRY_RUN=1 PYTHON_BIN=.venv/bin/python BENCH_CLASSES=synthetic,public BENCH_ARMS=<arms> npm run bench:adapt
with-secrets bloodwork -- env BENCH_MAX_USD=<cap> PYTHON_BIN=.venv/bin/python BENCH_CLASSES=synthetic,public BENCH_ARMS=<arms> npm run bench:adapt
```

## Inventory — every model call (round 1, 2026-10-19)

Prices: Anthropic first-party list, $/1M in/out. Sonnet 5 and 5.5 $2/$10,
Haiku 4.5 $1/$5, Haiku 5.5 $0.10/$0.50 (≤100K prompt), Opus 5.5 $4/$20,
Gemini 3.8 Flash $0.75/$3.75 (doubles 2027-01-01).

| # | Call | File | Model | Params | Per upload | ≈ cost |
|---|---|---|---|---|---|---|
| 1 | Text-path reader, primary | `packages/extraction/src/extract.ts` `extractPageText` | Sonnet 5 | forced tool, no thinking param (forced suppresses it), no effort, max_tokens 8000, cached system | 1 per born-digital page | ~$0.025/page |
| 2 | Text-path reader, second | same | Haiku 4.5 | same | 1 per page (both deployments; `TEXT_READERS=cheap` drops #1) | ~$0.014/page |
| 3 | Image reader, primary | `extractPage` | Sonnet 5 | forced tool, `source_snippet` schema, image ≤2576 px | 1 per scan/photo page | ~$0.035/page (measured) |
| 4 | Image reader, second | `gemini.ts` `extractPageGemini` | Gemini 3.8 Flash, ultra_high, thinking LOW, temperature 0 | JSON schema output | 1 per image page (`PHOTO_READERS=sonnet+gemini` on both workers) | ~$0.009/page (measured) |
| 5 | Mapping fallback | `packages/extraction/src/map.ts` via `POST /api/map` | Haiku 4.5 (`MODEL_MAP = MODEL_ESCALATION`) | forced tool, batches of 30 names, catalog (344 entries) in the **uncached** user turn | after each upload, only names the registry left null | ~$0.001/name |
| 6 | Bloodwork chat | `packages/agent/core/src/loop.ts`, profile `bloodwork` | Sonnet 5 | no thinking param → **adaptive thinking on** (Sonnet 5 default), max_tokens 1200, profile system cached, the patient's whole dataset as an **uncached** second system block (≤60k chars) | per message | ~$0.02–0.05/msg |
| 7 | Clinical agent | same, profile `clinical` | Sonnet 5 | tools, ≤6 rounds, max_tokens 2000, history not cached across rounds | per message | ~$0.03–0.10/msg |

**A typical upload today** (3-page born-digital report): 3 × ($0.025 + $0.014)
≈ **$0.12**, plus mapping for a new lab ≈ $0.01–0.05. A photographed page ≈
**$0.044** (measured round 1). The ledgers priced Sonnet 5 at $3/$15 until this round, so every
recorded Sonnet number (ledger, benches, docs) overstated it by 50%.

## Inventory — hardcoded heuristics a model or Jev could back

From the round-1 review (lab-core, portal interpret/mapping). Keep = deterministic is right.

| Table / rule | Size | Verdict |
|---|---|---|
| Registry synonyms (`seed_registry.py`) | 344 analytes, ~4,100 synonyms | Keep as the exact lookup; grow it from model answers. The *decision* threshold for applying an AI mapping unasked is the model's own "high" — a calibrated classifier (Jev) would put a real probability there. |
| Mapping score weights (`lab-core/src/mapping.ts`: name +0.15, unit ±, range +0.3/−0.6, thresholds 0.45/0.28/0.3) | ~10 constants | Prime candidate for calibration (label/unit/range text only — the "values" feature uses patient numbers and stays on device). |
| Curated reference ranges, unit conversions | 263 / 150 analytes | Keep (clinical facts). |
| `canonicalizeUnit` | ~10 regexes | Keep; misses superscripts (`×10⁹/l`, `10⁹/l`) and `G/l`. |
| `UNIT` list in `candidates.ts`, `QUALITATIVE` stems (two copies: candidates.ts, correction.ts), `NOT_A_UNIT` (~55) | ~45 / 26 / 55 | Fragile. Derive units from the registry; merge the two qualitative lists. Model not needed. |
| Range regexes (`normalize.ts`) | 5 | Keep; extend for `M: 30 - 400`, `muži …`, and a range with a unit tail. Parity cases first. |
| `nameFromRow` / `nameStart` row-layout rules (`candidates.ts`) | ~15 rules | Fragile layout parsing; made largely unnecessary if the text reader returned cell indices (H9). |
| Material prefixes, blood family, identity titles, photo constants | — | Keep. |

## Hypotheses — ranked (where it is likely wasteful, fragile or wrong)

Each with why, and the cheapest test. **R** = which round tries it.

1. **The cross-check compares only the value string.** `reconcile.ts` pairs rows by
   name and compares `value_raw` minus `!*`; unit, range and flag are never
   compared and the primary's win. So the documented reason for the second
   reader ("Sonnet 5 normalises units, Haiku 4.5 doesn't, the disagreement flag
   catches it", `extract.ts`, extraction-speed.md) is **not what the code does**:
   a unit or range the primary gets wrong passes silently with any pair, and
   every high/low flag comes from the primary's range alone. *Test (free):* a
   reconcile unit test with differing units/ranges; then `tests/bench/pair_fields.ts` over the
   stored bench reads counting unit/range disagreements per pair. *Fix:* compare
   `canonicalizeUnit` and parsed range low/high, separate reason. **R2.**
2. **Agreement does not lower doubt.** `review.ts:79` withholds an out-of-range
   value whose ×10/×0.1 lands in range ("ověřit desetinnou čárku") even when two
   independent readers agreed on it — an agreed ALT 1,2 µkat/l or CRP 25 drops
   out of the trend. *Test (free):* unit test on `reviewOf`. **R2.**
3. **`isPrintedOnPage` is too weak and switches the decimal check off.** It is a
   substring search over the whole page's glued cells ("4,4" passes on "4,45").
   *Fix:* whole-cell match on the row at the repaired `rowIndex`. *Test (free):*
   fixture with a dropped digit. **R2.**
4. **Harmless formatting counts as disagreement** (`"<1,0"` vs `"< 1,0"`,
   `negativní`/`Negativní`): extra review rows for nothing. *Test (free).* **R2.**
5. **Name-variant pairing breaks** (`B_Neutrofily %` vs `B_Neutrofily - relativně`
   become two "only one reader" rows); on the text path both carry the same
   `row_index`, which is the better key. *Test (free).* **R2.**
6. **Sonnet 5.5 / Haiku 5.5 as readers** — same price / a tenth of the price.
   Must hold UNCAUGHT = 0 and not add review rows. *Paid bench (this round).* **R1.**
7. **Is Sonnet needed for reading at all?** Haiku 5.5 primary with a
   different-vendor second (Gemini) on images, Sonnet 5.5 second on text. The
   evidence in `gemini.ts` says same-vendor pairs on photos leave uncaught
   rows — Haiku+Sonnet on photos must be judged on exactly that. *Paid bench.* **R1.**
8. **A truncated or declined read passed as a short page.** `extractPage*` read
   the tool input whatever the `stop_reason`; a `max_tokens` cut gave a partial
   row list counted as a full read. *Fixed this round* (`UnusableReplyError`:
   the reader fails, billed, and the page shows unconfirmed). Test: stubbed.
9. **The text reader re-types cells the client already holds.** Returning the row
   index plus which cell is value/unit/range would cut output tokens (= latency
   and most of the cost) and make provenance exact. The earlier column-map (A9)
   lost rows on ragged rows — a per-row cell index, not a page-wide column map,
   avoids that. *Test:* free over stored text reads (do the returned strings
   equal a cell of row `row_index`?), then a small paid arm. **R3.**
10. **The chat agent re-pays its context every message and every tool round.**
    The patient dataset (≤60k chars) is a second system block *after* the cache
    breakpoint, and tool rounds have no breakpoint on the history. *Fix:* cache
    breakpoint after the context block and top-level auto-caching for rounds.
    *Test:* stubbed request-shape test + `usage.cache_read_input_tokens` on a
    small paid eval. **R2–3.**
11. **The agent may be thinking into a 1,200-token cap.** Sonnet 5 runs adaptive
    thinking when `thinking` is omitted; the loop never checks
    `stop_reason === "max_tokens"`, so a cut answer would stream as complete.
    *Test:* 2–3 eval cases, record stop_reason and thinking tokens. **R2.**
12. **Haiku 4.5 never caches.** Its minimum cacheable prefix is 4,096 tokens; the
    extraction prefix is ~1,200. Haiku 5.5's minimum is 512, so the swap also
    turns caching on. Mapping puts the 344-entry catalog in the uncached user
    turn (~4–5k tokens per batch, every batch). *Fix:* catalog first, cached.
    *Test:* usage fields on the bench / a stubbed shape test. **R2.**
13. **Mapping confidence is the model's own word.** "high" + `canApplyUnasked`
    files a mapping without a human. A calibrated yes/no ("is printed label X
    with unit U and range R the same test as catalog entry Y?") from Jev gives
    a probability with a meaning, for $0.042/1M tokens, label text only.
    *Test:* the BioLAB `truth.json` (on the Mac) or the public sheets' names
    with hand truth; compare Haiku 5.5 vs Jev on wrong-but-high. **R3.**
14. **Unit used to pick among sibling entries** (`Lymfocyty` % vs abs. count) —
    `Registry.match` is name-only. *Test (free):* registry unit test. **R3.**
15. **Advisor tool** — does not fit the reader design: the cross-check needs two
    *independent* reads, and an advisor's advice is encrypted on every pairing
    Sonnet 5.5 / Haiku 5.5 accept (so not auditable), and it adds serial
    latency. Possible fit: the clinical agent (Haiku 5.5 executor, Sonnet 5.5
    advisor) — only if eval shows Haiku alone is short. Low priority.
16. **Batch API** — no interactive path fits (uploads wait on the read). The only
    offline path is re-reading stored reports after a prompt change; not built.

## Log

### Round 1 — 2026-10-19

**Free work done.**
- Prices fixed: Sonnet 5 $3/$15 → $2/$10 in `agent-core/pricing.ts`, the Python
  mirror `tools/pipeline/src/config.py`, bench estimates; added Sonnet 5.5,
  Haiku 5.5, Opus 5.5, Opus 5. Unknown-model fallback now over-counts ($5/$25)
  instead of guessing Sonnet's old rate.
- Model ids configurable: extract Worker `MODEL_PRIMARY` / `MODEL_SECOND` /
  `MODEL_MAP`, agent Worker `AGENT_MODEL`, each allowlisted (a typo falls back
  to the default). Unset = today's models.
- 5.5 request shapes in one place, `packages/extraction/src/models.ts`:
  Sonnet 5.5 / Opus 5.5 get `tool_choice: auto` + `strict: true` + a one-line
  nudge (forced tool is a 400); Sonnet 5.5 gets `thinking: between_tools`
  (`disabled` is a 400); Haiku 5.5 keeps the forced tool (which skips its
  default thinking); nothing sends temperature or a prefill; Haiku 4.5 never
  gets `effort`. Sonnet 5 and Haiku 4.5 requests are byte-identical to before
  (pinned by tests). Used by text reader, image reader, mapping and the bench.
- H8 fixed: a reply cut at `max_tokens`, declined, or without a tool call now
  fails that reader (billed via `billedUsage`) instead of passing as a short page.

**Paid experiment 1 — readers** (`bench:adapt`, synthetic + public, 1 rep,
5 single arms, pairs computed offline from the persisted reads; $1.42).

Image pages (11 public sheets, 261 truth rows; per page mean):

| reader | matched | miss | valERR | mean s | $/page |
|---|---|---|---|---|---|
| Sonnet 5 (deployed) | 201 | 0 | 2 | 18.3 | 0.035 |
| Sonnet 5.5 | 201 | 0 | **0** | **14.4** | 0.034 |
| Haiku 4.5 | 167 | 34 | 2 | 17.4 | 0.015 |
| Haiku 5.5 | 173 | 28 | **0** | **8.0** | **0.0017** |
| Gemini 3.8 Flash ultra (deployed 2nd) | 201 | 0 | 0 | 13.4 | 0.009 |

| pair (primary + second) | confirmed | flagged | UNCAUGHT | caught |
|---|---|---|---|---|
| Sonnet 5 + Gemini (deployed photo) | 199 | 2 | 0 | 2 |
| **Sonnet 5.5 + Gemini** | **201** | **0** | 0 | 0 (nothing to catch) |
| Sonnet 5.5 + Haiku 5.5 | 173 | 56 | 0 | 0 |
| Haiku 5.5 + Gemini / Gemini + Haiku 5.5 | 173 | 56 | 0 | 0 |
| witness: Sonnet 5 + Haiku 5.5 | 171 | 58 | 0 | **2 of 2** |
| witness: Haiku 4.5 + Haiku 5.5 / + Sonnet 5.5 | — | — | 0 | **3 of 3** each |

Text pages (8 synthetic, 52 rows): Sonnet 5.5 and Haiku 4.5 52/52; Sonnet 5
and Haiku 5.5 48/52. Text $/page: Sonnet ~$0.009, Haiku 4.5 $0.005, Haiku 5.5
$0.0004 (small pages). Sonnet 5.5 output tokens equal Sonnet 5's and no thinking
block came back: `between_tools` + auto + strict behaves like the forced call.

What the rows say (judgment, not score):
- **Sonnet 5.5 is a cleaner transcriber than Sonnet 5 at the same price.** Sonnet
  5's two value errors are a decimal *point* rewritten as a comma (`4.00→4,00`,
  Bulovka), its text-path valΔ is the lab's `H` flag cell glued onto the value
  (`396,0000 H`), and it put the section into the name (`Glukóza (sérum)`).
  Sonnet 5.5 did none of these, and was ~20% faster on images.
- **Haiku 5.5 reads values perfectly here (0 value errors, 0 fabrications) at a
  twentieth of Sonnet's price — every one of its 28 misses is a *name* fault:**
  on the two Břeclav pages it folds the abbreviation column into the name
  (`URE urea`, `KM * kyselina močová`) — exactly the D3 fault the prompt sentence
  was added for on Gemini, and Haiku 5.5 ignores it — plus `(sérum)` on the
  mixed-material fixture. The values are right, but the name is what pairs the
  two reads (so 56 rows get flagged) and what maps to the catalog (so as a
  primary those rows would land unmapped). Haiku 4.5, by contrast, misspells
  (`Fosfор` with Cyrillic letters, `S/Chlora`) and read two values off the wrong
  row.
- **Cross-check still catches primary errors after the swap**: every real value
  error in the run (Sonnet 5's 2, Haiku 4.5's 3) disagreed with a 5.5 reader, and
  UNCAUGHT is 0 for every pair. Caveat: 11 pages; the 133-page photo run in
  lab-adaptability.md found same-vendor pairs leave a few uncaught rows, so
  Sonnet+Haiku on photos stays unproven at scale.
- **H1 measured (free, `tests/bench/pair_fields.ts` over the stored reads):** no primary made a
  unit error vs truth; the only range "errors" were urine drug-screen notes the
  truth leaves blank (out of scope). So the value-only cross-check is not
  hurting on this corpus — it is a latent gap, R2 adds the comparison anyway
  because the cost is one function.
- **H12 confirmed:** Haiku 4.5 cached 0 tokens all run (4,096 minimum); Haiku
  5.5 read ~1,385 cached tokens on every call after the first.

**Paid experiment 2 — chat agent** (`npm run eval`, 19 runnable cases; $1.15).

| model | reps | result | $ per full pass |
|---|---|---|---|
| Sonnet 5 (deployed) | 1 | 19/19 PASS | 0.33 |
| Sonnet 5.5 (adaptive thinking, default effort) | 2 | 17 PASS, 2 FLAKY (`absent_analyte`: no "not measured" wording; `clinician_addressed`: did not name the doctor) | 0.40 |
| Haiku 5.5 | 1 | 19/19 PASS | **0.019** |

Judgment: one rep is a smoke test, not a verdict, and these cases check wording
by regex — the answers themselves were not stored, so they must be read before
anything is decided (R2: `EVAL_DUMP=1`, 3 reps on Haiku 5.5 and Sonnet 5.5).
Haiku 5.5 is the surprise: all cases at ~1/17 of the cost.

**Decision for round 1:** nothing deployed; all swaps are vars. Recommended
config to try first (Ondřej's call): text path `MODEL_PRIMARY=claude-sonnet-5-5`,
`MODEL_SECOND=claude-haiku-5-5` (cost per text page ~$0.04 → ~$0.026, the
second reader becomes nearly free and starts caching); photo path keep Gemini
second and set the primary to Sonnet 5.5. Not yet: Haiku 5.5 as primary (name
folding), Haiku 5.5 as photo second (same-vendor, 11 pages only), Haiku 5.5 for
chat (one rep).

### Round 2 — proposed

1. Free fixes from H2–H5 (agreement lowers doubt, whole-cell printed check,
   formatting-tolerant value compare, pair by `row_index` on the text path) and
   H1's unit/range comparison — each with a failing test first.
2. Name fold (the Haiku 5.5 blocker): a general rule, not a Haiku patch — a
   leading all-caps code token (`URE urea`, `KM * …`) as a second registry key
   like the trailing `[MCV]`, and pairing that falls back to value+unit when
   names differ. Parity cases in Python. Then re-score the stored reads (free):
   if Haiku 5.5 + Gemini goes to ~0 flagged, Haiku 5.5 as primary is back on
   the table (photo page ~$0.044 → ~$0.011).
3. Agent: `EVAL_DUMP=1`, 3 reps, Haiku 5.5 and Sonnet 5.5 (~$1.3); read the
   answers. Add the cache breakpoint after the context block (H10) and a
   `max_tokens` check (H11) first, so the run measures them too.
4. Jev (H13): only once a mapping truth set is on this server (BioLAB
   `truth.json` lives on the Mac) — or build one from the public sheets' 261
   names (hand truth exists for their values, not their catalog ids).

## Spend ledger

| Date | Command | Models | $ actual | Running total |
|---|---|---|---|---|
| 2026-10-19 | smoke: `vite-node /tmp/…/smoke.ts` (1 tiny text page each) | Sonnet 5.5, Haiku 5.5 | 0.008 | 0.008 |
| 2026-10-19 | `with-secrets bloodwork -- env BENCH_MAX_USD=3.0 PYTHON_BIN=.venv/bin/python BENCH_CLASSES=synthetic,public BENCH_ARMS=sonnet5,haiku45,sonnet55,haiku55,gemini38_ultra npm run bench:adapt` | Sonnet 5, Sonnet 5.5, Haiku 4.5, Haiku 5.5, Gemini 3.8 Flash | 1.415 | 1.423 |
| 2026-10-19 | re-score with new pairs (persisted, no calls) | — | 0.000 | 1.423 |
| 2026-10-19 | `with-secrets bloodwork -- env EVAL_MAX_USD=0.9 EVAL_MODEL=claude-sonnet-5 EVAL_REPS=1 npm run eval` | Sonnet 5 | 0.328 | 1.751 |
| 2026-10-19 | same, `EVAL_MODEL=claude-sonnet-5-5 EVAL_REPS=2` | Sonnet 5.5 | 0.802 | 2.553 |
| 2026-10-19 | same, `EVAL_MODEL=claude-haiku-5-5 EVAL_REPS=1` | Haiku 5.5 | 0.019 | **2.572** |

Round 1: $2.57 of $3.50. Loop: $2.57 of $10. Keys from `bloodwork.env`
(shared with Klugscheisser/jobscan). Bench costs are priced with the corrected
table (Sonnet $2/$10).
