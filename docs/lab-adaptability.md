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

## Phase C — tier 1, subagents (2026-09-06)

The free tier of the C4 ranking: Claude-shaped subagents read images, the
real API reads nothing. `subagent_dump_images.bench.ts` wrote each page as
the app would send it (`pages/<slug>.claude.jpg`, long edge 2576 px — the
Sonnet 5 tier, `CLAUDE_PHOTO_EDGE` in `corpora.ts`), `SYSTEM_EXTRACT` and
`TOOL` imported verbatim into `prompts/`, and the truth into `index.json`.
Scored with `BENCH_CLASSES=photo|public npx vitest run --config
tests/bench/vitest.config.ts tests/bench/subagent_score_images.bench.ts`,
re-run 2026-09-06 22:42 for this section.

### What was read

- **photo — 45 simulated shots** from `data/photos-sim` (the index holds
  133; `read 45` below): ten pages × `flat`/`angle`/`glare`/`dark` —
  `19_06_12` p1, `20_06_08` p1 (CASRI), `2020_09_213` p1 (PREVEDIG),
  `2022_07_01` p1, `2024_02_02` p1, `20_10_6` p1, `21_10_29` p1 (AGILAB),
  `2023_12_19` p1, `2024_06_07` p2, `2025_08` p1 (SPADIA) — plus four `crop`
  (`19_06_12`, `2022_07_01`, `2023_podzim_krev`, `2024_10_25`, p1 each) and
  one `twopage` (`19_06_12` p1–2). Truth `data/reports`, 1,633 rows.
- **public — 11 pages**, truth hand-transcribed in
  `tests/bench/public_sheets/*.json` (`breclav_hem_p80`, `breclav_p121`,
  `breclav_p122`, `bulovka_okbi`, `euc_p34`, `stod_p1`–`p5`,
  `unilabs_sk_p2`), 261 rows.
- **Readers:** Sonnet- and Opus-shaped subagents handed the system prompt
  and tool schema verbatim plus the image path, reading the image through
  the `Read` tool and writing the tool input to `out/<variant>/<slug>.json`.
  Seven pages per subagent, 18 subagents (7 + 7 photo, 2 + 2 public).

### The tables, as printed

photo — variants against `data/reports`, then the pair:

```
variant                pages read truth  rows match  miss extra valERR decens
opus_vision              133   45  1633  1621  1613    20     8      0      0
sonnet_vision            133   45  1633  1606  1598    35     8      0      0

pair                               pages single confirmed flagged UNCAUGHT caught 1-rdr ERR
opus_vision+sonnet_vision             45      0      1602      23        4      0         0
```

public — variants against `tests/bench/public_sheets/*.json`, then the pair:

```
variant                pages read truth  rows match  miss extra valERR decens
opus_vision               11   11   261   261   261     0     0      2      0
sonnet_vision             11   11   261   261   261     0     0      0      0

pair                               pages single confirmed flagged UNCAUGHT caught 1-rdr ERR
opus_vision+sonnet_vision             11      0       259       2        0      2         0
```

### What the misses are

Every photo miss, extra and UNCAUGHT row was opened; none is a wrong value.

- **`KO+diferenciál 5p.`** (12 misses each reader: `2024_02_02`, `20_10_6`,
  `21_10_29` × four conditions) is the AGILAB panel-marker row, value `#`.
  The baseline carries it as a row; every reader rightly skips it.
- **`Vazebná kapacita Fe` / `Saturace transf.-výp`** on `20_10_6` p1 (8 miss
  + 8 extra each; the four UNCAUGHT rows). That sheet clips its name column:
  the render shows `Vazebná kapacita I` — the first stroke of `Fe` — and
  `Saturace transf.-vý`. The baseline names came from the text layer, which
  has the full words. Both readers transcribed what is visible (Opus
  `Vazebná kapacita`, Sonnet `Vazebná kapacita I`; both `Saturace
  transf.-vý`) with the right values. The other AGILAB pages print the names
  in full and both readers read them in full, so the fix is one page's keys.
- **`S_TSH`, `S_T4 volný`, `S_T3 volný`, `S_Vitamin D celkový`,
  `S_Osteokalcin`** (Sonnet, 15 misses on `2024_06_07` p2
  `angle`/`glare`/`dark`) are qualitative rows, value `málo materiálu`.
  Sonnet's `flat` batch emitted them at `high` confidence; the batch reading
  the other three shots omitted them; Opus emitted all four. A prompt
  ambiguity — a qualitative result is a row — noted for Phase D.

On public, Opus's two `valERR` on `unilabs_sk_p2` are the compound CMV cells
`1,0 pozitívne` / `0,4 negatívne`: Opus returned `1,0` / `0,4` with the
qualifier only in `source_snippet`, Sonnet copied the whole cell as the
truth does. A cell-splitting convention, not a digit; the pair caught both.

### Adjudicated

Re-scored with `valueErrors`/`pairStats` from `score.ts` after two truth
edits: drop the `#` marker row from the photo truth, and key the two clipped
names on `20_10_6` p1 by the printed text. Photo truth becomes 1,621 rows.

| class | reader | truth | rows | match | miss | extra | value errors |
|---|---|---|---|---|---|---|---|
| photo | `opus_vision` | 1621 | 1621 | **1620** | 1 | 1 | **0** |
| photo | `sonnet_vision` | 1621 | 1606 | **1601** | 20 | 5 | **0** |
| public | `opus_vision` | 261 | 261 | 261 | 0 | 0 | 2 (CMV cells) |
| public | `sonnet_vision` | 261 | 261 | 261 | 0 | 0 | **0** |

Pair, photo: confirmed 1602, **flagged 23**, uncaught 1, caught 0. The 23
are the 15 qualitative rows (Opus has them, Sonnet does not) and 8 spellings
of the two clipped names over the four `20_10_6` shots; the residual
"uncaught" is the `dark` shot where both wrote `Vazebná kapacita I` with the
correct 69,6 — a name the truth cannot be keyed to satisfy both ways, not a
value. Pair, public: confirmed 259, flagged 2, uncaught 0. **Zero digit
errors for either reader on 1,882 rows over 56 pages; zero uncaught value
errors.** Confidence tracked the conditions, not errors: on `glare` Opus
marked 121 of 359 rows `low` and Sonnet 109 of 354; on `angle` Opus 78
`low`, Sonnet 107 `medium`; `flat` and `crop` were `high` throughout, and
none of those rows carried a wrong value.


### Synthetic class — the seven new layouts

The six text-layer fixtures (slash, hyphen/comma, Zkr. column, Slovak,
urine without prefix, mixed material; 43 expected rows) were read four ways:
the text path (`SYSTEM_EXTRACT_TEXT` over the page's `|`-joined rows, as a
digital PDF is read) and the vision path (the 220 DPI render), by Sonnet-
and Opus-shaped subagents. `scanned_photo_like` has no row truth yet.

```
variant                pages read truth  rows match  miss extra valERR decens
opus_text                 10    6    43    43    43     0     0      0      0
opus_vision               10    6    43    43    43     0     0      0      0
sonnet_text               10    6    43    43    43     0     0      0      0
sonnet_vision             10    6    43    43    43     0     0      0      0
```

Every pair: 43 confirmed, 0 flagged, 0 uncaught. The conventions that broke
the *parser* a day ago — `S/Sodík`, `S,P-glukóza`, `( * )`, `4,9000`,
`URE | urea`, `<1,0 negatívne` — never troubled the *reader*: both tiers
copied each cell as printed on the first attempt. That is the plan's
premise measured: adaptability lives in lab-core, not in the prompt.

### What tier 1 cannot tell us

- A subagent views the image through the `Read` tool and can look again,
  crop and zoom; the API gets one 2576 px image, one pass.
- `data/photos-sim` shots are pristine glyphs under synthetic warp, shadow
  and glare; real phone shots add blur, sensor noise and moiré (A4's photos).
- No latency and no cost are measured — a subagent has neither a page p50
  nor a token bill.
- The readers answered glare bands with `low` confidence rather than wrong
  values; whether the API path does the same is a tier-2 question.

So tier 1 ranks, tier 2 confirms.

### Ranking

Sonnet and Opus are indistinguishable on value accuracy at tier 1: neither
made a digit error on a photo or a public page. Opus reads slightly more
rows (1620 vs 1601 of 1621 — the qualitative rows Sonnet's batches dropped
on three shots). Two truth fixes are due before tier 2: drop the
`KO+diferenciál 5p.` marker row from the photo truth (a `#` cell, the class
A1 already excluded from its tally), and key the two clipped names on
`20_10_6` p1 by the printed text. With those, photo meets C3's bar (0
uncaught value errors on every shot including `angle`, `crop`, `twopage`);
public meets it once the compound-cell convention is settled in Phase D.

## Phase C — tier 2, the Gemini run (2026-09-06, $3.72)

Two arms of Google Gemini 3.8 Flash over the eleven public pages and all 133
simulated photos, 288 calls, approved by Ondřej beforehand. The arms differ
only in media resolution: `high` spends 1,120 visual tokens per image,
`ultra_high` 2,240. Thinking is `LOW` — `MINIMAL` is in the SDK enum and the
model rejects it with a 400 (the first attempt: 288 calls, $0.00).

### Was that a fair setting?

Yes, and it is measured rather than assumed. The deployed Claude readers force
a tool call, which suppresses thinking entirely (docs/extraction-speed.md,
"Turning thinking off"). Of the 288 Gemini calls at `LOW`, **one** returned any
thinking tokens at all. Both sides transcribe without reasoning.

### On the identical 45 photo pages, 1,621 rows

```
variant                pages read truth  rows match  miss extra marker valERR decens
gemini38_ultra           133   45  1621  1625  1620     1     5     12      0      0
gemini38_high            133   45  1621  1630  1615     6    15     12      0      0
opus_vision              133   45  1621  1621  1621     0     0     12      0      0
sonnet_vision            133   45  1621  1606  1606    15     0     12      0      0
```

**Nobody misread a value.** Four readers, 1,621 rows, zero value errors and
zero decensored rows each. The column that would have disqualified a reader
stayed empty for all of them.

What separates them is which rows they return, and every divergence is a
judgement call rather than a misread:

- Gemini emits the AGILAB panel line `KO+diferenciál 5p.`, whose printed value
  is `#`. Both Claude readers omit it. It is printed, so this is a defensible
  reading, but it is not a measurement and lab-core cannot map it — four
  spurious rows that would reach the mapping tab. Four of Gemini ultra's five
  "extras".
- The fifth is `Vazebná kapacita l` on the sheet that clips its name column:
  the same clipped glyph the Claude readers rendered as `I`. Now aliased.
- Sonnet's fifteen misses are the `málo materiálu` rows it declined to treat
  as results — the same prompt ambiguity tier 1 found.

So the honest ranking on photos is: **Opus and Gemini ultra tied at the top,
Sonnet last**, and the gap is about which rows count as rows, not about
reading digits.

### Resolution: ultra earns its tokens

`ultra_high` beats `high` on the same pages — 1,620 matched against 1,615, one
miss against six, five extras against fifteen. The extra 1,120 visual tokens
cost about **$0.001 per page**. There is no reason to run `high`.

### On the eleven public sheets, 261 rows

```
variant                pages read truth  rows match  miss extra marker valERR decens
gemini38_high             11   11   261   261   247    14    14      0      0      0
gemini38_ultra            11   11   261   261   247    14    14      0      0      0
opus_vision               11   11   261   261   261     0     0      0      2      0
sonnet_vision             11   11   261   261   261     0     0      0      0      0
```

Again zero value errors for Gemini. All fourteen of its misses are one page —
Břeclav p122 — where it returned `URE urea` instead of `urea`, folding the
`Zkr.` abbreviation column into the name. It read the same layout correctly on
p121. This is Phase D item 3 exactly: the prompt never mentions an
abbreviation column, and the Claude readers were told about it in their brief.
The prompt owes Gemini that sentence before any verdict on this class.

Opus's two errors are the Unilabs compound cells (`1,0 pozitívne` returned as
`1,0`); the pair catches both.

### Pairs — and why the second reader must come from elsewhere

```
pair                               pages single confirmed flagged UNCAUGHT
gemini38_ultra+opus_vision            45      0      1620       6        0
gemini38_ultra+sonnet_vision          45      0      1605      21        0
gemini38_high+gemini38_ultra          45      0      1618      19        3
opus_vision+sonnet_vision             45      0      1606      15        0
```

Every cross-vendor pair reaches **zero uncaught errors**, which is the bar.
The one pair that does not is the two Gemini arms against each other: three
rows where both made the same call and neither caught the other. That is the
whole argument for a second reader from another vendor, arriving as a
measurement instead of an assumption.

### What this does not yet settle

Gemini has not been given the abbreviation-column sentence, so its public-sheet
number is a prompt artefact, not a ceiling. These are still simulated photos.
And nobody has been measured at Sonnet's visual budget: Sonnet sees 4,784
tokens per page, Gemini ultra 2,240. The tiled arm exists to close that gap.
