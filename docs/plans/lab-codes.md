# Lab codes — every printed name to NČLP (and LOINC)

Ondřej's decision (2026-10-19): instead of matching printed names to our
catalog by spelling alone, map each name to a **standard code**: NČLP, the
Czech national lab code list, and LOINC where we know it. This file covers
the sources and their terms, the table, how the 344 catalog entries link to
it, what a lookup measured on real and synthetic names, and where the table
lives at runtime. Branch `claude/lab-codes` (on top of
`claude/model-pipeline-loop`); new files only, nothing in the mapping path
calls it yet.

## Sources and terms

| Source | What we took | Access | Terms |
|---|---|---|---|
| **NČLP** — Národní číselník laboratorních položek, version 03.01.01 (DS 04.28.08, generated 2026-09-15), MZ ČR / DASTA | the item list `nclppol.xml` (23,565 items) and its components, systems, kinds of property | free download, no login: `https://ciselniky.dasta.mzcr.cz/CD/nclp_data/ds_NCLP/aktual/` | Published by the Ministry of Health for use by every health IS; no licence text on the download pages. It is a state-declared standard (Věstník MZ ČR 1997/7, 2015/20), which reads as an *úřední dílo* outside copyright (§ 3 zák. 121/2000 Sb.). That is our reading, not legal advice. Attribution kept in the table: "Národní číselník laboratorních položek (NČLP), Datový standard MZ ČR (DASTA)". Contact for questions: wsdasta@mzcr.cz. |
| **LOINC** 2.82 (Regenstrief) | **codes only**, 312 of them, picked per NČLP item. No LOINC names or tables are stored. | NLM Clinical Tables search API (`clinicaltables.nlm.nih.gov/api/loinc_items/v3`) to find candidates; HL7's public terminology server `tx.fhir.org` `$lookup` to verify that each code exists, is ACTIVE and has the right axes. No account was created. | LOINC is free under the LOINC licence (loinc.org/license), which allows using and redistributing codes with its notice. The notice is in `codes/curation.json` and in the table's `source`. Clinical Tables: "users of this API must agree to the LOINC Terms of Use", provided "as is", free of charge. tx.fhir.org is a public test server, fine for a one-off build check, not for runtime. |
| Not used | the full LOINC table and the "top 2000" usage lists | need a loinc.org account | — |

NČLP has **no LOINC crosswalk**. It carries NPU codes (IFCC/IUPAC) on 5,645
items, which we keep as `npu`. ÚZIS/NCEZ announced an NČLP→LOINC mapping and
FHIR publication (HL7 CZ lab IG uses `https://ncez.mzcr.cz/nclp/CodeSystem/nclppol`
as the system URL); when it is published, it replaces our hand-picked LOINC.

## Why NČLP fits Czech reports

A Czech LIS builds its printed names from NČLP: system short name +
`_` + component short name. `S_Na`, `B_Leukocyty`, `U_pH` are literally
`nclpsyst.n32 + "_" + nclpkomp.n32`. The table stores that as `printed`.
What NČLP does *not* hold is the everyday wording ("Sodík", "Močovina",
"GMT", "Neutrofily %"): its names are formal ("Sodný kation", "Urea",
"GGT"). That vocabulary comes from our catalog — see `common` below.

## The table

`packages/lab-core/codes/lab-codes.json` — **4,734 rows**, 2.2 MB pretty
(234 KiB gzip). One row per NČLP item in its method-independent form
(procedure `*`); a quantity NČLP lists only as a formula (eGFR, LDL by
Friedewald, INR, anion gap, transferrin saturation…) gets its lowest-keyed
formula item instead, marked `names.cs.method` (436 rows). Rows by
specimen: plasma 1,897 · serum 1,598 · blood 606 · urine 501 · collected
urine 132.

Selection: every active item of a blood or urine system, minus
allergen-specific IgE (1,533 single allergens), drug levels, genetic
findings, coagulation mixtures and dried spots, and minus serology against
the ~70 infectious agents that are hospital microbiology (kept: hepatitis
A–E, HIV, syphilis, the herpes family, borrelia, TBE, H. pylori, rubella,
measles, mumps, parvovirus, toxoplasma, mycoplasma, chlamydia pneumoniae,
tetanus, SARS-CoV-2). A curated catalog link always keeps its row.

```jsonc
{
  "id": "02503",              // NČLP key — the language-neutral key
  "sys": "S", "comp": "NA",   // NČLP system and component codes
  "prop": "SCnc",             // kind of quantity, LOINC-like short form
  "unit": "mmol/l",           // NČLP unit ("1" = fraction)
  "mat": "s", "spec": "serum",// the app's material prefix code
  "kind": "ELE",              // NČLP component class
  "names": {
    "cs": { "name": "Na (S; látková konc. [mmol/l])", "printed": ["S_Na"],
            "syn": ["Na", "Sodný kation"],             // NČLP's own names
            "common": ["Sodík", "Natrium", …],         // lent by the catalog
            "prop": "Látková koncentrace" },
    "en": { "name": "Sodium (S; subst.c. [mmol/l])", "syn": ["Sodium", "Sodium ion"] }
  },
  "npu": "NPU03429", "loinc": ["2951-2"], "catalog": ["sodik"],
  "methods": ["02504", "02505", …]   // method-specific NČLP keys of the same item
}
```

Names are per language under `names.<lang>`; adding Slovak or English
wording is a data change. `common` is the catalog's synonyms (prefix off)
lent to the **component** of every row a catalog entry links, so "Sodík"
also finds `U_Na` and `dU_Na`, which the catalog itself never covers.

Build: `cd tools/pipeline && python3 -m scripts.build_lab_codes [--fetch]`.
`--fetch` downloads the NČLP XML into git-ignored `data/codes-src/nclp/`
(~50 MB). Inputs that are ours and tracked:
`packages/lab-core/codes/curation.json` (catalog → NČLP, NČLP → LOINC, each
link with its note) and `apps/portal/public/registry.json`. Re-run after an
NČLP upgrade (4×/year) or a catalog change; one row per line keeps the diff
readable.

Loader: `packages/lab-core/src/labCodes.ts` (`LabCodes`: `lookup`,
`shortlist`, `byId` — a method-specific key resolves to its row —, `byLoinc`,
`forCatalog`). Not exported from the package root yet; tests in
`packages/lab-core/tests/labCodes.test.ts`.

## The catalog, linked

| | entries |
|---|---|
| catalog entries | 344 |
| linked to ≥ 1 NČLP code | **318 (92 %)** |
| … of them with a LOINC code | 293 |
| linked to several specimens (S + P, or B) | 230 — normal, not ambiguous |
| flagged ambiguous | 94 (reason in `curation.json`) |
| no NČLP item | 26 |

**No NČLP item** (computed by the lab or the app, or simply absent):
bilirubin nekonjugovaný, Mg v erytrocytech, AIP, ApoB/ApoA1, LDL/HDL,
remnant cholesterol, VLDL, UIBC, hepcidin, omega-3 index, vitamin K,
kappa/lambda, CD4/CD8, CD3/CD4/CD8/CD19/NK in %, retikulocytový index,
lupus antikoagulans, FIB-4, index aterogenity (NČLP has only the
"aterogenní koeficient" (CHOL−HDL)/HDL, which is a different number), the
three sample-quality indices, and ROMA (NČLP 17412 exists, but under the
patient system `Pt`, which the table does not carry).

**Ambiguous** — one catalog entry covering what NČLP keeps apart. The kinds:

- **Mass vs molar unit under one entry** (catalog converts): Ca, Mg, P,
  cholesterol, TG, HDL, LDL, Fe, Se, B12, folate, vitamin D, 1,25-D, AFP.
  NČLP links the molar item; a lab printing mg/dl has a different NČLP item.
- **% vs fraction**: NČLP stores differential counts, electrophoresis
  fractions, RDW, IG, IPF and coagulation activities as a fraction [1];
  the catalog as %. Same quantity, ×100.
- **Two variants under one entry**: conjugated vs direct bilirubin, measured
  vs calculated LDL, hs vs standard troponin T/I, intact vs 1-84 PTH,
  CD4/CD8 vs CD3+CD4+/CD3+CD8+, anti-Xa for LMWH vs UFH, protein S
  activity vs free antigen, total vs IgG anti-HAV, HIV Ag/Ab vs Ab,
  D-dimer FEU vs DDU, neutrophils vs segments vs granulocytes.
- **Serology without a unit**: index, arbitrary units and kU/l are three
  NČLP items; most unitless antibody entries link more than one.
- Units that do not convert at a fixed factor: renin (ng/l vs mU/l), STH
  (mU/l vs µg/l), AMH.

These are exactly where a shared code helps: the catalog can be split per
code later without guessing.

## Does a lookup find the right code? (free)

`npm run bench:codes` (`tests/bench/lab_codes.bench.ts`). Names:
**258** measured names of the four synthetic labs (truth = the catalog
answer's linked codes; urine names labelled), and **237** distinct
(name, unit) pairs from the 11 public sample sheets, each labelled with
NČLP codes by hand, independently of the lookup
(`tests/bench/lab_codes_truth.json`). A prefix-less name gets the material
its section heading states ("Moč…" → urine), as `matchRow` does at runtime.
No values anywhere.

| | lookup right | wrong | no hit | shortlist@5 | shortlist@20 |
|---|---|---|---|---|---|
| synthetic, NČLP names only | 114 / 258 (44 %) | 4 | 140 | 87 % | 95 % |
| synthetic, as shipped (+ `common`) | **214 / 258 (83 %)** | 5 | 39 | 95 % | **97 %** |
| public, NČLP names only | 83 / 237 (35 %) | 7 | 147 | 87 % | 92 % |
| public, as shipped | **154 / 237 (65 %)** | 8 | 75 | 91 % | **93 %** |

- NČLP's own names catch the LIS-convention names (`S_Na`, `B_Leukocyty`);
  everyday wording needs the catalog's vocabulary, which roughly doubles
  the exact hits.
- A wrong exact hit is rare (≈ 3 %) and nearly always a quantity variant:
  `S-Vitamin B12 [pg/ml]` lands on the ng/l item where the catalog linked
  pmol/l, `Kyselina listová v erytrocytech` on serum folate.
- **12 of the 237 public names have their right code outside the table**
  (drug levels, punctate fluid `X_…`, urine drug screens). Excluding them,
  the shortlist holds the right code for **220 / 225 (98 %)**.
- Caveat: the public sheets' names were added to the catalog during the
  model loop, so "as shipped" on `public` is partly the catalog seeing its
  own vocabulary. The NČLP-only row is the honest floor.

Speed (node, this server): parse 25 ms, build the name index 140 ms, lookup
0.2 ms, shortlist 14 ms (first one +33 ms for the trigram index).

## Haiku picking from the shortlist (paid, $0.30 total)

`with-secrets bloodwork -- env BENCH_HAIKU=1 BENCH_MAX_USD=… npm run bench:codes`.
`claude-haiku-5-5`, one call per name, strict tool `pick_code` whose `code`
is an enum of the 20 shortlisted keys + `"unknown"`, `tool_choice` auto
(not forced), input = printed name, unit, printed range, section heading
and the 20 rows (`code | NČLP name | specimen | quantity | unit`). No value.

| run | right | wrong | unknown | cost |
|---|---|---|---|---|
| 1st prompt, 495 names | 308 (62 %) | 12 | 175 | $0.137 |
| 80-name sample with reasons | 40 / 80 | 3 | 37 | $0.023 |
| sharpened prompt, 468 names (cap hit, 27 skipped) | **419 (90 %)** | 24 | 25 | $0.136 |

The first prompt's 175 unknowns had two causes, both visible in the
reasons: no prefix → "serum or plasma, can't choose", and a conventional
unit (mg/dl) → "no candidate in mg/dl". The second prompt says S is the
default when nothing says otherwise and that a conventional unit is the
same test. The remaining 24 wrong are mostly not the model: urine strip
semi-quantitative vs quantitative items, `X_` punctate names whose code is
not in the table, `B_Glukóza`/`B_Chloridy` picked as serum (a check
against the printed prefix catches these), drug screens; and three where
the truth is arguable (`S-LDL-cholesterol (Friedewald)` → the Friedewald
item is right; `pg/ml` B12 → the mass item is right).

Cost: ~$0.0003 per name, i.e. a new lab's 40 unknown names ≈ 1 cent.

## Runtime: bundle a compact index in the worker, not D1

| | size |
|---|---|
| full table, minified | 2.2 MB · 234 KiB gzip |
| compact index (id, material, quantity, unit, name, keys, LOINC, catalog) | 0.97 MB · 123 KiB gzip |

**Recommendation: bundle the compact index into the worker that maps
names** (`workers/extract`, deployed as moje-krev-extract, which already
runs `/api/map`), built at deploy by the same script. ~125 KiB gzip is
far under the Workers bundle limit (3 MB free / 10 MB paid, compressed),
a lookup is in-memory and free, and the table changes 4× a year with a
deploy anyway. D1 would add a query per name, a migration per NČLP upgrade
and still need the trigram search in code — it earns its place only if the
table grows past ~10 MB or must change without a deploy. The browser does
not need the table.

Before shipping: emit the keys pre-normalised in the compact index (the
140 ms index build is `normKey` over ~40k names; a worker should not pay it
per isolate start), and build the trigram index lazily as now.

## Where it plugs into the mapping order

1. **Catalog exact match** (`Registry.match`) — unchanged.
2. **Saved / learned aliases** (`synonyms` D1 table, per-account `learned`) — unchanged.
3. **Code lookup**: `LabCodes.lookup(name, unit, material)`. A unique hit
   (or an S/P pair) whose row is linked to a catalog entry is that entry —
   no model. A hit on an unlinked row is a known test the catalog lacks:
   pre-fill a draft entry with its NČLP code, Czech name and unit.
4. **Shortlist + Haiku**: `shortlist(…, 20)` → `pick_code` (enum, strict,
   auto tool choice) → the picked row → its catalog entry, through the same
   `canApplyUnasked` gate as today, plus one new deterministic check: the
   picked row's material must agree with the printed prefix or heading.
   This replaces sending the whole 344-entry catalog per batch.
5. **Unknown / draft entry** — as today, now carrying the NČLP code when
   one was found.

Storing the NČLP code next to `canonicalId` on each row also gives the
portal a stable key for the day the catalog splits an ambiguous entry.

## Open

- Wire steps 3–4 into `workers/extract` `/api/map` and the portal (another
  branch is editing that code now).
- Drug levels and punctate fluids are outside the table on purpose; add the
  `DRUG` class (677 rows) if Moje krev starts showing them.
- Split the ambiguous catalog entries along their codes (the % vs fraction
  and mass vs molar ones first — that is also the open
  `convertToCanonical` issue in [lab-mapping.md](lab-mapping.md)).
- Replace our LOINC picks with ÚZIS's NČLP→LOINC mapping when it appears.
