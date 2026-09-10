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

## Phase C — the tiled arm, and a clean negative result (2026-09-07, $2.16)

Gemini spends a fixed visual budget per image part, and `ultra_high` is the top
of that ladder at 2,240 tokens — roughly half what Sonnet 5 spends on the same
page. The way to spend more is to send the page as several parts. This arm cuts
each page into a top and bottom half overlapping by a twelfth of the page, so
no printed row is severed, and gives each half its own `ultra_high` budget:
**4,784 input tokens per page, the same number Sonnet spends.**

The overlap is the risk. On the densest sheet seven measured rows and a section
heading appear whole on *both* halves, so the arm composes one Czech sentence
onto the prompt — never onto `SYSTEM_EXTRACT` itself — telling the model it
holds two overlapping halves of one page and owes each row exactly once.

### It bought nothing

```
variant                pages read truth  rows match  miss extra marker valERR decens
opus_vision              133   45  1621  1621  1621     0     0     12      0      0
gemini38_ultra           133   45  1621  1625  1621     0     4     12      0      0
gemini38_tiled           133   45  1621  1628  1621     0     7     12      0      0
gemini38_high            133   45  1621  1630  1618     3    12     12      0      0
sonnet_vision            133   45  1621  1606  1606    15     0     12      0      0
```

Tiled matched all 1,621 rows — and so did `ultra_high` at half the tokens and
half the price. Doubling the visual budget changed nothing a reader could use.
**`ultra_high` is the production setting**, and the question of whether Gemini
was handicapped by resolution is closed: it was not.

The de-duplication held completely. All seven of the tiled arm's spurious rows
are the same panel line `KO+diferenciál 5p.`, whose printed value is `#`. Not
one row was returned twice across 45 tiled pages, which is the outcome the
overlap band was most likely to spoil.

### The pairs, all five readers

```
pair                               pages confirmed flagged UNCAUGHT
gemini38_ultra+opus_vision            45      1621       4        0
gemini38_tiled+opus_vision            45      1621       7        0
gemini38_ultra+sonnet_vision          45      1606      19        0
opus_vision+sonnet_vision             45      1606      15        0
gemini38_tiled+gemini38_ultra         45      1624       5        3
gemini38_high+gemini38_ultra          45      1620      15        2
gemini38_high+gemini38_tiled          45      1622      14        4
```

Every cross-vendor pair: **zero uncaught errors**. Every same-vendor pair: two
to four. Three arms of one model share their blind spots; two vendors do not.
That was the reason for pairing across vendors, and it is now a measurement.

The best pair is Gemini ultra with Opus — every row confirmed, four flagged for
review. Gemini with Sonnet confirms fifteen fewer and flags nineteen, and the
whole difference is Sonnet's `málo materiálu` rows. **That is a prompt
ambiguity, not a reason to pay for Opus**: Phase D should tell the reader a
qualitative result is a result, and this pair should then be re-measured before
anyone reaches for the more expensive model.

### Phase C spend

| Run | Calls | USD |
|---|---|---|
| First Gemini attempt (rejected `MINIMAL` thinking) | 288 | 0.00 |
| Gemini `high` + `ultra_high` | 288 | 3.72 |
| Gemini tiled | 144 | 2.16 |
| Every Claude arm, all classes, tier 1 | — | 0.00 |
| **Total** | | **5.88** |

## Phase C — the full photo comparison, all 133 pages (2026-09-07)

Both Claude readers were extended from 45 pages to all 133 on subagents, at no
cost, so every arm now covers the same corpus: 3,677 truth rows across 32
source pages from four labs, each shot flat, angled, glared and dark, plus
crops and one two-page frame.

```
variant                pages read truth  rows match  miss extra marker valERR decens
gemini38_ultra           133  133  3677  3673  3663    14    10     16      0      0
gemini38_tiled           133  133  3677  3674  3663    14    11     16      0      0
opus_vision              133  133  3677  3657  3649    28     8     16      0      0
gemini38_high            133  132  3643  3644  3626    17    18     16      0      0
sonnet_vision            133  133  3677  3618  3614    63     4     16      0      0
```

**Zero value errors, five readers, 3,677 rows.** The column that disqualifies
a reader is empty for every one of them at full scale. Whatever separates
these models on this corpus, it is not their ability to read a printed number.

Sonnet's 63 misses are the largest gap and they are almost entirely one thing:
rows whose printed result is a status rather than a number. The Sonnet batches
contradicted *each other* on these, some transcribing `málo materiálu` and
others omitting it, from the same prompt. **That is a missing sentence in
`SYSTEM_EXTRACT`, not a weakness in the model**, and it is Phase D's item.
Note the asymmetry honestly: the Opus batches were told the rule explicitly
after the Sonnet ones had run, so part of Opus's lead here was a better brief.

### The pairs, and a correction to what they prove

```
pair                               pages confirmed flagged UNCAUGHT
gemini38_ultra+opus_vision            133      3647      36        0
gemini38_tiled+opus_vision            133      3649      33        0
gemini38_ultra+sonnet_vision          133      3612      67        0
gemini38_high+opus_vision             133      3610      81        0
opus_vision+sonnet_vision             133      3614      47        4
gemini38_tiled+gemini38_ultra         133      3668      11        7
gemini38_high+gemini38_ultra          133      3630      57        6
```

Every cross-vendor pair reaches zero uncaught. Every same-vendor pair does not,
and that now includes Opus with Sonnet, which is the pair a Claude-only product
would ship.

But look at what the same-vendor failures actually are, because the earlier
write-up overstated this. All seven Gemini-against-Gemini cases are the panel
line `KO+diferenciál 5p.`, which both arms transcribe because it is printed.
All four Opus-against-Sonnet cases are one row on one page: the vitamin D
continuation line that prints a value with a blank analyte cell, which both
readers rendered with an empty name rather than inventing one. The value, 76,7,
is right in both.

So the honest statement is narrower than "cross-vendor pairing catches errors".
**The mechanism is demonstrated and the consequence is not.** Two readers from
one vendor do make the same judgement calls and therefore confirm each other on
them; two vendors disagree and send the row to review. That is real and it is
why the pair should stay cross-vendor. But no reader has yet misread a value on
this corpus, so pairing has never actually caught a wrong number here. It is
insurance whose premium we can measure and whose payout we have not seen.

### Two more truth-set artefacts, found by the readers agreeing with each other

- `21_10_29.pdf#2` holds exactly two truth rows, `Krev srážlivá` and
  `Krev nesrážlivá`, both with the value `přijato` and no unit or range. These
  are specimen-receipt lines printed under `Typ primárního vzorku`. Both readers
  returned nothing for that page, on all four conditions, and several batches
  said independently that they treat receipt lines as non-measurements. They are
  right. The same exclusion the `#` panel line already gets should extend to
  them, and it must not touch qualitative *results* like `negativní` or
  `málo materiálu`, which are measurements.
- The vitamin D continuation row prints no name at all. Aliasing an empty name
  is unsafe, so this one stays a known artefact rather than a scorer rule.

## Phase C — Mistral OCR, both paths (2026-09-07, $0.99 including a wasted first attempt)

Two arms, run sequentially after the first attempt ran them in parallel and
rate-limited itself away. `mistral-ocr-4-1`, pinned to the dated id so a moving
alias cannot void these numbers, billed per page at $0.004.

### The born-digital path — genuinely competitive, and twelve times cheaper

32 text-layer pages, 877 accepted rows. The competition is the deployed text
path, measured on the real API in docs/extraction-speed.md.

| reader | matched / 877 | value errors | merged rows | $/page |
|---|---|---|---|---|
| Haiku 4.5 (deployed) | 851 | 0 | 0 | ~0.014 |
| **Mistral OCR** | **847** | **0** | **0** | **0.004** |
| Sonnet 5 (deployed) | 843 | 0 | 0 | ~0.037 |

Mistral lands between the two Claude readers on recall, with no value errors
and no merged rows, at roughly a third of Haiku's price and a twelfth of the
deployed pair's. **This is the cost question answered, and the answer is yes.**

Two caveats stated rather than buried. The arm scores 109 "fabrications", and
they are not inventions: the page prints its exponent glyph in a form the
checker searches for literally, Mistral normalises it to `10^9/l`, and the
accepted baseline stores `10^9/l` too — so the value matches truth exactly and
only the printed-text check disagrees. This is the same caveat A7 made about
Docling's 210. And 30 rows are still missing; the stored answers now carry
Mistral's own output, so whether we or it lost them is answerable without
another bill.

### Photographs — not a photo reader, and the reason is structural

133 simulated shots, 3,677 rows, scored beside the other five arms.

```
variant                pages read truth  rows match  miss extra marker valERR decens
gemini38_ultra           133  133  3677  3673  3663    14    10     16      0      0
opus_vision              133  133  3677  3657  3649    28     8     16      0      0
sonnet_vision            133  133  3677  3618  3614    63     4     16      0      0
mistral_ocr              133  133  3677  3692  3504   173   188     16     72      2
```

72 value errors and two decensored values, where every other reader has zero.
But the distribution is the finding: **all 72 sit on 7 pages of 133, and 5 of
those 7 are the `angle` condition** with the other 2 `dark`. Flat and glare
shots are clean.

The mechanism, read off the stored answer for `sim__2024_06_07_p2_angle`:

```
#   Mistral                        value  |  truth                        value
2   S_Albumin                       66,3  |  S_Albumin                     46,6
3   Štitná žláza                    46,6  |  S_TSH               málo materiálu
```

A section heading is emitted as a data row and absorbs the next real row's
value, and everything shifts by one until the table re-syncs. Five headings on
that page, five cascades. **This is a table-reconstruction failure, not a
misreading**: a document parser builds a grid, and a grid shears when the page
is photographed at an angle. The Claude and Gemini readers look at a page
rather than rebuilding a lattice over it, and they do not have this failure.

It follows that browser-side perspective correction stops being optional if
Mistral ever reads photographs. Phase E deferred de-skew pending evidence; this
is the evidence, and it is specific to this reader.

### The pairing insurance paid out

The previous section said cross-vendor pairing was a demonstrated mechanism
with an unproven consequence, because no reader had yet misread a value. One
now has.

```
pair                          confirmed flagged UNCAUGHT caught
mistral_ocr+opus_vision            3432     413        0     72
mistral_ocr+sonnet_vision          3399     440        0     72
gemini38_ultra+mistral_ocr         3437     419        7     72
```

**Every one of the 72 errors was caught.** Both Claude pairings end at zero
uncaught. The row-offset cascade is exactly the shape a second reader is good
at catching, because a shifted value is still a plausible number and only
disagreement reveals it. The cost is visible too: 413 flagged rows is a real
review burden, an order of magnitude above the 36 that Gemini and Opus flag
against each other.

### Where this leaves the two paths

- **Photographs**: Gemini ultra with a Claude reader, unchanged. Mistral is not
  a candidate until de-skew exists, and even then it must re-earn it.
- **Born-digital PDFs**: Mistral deserves a serious look. Same accuracy class,
  no merged rows, a twelfth of the price, and roughly three times faster. What
  it does not have is the deployed path's guarantee that every value was
  checked against characters taken from the file itself.

## Phase C — the deployed pair, measured at last (2026-09-07)

Every comparison so far told us which pair is good in the abstract. None told
us how much better it is than what the app runs today, because Haiku had never
been scored on this corpus. It has now, on subagents, free, over the same 133
pages.

```
variant                pages read truth  rows match  miss extra marker valERR decens  $/page
gemini38_ultra           133  133  3677  3673  3663    14    10     16      0      0  0.0133
gemini38_tiled           133  133  3677  3674  3663    14    11     16      0      0  0.0150
opus_vision              133  133  3677  3657  3649    28     8     16      0      0  0.1065*
gemini38_high            133  132  3643  3644  3626    17    18     16      0      0  0.0126
sonnet_vision            133  133  3677  3618  3614    63     4     16      0      0  0.0426*
mistral_ocr              133  133  3677  3692  3504   173   188     16     72      2  0.0040
haiku_vision             133  133  3677  3650  3436   241   214     16     48      0  0.0181*
```

`*` estimated: these arms ran on subagents, priced with the documented image
tokens and Gemini ultra's measured output length on the same pages.

**Haiku makes 48 value errors.** It is the only Claude reader that misreads a
number here, which confirms on 133 pages what the earlier speed benchmark saw
on a handful: Haiku must never read an image alone. It is also the reader the
app pairs with Sonnet on that path today.

### What the swap actually buys

```
pair                              confirmed flagged UNCAUGHT caught   $/page
gemini38_ultra+sonnet_vision           3612      67        0      0    0.056
gemini38_ultra+opus_vision             3647      36        0      0    0.120
sonnet_vision+haiku_vision  (today)    3375     506        0     48    0.061
```

The deployed pair is safe — zero uncaught, because Sonnet catches all 48 of
Haiku's misreads — but it pays for that safety twice over. It confirms **237
fewer rows** automatically and puts **506 rows in front of a human instead of
67**, which is a sevenfold review burden. And it costs slightly more per page
than the pair that beats it.

**So the recommendation is Gemini ultra with Sonnet 5**: same zero uncaught,
237 more rows confirmed without a human, 439 fewer rows to review, and a
fractionally lower bill. Against Gemini with Opus it gives up 35 confirmed rows
and 31 review rows for less than half the price, and Sonnet's remaining deficit
is the status-row prompt gap rather than a capability limit — so that
comparison should be re-run after Phase D, not settled now.

One number is worth keeping for its own sake: `haiku_vision+mistral_ocr`, the
two cheapest readers paired, catches 120 errors between them and still reaches
zero uncaught. Cross-checking is doing an enormous amount of work there. It is
not a recommendation — 881 flagged rows is not a product — but it is the
clearest demonstration in this document that the pair, not the reader, is what
makes the number trustworthy.

## Phase C — the corrected digital table, and what was actually Mistral's fault

The first Mistral numbers were mostly a verdict on our own column mapping. Four
rounds of fixing it, all verified offline against the answers the model itself
returned, leave this:

| reader | matched / 877 | value errors | unit Δ | range Δ | merged | $/page |
|---|---|---|---|---|---|---|
| Haiku 4.5 (deployed) | 852 | 0 | 21 | 34 | 0 | 0.014 |
| **Mistral OCR** | **849** | **0** | **57** | **86** | **0** | **0.004** |
| Sonnet 5 (deployed) | 844 | 0 | 13 | 34 | 0 | 0.037 |

**Mistral is at parity on the born-digital path**, three rows behind Haiku and
five ahead of Sonnet, with no value errors and no merged rows, at a third of
Haiku's price and a twelfth of the deployed pair's.

### The audit, because "it disagreed 485 times" was nearly all us

| cause of a unit disagreement | rows | whose |
|---|---|---|
| the evaluation scale returns as several cells, shifting every column after it | 403 | ours |
| a blank column wins the name election, because column support counted only non-empty cells | 41 | ours |
| Mistral fuses the unit into the reference-range cell | 41 | **Mistral's** |

91 percent of them were our mapping. The same blank-column fault also let a
signature block be read as a results table. Range disagreements fell 503 to 86
on the same fixes; of what remains, 53 are that genuine unit fusion and 33 are
the *baseline* keeping parentheses on one page of a lab and dropping them on
another, which both parsers strip anyway.

Three rows resist adjudication and are recorded rather than resolved: a
dimensionless unit printed as a single glyph, where the baseline reads `1` and
Mistral reads `l`. On a born-digital page the baseline comes from the file's own
characters, which points at Mistral — but that is exactly the confusion an OCR
pass produces in either direction, and the stored answer does not settle it.

### The lesson this phase actually taught

Four separate times an apparent Mistral failure was our code:

1. a reference interval split across three cells, taking the upper bound as the value
2. printed bold surviving as `**5,00**`, so the real result failed every numeric test
3. a one-sided bound losing its operator, turning a limit into a number
4. the evaluation scale shifting every column to its left

Each looked like a model defect and each was a mapping defect, and the third and
fourth were only findable because the bench now stores the model's own answer.
**An OCR arm's accuracy is a measurement of the code that reads it.** That is
the difference between this path and the vision arms, where the model returns
our schema directly and there is no mapping to get wrong.

## Phase C — a model mapper instead of code, tested and rejected (2026-09-07, free)

Ondřej's proposal: stop writing regex to turn Mistral's markdown into our
schema, and let a model do it. Code is rigid, reports vary, and a language
model is exactly the tool for messy structure. The deployed text prompt already
does this job — it takes rows whose cells are separated by bars and assigns
them to columns — and a markdown table is precisely that shape.

It cost nothing to test, because Mistral's answers were already stored and a
Haiku mapper runs on subagents. 165 pages, both classes, same truth, same
scorer.

### Photographs, 133 pages, 3,677 rows

```
variant                pages read truth  rows match  miss extra valERR decens
mistral_ocr   (our code) 133  133  3677  3692  3504   173   188     72      2
mistral_haiku (a model)  133  133  3677  3354  3162   515   192     72      2
```

### Born-digital, 32 pages, 877 rows

```
variant                pages base  rows match  miss extra valΔ coll
mistral_digital        32    877   879   847    30    32    0     0
mistral_haiku_digital  31    875   803   602   273   201    1    27
```

**The model mapper is worse on every axis that matters.** It loses 342 rows on
photographs and 245 on digital pages. It introduces a value error where the
code had none. And on the digital class it **collapses 27 rows** — the exact
merged-row failure that disqualified Docling from this project, and which our
code produced zero of.

The 72 photo value errors are identical in both, which confirms the prediction:
the perspective shear happens inside Mistral's table reconstruction, before any
mapper sees it, and no downstream reader can repair it. The names are shifted
against the values while each row stays internally consistent, so nothing in
the text contradicts itself.

### Why the flexible tool lost

The argument for a model was flexibility, and flexibility is exactly what hurt.
Asked to decide what counts as a measurement, the mapper decided — and dropped
rows it was unsure of, differently on different pages. One page came back with
20 rows where the readers found 34; another gave 25 on all four shots against a
truth of 34; a third returned 0 rows on the angled shot and 11 on the dark one,
from the same printed page. Several mappers also normalised the text they were
told to copy exactly, stripping parentheses from reference ranges.

**Code is rigid, and rigid is what a transcription layer should be.** It is
dumb and exhaustive: it never decides a row is uninteresting. When it is wrong
it is wrong the same way every time, which is why four separate faults were
found and fixed in a day. A model is wrong differently each time, and silently.

One honest caveat: the mapper here was Haiku. A stronger model would likely
drop fewer rows. But the entire reason to put an OCR engine in front is that it
costs four tenths of a cent, and mapping with Sonnet costs about four cents —
more than Gemini charges to read the whole page directly. The cheap mapper is
the only one that makes economic sense, and the cheap mapper is the one that
loses rows.

**Kept:** the deterministic mapper, with the raw answers stored so the next
fault is findable. **Rejected:** replacing it with a model. **Unchanged:** the
recommendation for photographs, which is Gemini ultra with Sonnet.

## Phase C — Mistral's own annotation, which is the same idea done natively (2026-09-08, $0.05)

Ondřej's follow-up: if an external model mapper is worse, could Mistral map its
own output with a cheap model of its own? It can, and it is a product feature
rather than a second call. `document_annotation_format` takes a JSON schema on
the OCR request and Mistral runs `mistral-small-2603` over its own OCR output to
fill it. No mapping layer of ours anywhere. Half a cent a page against four
tenths.

The schema is derived from `TOOL.input_schema` at call time, so the arm cannot
be scored on an easier question than every other reader, and the prompt passed
is `SYSTEM_EXTRACT_TEXT` byte for byte.

### Ten public sheets, 241 hand-transcribed rows

| arm | matched | missing | value errors | merged | $/page |
|---|---|---|---|---|---|
| `mistral_ocr` (our mapper) | 227 | 14 | 0 | 0 | 0.004 |
| `mistral_annot` (Mistral's) | 219 | 22 | 0 | 0 | 0.005 |

**It does not truncate.** The densest committed sheet, `stod_p2` with 44
measured rows, came back 44 of 44, and every field on all 44 is character
identical to a truth transcribed twice by hand. `stod_p1` likewise, 43 of 43.

**It does not normalise, either** — which is where the external Haiku mapper
failed. `( 2,5000 - 6,4000 )` returned with both parentheses and both interior
spaces intact. Classifying every field disagreement on the 219 matched rows
against Mistral's own stored OCR text: **one** text edit in 219 rows is
attributable to the annotation model. The other 51 are the OCR's, and each is
already documented — a page whose table genuinely has no unit column, the Greek
mu, the `1`/`l` glyph.

**But it drops rows by judgement, exactly as the Haiku mapper did.** 22 rows
missing, and **19 of them are sitting in Mistral's own OCR markdown in the same
stored record**, so a reader lost them, not the scanner. They are overwhelmingly
qualitative: the whole toxicology screen, urine sediment counts, a patient
weight, `S_Separace séra`.

### The generalisation worth keeping

Three different models have now been asked to decide what counts as a
measurement, and all three quietly dropped rows for it:

- Sonnet on the vision path: 63 misses, almost all rows whose printed result is
  a status rather than a number
- Haiku mapping Mistral's tables: 342 rows lost on photographs
- `mistral-small` filling our schema natively: 19 rows lost that its own OCR had
  found

**They are not making the same mistake by coincidence. Our prompt never says a
qualitative result is a result**, so each model decided for itself, and each
decided to leave them out. That is one sentence in `SYSTEM_EXTRACT`, and it is
already Phase D's first item. It should lift every one of these arms at once,
which is a much better return than choosing between mappers.

**Kept:** our deterministic mapper, still 8 rows ahead and 20 percent cheaper.
**Noted:** the annotation path is the better of the two model mappers by a wide
margin, preserves text faithfully, and would become the obvious choice if we
ever wanted to delete our mapping code — but not before the prompt is fixed,
because the comparison is currently measuring a prompt gap rather than a mapper.

One honest wrinkle recorded by the build: `SYSTEM_EXTRACT_TEXT` ends by asking
for a `row_index` that this schema does not contain, because the deployed text
path swaps `source_snippet` for it. It was passed as deployed rather than
paraphrased. No `row_index` appeared and every row carried a snippet, so it
caused no visible harm, but a prompt asking for a field the schema lacks is
untidy and should be tidied when Phase D touches these words.

## Phase D0 — deciding what a row is, and re-scoring everything on it (2026-09-08, free)

Every reader ranking published above was provisional, because the benchmark was
partly scoring an unanswered question: *is this printed line a result?* Three
models had independently dropped the same kinds of row from three different
roles, and the truth set counted every one of them as a miss. D0 settles the
question, and the settlement has to move three things at once — the truth, the
prompt and the scores — or the numbers lie in one direction or the other.

**The rule** (docs/plans/lab-adaptability.md, Phase D): the app tracks blood
analytes over time. A blood analyte is in scope whether its printed result is a
number **or a status** — `málo materiálu`, `neprovedeno` — because the status is
what tells a vanished TSH from a reading failure. Urine and every other
non-blood material is out, and so are patient anthropometrics, a toxicology
screen, auxiliary specimen-handling rows and specimen-receipt lines.

### What is deterministic, and what the prompt was allowed to say

Exclusion is code wherever code can see it. `scopeExclusion` in
`tests/bench/score.ts` reads the material from the same machinery the app uses —
`materialPrefix` for `U_`/`dU_`/`U-`, `materialWord` for a `Materiál` column,
`sectionMaterial` for a `Moč chemicky` heading, folded together by
`printedMaterial` — and never from the analyte's name. A prefix that is not in
`MATERIAL_CODES` is ignored, exactly as `registry.ts` ignores it: treating
`xxx_eGF (CKD-EPI)` as an unknown material would have deleted five real serum
rows from the truth.

That machinery needed one fix to be right here. `rowMaterial` scanned every cell
of a row for a material word, including the first — so the urine dipstick line
`Krev | negat. | ery/µl` under a `Moč chemicky` heading was read as *whole
blood*, and the registry would offer it a blood analyte. The Materiál column is
never the name column on any sheet in the corpus, so `rowMaterial` now skips the
first cell. Guard in `packages/lab-core/tests/rows.test.ts`, seen failing with
the fix removed.

The prompt was given only what code cannot see — two sentences each in
`SYSTEM_EXTRACT` and `SYSTEM_EXTRACT_TEXT`: that a printed status **is** a
result and comes back with an empty unit and interval, and that receipt,
auxiliary and anthropometric lines are not results. **Material is deliberately
not in the prompt.** It is handled deterministically, and the reader's job stays
"transcribe what is printed". While these words were open, the untidiness the
annotation arm found was fixed: `SYSTEM_EXTRACT_TEXT` asked for a `row_index`
that the vision `TOOL` does not carry, and now asks for it only where the field
exists.

### Rows excluded, by category

| category | photo (133 shots) | text/real (32 pages) | public (11 pages) | synthetic |
|---|---|---|---|---|
| material — urine and other non-blood | 72 | 18 | 45 | 2 |
| specimen receipt (`přijato`) | 20 | 5 | 0 | 0 |
| toxicology screen | 0 | 0 | 11 | 0 |
| patient anthropometrics | 0 | 0 | 2 | 0 |
| auxiliary / `POMOCNÉ` | 0 | 0 | 2 | 0 |
| **truth rows removed** | **92** | **23** | **60** | **2** |
| truth after | 3585 | 850 (with 4 marker rows) | 201 | 41 |

The 92 photo rows are the same 23 printed rows seen across four conditions:
`2022_07_01#2`'s nine urine dipstick and sediment rows plus three receipt lines,
`2024_02_02#2`'s nine urine rows, and `21_10_29#2`'s two receipt lines. On the
public sheets the exclusions are Stod's `U_`/`fU_`/`Fe_` blocks, its
`Moč chemicky + sediment` section, the whole `Toxikologie` block (including
`S_Etanol`, which is serum — so this cannot be a material rule),
`Pt_Hmotnost pacienta` / `Pt_Výška pacienta`, and `S_Separace séra 1` /
`P_Separace séra 2` under `POMOCNÉ`.

**Two shapes the machinery still cannot classify**, recorded rather than
hand-listed: Stod's four `X_` punctate rows under a `Punktát` heading, and
`C_Tubulární resorpce` under `Clearance`. Neither prefix is a known material
code and neither heading names a material, so both stay in the truth. Every
reader returns them, so they cost nobody a miss; the exclusion would only be
cosmetic, and inventing a heading table entry to get it is not worth the change
to `printedMaterial` that every mapping in the app would then inherit.

### One rule that is not the marker rule

A bare `#` panel line is dropped from the truth **only**: a reader that returns
it is still charged an extra, because nothing tells it to. It is never charged
as a *value* error, on either side of either scorer — there is no number on the
page to be wrong about — and since 2026-09-08 `pairStats` reads that rule from
the same place `valueErrors` does. The D0 exclusions are
dropped from the **read as well** (`inScopeReads`), for the opposite reason —
the prompt deliberately does not mention urine, so charging a reader an extra
for a row it was told to transcribe would score obedience as error. The app
works in that order too: the model transcribes the page, then lab-core drops
what is not a blood analyte.

### photo — 133 pages, truth 3677 → 3585

| variant | truth | rows | match | miss | extra | valERR |
|---|---|---|---|---|---|---|
| `gemini38_high` | 3643 → 3551 | 3644 → 3564 | 3626 → 3546 | 17 → **5** | 18 → 18 | 0 → 0 |
| `gemini38_tiled` | 3677 → 3585 | 3674 → 3596 | 3663 → 3585 | 14 → **0** | 11 → 11 | 0 → 0 |
| `gemini38_ultra` | 3677 → 3585 | 3673 → 3593 | 3663 → 3583 | 14 → **2** | 10 → 10 | 0 → 0 |
| `opus_vision` | 3677 → 3585 | 3657 → 3585 | 3649 → 3577 | 28 → **8** | 8 → 8 | 0 → 0 |
| `sonnet_vision` | 3677 → 3585 | 3618 → 3546 | 3614 → 3542 | 63 → **43** | 4 → 4 | 0 → 0 |
| `haiku_vision` | 3677 → 3585 | 3650 → 3574 | 3436 → 3360 | 241 → **225** | 214 → 214 | 48 → **40** |
| `mistral_ocr` | 3677 → 3585 | 3692 → 3663 | 3504 → 3477 | 173 → **108** | 188 → 186 | 72 → 72 |
| `mistral_haiku` | 3677 → 3585 | 3354 → 3317 | 3162 → 3125 | 515 → **460** | 192 → 192 | 72 → 72 |

Haiku's value errors fall 48 → 40: eight of its misreads were on urine rows the
product does not track. Nobody else's value-error column moves at all.

### photo pairs — 133 pages

| pair | confirmed | flagged | UNCAUGHT | caught |
|---|---|---|---|---|
| `gemini38_ultra+opus_vision` | 3647 → 3575 | 36 → 21 | 0 → 0 | 0 → 0 |
| `gemini38_ultra+sonnet_vision` | 3612 → 3540 | 67 → 52 | 0 → 0 | 0 → 0 |
| `gemini38_tiled+opus_vision` | 3649 → 3577 | 33 → 19 | 0 → 0 | 0 → 0 |
| `gemini38_tiled+sonnet_vision` | 3614 → 3542 | 64 → 50 | 0 → 0 | 0 → 0 |
| `opus_vision+sonnet_vision` | 3614 → 3542 | 47 → 47 | 4 → 4 | 0 → 0 |
| `sonnet_vision+haiku_vision` (deployed) | 3375 → 3307 | 506 → 494 | 0 → 0 | 48 → 40 |
| `gemini38_high+opus_vision` | 3610 → 3538 | 81 → 61 | 0 → 0 | 0 → 0 |
| `gemini38_high+sonnet_vision` | 3575 → 3503 | 112 → 92 | 0 → 0 | 0 → 0 |
| `gemini38_high+gemini38_tiled` | 3632 → 3547 | 54 → 46 | 8 → 1 | 0 → 0 |
| `gemini38_high+gemini38_ultra` | 3630 → 3545 | 57 → 48 | 6 → 1 | 0 → 0 |
| `gemini38_tiled+gemini38_ultra` | 3668 → 3584 | 11 → 6 | 7 → 1 | 0 → 0 |
| `gemini38_high+haiku_vision` | 3351 → 3283 | 544 → 520 | 0 → 0 | 48 → 40 |
| `gemini38_tiled+haiku_vision` | 3388 → 3320 | 502 → 482 | 0 → 0 | 48 → 40 |
| `gemini38_ultra+haiku_vision` | 3386 → 3318 | 503 → 484 | 0 → 0 | 48 → 40 |
| `gemini38_high+mistral_ocr` | 3405 → 3367 | 454 → 394 | 12 → 1 | 72 → 72 |
| `gemini38_tiled+mistral_ocr` | 3442 → 3408 | 410 → 348 | 10 → 3 | 72 → 72 |
| `gemini38_ultra+mistral_ocr` | 3437 → 3404 | 419 → 354 | 7 → 1 | 72 → 72 |
| `mistral_ocr+opus_vision` | 3432 → 3405 | 413 → 351 | 0 → 0 | 72 → 72 |
| `mistral_ocr+sonnet_vision` | 3399 → 3372 | 440 → 378 | 0 → 0 | 72 → 72 |
| `haiku_vision+opus_vision` | 3380 → 3312 | 507 → 495 | 0 → 0 | 48 → 40 |
| `haiku_vision+mistral_ocr` | 3179 → 3152 | 881 → 815 | 0 → 0 | 120 → 112 |
| `mistral_haiku+mistral_ocr` | 3128 → 3112 | 790 → 741 | 90 → 90 | 2 → 2 |
| `gemini38_high+mistral_haiku` | 3061 → 3024 | 804 → 749 | 0 → 0 | 72 → 72 |
| `gemini38_tiled+mistral_haiku` | 3090 → 3053 | 776 → 727 | 0 → 0 | 72 → 72 |
| `gemini38_ultra+mistral_haiku` | 3088 → 3051 | 779 → 729 | 0 → 0 | 72 → 72 |
| `mistral_haiku+opus_vision` | 3086 → 3049 | 767 → 732 | 0 → 0 | 72 → 72 |
| `mistral_haiku+sonnet_vision` | 3058 → 3021 | 784 → 749 | 0 → 0 | 72 → 72 |
| `haiku_vision+mistral_haiku` | 2878 → 2843 | 1146 → 1103 | 0 → 0 | 120 → 112 |

The "after" column was re-scored on 2026-09-08 once `pairStats` stopped
charging a bare-marker truth row to the pair — see *the pair scorer's marker
bug* at the end of this document for what moved and by how much. Nothing in
the "before" column can be re-scored: it is the pre-D0 truth.

### public — 11 pages, truth 261 → 201

| variant | rows | match | miss | extra | valERR |
|---|---|---|---|---|---|
| `opus_vision` | 261 → 201 | 261 → 201 | 0 → 0 | 0 → 0 | 2 → 2 |
| `sonnet_vision` | 261 → 201 | 261 → 201 | 0 → 0 | 0 → 0 | 0 → 0 |
| `gemini38_ultra` | 261 → 201 | 247 → 187 | 14 → 14 | 14 → 14 | 0 → 0 |
| `gemini38_high` | 261 → 201 | 247 → 187 | 14 → 14 | 14 → 14 | 0 → 0 |
| `gemini38_tiled` | 261 → 201 | 247 → 187 | 14 → 14 | 14 → 14 | 0 → 0 |
| `mistral_ocr` | 235 → 181 | 227 → 173 | 34 → **28** | 8 → 8 | 0 → 0 |

Gemini's fourteen misses are untouched, and that is the right outcome: they are
the `URE urea` abbreviation-column rows on Břeclav p122, which is Phase D item
3, not D0.

| pair | confirmed | flagged | UNCAUGHT | caught |
|---|---|---|---|---|
| `opus_vision+sonnet_vision` | 259 → 199 | 2 → 2 | 0 → 0 | 2 → 2 |
| `gemini38_ultra+sonnet_vision` | 247 → 187 | 28 → 28 | 0 → 0 | 0 → 0 |
| `gemini38_ultra+opus_vision` | 245 → 185 | 30 → 30 | 0 → 0 | 2 → 2 |
| `gemini38_high+sonnet_vision` | 247 → 187 | 28 → 28 | 0 → 0 | 0 → 0 |
| `gemini38_high+opus_vision` | 245 → 185 | 30 → 30 | 0 → 0 | 2 → 2 |
| `gemini38_tiled+sonnet_vision` | 247 → 187 | 28 → 28 | 0 → 0 | 0 → 0 |
| `gemini38_tiled+opus_vision` | 245 → 185 | 30 → 30 | 0 → 0 | 2 → 2 |
| `gemini38_high+gemini38_ultra` | 261 → 201 | 0 → 0 | 14 → 14 | 0 → 0 |
| `gemini38_high+gemini38_tiled` | 261 → 201 | 0 → 0 | 14 → 14 | 0 → 0 |
| `gemini38_tiled+gemini38_ultra` | 261 → 201 | 0 → 0 | 14 → 14 | 0 → 0 |
| `mistral_ocr+opus_vision` | 227 → 173 | 42 → 36 | 0 → 0 | 2 → 2 |
| `mistral_ocr+sonnet_vision` | 227 → 173 | 42 → 36 | 0 → 0 | 0 → 0 |
| `gemini38_high+mistral_ocr` | 213 → 159 | 70 → 64 | 0 → 0 | 0 → 0 |
| `gemini38_tiled+mistral_ocr` | 213 → 159 | 70 → 64 | 0 → 0 | 0 → 0 |
| `gemini38_ultra+mistral_ocr` | 213 → 159 | 70 → 64 | 0 → 0 | 0 → 0 |

### synthetic — 6 scored pages, truth 43 → 41

`U-amyláza` and `dU_Kreatinin` leave `hyphen_comma_prefix.pdf`'s truth. All four
arms (`opus_text`, `opus_vision`, `sonnet_text`, `sonnet_vision`) read 41 of 41
with zero misses, zero extras and zero value errors, and every one of the six
pairs confirms 41 with nothing flagged — exactly as before, two rows shorter.
The fixture keeps printing both rows: they are there to prove the *parser*
handles a `U-` and a `dU_` prefix, which is a different question from whether
the product tracks the analyte.

### text / born-digital — 33 pages, baseline 877 → 850

| variant | rows | match | miss | extra | unitΔ | rangeΔ |
|---|---|---|---|---|---|---|
| `sonnet_text` | 855 → 837 | 853 → 835 | 24 → **15** | 2 → 2 | 19 → 18 | 35 → 34 |
| `haiku_text` | 845 → 827 | 842 → 823 | 35 → **27** | 3 → 4 | 21 → 21 | 33 → 33 |
| `current(sonnet+haiku)` | 857 → 839 | 854 → 835 | 23 → **15** | 3 → 4 | 19 → 18 | 35 → 34 |
| `api_sonnet_text` | 844 → 826 | 844 → 826 | 33 → **24** | 0 → 0 | 13 → 13 | 34 → 34 |
| `api_haiku_text` | 852 → 834 | 852 → 834 | 25 → **16** | 0 → 0 | 21 → 20 | 34 → 34 |
| `api_current(sonnet+haiku)` | 852 → 834 | 852 → 834 | 25 → **16** | 0 → 0 | 13 → 13 | 34 → 34 |
| `haiku_text_noname` | 844 → 827 | 829 → 812 | 48 → **38** | 15 → 15 | 19 → 19 | 35 → 35 |
| `mistral_digital` | 879 → 870 | 847 → 834 | 30 → **16** | 32 → 36 | 485 → 477 | 503 → 503 |
| `mistral_haiku_digital` | 803 → 800 | 602 → 601 | 273 → **249** | 201 → 199 | 181 → 181 | 313 → 312 |

The text bench had been carrying a hand-written `NON_RESULT` name list to
discount some of these rows in a side column; it now uses the same
`isMeasurementRow` as every other class, and its `nonRes` column became
`dropped` (D0 scope plus bare markers). The one column that moves the wrong way
is `extra`, `+4` on `mistral_digital` and `+1` on the two Haiku arms, and it is
entirely the `KO+diferenciál 5p.` marker line: the text baseline used to keep it
and match it, and the marker rule now drops it from truth while — correctly —
still charging the reader that returned it.

### Did the ranking change? No.

**Gemini 3.8 Flash `ultra_high` with Sonnet 5 is still the recommendation**, and
the margins are almost exactly what they were:

| | before | after |
|---|---|---|
| Gemini ultra + Opus, confirmed | 3647 / 3677 | 3575 / 3585 |
| Gemini ultra + Sonnet, confirmed | 3612 / 3677 | 3540 / 3585 |
| Opus's lead, in rows | 35 | **35** |
| Gemini + Sonnet flagged vs Gemini + Opus | 67 vs 36 | 52 vs 21 |
| Gemini + Sonnet vs the deployed Sonnet + Haiku, confirmed | +237 | +233 |
| Gemini + Sonnet vs deployed, flagged | 67 vs 506 | 52 vs 494 |
| uncaught value errors, every cross-vendor pair | 0 | 0 |

Not one ordering moved, on any class or any pair. That is a real answer rather
than a null result, and the reason is worth stating precisely: **D0 keeps the
very rows Sonnet was losing.** Sonnet's 43 remaining photo misses are 39
`málo materiálu` status rows (`S_Vitamin D celkový`, `S_TSH`, `S_T4 volný`,
`S_T3 volný`, `S_Kyselina listová`, `S_Osteokalcin`) and 4 of the blank-named
vitamin D continuation row that Opus misses too. The status rows are *in* scope
by rule, so no truth edit could ever have closed that gap. Only the prompt can,
and the prompt half is not measurable from what is on disk.

### What is not measured, and what measuring it would cost

**The prompt change cannot be re-scored from the persisted output.** Every
answer in `results/subagent/*/out/` was produced under the old
`SYSTEM_EXTRACT` — the copy is kept beside the new one as
`prompts/system_vision.preD0.txt`, and the pre-D0 truth as
`index.preD0.json`, so this section's "before" column can be reproduced. Only
the truth-side half of D0 is measured above.

Measuring the prompt half means re-reading the corpus under the new words:

- **Tier 1, free.** The two Claude vision arms over 133 photo pages, 11 public
  pages and the 6 synthetic pages, at 7 pages per subagent — about 45 subagent
  reads, no API calls, no cost. That is the run that would show whether
  Sonnet's 39 status-row misses go away, which is the one number that could
  move `gemini38_ultra+sonnet_vision` against `gemini38_ultra+opus_vision`.
- **Tier 2, paid, and needs approval first.** Gemini has no subagent
  equivalent: 144 pages at ~$0.0133 ≈ **$1.92**, and Mistral 165 pages at
  $0.004 ≈ **$0.66** — about **$2.60** to bring the non-Claude arms onto the
  new prompt. Nothing about the recommendation depends on it: Gemini already
  returns the status rows.

One smaller thing left undone deliberately: the truth in `data/reports` and
`tests/bench/public_sheets/` was **not** edited. The rows are still there and
the scorer excludes them, which keeps the transcription faithful to what the
sheets print — a hand-deleted truth row cannot be audited later, and the
exclusion is now a testable rule rather than a set of deletions.

## Phase D0 — the prompt half, measured (2026-09-08, free)

The truth-side half of D0 moved no ranking, and could not, because D0 *keeps*
the rows Sonnet was losing. Only the prompt could close that gap. Both Claude
readers re-read the 16 photo pages that hold a status row, under the new prompt,
on subagents.

```
variant             pages read truth  rows match  miss extra valERR
sonnet_vision_d0      133   16   588   588   588     0     0      0
opus_vision_d0        133   16   588   588   588     0     0      0
```

**Sonnet returns 549 rows on these pages under the old prompt and 588 under the
new one — exactly Opus's number, and exactly the truth's.** Both readers now
match every row, miss nothing, invent nothing. Paired with each other they
confirm all 588 with nothing flagged: they agree on every cell.

Opus's output did not change at all. It was already returning the status rows,
which is why it led. **One sentence closed a gap that a more expensive model was
being bought to cover.**

### What this does to the recommendation

Across the full corpus Sonnet had 43 misses and Opus 8. Thirty-nine of Sonnet's
were these status rows, so the arithmetic points at Sonnet finishing on 4 misses
against Opus's 8 — ahead, not behind. That is an extrapolation from 16 pages and
is being confirmed by a full re-read; the number is not banked until it is.

If it holds, the case for Opus on photographs disappears. It cost twice
Sonnet's price to recover rows that a sentence recovers for nothing.

### One flaw in the sentence, found by the readers

`S_Vitamin D celkový  neprovedeno  nmol/l` prints a status **and** a unit. The
new sentence tells the reader to return a status with an empty unit and
interval, so both models dutifully discarded a unit that is printed. That
over-specifies. The rule should be that a status is a value, and say nothing
about the other columns, which are transcribed like any other. Recorded here
rather than patched silently, because the fix changes a prompt that has just
been measured and the measurement should be repeated after it.

## Phase D — the sentences, one at a time (2026-09-08, free)

Four wordings were tried on the vision prompt, each dumped fresh through
`subagent_dump_images.bench.ts` so the readers saw the edited text rather than a
paraphrase, each read by Sonnet-shaped subagents, each scored by
`subagent_score_images.bench.ts` against the arm already on disk. **One was
kept.** The three the plan proposed were dropped, and the reason is the same in
all three cases and worth more than the sentences would have been.

### The briefs were the bug, and removing them changed the question

Every Claude arm scored before today was read by a subagent whose brief
*described this repository's sheets* — the `Zkr.` abbreviation column, the slash
prefixes, the Slovak headers. That is an advantage the deployed model does not
have, and it made the Claude readers look better than the measurement was
entitled to claim. Every read below was taken under a brief that says only:
here is the system prompt, here is the tool schema, here is the image,
transcribe from the image alone and open no other file in the repository.

That is the reason the baseline moved and then would not move again.

### D0-fix — a status is a value, and nothing more

Measured on the 16 photo pages that print a status row, 588 truth rows.

> ~~`Je-li místo hodnoty vytištěn stav …, je to také výsledek — vrať ho jako
> hodnotu s prázdnou jednotkou i intervalem.`~~
> `Je-li místo hodnoty vytištěn stav …, je ten stav hodnotou; řádek přepiš
> jako každý jiný.`

```
arm                pages truth  rows match  miss extra valERR
sonnet_vision_d0      16   588   588   588     0     0      0
sonnet_d0fix          16   588   588   588     0     0      0
opus_vision_d0        16   588   588   588     0     0      0
opus_d0fix            16   588   588   588     0     0      0
```

The row columns cannot show this defect, because `valueErrors` compares
`value_raw` and the defect is in the column beside it. The measurement that
matters is the four pages where `S_Vitamin D celkový  neprovedeno  nmol/l`
prints a status *and* a unit:

| arm | status rows carrying a printed unit | unit transcribed exactly |
|---|---|---|
| `sonnet_vision_d0` | 4 | 4 |
| `sonnet_d0fix` | 4 | 4 |
| `opus_vision_d0` | 4 | **0** — unit dropped on all four |
| `opus_d0fix` | 4 | **4** |

**Kept.** Opus goes from losing a printed unit on every one of those pages to
losing none, Sonnet is unchanged, and no other column moves on either reader.

One correction to the note that prompted this. It says both readers discarded
the printed unit; the persisted output says only Opus did — and `opus_vision`,
read under the *pre-D0* prompt, dropped it too. So the old sentence did not
create Opus's behaviour, it merely licensed it. The new sentence removes the
licence, which is the whole of what a prompt can do here.

### D1 — the prefix list. Dropped.

> `(včetně předpony jako 'S_', 'S/', 'S-', 'S,P-', 'U-' nebo 'dU_')`
> replacing `(včetně předpony jako 'S_' nebo 'B_')`

### D3 — the abbreviation column. Dropped.

> `Tiskne-li list zkratku i celý název ve dvou sloupcích, názvem analytu je
> celý název.`

### D4 — Slovak. Dropped.

> `List může být i slovensky; přepisuj v jazyce, ve kterém je vytištěn.`

All three were measured on the same 15 pages — eight synthetic fixtures
(`slash_prefix`, `hyphen_comma_prefix`, `zkr_column`, `slovak_grouped`, plus
`standard`, `two_column`, `urine_no_prefix`, `mixed_material` as the regression
set) and seven public scans (`euc_p34`, `breclav_p121`, `breclav_p122`,
`unilabs_sk_p2`, plus `stod_p1`, `stod_p2`, `breclav_hem_p80`) — 202 truth rows
in scope. Each sentence was added to the D0-fixed prompt alone and then
reverted, so none of them is measured on top of another.

```
                    ── public, 7 pages ──   ── synthetic, 8 pages ──
arm                truth match miss extra   truth match miss extra   valERR
sonnet_dA  (base)    152   152    0     0      50    50    0     0        0
sonnet_dB  (+D1)     152   152    0     0      50    50    0     0        0
sonnet_dC  (+D3)     152   152    0     0      50    50    0     0        0
sonnet_dD  (+D4)     152   152    0     0      50    50    0     0        0
```

Every pair of those four arms confirms all 202 rows with **nothing flagged**:
the four reads are identical cell for cell. The sentences changed no output at
all.

**Why they were dropped.** The rule is that an addition is adopted only if its
target class improves. The target class was already perfect before any of them
was written — with the briefs removed, which is what made the test worth
running. Sonnet returned `S/Sodík`, `S,P-glukóza`, `U-amyláza` and `dU_Kreatinin`
with their prefixes intact; on `zkr_column` and Břeclav p122 it put the full
name in `raw_analyte_name` and the abbreviation in the snippet, unprompted; and
it transcribed the Unilabs SK sheet in Slovak, `negatívne` and all. There is no
headroom for a sentence to buy back.

**What the evidence for D3 actually was.** The 14 rows lost to `URE urea` on
Břeclav p122 are **Gemini's**, not a Claude reader's, and Gemini is a tier-2
arm: re-reading 144 pages under a new prompt costs about $1.92 and needs
approval before it runs. So the sentence's one piece of supporting evidence
cannot be tested for free, and adding an untested sentence on the strength of
another provider's failure is how the D0 wording went wrong in the first place.
It stays available, written down here, for whoever proposes that paid run.

That run happened the same afternoon, and it reversed the decision — see
"D3, reopened", below.

The general finding is the one Phase C already recorded and this measures
properly: **adaptability lives in lab-core, not in the prompt.** Three
conventions that broke the parser outright never troubled the reader, even with
nothing in its brief to warn it.

### D3, reopened — kept, because Gemini is unstable rather than wrong (2026-09-08, 60 calls, $0.47)

D3 was dropped hours earlier on a fair test that asked the wrong question. The
test asked whether the sentence changes what Sonnet returns; it does not. What
it never asked is how often Gemini folds the column **on repeated calls to the
same page**, and the deployed-call confirmation had just seen that page come
back 28 rows with every one flagged on one attempt and 14 rows with none
flagged on a repeat — both readers correct in the repeat. That is not one
provider being wrong once. That is a coin.

So the rate was measured, on the deployed `extractPageGemini` at the deployed
`ultra_high`, prompt and schema imported rather than restated, no text-layer
hint (the reader must see the columns to fold them), on the three
abbreviation-column pages: Břeclav p121, Břeclav p122 and the `zkr_column`
fixture render. `tests/bench/zkr_gemini.bench.ts`.

| page | before, folded / calls | after, folded / calls |
|---|---|---|
| `breclav_p121` | 0 / 5 | 0 / 5 |
| `breclav_p122` | **7 / 20** | **0 / 20** |
| `zkr_column` | 0 / 5 | 0 / 5 |
| **all three, first round** | **1 / 15** | **0 / 15** |

The first round was five calls per page; p122 was then given fifteen more per
arm, because it is the only page that ever folded and one event in fifteen
settles nothing. Břeclav p122 folds on **7 of 20 calls under the old prompt and
0 of 20 under the new one** (Fisher exact, one-sided, p = 0.004). Nothing else
on any page changed: the same 14, 14 and 5 rows came back every time, with the
same values.

**The fold is all-or-nothing within a call.** Every folded read returned
`URE urea`, `KRE kreatinin`, `KM kyselina močová` — all fourteen rows — and
every other read returned all fourteen full names. The model does not hesitate
row by row; it decides once per page which column is the name, and then it is
consistent with itself. That is exactly what makes it expensive: a page whose
review burden is 0 rows on one attempt and 14 on the next, from the same bytes.

**Which is the argument the drop missed.** A steady error is a known quantity
and lab-core could alias it. An intermittent one cannot be aliased, cannot be
reproduced on demand, and reaches the user as a pair disagreement on every row
of a page that was read correctly the last time. Unpredictable review is worse
than a predictable error, and that is a property of the *pair*, which is why no
measurement of Sonnet alone could have found it.

**And Sonnet is untouched.** Sonnet-shaped subagents re-read the three
abbreviation pages plus six with no abbreviation column (`euc_p34`,
`unilabs_sk_p2`, `stod_p1`, `standard`, `slash_prefix`, `slovak_grouped`),
under a brief naming nothing about these sheets, once with the sentence and
once without — the two prompt files verified byte-identical to this morning's
`dA` and `dC`.

```
                     ── public, 5 pages ──   ── synthetic, 4 pages ──
arm                 truth match miss extra   truth match miss extra   valERR
sonnet_zkrA (base)    116   116    0     0      26    26    0     0        0
sonnet_zkrC (+D3)     116   116    0     0      26    26    0     0        0
```

142 of 142 rows either way, and the pair `sonnet_zkrA+sonnet_zkrC` confirms all
142 with **nothing flagged**: the two reads agree cell for cell. The sentence
buys Sonnet nothing and costs it nothing, which is the whole condition for
keeping it.

**Kept**, in `SYSTEM_EXTRACT` only. The text path never sees a page image and
its cells arrive separated by the PDF's own coordinates, so there is no column
to fold and no reason to spend the tokens.

The correction this owes the morning's finding: "adaptability lives in lab-core,
not in the prompt" still holds for what a reader *can* do — Sonnet needed none
of these four sentences to read any of these layouts. What it missed is that a
prompt can also buy **agreement between two readers**, and the pair is the
product. A sentence that changes nothing for one reader and removes a
one-in-three coin flip for the other is worth its tokens. The rule "adopt only
if the target class improves" should read *target class or target pair*.

### The full corpus under the final prompt — 133 photo pages, 3,585 truth rows

`out/sonnet_vision_dF/`, Sonnet-shaped subagents, 17 batches of eight, the
D0-fixed prompt and nothing else added.

```
variant             pages read truth  rows match  miss extra marker scope valERR
sonnet_vision_dF     133  133  3585  3593  3585     0     8     16    92      0
sonnet_vision        133  133  3585  3546  3542    43     4     16    92      0
opus_vision          133  133  3585  3585  3577     8     8     16    92      0
gemini38_ultra       133  133  3585  3593  3583     2    10     16    92      0
gemini38_tiled       133  133  3585  3596  3585     0    11     16    92      0
gemini38_high        133  132  3551  3564  3546     5    18     16    92      0
haiku_vision         133  133  3585  3574  3360   225   214     16    92     40
mistral_ocr          133  133  3585  3663  3477   108   186     16    92     72
```

**The extrapolation was pessimistic. Sonnet finishes on 0 misses, not 4.** It
matches every one of the 3,585 truth rows on all 133 shots, in every condition
including `angle`, `glare`, `dark`, `crop` and the two-page frame, with zero
value errors. Opus, on the same corpus, misses 8 — the second
`25-hydroxyvitamin D` line on the CASRI pages, whose analyte name is not
reprinted on the continuation row. Sonnet under the new prompt returns it;
Sonnet under the old one did not, and neither does Opus.

Sonnet's 8 extras are all one row: `KO+diferenciál 5p.`, the AGILAB panel
header printed with a bare `#` where a value would go, on the four shots each
of `2022_10_17_krev` p1 and `2024_02_02` p1. The scorer drops such a row from
*truth* (`isMeasurementRow`) and charges it to any reader that returns it. Both
Gemini arms return it too — 10 and 11 times. It carries no number to be wrong
about and `parseValue("#")` is null, so it reaches the app as a row with no
value, never as a measurement on a chart.

### The pairs, and the one column that needs adjudicating

```
pair                              pages confirmed flagged UNCAUGHT caught
gemini38_ultra+sonnet_vision_dF     133      3583       5        0      0
gemini38_ultra+opus_vision          133      3575      21        0      0
gemini38_ultra+sonnet_vision        133      3540      52        0      0
gemini38_tiled+sonnet_vision_dF     133      3585       3        0      0
opus_vision+sonnet_vision_dF        133      3577      16        0      0
opus_vision+sonnet_vision           133      3542      47        4      0
```

**This table was first published with 6 uncaught on
`gemini38_ultra+sonnet_vision_dF` and 7 on `gemini38_tiled+sonnet_vision_dF`,
adjudicated to 0 by hand.** Every one was the same `KO+diferenciál 5p. ∅→#`
marker line, and that adjudication is now the scorer's own: `pairStats` reads
the same rule about what a measurement is that `valueErrors` always had, so the
column needs no adjudication to be believed. The numbers above are the
re-scored ones — *the pair scorer's marker bug*, at the end of this document,
has the full before and after. The confirmed and flagged columns move with it:
nine marker rows leave `gemini38_ultra+sonnet_vision_dF`'s ledger, which is why
3589/8 became 3583/5.

The four uncaught rows on `opus_vision+sonnet_vision` are *not* an artefact:
both readers returned `76,7` on a row whose printed name they both dropped. The
new prompt removes them — `opus_vision+sonnet_vision_dF` is clean.

### Does the pair recommendation move? Yes.

**The case for Opus on photographs is gone.** It was bought to recover rows
Sonnet was dropping; Sonnet now drops none, and Opus drops eight that Sonnet
returns. On flagged rows — the cost of human review — the Sonnet pair is four
times cheaper to check: 5 flagged against 21.

`gemini38_ultra+sonnet_vision` stands as the recommendation, and now stands on
better ground than "Opus is not worth twice the price": it is the better pair on
every column, adjudication included. Two caveats, both already in this document:
Gemini's numbers are tier-2 reads taken under the *pre-D0* prompt, so the pair
table mixes prompts and the Gemini half can only improve when it is re-read
(≈ $1.92, needs approval); and a subagent is not the API.

## Phase D — the pair scorer's marker bug (2026-09-08, free)

`valueErrors` and `pairStats` disagreed about what a measurement is, and the
pair column had been publishing that disagreement as if it were a reader
fault. Fixed in `tests/bench/score.ts`; every class re-scored from the reads
already on disk, no API calls.

### The rule, now stated once

`splitTruth` partitions the truth in three, and both scorers read it:

> Truth is **measurements**, **markers** and **out-of-scope rows**, and the
> three are exhaustive. A *measurement* is a blood analyte's row carrying a
> result, number or status — only these can be read right or wrong. A *marker*
> is an in-scope row the page prints with a bare `#`, `*`, `-`, `—` or nothing
> where a value would go; the page does print the line, so a reader returning
> it is being faithful, and it carries no number, so **no scorer in this file
> makes a value claim about it, on either side**. `valueErrors` leaves it out
> of `truthRows` and `matched`; `pairStats` leaves it out of `confirmedRows`,
> `flaggedRows` and `uncaughtValueErrors`. Both report the count instead, so
> the drop is visible rather than silent.

The exemption is a **budget, not a licence**: `splitTruth` counts how many
times each name is printed as a marker row and `pairStats` spends one per
exempted slot. A reader that returns the panel line twice where the page
prints it once is still charged for the second.

Three guards in `tests/bench/score.test.ts`, each seen failing before it
passed: the marker row exempted; two readers agreeing on a wrong number for a
genuine measurement still uncaught; a row the page does not print at all still
charged as an invention. A fourth asserts the partition sums to `truth.length`,
and a fifth spends the budget.

### Every pair whose UNCAUGHT changed

Only the photo class moves — it is the only corpus whose truth holds marker
rows. Public, synthetic and born-digital are identical to the row.

| pair | UNCAUGHT before | after | confirmed | flagged | marker rows exempted |
|---|---|---|---|---|---|
| `gemini38_high+mistral_ocr` | 12 | **1** | 3378 → 3367 | 399 → 394 | 16 |
| `gemini38_tiled+mistral_ocr` | 10 | **3** | 3415 → 3408 | 357 → 348 | 16 |
| `gemini38_high+gemini38_tiled` | 8 | **1** | 3554 → 3547 | 52 → 46 | 13 |
| `gemini38_high+sonnet_vision_dF` | 7 | **0** | 3553 → 3546 | 51 → 45 | 13 |
| `gemini38_tiled+gemini38_ultra` | 7 | **1** | 3590 → 3584 | 9 → 6 | 9 |
| `gemini38_tiled+sonnet_vision_dF` | 7 | **0** | 3592 → 3585 | 5 → 3 | 9 |
| `gemini38_ultra+mistral_ocr` | 7 | **1** | 3410 → 3404 | 364 → 354 | 16 |
| `mistral_ocr+sonnet_vision_dF` | 7 | **0** | 3412 → 3405 | 360 → 351 | 16 |
| `gemini38_high+gemini38_ultra` | 6 | **1** | 3550 → 3545 | 57 → 48 | 14 |
| `gemini38_ultra+sonnet_vision_dF` | 6 | **0** | 3589 → 3583 | 8 → 5 | 9 |

**69 uncaught entries removed across 10 pairs, and every single one of them was
`KO+diferenciál 5p. ∅→#`.** Nothing was added anywhere: the removed set has
exactly one distinct analyte name in it. `mistral_haiku+mistral_ocr` keeps all
90 of its uncaught rows — those are the row-offset cascade, which is a real
fault and is untouched.

A further **20 pairs change only `flagged`, by 200 rows in total** — the shots
where one reader returned the panel line and the other did not, previously
counted as review cost for a row nobody can be wrong about. No pair's `caught`
moves at all, and every variant's `valERR`, `miss`, `extra` and `marker` column
is identical before and after: `valueErrors` was already right and its output
did not change by a single row.

### What is left, and why it is not the same thing

Seventeen `KO+diferenciál 5p.` rows survive as uncaught, and every one is the
same printed page: `2022_07_01` p1, mostly its `angle` shot, plus `flat` and
`crop` on the one pair where both readers returned it there. That page's
accepted report in `data/reports` never recorded the panel line at all,
so the truth has no marker row there to exempt. That is a truth-set gap, not a
scorer artefact, and the exemption deliberately does not paper over it: it is
keyed to what the truth carries, exactly as `valueErrors` is. It is why
`gemini38_tiled+mistral_ocr` lands on 3 rather than 0 and four Gemini pairs
land on 1.

### What this changes, and what it does not

**It changes bookkeeping. No reader behaves any differently.** Not one model
was re-run, not one prompt moved, and the reads scored here are byte-for-byte
the ones scored two days ago. What was wrong was the arithmetic on top of them.

Which published numbers were wrong, and by how much:

- **the Phase D0 photo pairs table** — three pairs' UNCAUGHT overstated by 7,
  5 and 6 (`gemini38_high+gemini38_tiled` 8, `gemini38_high+gemini38_ultra` 6,
  `gemini38_tiled+gemini38_ultra` 7, all now 1), and the Mistral pairs by 11, 7
  and 6. Twenty more pairs' `flagged` overstated, by 200 rows between them;
- **the final Phase D pairs block** — `gemini38_ultra+sonnet_vision_dF`
  published 6 uncaught and `gemini38_tiled+sonnet_vision_dF` 7, both actually
  0. Both were adjudicated to 0 in prose at the time, so the conclusion drawn
  from them was already right; the table was not;
- **the Phase C pair tables** (2026-09-06 and 2026-09-07, above) carry the same
  artefact in their same-vendor rows — 3, 2 and 4 uncaught on 45 pages, 7 and 6
  on 133. They are left as printed. They were scored against the pre-D0 truth,
  which no longer exists in the scorer, so re-running them would produce a
  third set of numbers rather than a correction. The prose beside them already
  identifies every one of those rows as the panel line.

The recommendation does not move. `gemini38_ultra+sonnet_vision` was chosen on
zero uncaught after adjudication and it still has zero, on a column that no
longer needs adjudicating.

## Phase E — how many encodes a photograph needs (2026-09-08, $0.48)

Phase E1 of the plan called for **two** encodes of every phone shot: 2576 px
for Sonnet's image tier, and the uncut original for Gemini, because Gemini
spends a fixed token budget per image part whatever the pixels are, so a bigger
picture looked like free detail. The Worker was built for it — `imageFullBase64`
in `workers/extract/src/index.ts` — and the browser encoder was about to be.

Free to Gemini; not free to anything else. A second encode costs the phone a
second full-size canvas while up to 64 pages are in flight, and it costs the
uplink a body several times larger. So it was measured before it was built.

`tests/bench/photo_edge_gemini.bench.ts`, five pages, two arms, three calls
each — 30 calls, $0.478 — through the deployed `extractPageGemini` at
`ultra_high`, scored with `valueErrors` against the same truth every other arm
in this document is scored against.

Two page classes, because the photo corpus cannot ask the question on its own.
`data/photos-sim` is 2138×3024, only **1.17×** the 2576 tier, which is the real
ratio for the pages we hold. So two public sheets were rasterised at 440 DPI
(3639×5146) and downscaled to 2576 for the other arm: **2× linearly, 4× the
pixels** — the ratio a 12 MP phone shot of an A4 page actually offers.

| Page | class | tier2576 | full |
|---|---|---|---|
| `sim__2024_02_02_p1_flat` | photo | 1822×2576 | 2138×3024 |
| `sim__2020_09_213_p1_angle` | photo | 1822×2576 | 2138×3024 |
| `sim__2023_12_19_p1_dark` | photo | 1991×2576 | 2337×3024 |
| `breclav_p121` | public | 1822×2576 | 3639×5146 |
| `stod_p1` | public | 1821×2576 | 3637×5146 |

```
arm        pages calls truth match valERR miss extra  median input tokens  median s
tier2576       5    15   510   510      0    0     1                2,543      10.9
full           5    15   510   510      0    0     3                2,543      12.9
```

**Every truth row matched in both arms, on every one of the thirty calls.** No
value error either way, nothing missing either way. The only column that moved
is `extra`, and it moved the wrong way for the larger picture: three spurious
rows against one, all of them the `KO+diferenciál 5p.` panel line this document
has been discounting since Phase C.

The mechanism is in the token count, and it is not an inference. **A 5146 px
page and a 2576 px page reach the model as the same 2,543 input tokens.**
`ultra_high` is a budget, not a resolution — 2,240 tokens for the image part
plus ~300 for the prompt and schema, whatever is sent. Four times the pixels
bought exactly nothing, which is the same answer the tiled arm returned when it
spent twice the budget on the same pixels.

So the two experiments close the question from both sides: more budget over the
same pixels buys nothing, and more pixels into the same budget buys nothing.

**Decision: one encode at 2576 px, for both readers.** It is simpler, it halves
what the phone does and what the uplink carries, and it removes the collision
with the request-size ceiling that a full-resolution body would have created.
`imageFullBase64` stays on the Worker — it costs nothing to keep and it is the
seam a future reader with a real resolution appetite would arrive through — and
the browser never sends it. The constant lives in
`packages/lab-core/src/photo.ts` as `PHOTO_MAX_EDGE` and is pinned equal to
`SONNET_IMAGE_MAX_EDGE` by `packages/lab-core/tests/photo.test.ts`. (It was in
`apps/bloodwork/src/lib/` until Moje krev learned to take photographs too;
sharing the encoder is what keeps the two apps' pixels identical, and therefore
what keeps this measurement true of both.)

### Perspective correction: closed, not deferred

The plan deferred browser-side de-skew "until the angle photos are scored".
They are scored. Under the final prompt, on all 133 photographed pages
including every `angle` shot, Sonnet 5 returned 3,585 of 3,585 rows with zero
value errors and Gemini `ultra_high` zero as well. The one reader that sheared
on angle was `mistral_ocr`, which is not in the deployed pair. A homography in
the browser would add a slow, failure-prone step in front of two readers that
demonstrably do not need it. It is written into `photo.ts` as a comment so the
next person does not rebuild it on the strength of the plan alone.
