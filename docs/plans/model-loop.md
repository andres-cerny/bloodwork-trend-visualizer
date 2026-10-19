# The model-pipeline loop — playbook, log, ledger

A loop of rounds that makes the model side of **Moje krev** (apps/portal +
workers/portal + workers/portal-extract: upload → readers → mapping →
flags/verification) better and, where it holds, cheaper. No UI work. Branch
`claude/model-pipeline-loop`; the orchestrator opens the PR.

**Scope (Ondřej, 2026-10-19, during round 2):** Moje krev has no chat. The chat
agent (apps/chat, apps/bloodwork's chat panel, workers/agent) is out of scope;
the round-1/2 chat findings below are kept as notes only, and the round-2
agent changes (context caching, max_tokens check) are parked on branch
`claude/agent-cache-parked`, not on this one.

## Summary — what to flip, in which order, how to roll back (after round 3)

Everything below is a **setting** on `moje-krev-extract`
(`workers/portal-extract/wrangler.jsonc` → `vars`). The code on this branch
reads the settings, and with none of them set it behaves exactly as today. To
roll back, delete the line and deploy again.

| order | setting | what it does | evidence | effect |
|---|---|---|---|---|
| 0 | (merge this branch) | prices right; cross-check also compares unit and range; formatting is no longer a disagreement; differently-named rows pair; glued lab codes (`URE urea`, `FE železo`) map; a punctate (`X_`) no longer files as blood; more ranges parse; a cut-off or declined read fails honestly; mapping catalog cached | tests; re-scored stored reads | photos (today's Sonnet 5 + Gemini pair): rows asked about 53 → 9 on the public sheets, 0 uncaught |
| 1 | `MODEL_MAP: "claude-haiku-5-5"` | mapping fallback on Haiku 5.5 | 43-name truth set: 0 wrong filed, same as Haiku 4.5 | a tenth of the mapping cost |
| 2 | `TEXT_READERS: "cheap"` + `MODEL_SECOND: "claude-haiku-5-5"` | born-digital pages read once, by Haiku 5.5; interpret.ts's checks stand in for reader 2 | 12 pages: 210/213 rows, 0 uncaught, like the deployed pair | 3-page upload ~$0.17 → ~$0.006; ~24 s → ~10 s a page |
| 3 | `MODEL_PRIMARY: "claude-haiku-5-5"` (Gemini stays second) | photos read first by Haiku 5.5 | 11 sheets × 2 reps: 0 uncaught, rows asked about equal to Sonnet 5.5 + Gemini | photo page ~$0.044 → ~$0.011 |
| 3′ | or `MODEL_PRIMARY: "claude-sonnet-5-5"` | a safer photo step: same price as today, a cleaner copier than Sonnet 5 | R1: 0 value errors vs Sonnet 5's 2 | ~20% faster |

| 4 | `VITE_SHARE_AI_MAPPINGS=1` (portal build) | the model's confident filings (catalog + high + unit check) teach every account, revocable by the account that taught them | 0 confident wrong in 495 names (round 3) | the same new name never reaches the model twice |

Not a switch yet: unrecognised parameters getting their own trend.
`buildTrends` can do it, but Trendy has to show it — see "Mapping design".

Steps 2 and 3 should first pass the Mac check
([model-loop-mac-check.md](model-loop-mac-check.md): free re-scoring plus about
$0.35–1.50 of new reads). Step 1 and step 3′ are low-risk without it.
`MODEL_PRIMARY` moves the first reader on both paths; with step 2 in place the
text path uses only the second slot, so the steps do not collide. Not
recommended: Jev in the mapping gate (no gain on the test set), and changing
the triage model (GLM 5.3 Flash is free and off the user's path), and
Haiku-first mapping (0 confident errors in 495 names, but more unknowns than
the table, a wait on every upload, and no gain the table does not already
give — see round 3).

## Mapping design (Ondřej's decision, round 3) — today vs after

**Rule:** the list first. A name the list does not know goes to Haiku 5.5. A
confident Haiku answer whose unit checks out is **saved as an alias**, so the
same name never goes to the model twice. Anything less is asked of the person,
and their answer is saved. A person's correction always wins, and every saved
alias can be withdrawn.

| step | today (Moje krev, verified in code) | after (this branch, switches default off) | still to build |
|---|---|---|---|
| 1. list | shipped synonyms (`registry.json`, 344 entries / ~4,100 names) + shared `synonyms` (D1, taught by a person's click onto a shipped entry, keyed by printed name only) + the account's `learned`. Exact key after `normKey`, plus the trailing `[ABBR]`; material checked | + glued codes (`URE urea`, `FE železo`, guarded), + `x` (punctate) refused as blood | key shared aliases by **(lab, printed name, unit)**, not name alone, so a name means one thing per lab |
| 2. model | Haiku 4.5, automatic after every upload and once on load, for unmapped names that can trend; catalog id must exist (`toSuggestions` refuses invented ids — in effect an enum) | `MODEL_MAP=claude-haiku-5-5`; catalog sent as a cached block | — |
| 3. save | every answer per account (`settings.aiAsked`, never asked again); `catalog`+`high`+`canApplyUnasked` (unit known to agree, nothing contradicting) filed **for this account only**; the rest waits for a click, and a click onto a shipped entry teaches every account | `VITE_SHARE_AI_MAPPINGS=1` (build-time, off): the same confident filings onto shipped entries are also taught to every account, under the account that triggered them (so revocable by it, like a click) | mark shared rows as model-taught (column `source`, migration + `check:schema`) so Ondřej can list and revoke them in one place; one in-flight guard so two accounts don't ask for the same new name at once |
| 4. not in the catalog | the row is stored and flagged, but **left out of every trend**; Trendy shows "N parametrů se nezobrazuje"; Haiku's `new` proposal pre-fills the founding form; a founded parameter is per account | `buildTrends(..., { unrecognised: true })` (lab-core, off): such rows get their own series keyed `unrecognisedKey(lab, name, unit)`, marked `recognised: false` | wire it in Trendy ("zatím nerozpoznaný parametr"); a review queue (D1 `draft_entries`: Haiku's proposed Czech name, unit, group, printed range as the range source) that Ondřej approves into `seed_registry.py`; on approval, the unrecognised series' readings remap to the new id (the same `rematchReport` path a new synonym already uses) |

Why not Haiku-first (measured in round 3): it made 0 confident errors in 495
names, but more "unknown"s than the list, 6.7% of its answers flip between runs,
and it adds a model wait to every upload. The table *is* the stored-decision
store a Haiku-first design would need. The place to use Haiku more is a
**second opinion on weak list matches** (unit not the entry's, or an unknown
material — 9% of the list's matches on the public sheets, where its real errors
were). Next step, behind a switch.

**Standard codes (NČLP/LOINC):** handled by a separate effort on branch
`claude/lab-codes` (`packages/lab-core/codes/`, `docs/plans/lab-codes.md`),
to be merged into this branch later; no code table is built here. This loop's
saved decisions stay keyed by **catalog id** (the `synonyms` row's
`canonical_id`, the account's `learned`/`aiAsked`), so a code attaches
through the catalog entry once lab-codes lands. If a row ever needs its own
code, there is room for a `code` column beside `canonical_id`. Two
constraints carry over to that work:
- Haiku never writes a code from memory; it picks from a list the table
  provides, and the unit/specimen check validates the pick.
- None of the public sheets prints NČLP codes (Stod's text layer checked).

**Other languages (not a priority, a few lines):** Czech-specific today:
- reader prompts (`packages/extraction/src/extract.ts`, `map.ts`);
- decimal comma and range words (`lab-core/src/normalize.ts` + Python twin);
- specimen prefixes and material codes (`normalize.ts` `MATERIAL_CODES`);
- unit spellings (`canonicalizeUnit`);
- `NOT_A_UNIT` and qualitative word lists (`normalize.ts`, `candidates.ts`,
  `correction.ts`);
- the catalog's `displayNameCs`;
- all UI copy.

Rules, not a model, for the number, range and prefix formats; the model
already reads any language. The code touched in this loop keeps those bits in
the files above rather than adding new places.

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

## Inventory — Moje krev's model calls (re-done round 2, 2026-10-19)

Prices: Anthropic first-party list, $/1M in/out. Sonnet 5 and 5.5 $2/$10,
Haiku 4.5 $1/$5, Haiku 5.5 $0.10/$0.50 (≤100K prompt), Opus 5.5 $4/$20,
Gemini 3.8 Flash $0.75/$3.75 (doubles 2027-01-01).

| # | Call | Where | Model (as configured) | Per upload | ≈ cost, measured |
|---|---|---|---|---|---|
| 1 | Text page, reader 1 | moje-krev-extract → `extractPageText` | Sonnet 5 | every born-digital page | $0.03–0.04 / dense page (Stod) |
| 2 | Text page, reader 2 | same | Haiku 4.5 — **`TEXT_READERS` is unset, so both readers run**; `interpret.ts`'s comment said "Haiku alone" and was wrong (fixed) | every born-digital page | $0.016–0.023 / dense page |
| 3 | Photo/scan page, reader 1 | `extractPage` | Sonnet 5 | every image page | ~$0.035 |
| 4 | Photo/scan page, reader 2 | `extractPageGemini` (`PHOTO_READERS=sonnet+gemini`) | Gemini 3.8 Flash ultra_high | every image page | ~$0.009 |
| 5 | Mapping fallback | `POST /api/map` (portal proxies to extract), `aiMapping.ts` runs it after every upload and once on load for names the catalog left null | Haiku 4.5, batches of 30, forced tool; the 344-entry catalog was in the **uncached** part of the turn (fixed: cached block) | new lab only | ~$0.005 / 43 names on Haiku 5.5 |
| 6 | Help-desk / ops triage | `workers/portal/src/triage.ts` | Workers AI `@cf/zai-org/glm-5.3-flash`, thinking off, JSON schema, ≤600 tokens | per help-desk message or ops alert, not per upload | free tier (10k neurons/day; a triage is a few hundred) |
| — | `/api/synonyms`, `/api/ai-share` | D1 / stored page | no model | — | — |

**A typical Moje krev upload today** (3-page born-digital report): 3 × ~$0.06
≈ **$0.17** at Stod density (round 1's estimate of $0.12 was on lighter
pages), about 25 s per page. A photographed page ≈ **$0.044**. A new lab adds
mapping (cents). The ledgers priced Sonnet 5 at $3/$15 until round 1, so every
recorded Sonnet number overstated it by 50%.

Out of scope (chat, kept for reference): bloodwork chat and clinical agent
(`packages/agent/core/src/loop.ts`, Sonnet 5, ~$0.29 per 19-case eval pass).

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

**Re-ranked for Moje krev (round 2).** Status in brackets; numbers refer to the
list below.
1. Text path: is the second reader still needed, and on which model? H6/H7 →
   **measured round 2: Haiku 5.5 alone + interpret's checks = the two-reader
   result at ~1/30 of the cost.** Ondřej's decision.
2. Cross-check correctness on photos (two readers stay there): H1–H5 [done R2].
3. Glued abbreviation names (`URE urea`) on Břeclav-style sheets [done R2].
4. Photo path primary: Sonnet 5.5 vs Haiku 5.5 with Gemini second [measured
   R1–R2 on 11 pages; needs the Mac's 133-photo corpus].
5. Mapping: Haiku 4.5 → 5.5 via `MODEL_MAP`, catalog cached (H12) [done R2];
   Jev as the gate (H13) [measured R2: not worth a new vendor yet].
6. Triage (GLM 5.3 Flash): free, ops-only, not on a user's path — low priority.
7. H9 (cell indices instead of re-typed cells) [tested R3, free: feasible but
   ~6 tokens a row; not pursued].
8. Range-parsing gaps (sex prefixes, unit tails) [done R3].
H10/H11 (chat) are out of scope.


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

### Round 2 — 2026-10-19

**1. Cross-check fixes (free, tests first: `lab-core/tests/crosscheck.test.ts`).**
- H1: `reconcile` now compares unit (`canonicalizeUnit`, spacing/case off) and
  the printed interval (parsed low/high, only when both parse) once the values
  agree. New facts `UNIT_DIFFERS` / `RANGE_DIFFERS` (no colon, so review.ts does
  not split "mmol/l" on its slash); the row is "unconfirmed" with the generic
  ask. Value disagreement keeps precedence.
- H4: value compare ignores spacing, case and `!*↑↓` (`< 1,0` = `<1,0`,
  `Negativní` = `negativní`); the censor sign and digits still count.
- H5 + the glued-abbreviation pairing: rows the name key left apart pair when
  each side is an orphan from a different reader and either carries the same
  `row_index` (text path) or the same value+unit with exactly one candidate on
  each side. Ambiguity leaves both rows flagged. The primary's row (and name) is kept.
- H2: a suspected decimal slip on a row two readers *agreed* on is
  "unconfirmed" (plotted, marked), not "withheld". An impossible value stays
  withheld.
- H3: `isPrintedOnRow` — whole cell (or 2-3 adjacent cells, pdf.js splits
  "<"|"1,0") of the repaired row, markers/spacing ignored. Portal's
  `printedOnPage` (which switches the decimal check off) now uses it;
  `isPrintedOnPage` stays the looser fabrication check.
- Glued code as a catalog key: `leadingCodeKey` ("URE urea" → "urea", "KM *
  kyselina močová" → "kyselina mocova"), third key after the full name and the
  trailing `[ABBR]`; only when the code's first letter starts the long name, so
  "HDL cholesterol" never becomes "cholesterol". Python twin in
  `matching.py`, 11 parity cases (178 pass on both sides).

**Re-scored the stored reads through the app's own `reconcile` + `reviewOf`**
(`tests/bench/reconcile_pairs.ts`, free; the bench's `pairStats` pairs by its
own rules and cannot see a reconcile change). 13 image pages + 8 text pages:

| pair | rows asked about, before → after | UNCAUGHT | unmapped |
|---|---|---|---|
| Sonnet 5 + Gemini (deployed photo) | 53 → 9 | 2* | 91 → 68 |
| Sonnet 5.5 + Gemini | 51 → 7 | 0 | 89 → 66 |
| **Haiku 5.5 + Gemini** | **107 → 7** | 0 | 107 → 70 |
| Sonnet 5.5 + Haiku 5.5 | 71 → 7 | 0 | 92 → 71 |
| Sonnet 5 + Haiku 4.5 (deployed text) | 83 → 29 | 2* | 102 → 80 |

\* Sonnet 5 wrote "4.00" as "4,00" — the same number, so harmless, but a sign it
rewrites what it copies. The 7 left are agreed out-of-range values now asked
about instead of withheld (H2). "Unmapped" is mostly tests the catalog lacks
(blood gases, drug levels, urine); Haiku-first is 4 worse than Sonnet-first
(`FE železo`, `TRFSAT Saturace…` — the code's letter does not start the name,
so the safe rule does not fire).

**Paid: Haiku 5.5 + Gemini, second repetition** on the 11 public sheets
($0.13). Haiku 5.5: 0 value errors again, 186/201 matched; it glued the code
on one Břeclav page this time (two last time — intermittent). Through the app's
reconcile: 208 ok, 8 asked, 0 uncaught. **So on photos, Haiku 5.5 first +
Gemini second now equals Sonnet 5.5 + Gemini on this corpus, at ~$0.011 vs
~$0.043 a page.** Caveat unchanged: 11 pages, two reps; the 133-photo corpus
on the Mac is the real test.

**3. Agent — OUT OF SCOPE (course correction mid-round: Moje krev has no
chat). Kept as notes; the code is parked on `claude/agent-cache-parked`, and
the $0.95 below was spent before the correction.** Patient-data block now cached (second breakpoint) and tool rounds
auto-cached (top-level `cache_control`); a reply cut at `max_tokens` now emits
an error ("Odpověď se nevešla…") and `done.stopReason`, and the eval fails it.
Eval with answers dumped (`EVAL_DUMP=1`, 19 runnable cases):

| model | reps | result | $ per full pass | out tokens/answer |
|---|---|---|---|---|
| Sonnet 5 (deployed) | 1 | 19/19 | 0.289 (was 0.328 before caching) | ~570 |
| Sonnet 5.5 | 2 | 18/19 + 1 grader false negative | 0.306 (was 0.40) | ~740 |
| Haiku 5.5 | 3 | 54/57; 3 cut at max_tokens | **0.018** | ~1,000 (incl. thinking) |

Caching works: ~95% of input tokens are now cache reads on every model.
Reading the answers (not the verdicts):
- Sonnet 5.5's one fail is the grader: "Prokalcitonin se … nevyskytuje" is the
  right answer; the case now accepts "nevyskyt".
- **Where Haiku 5.5 falls short, concretely:** (a) on the broadest questions
  (summarise one patient — `identity_unique`; "what changed" — `tools_changes`)
  it lists every analyte and, with its default thinking spending the same
  2,000-token budget, was cut mid-list in 3 of 6 runs (the new check caught
  this; before it would have streamed as complete); (b) occasional clumsy
  Czech ("ať jde o jakoukoli hodnotu příznaku mimo rozmezí"); (c) a missing
  space where text from two tool rounds joins ("reference.V dokumentaci").
  It was right on every number, cited sources, refused nothing it should
  answer, asked which Michal Novák, and quoted documents' conclusions as the
  document's. Its answers are as long as Sonnet 5.5's; its token count is
  higher because it thinks.
- Fix to try before deciding: Haiku at effort `low` and/or `maxTokens` 3,000
  for `clinical`, then 3 reps again (~$0.06).

**4. Jev on the mapping gate** (`tests/bench/map_gate.ts`,
`map_gate_truth.json`: 43 printed names from the public sheets the catalog
misses, hand-labelled, label/unit/range text only; $0.01 for two runs).
- Haiku 5.5 as the mapper: no wrong mapping filed by any gate (after I fixed
  one of *my* labels — the Coombs test is in the catalog as `pat`, Haiku was
  right). Current gate (high + `canApplyUnasked`) filed 18 of 31 mappable names.
- Jev's calibration on truth vs hand-picked near misses: AUC 0.98. Its misses
  are the instructive part: ionised Ca → total Ca p=0.92 (wrong, high), INR ↔ PT
  ratio p≈0.6, MCV → MPV 0.51; and it under-rates right answers on odd labels
  (`S_GF_MDRD 6` → eGFR MDRD 0.25, hs-troponin I 0.40).
- Judgment: on this set Jev would not stop a wrong filing the current gate lets
  through (there was none), and as the sole gate at 0.9 it would have accepted
  ionised → total calcium had the model proposed it. **Not worth a new vendor in
  the Worker now.** Revisit only with a larger truth set where the model's
  "high" is actually wrong sometimes (the BioLAB file).

**5. Moje krev's text path, end to end** (`tests/bench/portal_text.ts`: the
extract call, then `apps/portal/src/lib/interpret.ts` and `reviewOf`, scored
against hand truth; 8 synthetic text pages + the Stod sheet's 4 results pages —
the only public sheet with a text layer, dense real-lab pages; $0.38):

| config | truth rows found (of 213) | asked | UNCAUGHT | $ / Stod page | s / Stod page |
|---|---|---|---|---|---|
| Sonnet 5 + Haiku 4.5 (**deployed**) | 210 | 4 | 0 | ~0.06 | ~24 |
| Haiku 4.5 alone (`TEXT_READERS=cheap`) | 208 | 1 | 0 | ~0.020 | ~24 |
| Sonnet 5.5 + Haiku 5.5 | 210 | 0 | 0 | ~0.04 | ~20 |
| Sonnet 5.5 alone | 210 | 0 | 0 | ~0.037 | ~20 |
| **Haiku 5.5 alone** | **210** | 3 | **0** | **~0.002** | **~10** |

The 3 rows every config "misses" are not results (patient height/weight, which
the prompt excludes on purpose, and the `ABR arter.` heading). Haiku 4.5 alone
lost two hematology rows (`B_Hemoglobin HGB`); Haiku 5.5 alone lost none. So on
the text path Haiku 5.5 alone, with interpret's three checks, matches the
deployed two-reader result at about **1/30 of the cost and twice the speed**.
Caveat: 12 pages, one rep; the 33-page real corpus on the Mac is the proper
test (round 1 of extraction-speed.md found the same for Haiku 4.5 there).

**6. Mapping catalog cached.** `/api/map` now sends the 344-entry catalog as
its own cached block before the names (`mapContent`); answers unchanged on the
map-gate set (18 filed, 0 wrong). The two 30-name batches go out in parallel,
so each writes the cache; reads come from the next upload within 5 minutes.

**Decision for round 2:** all fixes are deterministic and on this branch; no
config changes. For Ondřej (config only, all reversible on moje-krev-extract):
- text path: `TEXT_READERS=cheap` + `MODEL_SECOND=claude-haiku-5-5`
  (Haiku 5.5 alone) — a 3-page upload from ~$0.17 to ~$0.006, ~10 s a page;
  or, keeping two readers, `MODEL_PRIMARY=claude-sonnet-5-5` +
  `MODEL_SECOND=claude-haiku-5-5` (~$0.12, no review rows on this set);
- photos: keep Gemini second; `MODEL_PRIMARY=claude-sonnet-5-5` is safe today;
  Haiku 5.5 first waits for the Mac corpus. (Note `MODEL_PRIMARY` moves the
  primary on both paths.)
- mapping: `MODEL_MAP=claude-haiku-5-5` (a tenth of the price, same answers
  here).
- triage: leave GLM 5.3 Flash; it is free and off the user's path.

### Round 3 — 2026-10-19

**H9, cell positions instead of re-typed cells — tested free, not pursued.**
`tests/bench/cell_index_check.ts` over the 210 stored text-path rows of each
reader (synthetic + Stod):
- value: one whole cell of its row in 209–210 of 210;
- unit: one whole cell, or correctly empty, in all of them;
- range: one cell in ~160, empty in ~45, and two cells only for printed
  `od`/`do` columns (3 rows).

So the schema change is feasible. But the typed value+unit+range is only ~1,200
tokens over all 210 rows, about 6 per row, against ~3,400 output tokens for one
dense page. Most of what a reader writes is the JSON keys, the name and
`confidence`, not those cells. At Haiku 5.5's price ($0.002 a page) the saving
is cents per thousand uploads and a few seconds. Round 1's A9 column map also
showed that rebuilding rows from indices is where rows get lost. **Judgment:
not clearly better, so no paid run.** If latency ever matters, the bigger
lever is shorter keys and dropping `confidence` on the text path, measured
the same way.

**Ranges the parser could not read** (TS + Python, 9 new parity cases, 187 pass
on both sides):
- a count unit after the interval: `1,5-4,0 10^9/l`, `4,0 - 10,0 10˄9/l`.
  These were text, so every such row's flag was "unknown";
- one population label in front: `M: 30 - 400`, `muži 30 - 400`,
  `Ž: 13-150`, `dospělí: 0,5 - 1,2`, `muži: < 5,0`.
- Still text, on purpose: `M: 30-400 Ž: 15-150` (two intervals; which one
  applies needs the person's sex) and `M 30 - 400` (a one-letter label needs
  its colon).

**Glued code, widened.** A code whose letter does not start the name
(`FE železo`) now maps when the code *and* the name each resolve to the same
catalog entry. `HDL cholesterol` (two different entries) and an unknown code
(`TRFSAT Saturace…`, `XYZ železo`) are still refused. Both sides
(`registry.ts`, `matching.py`), with tests. On the stored public reads,
Haiku-first unmapped rows go 70 → 67 (Sonnet-first: 66). The rest is
vocabulary the catalog lacks: plain "Bilirubin", "S_Bilirubin" and blood gases
— a seed_registry.py job, not a rule.

**Haiku-first mapping — evaluated (Ondřej's idea), not built.** The question:
should Haiku 5.5 decide every printed name → catalog entry, with aliases as
prompt hints and decisions stored per (lab, name, unit), instead of only the
names the alias table misses? `tests/bench/map_first.ts`, 495 names, one run on
Haiku 5.5 ($0.05, 17 parallel batches of 30, 12 s):

| set | names | right | unknown | wrong, "high" | wrong, medium/low |
|---|---|---|---|---|---|
| held-out catalog synonyms (model sees id/name/unit, no synonyms), weighted to look-alikes | 297 | 274 | 22 | **0** | 1 |
| negatives (U_ specimen, tests the catalog lacks) | 11 | 11 | 0 | 0 | 0 |
| public-sheet names the table matched | 144 | 132 | 10 | **0** | 2 |
| public-sheet names the table missed | 43 | 39 | 4 | 0 | 0 |

- **Haiku never mapped a look-alike with confidence.** Ionised vs total vs
  corrected calcium, HDL vs total vs non-HDL cholesterol, % vs absolute counts,
  T3/T4 total vs free, PSA vs free PSA, and U_ names: all either right or
  "unknown". Its misses are caution, not errors: about 7% unknown, including
  names the table already knows (`S-TSH`, `B-HbA1c`, `ferritin` in ng/ml), so
  Haiku-first would *add* human asks.
- **Where Haiku disagreed with the table, the table was wrong.** The table is
  unit- and specimen-blind (H14):
  - `X_glukóza`, `X_LD`, `X_Celková bílkovina` are a punctate, filed under the
    blood entries (and into the blood glucose trend);
  - `Glukóza [arb.j.]` is a urine strip;
  - `P_Protrombinový test [s]` was mapped to Quick (%);
  - `P_Antitrombin III [mg/L]` was mapped to a % entry;
  - `B-HbA1c [%]` was mapped to the mmol/mol entry.

  The X_ case is fixed here: `x` is now a material code (punctate, TS + Python,
  parity), so the registry refuses it and Haiku is asked. The unit-blind cases
  are 13 of the table's 144 matches (9%), most of them harmless spellings
  (`G/l`, `T/l`, `1/1`).
- **Cost and latency of Haiku-first:** ~$0.003 per 30 names, and a page's names
  can be decided in one parallel round (~6–12 s). That is cheap, but it adds a
  model wait to every upload. And consistency then rests on the stored
  decisions — which is exactly what the alias table already is.

**Repeat stability** (`MAP_FIRST_RUNS=3`, the same 492 names three times,
$0.08):
- the answer differed on **33 of 492 (6.7%)**;
- **only 1** of those flipped between two catalog ids: `P_Trombinový test [s]`,
  thrombin time vs prothrombin time, at low/medium confidence;
- the other 32 flipped between an id and "unknown"/"new". Several had a "high"
  in one run (DHEA, cholinesterase, transferrin `IT`), so whether a name is
  filed *without a human* is run-dependent.

Consistency therefore cannot come from the model. Haiku 5.5 takes no
temperature, and the answer is already restricted: `toSuggestions` refuses any
id not in the catalog, which in effect enforces an enum. An enum of 344 ids
inside the tool schema would only stop a wasted answer. Consistency has to come
from storing the first answer. Moje krev already does that per name
(`settings.aiAsked`), and a confirmed mapping becomes a synonym. A Haiku-first
design would need the same store keyed by (lab, name, unit) for *every* name,
which is the alias table again, built from model answers.

**Recommendation:** keep the table first and Haiku for the rest (today), and
add **Haiku as a second opinion only on weak table matches** — the row's unit
is neither the entry's unit nor a known conversion, or the prefix is a material
the entry does not have. That is about 9% of matches, it is where this set's
real errors were, and it needs no stored-decision store. Nothing was built
behind a switch: the evaluation argues against Haiku-first, and the
second-opinion gate is the next step if the loop continues (it touches
`aiMapping.ts`'s flow). The held-out result (92% recovered, 0 confident wrong)
also backs `MODEL_MAP=claude-haiku-5-5`.

**Mac check written:** [model-loop-mac-check.md](model-loop-mac-check.md). It
has six copy-paste lines, go criteria and costs; free re-scoring wherever reads
are already on disk. `portal_text.ts` gained `PORTAL_TEXT_CLASSES=real` and
`PORTAL_TEXT_CONFIGS` for it.

Also built (switches default off, tests): unrecognised parameters get their own
series (`buildTrends` `opts.unrecognised`, `unrecognisedKey`), and confident AI
mappings can be shared with every account (`VITE_SHARE_AI_MAPPINGS=1`,
`sharedLessons`). See "Mapping design" at the top.

Round 3 spend: $0.13 (the Haiku-first evaluation and its repeat-stability runs).

### Next, if the loop continues
1. Ondřej runs the Mac check; the result goes here, then the settings in the summary.
1b. Mapping: Haiku as a second opinion on weak table matches (unit not the
   entry's, unknown material) — behind a switch, default off.
2. Vocabulary: plain "Bilirubin"/"S_Bilirubin" → total bilirubin and similar
   gaps the public sheets showed (seed_registry.py, regenerate both
   registry.json copies, zero-diff check).
3. Text-path output trimming (shorter keys, no `confidence`), only if speed matters.

## Spend ledger

| Date | Command | Models | $ actual | Running total |
|---|---|---|---|---|
| 2026-10-19 | smoke: `vite-node /tmp/…/smoke.ts` (1 tiny text page each) | Sonnet 5.5, Haiku 5.5 | 0.008 | 0.008 |
| 2026-10-19 | `with-secrets bloodwork -- env BENCH_MAX_USD=3.0 PYTHON_BIN=.venv/bin/python BENCH_CLASSES=synthetic,public BENCH_ARMS=sonnet5,haiku45,sonnet55,haiku55,gemini38_ultra npm run bench:adapt` | Sonnet 5, Sonnet 5.5, Haiku 4.5, Haiku 5.5, Gemini 3.8 Flash | 1.415 | 1.423 |
| 2026-10-19 | re-score with new pairs (persisted, no calls) | — | 0.000 | 1.423 |
| 2026-10-19 | `with-secrets bloodwork -- env EVAL_MAX_USD=0.9 EVAL_MODEL=claude-sonnet-5 EVAL_REPS=1 npm run eval` | Sonnet 5 | 0.328 | 1.751 |
| 2026-10-19 | same, `EVAL_MODEL=claude-sonnet-5-5 EVAL_REPS=2` | Sonnet 5.5 | 0.802 | 2.553 |
| 2026-10-19 | same, `EVAL_MODEL=claude-haiku-5-5 EVAL_REPS=1` | Haiku 5.5 | 0.019 | **2.572** |

| 2026-10-19 | `with-secrets bloodwork -- env BENCH_FRESH=1 BENCH_MAX_USD=0.4 PYTHON_BIN=.venv/bin/python BENCH_CLASSES=public BENCH_ARMS=haiku55,gemini38_ultra npm run bench:adapt` (rep 2; rep 1 kept in `results/adapt_rep1`) | Haiku 5.5, Gemini 3.8 Flash | 0.131 | 2.703 |
| 2026-10-19 | `with-secrets bloodwork -- npx vite-node --root . tests/bench/map_gate.ts` ×2 | Haiku 5.5, Jev | 0.010 | 2.713 |
| 2026-10-19 | `with-secrets bloodwork -- env EVAL_DUMP=1 EVAL_MAX_USD=0.3 EVAL_MODEL=claude-haiku-5-5 EVAL_REPS=3 EVAL_LABEL=r2_haiku55 npm run eval` | Haiku 5.5 | 0.053 | 2.766 |
| 2026-10-19 | same, `EVAL_MODEL=claude-sonnet-5-5 EVAL_REPS=2` | Sonnet 5.5 | 0.613 | 3.379 |
| 2026-10-19 | same, `EVAL_MODEL=claude-sonnet-5 EVAL_REPS=1` | Sonnet 5 | 0.289 | **3.668** |

| 2026-10-19 | `with-secrets bloodwork -- env PYTHON_BIN=.venv/bin/python PORTAL_TEXT_MAX_USD=0.5 npx vite-node --root . tests/bench/portal_text.ts` | Sonnet 5, Haiku 4.5, Sonnet 5.5, Haiku 5.5 (Stod ×4) | 0.382 | 4.050 |
| 2026-10-19 | `map_gate.ts` again (catalog-cache check) | Haiku 5.5, Jev | 0.006 | **4.056** |

| 2026-10-19 | `with-secrets bloodwork -- npx vite-node --root . tests/bench/map_first.ts` (495 names) | Haiku 5.5 | 0.049 | 4.105 |
| 2026-10-19 | same with `MAP_FIRST_RUNS=3` (492 names ×3, catalog cached) | Haiku 5.5 | 0.084 | **4.189** |

Round 1: $2.57 of $3.50. Round 2: $1.48 of $3.00 (of which $0.95 chat evals,
before the scope correction). Round 3: $0.13 of $2.50. Loop: **$4.19 of $10**. Keys from `bloodwork.env`
(shared with Klugscheisser/jobscan). Bench costs are priced with the corrected
table (Sonnet $2/$10).
