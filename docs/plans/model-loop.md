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

## Summary — what to flip, in which order, how to roll back (after round 7)

**Final recommendation (round 7, every switch run together end to end):**

1. **Merge, then apply the three D1 migrations before deploying the API
   worker:** `2026-10-19-aliases.sql`, `2026-10-20-auto-entries.sql`,
   `2026-10-21-auto-entries-material.sql` (moje-krev-go-live.md).
   `check:schema` confirms them. The merge alone changes no model, only
   deterministic checks and the catalog: 7 entries are split out of
   ambiguous ones, and stored rows move automatically.
2. **`MODEL_MAP=claude-haiku-5-5` + `MAP_MODE=codes-retry`** (moje-krev-extract).
3. **`MODEL_PRIMARY=claude-sonnet-5-5`** (photos; Gemini stays second).
4. **After the Mac check passes:** `TEXT_READERS=cheap` +
   `MODEL_SECOND=claude-haiku-5-5` (text read once by Haiku 5.5), and
   optionally `MODEL_PRIMARY=claude-haiku-5-5` for photos.
5. **Portal build:** `VITE_SHARE_AI_MAPPINGS=1` and `VITE_SECOND_OPINION=1`.
6. **`VITE_AUTO_ENTRIES=1`** — the app now shows an auto-added entry as
   such (branch `claude/mapping-ui`, see "Mapping UI" below).
7. **`VITE_UNRECOGNISED_TRENDS=1`** (portal build): unrecognised readings get
   their own trend in Trendy.

With 2–5 on, the model cost of an upload's mapping and second opinion
measured $0.0003 per page vs $0.0006 off. Reading drops from ~$0.06 to
~$0.002 per text page once step 4 is on.

Each row below is one **setting**: a `vars` entry on `moje-krev-extract`
(`workers/portal-extract/wrangler.jsonc`), or a portal build variable where
the row says so. With none of them set, the code behaves exactly as today. To
roll back, delete the line and deploy again.

| order | setting | what it does | evidence | effect |
|---|---|---|---|---|
| 0 | (merge this branch; **apply `migrations/2026-10-19-aliases.sql` before deploying the API worker** — moje-krev-go-live.md) | prices right; cross-check also compares unit and range; formatting is no longer a disagreement; differently-named rows pair; glued lab codes (`URE urea`, `FE železo`) map; a punctate (`X_`) no longer files as blood; more ranges and units parse (`G/l`, `T/l`, `1/1`); 29 public-sheet spellings and 4 blood-gas entries in the catalog; a cut-off or declined read fails honestly; mapping catalog cached | tests; re-scored stored reads | photos (today's Sonnet 5 + Gemini pair): rows asked about 53 → 9 on the public sheets, 0 uncaught; unmapped public names 66 → 36 |
| 1 | `MODEL_MAP: "claude-haiku-5-5"` | mapping fallback on Haiku 5.5 | 43-name truth set: 0 wrong filed, same as Haiku 4.5 | a tenth of the mapping cost |
| 2 | `TEXT_READERS: "cheap"` + `MODEL_SECOND: "claude-haiku-5-5"` | born-digital pages read once, by Haiku 5.5; interpret.ts's checks stand in for reader 2 | 12 pages: 210/213 rows, 0 uncaught, like the deployed pair | 3-page upload ~$0.17 → ~$0.006; ~24 s → ~10 s a page |
| 3 | `MODEL_PRIMARY: "claude-haiku-5-5"` (Gemini stays second) | photos read first by Haiku 5.5 | 11 sheets × 2 reps: 0 uncaught, rows asked about equal to Sonnet 5.5 + Gemini | photo page ~$0.044 → ~$0.011 |
| 3′ | or `MODEL_PRIMARY: "claude-sonnet-5-5"` | a safer photo step: same price as today, a cleaner copier than Sonnet 5 | R1: 0 value errors vs Sonnet 5's 2 | ~20% faster |
| 4 | `VITE_SHARE_AI_MAPPINGS=1` (portal build) | the model's confident filings (catalog + high + unit check) are saved for every account as a decision for that (lab, printed name, unit), marked `source: model`, revocable by the account that triggered it and listable/revocable by Ondřej from the CLI | 0 confident wrong in 495 names (round 3) | the same new name never reaches the model twice |
| 5 | `VITE_SECOND_OPINION=1` (portal build) | the list's weak matches (unit not the entry's, unknown specimen prefix) get Haiku's opinion once: confirmed, re-filed (only on "high" + unit evidence), or taken off the entry for a person to decide; saved like step 4 | round 4: the 4 real errors on the public sheets + look-alikes taken off (urine-strip glucose, PT in seconds, antithrombin mg/l, HbA1c %), 5 harmless ones confirmed | ~$0.002 once per (lab, name, unit) |
| 6 | `MAP_MODE: "codes-retry"` (moje-krev-extract; `"codes"` is the same without the second try) | `/api/map`: the bundled NČLP table first (a hit linked to one catalog entry needs no model), then today's whole-catalog Haiku call, and only what that call cannot place gets a second try: Haiku picks from the 20 nearest NČLP rows. Every answer carries its NČLP `code` where one is known, and the code is saved on the alias rows (steps 4–5) | round 6, best of seven arms: 131/133 unseen catalog spellings, 9/9 urine twins, 11/11 public misses, 34/40 tests not in the catalog, **0 confidently wrong**; worker bundle +187 KiB gzip, parsed only when set | ~$0.0001–0.0003 per name, ~10–15 s per batch |
| 7 | `VITE_AUTO_ENTRIES=1` (portal build; needs step 6 and the `2026-10-20-auto-entries.sql` migration) | a test the catalog lacks, resolved to one NČLP row exactly — the printed unit and specimen are the row's, the catalog call found no entry, and Haiku picked the same code at "high" — becomes a catalog entry for every account (`nclp_<code>`, NČLP's name and unit), stored in D1 `auto_entries`, listable and withdrawable from the CLI | round 6: 16 of 40 not-in-catalog tests would be added, 0 wrong; 1 of 133 known-test spellings would be added as its own entry ("Granulocyty" — a distinct NČLP item the catalog folds into neutrophils): a split trend, never a wrong merge | a new lab's unknown tests start trending without a person |

Listing and withdrawing what the model saved, from the CLI (no UI):

```sh
cd workers/portal && npx wrangler d1 execute moje-krev --remote --command "SELECT lab, raw_name, unit, canonical_id, model, created_at FROM aliases WHERE source = 'model' ORDER BY created_at"
```

```sh
cd workers/portal && npx wrangler d1 execute moje-krev --remote --command "DELETE FROM aliases WHERE source = 'model' AND lab = 'LAB' AND raw_name = 'NAME' AND unit = 'UNIT'"
```

Unrecognised parameters getting their own trend: `VITE_UNRECOGNISED_TRENDS=1`
(portal build) — see "Mapping UI".

Auto-added entries, from the CLI:

```sh
cd workers/portal && npx wrangler d1 execute moje-krev --remote --command "SELECT code, name_cs, unit, raw_name, created_at FROM auto_entries ORDER BY created_at"
```

```sh
cd workers/portal && npx wrangler d1 execute moje-krev --remote --command "DELETE FROM auto_entries WHERE code = 'CODE'"
```

Not recommended: `MAP_MODE: "codes-shortlist"` (the model picks from 20 NČLP
rows instead of the catalog): weaker on never-seen names (111 vs 126 of 133,
one confident wrong) at 4× the cost. Better only on the public sheets'
leftovers (11 vs 8 of 11), so it may earn a place later as a second try after
the catalog step says "unknown".

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

## Mapping UI (branch `claude/mapping-ui`, 2026-10-21)

The three UI pieces this loop left open. Every one is behind a portal build
switch; with all of them off the app is as before (portal audit: zero new
flaws). `npm run test:mapping-ui` builds the portal with
`VITE_UNRECOGNISED_TRENDS=1 VITE_AUTO_ENTRIES=1` into `apps/portal/dist-mapping-ui`
and sweeps the new screens (five widths, both palettes) plus the decisions
they save; `MAPPING_UI_SHOTS=<dir>` adds screenshots.

- **Unrecognised in Trendy** (`VITE_UNRECOGNISED_TRENDS=1`): one
  `buildTrends(..., { unrecognised: true })`, split into two maps that never
  meet — Souhrn and AI konzultace read only the recognised one. Each
  unrecognised series (lab + printed name + unit; blood or unknown specimen,
  with a number, not parked by the model as another material) is its own
  card with a dashed edge and a „nerozpoznáno" chip, no „mimo rozmezí"
  verdict anywhere (headline, chart, table: no red, no „v rozmezí"), the
  lab's printed range drawn as a band and captioned „(dle laboratoře)", and
  „Přiřadit ke známému parametru": a sheet with the
  evidence-backed suggestion, a search, and a link to Přiřazení. The choice
  is saved as a scoped `person` alias (lab, name, unit) plus the account's
  learned name, like a click in Přiřazení; undo withdraws both.
- **„přidáno automaticky"** (`VITE_AUTO_ENTRIES=1`): a quiet dashed mark
  after the name in Trendy cards, Souhrn rows and Ověření rows (`Mark.tsx`, a
  context, so nothing else is threaded). It opens a sheet saying in words
  what NČLP is, the code, specimen, unit, the printed name it came from and
  what it means for the person; „Nesedí to?" offers another parameter or
  „Nechat bez přiřazení" (a scoped `person` alias with canonical id NULL).
  The shared entry itself is not withdrawn by a person's correction. On
  screen an auto entry's name drops the NČLP system part
  („Apolipoprotein AII", not „… (S; hmot. konc. [g/l])"); the registry keeps
  the full name as its key so a short one cannot take a shipped entry's name.
  A stored row filed under an `nclp_` entry that is gone from the catalog is
  unfiled and matched again on load.
- **„Jak čteme názvy z laboratoří"** (Reporty, under „Váš účet, vaše data";
  on with any mapping switch): every decision that shapes the account's
  trends, grouped by lab — printed name + unit → parameter, and who decided
  (vaše rozhodnutí / automaticky — another account's decision also reads
  „automaticky", so nothing hints that someone else has reports from the
  same lab). One's own: „Vrátit zpět"
  after a confirmation. Automatic: „Nesedí" (the sheet; a person's decision
  always outranks a model's). Another account's: shown, no button (the
  worker would refuse it). Below: the auto-added parameters in use, each opening its
  sheet.
- **No curator view.** The app has no notion of an administrator, so the
  list of every account's model decisions and auto entries stays on the CLI
  (the commands under the summary above).
- `VITE_AUTO_ENTRIES` and `VITE_UNRECOGNISED_TRENDS` also turn on reading
  `/api/aliases` and saving a click as a scoped `person` decision (they need
  the `2026-10-19-aliases.sql` migration). Undoing a click in Přiřazení now
  also withdraws that scoped decision, so a reload does not file the name
  again.

## Mapping design (Ondřej's decision, round 3) — today vs after

**Rule:** the list first. A name the list does not know goes to Haiku 5.5. A
confident Haiku answer whose unit checks out is **saved as an alias**, so the
same name never goes to the model twice. Anything less is asked of the person,
and their answer is saved. A person's correction always wins, and every saved
alias can be withdrawn.

| step | today (Moje krev, verified in code) | after (this branch, switches default off) | still to build |
|---|---|---|---|
| 1. list | shipped synonyms (`registry.json`, 344 entries / ~4,100 names) + shared `synonyms` (D1, taught by a person's click onto a shipped entry, keyed by printed name only) + the account's `learned`. Exact key after `normKey`, plus the trailing `[ABBR]`; material checked | + glued codes (`URE urea`, `FE železo`, guarded), + `x` (punctate) refused as blood, + 29 spellings and 4 blood-gas entries (348 entries); **scoped decisions** (`Registry.addScopedAlias`, `aliasKey(lab, name, unit)`) consulted first — this lab and unit, this lab any unit, any lab this unit — and `rematchReport` carries them into stored reports, mapped rows included | — |
| 2. model | Haiku 4.5, automatic after every upload and once on load, for unmapped names that can trend; catalog id must exist (`toSuggestions` refuses invented ids — in effect an enum) | `MODEL_MAP=claude-haiku-5-5`; catalog sent as a cached block; `MAP_MODE=codes`: an NČLP lookup first (no model for a linked hit, a "new" draft carrying the code for an unlinked one, a specimen check), the code attached to every answer it can (`packages/extraction/src/codeMap.ts`, index `packages/lab-core/codes/lab-codes.index.json`) | — |
| 3. save | every answer per account (`settings.aiAsked`, never asked again); `catalog`+`high`+`canApplyUnasked` (unit known to agree, nothing contradicting) filed **for this account only**; the rest waits for a click, and a click onto a shipped entry teaches every account | D1 `aliases` (lab, raw_name, unit → canonical_id or NULL, `source` person/model, `model`, reserved `code`), `GET/PUT/DELETE /api/aliases`; a model's row never replaces a person's, a person's replaces a model's; `VITE_SHARE_AI_MAPPINGS=1` writes the confident filings there; `VITE_SECOND_OPINION=1` writes its decisions there | an in-flight guard so two accounts don't ask for the same new name at once. (Done in round 5: a person's click is also saved as a scoped `person` alias when the alias switches are on; the `code` column is filled.) |
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

### Round 4 — 2026-10-19

**Second opinion on weak list matches** (lab-core `weakMatchReason`,
`findWeakMatches`; portal `judgeSecondOpinion`, `runSecondOpinion`, behind
`VITE_SECOND_OPINION=1`).
- A list match is *weak* when the printed unit is neither the entry's unit nor
  a declared conversion, or the name has a specimen prefix the catalog does
  not know (unless that exact spelling is a listed synonym).
- Haiku is asked about the name fresh; it is not told the list's choice.
  - It names the list's entry → **confirm**.
  - It names another entry with "high" and the unit evidence holds →
    **remap**.
  - Anything else → **unmap**: the row leaves the entry and waits for a
    person, with the answer shown.
- Each decision is saved as a scoped alias, so it is asked once.

`tests/bench/second_opinion.ts` ($0.002, 4.7 s) ran on 13 weak matches:
- the public sheets' 9, plus the look-alikes as a lab would print them;
- `G/l`, `T/l` and `1/1` now fold in `canonicalizeUnit` (TS + Python,
  parity), so the harmless spellings are no longer weak at all.

| printed | list said | model | verdict |
|---|---|---|---|
| `Glukóza [arb.j.]` (urine strip) | glukoza | unknown | **unmap** ✔ |
| `P_Protrombinový test [s]` | Quick (%) | unknown — "several prothrombin items" | **unmap** ✔ (a person files it as PT time) |
| `P_Antitrombin III [mg/L]` | antithrombin (%) | unknown | **unmap** ✔ |
| `B-HbA1c [%]` | HbA1c (mmol/mol) | unknown, medium | **unmap** (defensible: same analyte, other scale) |
| `HbA1c [%]` | HbA1c | HbA1c, low | confirm (the trend keeps the % readings apart as another unit) |
| `S_GF_MDRD 6 [ml/s]`, `S_CKD-EPI [ml/s]`, `Hematokrit [pomer]`, `Anti CMV IgG/IgM [index]` | — | same entry | confirm ✔ |

No real error was confirmed and nothing right was re-filed. The two HbA1c lines
show the model's randomness. Saving the first answer is what keeps a trend
stable.

**Scoped aliases (lab + printed name + unit) with a model marker:**
- Registry: `addScopedAlias`, `scopedMatch`, `aliasKey`, consulted before
  every global key. NULL means "not this entry".
- `rematchReport` applies scoped decisions to stored rows, mapped ones
  included.
- `interpret.ts` passes the page's lab and the row's unit at upload.
- D1 `aliases` table (migration `2026-10-19-aliases.sql`, `schema.sql`,
  `schemaDrift` test). The `code` column is reserved for NČLP/LOINC from
  lab-codes.
- `GET/PUT/DELETE /api/aliases` with the ownership rule: a person beats a
  model, never the reverse.
- Account deletion unlinks the account's rows.
- The portal reads aliases only when one of the two switches is on, model
  rows first and then person rows.
- `VITE_SHARE_AI_MAPPINGS` now writes scoped `source: model` rows instead of
  name-only synonyms.
- Listing and revoking from the CLI: the two commands under the summary.

**Vocabulary** (`seed_registry.py`, both `registry.json` copies regenerated,
demo data byte-identical):
- 29 public-sheet spellings of existing entries.
- 4 blood-gas entries with Czech "about" texts: pCO2, pO2, base excess, sO2.
- Not added, on purpose:
  - bare "Bilirubin" and blood "pH": their keys are also the urine strip's
    bare names, and a bare name carries no specimen;
  - a bare trailing-code rule ("… MCV"): "S- Cholesterol non- HDL" also ends
    in "HDL".
- Unmapped names on the public reads: 66 → 36. The rest is urine, drug
  levels, punctates and those two.
- Note: this makes part of round 3's map-gate and map-first truth sets
  catalog-known; future runs of those measure less.

Round 4 spend: $0.002.

### Round 5 — 2026-10-20

**Merged `claude/lab-codes`** (the NČLP/LOINC code table: see
[lab-codes.md](lab-codes.md)). Clean merge, green.

**Mapping order wired (switch `MAP_MODE` on moje-krev-extract, default
unchanged):**

catalog → saved (lab, name, unit) aliases → **NČLP lookup** → model → unknown

- *Lookup.* The best hit (or an S/P pair of one component) linked to exactly
  one catalog entry is filed with no model, at "high" — but only if its
  specimen agrees with the printed prefix. A hit on a row the catalog doesn't
  link becomes a "new" draft pre-filled from the code (`nclp_<code>`, NČLP's
  Czech name, unit).
- *Specimen check* (`specimenAgrees`):
  - a pick or hit must match a readable blood or urine prefix;
  - a specimen the table has no rows for (PE_ erythrocytes, X_ punctate)
    never agrees, which caught `PE_Hořčík v ery` → plasma Mg;
  - an unreadable prefix is no evidence.
- *Model step*, two variants:
  - "codes": today's whole-catalog call for the names the lookup left, plus
    a code attached where the answer's entry links exactly one row for the
    printed specimen (`codeForCatalog`);
  - "codes-shortlist": Haiku picks from an enum of 20 rows + "unknown". The
    prompt is the lab-codes bench's serum-default / conventional-unit one,
    plus one sentence on timed and other-material variants ("po zátěži",
    "v erytrocytech").
- *The index:* `tools/scripts/build-code-index.ts` writes
  `packages/lab-core/codes/lab-codes.index.json` (4,734 rows, keys
  pre-normalised, catalog vocabulary lent). A test pins that it is current
  and answers exactly like the full table.
  - Worker bundle 222 → 409 KiB gzip (limit 3 MB).
  - Dynamically imported, so an isolate without `MAP_MODE` never parses it.

**Measured** (`tests/bench/map_codes.ts`, Haiku 5.5 all three ways, $0.10
including the smoke run):

| names | today (whole catalog) | MAP_MODE=codes | codes-shortlist |
|---|---|---|---|
| 133 held-out catalog synonyms (look-alike families) — the code path gets NČLP's own names only | 126 right · 7 unknown · 0 wrong · $0.0076 · 9.4 s | **127** · 6 · **0** · **$0.0060** · 8.7 s; 27 without a model; 114 carry a code | 111 · 20 · 1 confident wrong (`S_Vol.VK Fe` → iron) · $0.029 · 21.5 s |
| 9 negatives (urine twins, tests the catalog lacks) | 9 | 9 | 9 |
| 11 public-sheet names the catalog misses | 8 · 3 unknown | 8 · 3 | **11** · 0 |

Judgment:
- The lookup + catalog step keeps today's accuracy, is a little cheaper and
  faster, and gives most decisions a standard code. That is what to switch on.
- The shortlist does **not** hold up as a replacement on names the catalog
  has never seen. It sees 20 NČLP rows where the catalog call sees all 344
  entries by their everyday names. Its strength is the odd lab names
  (11/11). A second try after "unknown" is the natural next step (cents per
  new lab), not built.

**Saved decisions:**
- A person's click onto an entry is also saved as a scoped `person` alias
  (when the alias switches are on), so it is the strongest decision and
  withdrawable in the same place as the model's.
- The `code` column is filled: `/api/aliases` accepts a 5-digit NČLP key,
  anything else is stored as NULL.
- Model answers and second opinions pass their code through.

Round 5 spend: $0.10 (plus the code-table agent's $0.30 on its own branch,
already in the loop total).

### Round 6 — 2026-10-20 (branch `claude/mapping-ncl-arms`, on top of PR #8)

**Question:** how to resolve names that are *not* in the catalog (the public
launch reality) as well as unseen spellings of known tests, without wrong
mappings.

**New set:** `tests/bench/map_ncl_truth.json` — 41 real test names the
348-entry catalog lacks, as labs print them: LIS-style S_/U_ names and
everyday wording. Truth is the NČLP code(s); an empty list means the table
lacks them too (drug levels, a few markers), so "unknown" is the right answer.
One of my labels was wrong and is corrected (macroprolactin is in the table).
Label text and units only.

`tests/bench/map_ncl_arms.ts`, Haiku 5.5, all sets, $0.59 in total:

| arm | unseen catalog spellings (133) | urine twins / missing (9) | public misses (11) | not in catalog (40) | $ / name | latency |
|---|---|---|---|---|---|---|
| a `MAP_MODE=codes` | 128 · 0 wrong-conf · 5 unk | 9 | 8 · 3 unk | 27 · 1 wrong (low) · 12 unk | 0.00003–0.00008 | 2–9 s / set |
| b whole table (4,734 rows, cached) | 89 · 0 · 42 unk | 9 | 10 | 23 · 2 wrong (med) · 15 unk | 0.0004–0.0009 | 2–10 s |
| c code from memory | 0 (Haiku gave no code at all) | 9 | 8 | 7 | 0.00003 | 2–6 s |
| d blind → shortlist from description → pick | 115 · **1 wrong-conf** · 15 unk | 9 | 10 · 1 wrong | 36 · 0 · 4 unk | 0.0003–0.0004 | 36 s (one call per name) |
| e a, then a shortlist second try for "unknown" | **131** · 0 · 2 unk | 9 | **11** | 34 · 0 · 6 unk | 0.00006–0.0003 | 3–15 s |
| f blind → whole table + own statement, contradiction → review | 87 · 0 · 45 unk · 2 review | 9 | 10 | 26 · 1 wrong (med) · 13 unk · 6 review | 0.0005–0.0011 | 2–8 s |
| **g = e as shipped (`MAP_MODE=codes-retry`)** | **131 · 0 · 2 unk** | **9** | **11** | **34 · 0 · 6 unk** | **0.00006–0.00035** | 4–15 s |

The not-in-catalog column above is after the macroprolactin truth fix, for d,
e and g, which had picked it.

Judgment:
- **Ship e (as g):** best or tied-best on every set, no confident error
  anywhere, the cheapest model path.
  - The second try costs only for the few names the catalog call can't place.
  - It closes the gap on odd lab names (public 11/11).
  - On tests the catalog lacks it finds the code for 34/40. Its misses are
    unknowns, not wrong answers.
- **d** finds one more of the not-in-catalog tests (36), and that is its only
  edge. It made the round's one confident error ("S_Vol.VK Fe" — free
  iron-binding capacity — filed as serum iron) and makes a call per name. The
  narrowing step helps a lot over the whole table (d 115 vs f 87 on unseen
  spellings), but not enough to beat e.
- **The whole table in the prompt (b, f) does not pay.**
  - It is ~110K tokens, so above Haiku 5.5's 100K line: the $0.50/$2.50 rate.
    The first batch writes the cache, and later batches read it at 0.1×.
  - It is less accurate on unseen spellings (89, 87), because the model must
    find a formal NČLP name among 4,734 rows by itself.
  - Anchoring: b made no *confident* wrong pick, so there was nothing for f
    to fix there. Of b's two medium wrongs on unseen spellings, f fixed one
    (anti-Xa → antithrombin) and repeated the other (free iron-binding
    capacity → total). The contradiction rule sent 9 names to review across
    all sets and turned none of them into a right answer.
- **c:** Haiku 5.5 states no NČLP code from memory at all (0 five-digit
  codes in 193 names). It does not hallucinate codes, and it is no use.

**Built** (switches, default unchanged):
- **`MAP_MODE=codes-retry`** (step "catalog+shortlist" in `codeMap.ts`):
  - the lookup first;
  - then the catalog call, which also decides unlinked hits ("Granulocyty"
    → neutrofily_abs wins over a draft when the catalog call finds it);
  - then a shortlist second try for "unknown" and for the model's own
    code-less "new" proposals.
- **An exact code hit the catalog lacks is "high" only when** the printed unit
  and specimen are the row's own **and** Haiku, shown the shortlist, picks
  the same code at "high". In plain `codes` mode such a draft stays "medium".
- **`VITE_AUTO_ENTRIES=1`** (portal):
  - a "new" answer with a code at "high" becomes a shared catalog entry
    (`auto_entries` in D1, migration `2026-10-20-auto-entries.sql`,
    `GET/PUT/DELETE /api/auto-entries`; the first writer keeps a code, the
    creator or the CLI withdraws it);
  - the name is filed under it, and every account loads it;
  - there is no "auto-added" label on screen (no UI this loop): the flag is
    the table itself.
- Tests: `codeMap.test.ts` (step order, the draft rule, agreement),
  `aiMapping.test.ts` (`autoEntriesFrom`, `autoEntryDef`), the API tests,
  and the schema drift test.

Round 6 spend: $0.59.

### Round 7 — 2026-10-21 (branch `claude/model-loop-r7`, on top of PR #9)

**1. Ambiguous catalog entries split along their NČLP codes**
(`seed_registry.SPLITS`, 355 entries). Only genuinely different
measurements whose printed names say which one they are:

| new entry | split from | what moves | NČLP |
|---|---|---|---|
| `granulocyty`, `granulocyty_abs` | neutrofily, neutrofily_abs | "Granulocyty", "Gra granulocyty" (neutrophils + eosinophils + basophils) | 03556, 03553 |
| `ldl_vypocet` | ldl | the 8 names that say výpočet / Friedewald | 03380/03379 |
| `parathormon_1_84` | parathormon | "biointaktní 1-84", "PTH 1-84" | 18237/18235 |
| `vapnik_ionizovany_vypocet` | vapnik_ionizovany | the 4 "výpočet" names | — |
| `d_dimery_ddu` | d_dimery | "D-dimery (DDU)", and the DDU units that were converted **1:1** into the FEU entry (DDU is about half FEU — a wrong merge, fixed) | — |
| `anti_hav_celkove` | anti_hav_igg | the 4 "celkové / total" names | 00364/00362 |

**Not split, on purpose:**
- Mass vs molar pairs with a fixed factor (Ca, Mg, P, lipids, Fe, B12,
  folate, vitamin D, ACTH, AMH, GH, renin) stay one trend with their
  conversion.
- Variants printed with the same name and told apart only by unit (Lp(a),
  bone ALP): the trend already keeps an unconvertible unit apart
  (`otherUnits`).
- Troponin hs vs conventional, direct vs conjugated bilirubin, total vs
  beta-hCG: labs print the plain name for both. A name-based split would cut
  one test's trend in two whenever a person changes labs.

**Stored rows move by themselves:**
- `registry.json` entries carry `splitFrom`, and `rematchReport` (run on
  every portal load) moves a row from the old entry to the new one when its
  printed name now resolves there.
- A name the account filed itself (learned) stays where it was filed.
- `packages/lab-core/tests/splits.test.ts` runs on the shipped registry: the
  split names move exactly, nothing else moves, it is idempotent, the
  reading count is unchanged, and no series mixes two meanings.
- Code-table side: `curation.json` links updated, `lab-codes.json` rebuilt
  from a fresh NČLP download (78 lines changed, links only) and the index
  rebuilt.
- Demo reports, chat demos and seed SQL are byte-identical; only the two
  `registry.json` copies change (the 7 entries, `splitFrom`, the moved
  names). Python parity is unchanged (192).

**2. Every switch on, end to end** (`tests/bench/e2e_switches.ts`: the stored
reads of 20 pages, 309 rows; interpret → mapping → judge → shared lessons →
auto entries → second opinion → rematch; then a second account loading the
same reports; $0.17 in all runs). Findings and fixes:
- **Bug: an auto entry founded by a name without a specimen took every
  specimen's name.** "pH" from a urine strip became an entry that then took
  the blood gas "B_pH" — a wrong merge.
  - Fix: auto entries are blood only (S/P/B rows). They carry their specimen
    (proposal `material`, D1 column `mat`, migration
    `2026-10-21-auto-entries-material.sql`).
  - A bare founding name also gets a prefixed synonym, so the registry
    refuses the entry to another specimen's name.
  - Tests added.
- **Bug: the second opinion through `MAP_MODE=codes-retry` took right weak
  matches off their entry.** "Anti CMV IgM (skríning)" printed as an index
  came back as a "new" code draft.
  - Fix: `/api/map` with `purpose: "second-opinion"` asks the catalog
    question whatever `MAP_MODE` says. The portal sends it. Worker test
    added.
- **Checked, no problem:**
  - no name is asked both by the mapping and by the second opinion;
  - no auto entry is later undone by a second opinion;
  - the second account maps every row exactly like the first (0
    differences);
  - the first account's settled names (shared lessons, auto entries) are not
    asked again.
- **Known, small:** names the model answered "unknown" are asked again by
  each new account (~$0.004 per account here), because only decisions are
  shared, not "unknown".
  - A second opinion's "unmap" (e.g. PT in seconds, filed as Quick %) leaves
    the name for the next mapping run. That run then files it (pt_cas) for
    the account that asks.
  - The shared table keeps the first model decision; a person's decision
    beats it.
  - The second opinion's answers vary run to run (HbA1c in %:
    confirm/unmap). That is why it is asked once and saved.
- **Settings together** (worker route test added): text read once by Haiku 5.5
  (slot 2), photos by Sonnet 5.5 (slot 1) + Gemini.
- **Cost on these pages:** mapping + second opinion $0.0003 per page ON vs
  $0.0006 OFF (Haiku 4.5 over the whole catalog); a second account $0.0002.
  Reading is the big lever: ~$0.002 vs ~$0.06 per text page.

Round 7 spend: $0.17.

### What still needs Ondřej
1. **The Mac check** (`model-loop-mac-check.md`) before step 4 of the final
   recommendation.
2. **The D1 migrations** before deploying the API worker; then the settings,
   in the order above.
3. **UI:** built on `claude/mapping-ui` (see "Mapping UI"); the curator
   list stays on the CLI — the app has no administrator concept.
4. **Optional:** share "unknown" answers too, so a second account does not
   re-ask; split vitamin B6 by specimen and the remaining unitless-serology
   entries if they ever trend.

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

| 2026-10-19 | `with-secrets bloodwork -- npx vite-node --root . tests/bench/second_opinion.ts` (13 weak matches) | Haiku 5.5 | 0.002 | 4.191 |
| 2026-10-19 | code-table agent, branch `claude/lab-codes` (`BENCH_HAIKU=1 npm run bench:codes`, see lab-codes.md) | Haiku 5.5 | 0.300 | 4.491 |
| 2026-10-20 | `with-secrets bloodwork -- env MAP_CODES_LIMIT=20 npx vite-node --root . tests/bench/map_codes.ts` (smoke) | Haiku 5.5 | 0.013 | 4.504 |
| 2026-10-20 | `with-secrets bloodwork -- npx vite-node --root . tests/bench/map_codes.ts` ×2 (before/after the specimen fix, the second with the codes step) | Haiku 5.5 | 0.092 | 4.596 |
| 2026-10-20 | `with-secrets bloodwork -- env ARMS=b SETS=3 npx vite-node --root . tests/bench/map_ncl_arms.ts` (whole-table smoke) | Haiku 5.5 | 0.105 | 4.701 |
| 2026-10-20 | same, `ARMS=a,b,c,d,e,f` (all sets) | Haiku 5.5 | 0.390 | 5.091 |
| 2026-10-20 | same, `ARMS=e` ×3 and `ARMS=g` ×2 (truth fix, draft and agreement rules) | Haiku 5.5 | 0.095 | 5.186 |
| 2026-10-21 | `with-secrets bloodwork -- env PYTHON_BIN=.venv/bin/python npx vite-node --root . tests/bench/e2e_switches.ts` ×6 (before/after the fixes, debug runs) | Haiku 4.5, Haiku 5.5 (mapping only; reads stored) | 0.170 | **5.356** |

Round 1: $2.57 of $3.50. Round 2: $1.48 of $3.00 (of which $0.95 chat evals,
before the scope correction). Round 3: $0.13 of $2.50. Round 4: $0.002 of
$2.00. Round 5: $0.10 of $2.00. Code-table agent: $0.30. Round 6: $0.59 of $1.50.
Round 7: $0.17 of $2.00. Loop: **$5.36 of $10**. Keys from `bloodwork.env`
(shared with Klugscheisser/jobscan). Bench costs are priced with the corrected
table (Sonnet $2/$10).
