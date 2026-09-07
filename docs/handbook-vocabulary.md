# Vocabulary from three public laboratory handbooks

Phase F of [the lab-adaptability plan](plans/lab-adaptability.md). Phase A took
*layouts* from public sheets; this takes **vocabulary** — the analyte names,
unit spellings and reference-range notations Czech and Slovak labs actually
print, from labs whose result sheets we have never seen.

A handbook is reference material, not a patient report, so there is no PHI and
no consent question. **Nothing from the PDFs is committed except extracted
facts** — a unit string, a range spelling, an analyte name. The files themselves
live under git-ignored `data/handbooks/`, and no test fetches a URL.

## The three sources

| Slug | Lab | Pages | sha256 |
|---|---|---|---|
| `synlab_sk.pdf` | synlab slovakia s.r.o., *Laboratórna príručka* VD.LAB-SK 03 v02 | 46 | `0f57a1d4b07506b3122f0db78cdbb82226ecf6e1153e72a831396ac7b5162d25` |
| `fnhk_hematologie.pdf` | FN Hradec Králové, laboratoř IV. interní hematologické kliniky, *Laboratorní příručka* v17 | 37 | `7823760d34dec5f0d1f0c890b96c3be3f1dcf0505a1ef246d721460c40c090de` |
| `spadia_brno.pdf` | SPADIA LAB Brno, *Laboratorní příručka*, vydání 11 | 169 | `a26b63677f759769bced91e16f99b9eb4d9ddae370bcc6ecd10169941a3f5ede` |

URLs, as fetched 2026-09-08:

- <https://www.synlab.sk/fileadmin/user_upload/VD.LAB-SK_03_Laborat%C3%B3rna_pr%C3%ADru%C4%8Dka.pdf>
- <https://www.fnhk.cz/content/files/download/2806/laboratorni-prirucka.pdf>
- <https://www.spadia.cz/media/4iknexkb/laboratorni-prirucka-brno.pdf>

The FNHK URL named in the plan
(`.../fs157/laboratorni-prirucka-laboratore-iv.-interni-hematologicke-kliniky-verze-12.pdf`)
now returns a 404 HTML page, as do the `verze-14` and `verze-c.16` successors
that a search still lists. The link above is the one the clinic's own
[laboratory page](https://www.fnhk.cz/int-4h/lab) currently serves, and it is
the same document at version 17. `curl` writes an HTML error page under the
requested filename without failing, so **check `file` on the download** — that
is how the dead link was caught.

Text was extracted with PyMuPDF 1.28.2 in the scratch venv.

## What was extracted, and the yield

| Axis | Distinct forms extracted | Genuinely unhandled | Turned into parity cases |
|---|---|---|---|
| Analyte names | 743 name-shaped cells — 122 SPADIA analyte sections, 165 FNHK reference-table methods, the rest headings and prose | 1 that normalises *wrongly*, 2 conventions the code cannot see (all three below) | 0 |
| Unit strings | 69 | 10 | 13 (10 fixes + 3 guards) |
| Reference-range notations | 1 406 range-shaped cells in 371 distinct shapes | 12 | 17 (12 fixes + 5 new guards) |
| Value notations | 1 936 short value-shaped cells in 458 distinct shapes | 0 | 0 |

**4 154 distinct printed forms in, 22 genuine failures out, 30 parity cases
added** (the extra eight are the guards that hold each widening in place). The
fixture went from 105 cases to 135. Three more forms failed and were
deliberately left alone, with reasons, below.

The zero on the value axis is a result, not a gap: every value notation these
three labs print — `4,9000`, `0,15*`, dot decimals (`10.4`), the Slovak
qualitatives — already parsed correctly, because Phase B took those forms from
the sheets themselves.

Names were checked twice: through `norm_key`/`normKey`, and through the shipped
registry index. Thirty-nine handbook names resolve to a canonical id and **all
thirty-nine resolve correctly**, Slovak spellings included (`Hemoglobín` →
`hemoglobin`, `Homocysteín` → `homocystein`, `Inzulín` → `inzulin`). No handbook
name collided with the wrong analyte.

## Cases added, with the reason

Every case went into `tools/pipeline/tests/parity_cases.json` **first**, was
watched failing on both sides, and only then was implemented in
`tools/pipeline/src/normalize.py` and `packages/lab-core/src/normalize.ts`
together. Twenty-two of the thirty failed on first run (the eight guards passed
already — their job is to keep passing).

### `canonicalize_unit` — micro has an ASCII spelling

| Case | Before | After | Printed in |
|---|---|---|---|
| `umol/l` | `umol/l` | `µmol/l` | synlab p43 (critical values), SPADIA p124 |
| `ug/l` | `ug/l` | `µg/l` | SPADIA p34, test list (`Troponin I \| S, B \| ug/l`) |
| `ug/den` | `ug/den` | `µg/den` | SPADIA p92, kortizol |

A lab whose LIS cannot emit `µ` prints `u`. Unfolded, its `umol/l` creatinine is
a different unit from every other lab's `µmol/l` creatinine, which is exactly
the line-up `canonicalizeUnit` exists to make. The fold is **lowercase only and
only before a stem that has a micro form** (`mol`, `kat`, `g`, `l`), because `U`
is the enzyme unit — the guards `U/l`, `IU/ml` and `mIU/l` pin that.

### `canonicalize_unit` — the count units lose their superscript

| Case | Before | After | Printed in |
|---|---|---|---|
| `109/l` | `109/l` | `10^9/l` | SPADIA p35 |
| `109 /l` | `109 /l` | `10^9/l` | SPADIA p106, p111 |
| `x 109/l` | `x 109/l` | `10^9/l` | FNHK p23, 24, 25, 28, 29 |
| `x 109/L` | `x 109/l` | `10^9/l` | FNHK p11 |
| `x109/ l` | `x109/ l` | `10^9/l` | synlab p43 |
| `x 1012/l` | `x 1012/l` | `10^12/l` | FNHK p23, p29 |

All three handbooks print leukocytes and platelets as `x 10⁹/l` with a genuine
superscript span (confirmed by the span sizes: 6.7 pt against 10 pt body, raised
5 pt). A PDF text layer — ours included — flattens that to `x 109/l`, so this is
what the text path actually receives, and the registry's canonical unit is
`10^9/l`. The fold takes an optional `x`/`×`/`*` multiplier, any of `^ ˄ * E e`
or nothing as the separator, and **only the exponents labs use** (3, 6, 9, 12),
so a US-style `x1000/µl` is left alone.

### `canonicalize_unit` — spacing around the solidus

| Case | Before | After | Printed in |
|---|---|---|---|
| `μmol / 24 h` | `µmol / 24 h` | `µmol/24 h` | SPADIA p111 |

SPADIA prints both `µmol/24 h` and `µmol / 24 h` in the same document. One
analyte, two unit keys, from one lab.

Guards added beside these: `mmol/mol` (HbA1c IFCC, SPADIA p78), `IU/ml` (FNHK
p34) and `mIU/l` (SPADIA p34) must come back untouched, so neither the micro,
exponent nor solidus rule may disturb an ordinary unit.

### `parse_range` — the interval carries its unit

| Case | Before | After | Printed in |
|---|---|---|---|
| `7,8 - 12,8 fl` | text | 7,8 – 12,8 | FNHK p24, MPV |
| `0,12 - 0,35 %` | text | 0,12 – 0,35 | FNHK p24, PCT |
| `0,00 - 0,50 mg/l FEU` | text | 0,00 – 0,50 | FNHK p32, D-dimery |
| `3,40 – 4,10 mmol/l` | text | 3,40 – 4,10 | SPADIA p116, LDL band |
| `0,8 - 1,2 poměr` | text | 0,8 – 1,2 | FNHK p34, lupus antikoagulans |
| `2 - 5 min.` | text | 2 – 5 | FNHK p31, krvácivost Duke |
| `0 - 0,007 x 109/l` | text | 0 – 0,007 | FNHK p29, KO z likvoru |
| `< 50 ng/ml` | text | ≤ 50 | FNHK p34, gatrany |
| `< 125 pg/ml` | text | ≤ 125 | SPADIA p130, NT-proBNP |
| `> 4,10 mmol/l` | text | ≥ 4,10 | SPADIA p116, LDL band |
| `> 4g/den` | text | ≥ 4 | SPADIA p58, proteinurie |
| `nad 120 min.` | text | ≥ 120 | FNHK p34, euglobulinová fibrinolýza |

This is the single highest-yield class. Every one of these degraded to text
today, which means the value was never flagged against the range the lab
printed. Note `> 4g/den`: no space between the number and the unit.

The rule reads a trailing cell of **at most three words** as the unit and drops
it. Two closed Czech/Slovak vocabularies say the numbers in front are *not* an
interval, and both are pinned as guards:

| Guard | Stays | Why |
|---|---|---|
| `0 - 15 let` | text | the numbers are ages — FNHK prints its bands in this shape |
| `15 - 150 let ženy` | text | same, with a sex qualifier after it |
| `nad 18 let` | text | an age band on the one-sided path |
| `do 24 hodin` | text | a turnaround time, not a bound |
| `<1,0 negatívne` | text | a criterion — the numbers define a category (already in the fixture since Phase B; it now also guards this rule) |
| `0,5 - 2 MKC /1 zorné pole,` | text | four words — the three-word cap |

Anything *else* after the numbers only names the population the interval belongs
to (`muži`, `nekuřáci`), and accepting it costs nothing because the interval
still stands.

## Both implementations checked against every extracted form

The fixture pins 135 cases. As a wider check the two implementations were run
over **all 73 extracted unit strings and all 1 413 range cells** (plus
`x1000/µl`, `ml/s/1,73 m2`, `10*9/l`, `10E9/l` and a range whose unit sits on the
next text line) and their outputs compared field by field: **identical on all
1 486**. That is the property the twice-exists rule is protecting, tested on the
whole corpus rather than on the sample that reached the fixture.

## The four faults, reintroduced and watched failing

Per docs/constraints.md, "a guard that has never been seen to fail is a guard
nobody has tested". Each was applied to both implementations, both suites run,
then restored.

| Fault | Python | TypeScript |
|---|---|---|
| Fold the ASCII micro case-insensitively and before any letter — the naive widening | 3 fail: `U/l` → `µ/l`, `IU/ml` → `Iµ/ml`, `mIU/l` → `mIµ/l` | `canonicalizeUnit` fails |
| Drop the `x`/`×`/`*` multiplier from the exponent rule | 4 fail: `x 109/l`, `x 109/L`, `x109/ l`, `x 1012/l` all left unfolded | `canonicalizeUnit` fails |
| Accept any trailing cell as a unit (no deny-list) | 5 fail: `0 - 15 let` → 0–15, `15 - 150 let ženy` → 15–150, `nad 18 let` → ≥18, `do 24 hodin` → ≤24, `<1,0 negatívne` → ≤1,0 | `parseRange` fails |
| Lift the three-word cap on the trailing cell | 1 fails: `0,5 - 2 MKC /1 zorné pole,` → 0,5–2 | `parseRange` fails |

The third is the one worth keeping in mind: without the deny-list this widening
turns an age band into a reference interval, and every paediatric row on an
FNHK-shaped sheet would then be judged against ages instead of values.

## Extracted, examined, and deliberately not turned into a case

### Material printed as a *suffix* — `Glukóza - U` (SPADIA, ~25 analytes)

SPADIA's handbook index prints the material after the name: `Glukóza - U`,
`Kreatinin - U`, `Amyláza celková - U`, `Kortizol volný - U`, `Bílkovina celková
- U`. `materialPrefix` returns null for all of them, and `normKey` keeps the
code inside the key (`kreatinin u`), so they simply stay unmapped — safe, and
the mapping tab handles them.

Not implemented, for two reasons. First, SPADIA's own result sheets do not use
it: the handbook states the sheet prints `S-sérum, P-plasma, B-krev, U-moč,
dU-moč za 24 hod.` (p35), i.e. the hyphen *prefix* the fixture already covers.
The suffix is an index convention, to sort alphabetically by analyte. Second,
recognising it would make `normKey("Kreatinin - U")` return `kreatinin` — and
Python's `Registry.match` is name-only (`packages/lab-core/CLAUDE.md`: "Python's
`match` has no page material and stays name-only"), so the Python pipeline would
start auto-mapping urine creatinine onto the serum analyte. That is strictly
worse than today. It becomes safe once the Python side gains B7's material
check; noted as an open item on the plan.

### Slovak material in words — `Glukóza v sére` (synlab, critical-value table)

`Glukóza v sére`, `Draslík v sére`, `ALT v sére`, `Kreatinín v sére`. Same
verdict for the same reason, and the same phrase would have to be stripped from
the key to be useful.

### `L-dopa` / `L-DOPA` (SPADIA, interference lists)

This one really is wrong today: `materialPrefix("L-dopa")` returns `l` (likvor)
and `normKey` returns `dopa`, losing the stereochemical descriptor that
distinguishes levodopa from dopamine. It is not fixed here because it cannot be
fixed by *widening*: `L-` before a lowercase word is exactly the shape of
`S,P-glukóza`, so no rule separates a liquor prefix from a chirality prefix
without naming one of them. Both handbook occurrences are prose in an
interference list, not an offered analyte, so the honest move is to record it
rather than trade one wrong answer for another. Open item on the plan.

### `kat/l` for ALT (synlab p43)

A typo in the handbook — the unit is `µkat/l`. Not ours to canonicalise.

### `0,0 - 8,3/100 WBC`, `1,3 - 4,6 : 1`, `14 - 18 s (až 23 s)`

The first now parses as 0,0–8,3 (a "per 100 white cells" denominator is a unit).
The other two stay text: `: 1` does not start like a unit, and the parenthetical
second bound is four words. Both are bone-marrow and coagulation notations
outside the app's blood-trend scope, so no case was added either way.

## Deferred to `make_layout_fixtures.py` — layout, not vocabulary

These are things the handbooks show that a *string* rule cannot reach. They
belong in a font-locked fixture, not in the parity contract.

1. **A superscript exponent split across spans.** `x 10⁹/l` is three spans —
   `x 10` at 10 pt, `9` at 6.7 pt raised 5 pt, `/l` back at 10 pt. Today the
   text path flattens it and `canonicalizeUnit` repairs the result, which is why
   this phase could handle it as vocabulary. A fixture that prints a real raised
   `9` would let `pdf/rows.ts` be tested on whether it *keeps the reading order*
   — the failure mode is `x 10/l9`, which no unit rule can undo.
2. **A reference range split across two columns.** FNHK's Příloha 3 prints
   `dolní mez` and `horní mez` as separate columns with the analyte name and
   unit spanning both. SPADIA does the same for its age/sex tables. Nothing in
   `parseRange` sees a range at all here; the row builder has to join the cells.
3. **A unit that lives in the header, not the row.** FNHK prints the unit once
   beside the method name (`LEUKOCYTY … x 10⁹/l`) and then a column of bare
   intervals under it. A prefix-free version of the `mixed_material.pdf`
   problem, one column over.
4. **An interval whose two halves sit on different text lines.** SPADIA's
   `Referenční meze: věk / koncentrace` blocks wrap, so `0-100 r.` and
   `34 - 48` arrive as separate rows.
5. **A per-sex reference block.** `nad 18 let muži 65 - 140` / `nad 18 let ženy
   50 - 140` on consecutive lines under one analyte (FNHK p32, Protein S). The
   *cells* parse; choosing which one applies is a row-assembly question.

## Reproducing

```sh
mkdir -p data/handbooks && cd data/handbooks
curl -sSL -A "Mozilla/5.0" -o synlab_sk.pdf         "<synlab URL above>"
curl -sSL -A "Mozilla/5.0" -o fnhk_hematologie.pdf  "<FNHK URL above>"
curl -sSL -A "Mozilla/5.0" -o spadia_brno.pdf       "<SPADIA URL above>"
file *.pdf && shasum -a 256 *.pdf     # HTML error pages arrive with a 200-shaped name
```

`data/` is git-ignored and `.claude/hooks/privacy-guard.mjs` refuses to stage
it, so the PDFs cannot reach the repository by accident.
