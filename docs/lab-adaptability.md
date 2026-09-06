# Reading a lab sheet we have never seen — the corpus and the numbers

Plain-language record of [the lab-adaptability plan](plans/lab-adaptability.md)
as it is carried out: what the corpus is, what was wrong in the accepted
reports everything is scored against, and what each phase's numbers say. The
harness is [`tests/bench/`](../tests/bench/); its results directory is
git-ignored because it is derived from real PDFs, so every figure here is
hand-copied from a named run rather than read from a file. Where a number
disagrees with [docs/extraction-speed.md](extraction-speed.md), this document
is the later one.

## A1 — the accepted reports were wrong in nine rows

`data/reports/*.json` is the incumbent's output, accepted in the verify tab in
2025, and `loadBaseline()` in `tests/bench/score.ts` keys every benchmark on
it. docs/extraction-speed.md's subagent run found nine rows where both new
reads disagreed with it and the printed row sided with the reads. Corrected
2026-09-06 against `results/subagent/pages/<stem>__p<N>.rows.txt` (the text
layer, cells joined with `|`); backups in `data/reports/_backup_2026-09-06/`.
Derived fields (`value`, `unit`, `ref_range_low/high`, `flag`) were recomputed
the way `packages/lab-core/src/normalize.ts` does; no flag and no
`canonical_id` changed. Each row carries `corrected: true` — the verify tab's
"ručně opraveno" chip.

| Report (page) | Row | Was | Now | Printed row that decides it |
|---|---|---|---|---|
| 2020_09_213 PREVEDIG (p1) | `B_Neutrofily` | 4,50 10^9/l · 2,00 - 7,00 | 0,693 bezrozm. · 0,450 - 0,700 | row 21: `B_Neutrofily \| bezrozm. \| 0,693 \| … \| 0,450 - 0,700` |
| 2020_09_213 PREVEDIG (p1) | `B_Lymfocyty` | 1,30 10^9/l · 0,80 - 4,00 | 0,201 bezrozm. · 0,200 - 0,450 | row 22: `B_Lymfocyty \| bezrozm. \| 0,201 \| … \| 0,200 - 0,450` |
| 2020_09_213 PREVEDIG (p1) | `B_Monocyty` | 0,50 10^9/l · 0,00 - 1,20 | 0,078 bezrozm. · 0,020 - 0,120 | row 23: `B_Monocyty \| bezrozm. \| 0,078 \| … \| 0,020 - 0,120` |
| 2020_09_213 PREVEDIG (p1) | `B_Eozinofily` | 0,10 10^9/l · 0,00 - 0,50 | 0,015 bezrozm. · 0,000 - 0,050 | row 24: `B_Eozinofily \| bezrozm. \| 0,015 \| … \| 0,000 - 0,050` |
| 2020_09_213 PREVEDIG (p1) | `B_Bazofily` | 0,10 10^9/l · 0,00 - 0,20 | 0,013 bezrozm. · 0,000 - 0,020 | row 25: `B_Bazofily \| bezrozm. \| 0,013 \| … \| 0,000 - 0,020` |
| 19_10_31 CASRI (p2) | `25-hydroxyvitamin D` (first of two) | 76,7 nmol/l · 75,0 - 250 | 30,7 ng/ml · 30,0 - 100 | row 17: `KOSTI \| 25-hydroxyvitamin D \| 30,7 \| ng/ml \| 30,0 \| - \| 100 \| (X)` |
| 20_06_08 CASRI (p2) | `25-hydroxyvitamin D` (first of two) | 58,3 nmol/l · 50,0 - 180 | 23,3 ng/ml · 20,0 - 72 | row 19: `KOSTI \| 25-hydroxyvitamin D \| 23,3 \| ng/ml \| 20,0 \| - \| 72 \| (X)` |
| 20_10_6 AGILAB (p1) | `Vazebná kapacita F` (Sonnet) + `Vazebná kapacita` (Opus) | two rows, 69,6 µmol/l each | one row, `Vazebná kapacita Fe`, 69,6 µmol/l · 45,0 - 80,0 | row 42: `81629 \| Vazebná kapacita Fe \| 69,6 \| … \| 45,0 - 80,0 \| μmol/l` |

Three things the corrections taught, worth more than the rows themselves:

- **The differential on the PREVEDIG sheet prints fractions as `bezrozm.`**
  (0,693), not as `%`. The five fraction rows in the accepted report carried
  the absolute counts from the block printed five rows lower — Opus's read
  had won the reconciliation with Sonnet's correct one. The absolute-count
  rows (`B_Neutrofily.` with a trailing dot) were also present and right, so
  the report said "4,50" twice and "0,693" never.
- **The nmol/l vitamin D line *is* printed.** extraction-speed.md called it
  a unit conversion the page never showed; in fact CASRI prints a
  continuation row (`76,7 | nmol/l | 75,0 - 250`) directly under the ng/ml
  row, and the second baseline row already carried it correctly. The defect
  was the *first* row, which held the converted value in place of the
  printed `30,7 ng/ml`. So the row was replaced, not deleted, and the
  ng/ml → nmol/l pair stays two rows because the lab prints two.
- **The split row was a name, not a value.** Sonnet read `Vazebná kapacita
  F`, Opus `Vazebná kapacita`, the reconciler saw two analytes, and both were
  flagged "found by one reader only". Merged under the printed name; the
  two readers of 2026-09-02 both return `Vazebná kapacita Fe`.

Nine rows in the accepted reports: five fractions, two vitamin D, and the
split row counted as the two baseline rows it occupied. The baseline is now
877 rows, one fewer.

### What the score did

`npx vitest run --config tests/bench/vitest.config.ts tests/bench/subagent_score.bench.ts`
(free — it rescores the stored reads), before and after the correction, on
the two real-API arms of 2026-09-02:

| arm | matched | value errors | range errors | extra | missing | uncaught real misses |
|---|---|---|---|---|---|---|
| `api_haiku_text`, before | 851 / 878 | 7 | 41 | 1 | 27 | 2 |
| `api_haiku_text`, after | **852 / 877** | **0** | 34 | 0 | 25 | **0** |
| `api_sonnet_text`, before | 843 / 878 | 7 | 41 | 1 | 35 | 2 |
| `api_sonnet_text`, after | **844 / 877** | **0** | 34 | 0 | 33 | **0** |

"Uncaught real misses" is `missing` minus the non-result lines the accepted
reports counted (`Krev srážlivá`, `KO+diferenciál 5p.` and the like, 9) minus
the qualitative rows the deterministic candidate rule catches. Every value
error either arm had was one of the nine; the 34 remaining range
disagreements are one SPADIA page whose ranges the reads return in
parentheses as printed, `(4,11-5,60)`, and the accepted report stripped. The
subagent arms moved the same way (`sonnet_text` 852 → 853, `haiku_text`
841 → 842, value errors 7 → 0 on all three text arms).

## Phase A — the corpus

### Real reports

Fifteen blood panels from four labs, under git-ignored `samples/`, keyed by
`source_file` in `data/reports`. Page classes are the harness's
(`results/subagent/index.json`): a page with a usable text layer is
`text`, one without is `scan` — the three scans are SPADIA third pages (a
footer carrying only the VirtualLab link, and two `Interpretace:` /
`Razítko:` pages whose only bitmap is the stamp), not scanned results
tables. Rows are the accepted measurements per page after A1.

| PDF | Lab | Report date | Pages | Baseline rows |
|---|---|---|---|---|
| `19_06_12.pdf` | CASRI Praha | 2019-06-12 | 2 text | 45 (38 + 7) |
| `19_10_31.pdf` | CASRI Praha | 2019-10-31 | 2 text | 48 (31 + 17) |
| `20_06_08.pdf` | CASRI Praha | 2020-06-08 | 2 text | 51 (31 + 20) |
| `2020_09_213.pdf` | PREVEDIG | 2020-09-21 | 2 text | 53 (42 + 11) |
| `20_10_6.pdf` | AGILAB group (OpenLIMS, STAPRO) | 2020-10-02 | 2 text | 46 (36 + 10) |
| `21_10_29.pdf` | AGILAB group (OpenLIMS, STAPRO) | 2021-10-27 | 2 text | 39 (37 + 2) |
| `2022_07_01.pdf` | AGILAB group (OpenLIMS, STAPRO) | 2022-07-01 | 2 text | 53 (36 + 17) |
| `2022_10_17_krev.pdf` | AGILAB group (OpenLIMS, STAPRO) | 2022-10-17 | 2 text | 53 (37 + 16) |
| `2024_02_02.pdf` | AGILAB group (OpenLIMS, STAPRO) | 2024-02-01 | 2 text | 58 (42 + 16) |
| `2023_podzim_krev.pdf` | SPADIA LAB, Ostrava | 2023-09-20 | 3 text | 71 (32 + 39 + 0) |
| `2023_12_19.pdf` | SPADIA LAB, Ostrava | 2023-12-19 | 2 text + 1 scan | 58 (31 + 27) |
| `2024_06_07.pdf` | SPADIA LAB, Ostrava | 2024-06-07 | 2 text + 1 scan | 69 (34 + 35) |
| `2024_10_25.pdf` | SPADIA LAB, Ostrava | 2024-10-25 | 2 text + 1 scan | 67 (34 + 33) |
| `2025_07_11.pdf` | SPADIA LAB, Ostrava | 2025-07-11 | 3 text | 83 (34 + 45 + 4) |
| `2025_08.pdf` | SPADIA LAB, Ostrava | 2025-08-15 | 3 text | 83 (34 + 45 + 4) |
| **15 files** | AGILAB 5 · SPADIA 6 · CASRI 3 · PREVEDIG 1 | | **33 text + 3 scan** | **877** |

The LIS vendor is printed only by AGILAB (`OpenLIMS STAPRO s. r. o.` in the
header of every sheet); SPADIA, CASRI and PREVEDIG name none. Conventions
the four labs cover between them: material prefix `S_`/`B_`/`PE_`/`xxx_`
with underscore (PREVEDIG, SPADIA), no prefix at all with numeric urine rows
(AGILAB), no prefix with ALL-CAPS section labels in the first cell and the
range split over three cells `30,0 | - | 100` (CASRI), fractions as
`bezrozm.` (PREVEDIG), an accreditation `A` and a lab code before the name
(AGILAB), a unit column before the value (PREVEDIG), and a `#` marker cell
(PREVEDIG). Also under `samples/`, not lab sheets and with no baseline: 18
performance-test PDFs and 2 tHb-mass PDFs.

### Public sheets

Downloaded 2026-09-06 into git-ignored `data/public-sheets/`
(`SOURCES.md` there has the URLs). Four pages are actual result sheets with
fictitious or blurred patients; the rest of those handbooks carry naming
conventions only.

| Page | Source | Language | Conventions we had never seen |
|---|---|---|---|
| `breclav.pdf` p121 | Nemocnice Břeclav, laboratory handbook appendix 8 "Výsledkový list (vzor)" | Czech | no material prefix; a `Zkr.` abbreviation column before the name; four-decimal values (`4,9000`); ranges in spaced parentheses `( 2,5000 - 6,4000 )`; an `H` flag cell between value and unit; trailing signature cells |
| `breclav.pdf` p122 | same sheet, second page | Czech | as above, continued |
| `euc.pdf` p34 | EUC Klinika Ostrava handbook, sample sheet, patient "Novák Jan" | Czech | slash prefix (`S/Sodík`, `B/Hemoglobin`); a `Hodnocení` column carrying `( * )`; out-of-range values in red |
| `unilabs_sk_smartreports.pdf` p2 | Unilabs Slovakia SmartReports 2024, patient "XY YZ" | Slovak | `Výsledok`, `Hodnotiace kritériá`, `negatívne`; grouped sections; a separate `Materiál` column; accreditation icons inside the row |

Conventions-only pages (critical-value tables, no sheet): `spadia_havirov.pdf`
p18 (`S_`, `P_` underscore), `euc.pdf` p32 (`S-`, `S,P-`, `U-` hyphen and
comma), `opocno.pdf` p12 (no prefix), `revma.pdf` p27.

### Synthetic fixtures

TODO — the seven layout fixtures of plan step A3 (`slash_prefix`,
`hyphen_comma_prefix`, `zkr_column`, `slovak_grouped`, `urine_no_prefix`,
`mixed_material`, `scanned_photo_like`) are being generated through
`tools/pipeline/scripts/make_layout_fixtures.py`; list them here with their
expected row counts once `layouts.test.ts` covers them.
