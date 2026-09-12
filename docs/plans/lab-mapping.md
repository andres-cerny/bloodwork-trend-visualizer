# Mapping any lab's names — the plan

The first real user from a laboratory we had never tested (BioLAB, Praha 7,
2026-09-12) uploaded three reports and 155 of her 223 rows landed with
`canonicalId = null`: stored, correctly flagged, and invisible in Trendy and
the overview. Nothing was misread. The names were simply not in the catalog.

This plan turns that account into the fifth lab the app knows, and makes the
sixth lab cheaper than the fifth. She consented to her values being used for
this; the payloads live under git-ignored `data/real_seed/biolab/` and never
leave the machine.

## What was found

The pipeline is "copy what is printed, then look it up":

1. The extraction prompt asks for the name **exactly as printed, prefix
   included** (`packages/extraction/src/extract.ts`). Nothing canonicalises.
2. `Registry.match` (`packages/lab-core/src/registry.ts`) normalises the name
   (`normKey`: lowercase, material prefix off, diacritics off) and does an
   **exact** lookup. No fuzzy matching at this stage.
3. The catalog is `apps/portal/public/registry.json`, exported from
   `tools/pipeline/scripts/seed_registry.py`. Its synonyms are literally the
   printed names of AGILAB, SPADIA, CASRI and PREVEDIG.
4. What a user assigns by hand is saved per account in `users.settings.learned`.
5. `canonicalId` is computed at upload and stored in the payload. A catalog
   update does **not** reach reports already uploaded.

Three classes among the unmatched names:

| class | count | example | answer |
|---|---|---|---|
| catalog entry exists, BioLAB spells it differently | ~40 | `S_Na`, `S_Močovina`, `B_Střed.obj.erytr. [MCV]`, `B_Neutrofily - relativně` | synonyms |
| no catalog entry at all | ~30 | tumor markers, serology, cystatin C, prolactin, total T3/T4 | new analytes |
| not blood (urine strip and sediment), or not a measurement | ~24 | `U_pH`, `Povrch těla`, `Hodnocení stadia CKD` | leave out of the banner |

Two bugs on top of the vocabulary gap:

- **Greek mu.** BioLAB prints `μmol/l` with U+03BC. The mapping suggester's
  `unitKey` (`packages/lab-core/src/mapping.ts`) only lowercased and never
  called `canonicalizeUnit`, so every correct BioLAB candidate was marked
  "nedoporučujeme" with the line "μmol/l vs µmol/l — neodpovídá". The Python
  twin (`tools/pipeline/src/matching.py`) canonicalised — a parity drift.
- **A rejected reader vanished without a log line.** Both 27. 3. uploads had
  their second read fail on page 2 (67 rows "nepotvrzeno"); `settle()` in
  `workers/extract/src/index.ts` skipped the rejection silently, so the cause
  cannot be known after the fact.

## Phases

Every phase is measured against the same fixture, and the number must move
without "wrong" ever rising.

### Phase 0 — the fixture and the bench

- `data/real_seed/biolab/report_*.json`: the three payloads, verbatim.
- `data/real_seed/biolab/truth.json`: every distinct printed name →
  `canonicalId`, or `NEW:<id>` for a test the catalog lacks, or `NOT_BLOOD`
  for urine, or `IGNORE` for a non-measurement.
- `npm run bench:mapping` (`tests/bench/mapping.bench.ts`): runs the shipped
  registry over the fixture and prints **matched / wrong / unmatched**.
  Baseline: 28 matched, 0 wrong, 101 unmatched of 129 names.

### Phase 1 — the bugs and two rules (free; failing test first)

1. `unitKey` canonicalises. Parity restored with `matching.py`.
2. `canonicalizeUnit` folds `m^2` → `m2` (and `m^3`) and spaces a digit from
   the `m2` that follows it, so `ml/s/1,73m^2` meets the catalog's
   `ml/s/1,73 m2`; and `1` — the SI spelling of "dimensionless" — folds to
   `""` like `-` already does. Parity cases first.
3. A trailing `[ABBR]` is a **second** key: `B_Střed.obj.erytr. [MCV]` is
   looked up as its full key and then as `mcv`. Registry index and `match`
   on both sides; `normKey` itself stays one-to-one. Parity section
   `abbreviation_key`.
4. Urine rows and names with no numeric value anywhere leave the
   "nezobrazuje se" banner and the mapping list: neither can ever trend.
5. `settle()` logs why a reader was rejected.

### Phase 2 — BioLAB's vocabulary, and the tests the catalog lacked (free)

`seed_registry.py` grows a `BIOLAB_SYNONYMS` block and a set of new
analytes — the tumor markers, serology, cystatin C, prolactin, total T3/T4,
pancreatic amylase, lipase, apolipoprotein A-I, FIB-4, DAO, PTH, rheumatoid
factor. Then `python3 -m scripts.seed_registry && python3 -m
scripts.make_demo_data` regenerates both `registry.json` copies (CI's
zero-diff check covers them). Target on the bench: 0 unmatched blood names.

### Phase 3 — the catalog reaches existing reports, and one confirmation teaches the app

- On load, the portal re-matches every `canonicalId: null` row against the
  registry it just built and persists what changed. This is how deploying a
  catalog fixes an account that uploaded last week.
- A new D1 table `synonyms(raw_name, canonical_id, taught_by, created_at)`.
  Accepting a mapping onto a **shipped** analyte writes there as well as to
  the account's `learned`; every account reads it at load, after the shipped
  catalog and before its own `learned`. Undo by the teacher deletes the row.
  Founded parameters stay per account — their ids exist nowhere else.
- Migration `2026-09-12-synonyms.sql`, `schema.sql`, `check:schema`.

### Phase 4 — agentic suggestions for what the catalog still misses

Only for names the deterministic path left null, and only on a click.

- `POST /api/map` on the extract worker: printed name + unit + range +
  material for each unmatched name, the whole catalog (id, name, unit), and
  Haiku is asked for `canonicalId | NEW{id, displayNameCs, unit} | NOT_BLOOD`
  with a one-line reason. Spend is priced and booked like a page.
- The portal proxies it on the person's ledger (`POST /api/map`).
- The mapping tab's "Nechat AI navrhnout" runs it for every pending name.
  A suggestion that names a catalog id is **applied only if** the unit is
  known to agree and neither interval, material nor magnitude disagrees
  (`canApplyUnasked`). Name similarity is *not* held against it — "S_Na" and
  "sodik" share no bigram, and the name is the one thing the model was asked
  because it knows (the portal audit caught the first version vetoing exactly
  that). Otherwise it is shown on the card under "Návrh AI" with the model's
  reason and waits for a click. A `NEW` proposal pre-fills the founding
  form; "not blood" parks the name and the banner says so.
- What the model applied is **this account's mapping only**, listed with a
  way back. Teaching every account (Phase 3) takes a person's click.
- Evaluated on the fixture first, through a subagent, against `truth.json`.

### Phase 5 — gate

`npm run test:all`, the bench, a `portal-auditor` sweep of the mapping and
trends tabs, then deploy (`deploy:moje-krev`) and confirm the account's
trends fill in.

## Done 2026-09-12 — the numbers

| step | bench on the BioLAB fixture (129 printed names) |
|---|---|
| baseline | 28 matched · 0 wrong · 77 unmatched · 24 left out |
| Phase 1 (µ, `m^2`, `1`, `[ABBR]`) | 36 matched · 0 wrong · 69 unmatched |
| Phase 2 (vocabulary + 30 new entries) | **105 matched · 0 wrong · 0 unmatched · 24 left out** |

Phase 4, the mapping model, on the 93 names the *pre-Phase-2* catalog did
not know: a subagent handed the prompt verbatim 92/93 right, 0 wrong (its
one "unknown" was transferrin saturation printed as a fraction — right to
hesitate); Haiku 4.5 through the API 92/93 right, 0 wrong, $0.07 for the
run. Two things the API run taught that the subagent could not: 93 names
in one call ran past `max_tokens` and decoded to nothing, and Haiku copied
the whole evidence line as `raw_name` for a batch of thirty. Both are
handled and tested (`packages/extraction/tests/map.test.ts`).

## Open, deliberately

- `convertToCanonical` is declared and never called in the portal: a lab
  printing a fraction (`0,20 - 0,48`, unit `1`) and one printing percent will
  not share a trend axis. BioLAB is the only lab with such rows today.
- Urine is not catalogued. "Moje krev" is blood; a urine trend is a
  different product decision.
