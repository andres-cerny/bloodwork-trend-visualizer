# Candidate C — pass 2 (screenshots only)

32 of 32 states present, including `note-mobile-light/dark`, which timed out in
pass 1. Mobile shots are one 390×844 viewport each (780×1688 @2x), so anything
below the fold is genuinely below the fold. Judged fresh; pass 1's 14/30 was not
consulted while scoring, only while regression-checking.

## 1. Regression check against C.md

| # | Pass-1 defect | Status | Seen in |
|---|---|---|---|
| 1 | Note unreachable (spec MUST) | **PARTIAL** | `note-mobile-light/dark` now render: „Zpráva lékaře / Zpráva z vyšetření / Uvolněno 9. 6. 2026" + serif body. But the state is the same report card as `visit-scrolled-mobile-*` (same content, ~18 px scroll offset), i.e. test id `note` marks the preview on the visit detail. The letter is ellipsized at „Spirometrie…" and „Celá zpráva včetně stránek ›" is never followed, so no captured state shows the whole letter or a single page image. There is no note URL affordance in portal-spec.md, so the camera cannot reach the viewer — this is as much a spec/camera gap as a candidate defect. |
| 2 | Label column breaks words vertically | **CLOSED** | `home-mobile-*`, `home-desktop-*`, `visit-annual-mobile-*`, `visit-annual-desktop-*`: „Železo", „Kreatinkináza (CK)", „Hematokrit", „Erytrocyty", „Leukocyty" and „rozmezí 11–28" all set on one line in both palettes and both widths. |
| 3 | Raw floating-point deltas | **CLOSED** | `home-*`: „−1,9 µmol/l", „+3,70 µkat/l", „−0,008"; `visit-annual-*`: „−0,005", „−0,34", „−0,18", „−1,3 µmol/l". Every delta in frame is rounded to display precision. (The two perf-row examples from pass 1 are no longer captured — `visit-scrolled-*` now frames the note card.) |
| 4 | Dimensionless unit rendered as „1" | **CLOSED** | `visit-annual-*` Hematokrit „0,436 · v rozmezí ↓ −0,005"; `home-desktop-*` „−0,008  0,428". No trailing „1". |
| 5 | Chart x-axis at 390 px | **CLOSED** | `chart-lab-mobile-*`: 6/2023 · 6/2024 · 6/2025 · 8/2026, thinned, four-digit years, no collision; `chart-perf-mobile-*` likewise. Desktop keeps five ticks. Mobile now also labels the band bounds (175 / 135). |
| 6 | ThemeSwitch not themed in dark | **CLOSED** | Every dark state: „Tmavý" pill is dark-surface with light ink and a moon icon. No light artifact anywhere in the chrome. |
| 7 | Note preview is letterhead, not the letter | **CLOSED** | `note-mobile-*`, `visit-scrolled-*`: preview opens „Od zimy horší tolerance intenzivních jednotek…". Address/phone block gone. |
| 8 | Double arrow per flagged row | **CLOSED** | `home-mobile-*`: „pod rozmezím ↓ −14 µg/l" — one arrow, on the delta; the flag is textual. |
| 9 | No active tab on detail views | **CLOSED** | `visit-annual-*` holds „Historie" selected; `chart-lab-*` and `chart-perf-*` hold „Výsledky". |
| 10 | Perf chart label collides with the line | **CLOSED for perf, REOPENED on lab** | `chart-perf-*` (all four): „5,39" now sits below-left of the last point, clear of the stroke. But `chart-lab-mobile-*` has a new overprint — see New defect 1. |
| 11 | Perf chart y-axis is two gridlines | **CLOSED** | `chart-perf-mobile-*` and `-desktop-*`: 5,3 / 5,4 / 5,5 / 5,6. |
| 12 | Sparklines unproven | **STILL UNPROVEN** | The r2 set contains no Výsledky-list state at all — only the two full charts. Not judgeable from these screenshots; this is camera coverage, not evidence of absence. Not scored against C. |

## 2. Fresh score table

| # | Criterion | Score | Justification (state) |
|---|---|---|---|
| 1 | First-screen answer | 3 | `home-mobile-light/dark`: inside one 390×844 viewport — „VAŠE POSLEDNÍ NÁVŠTĚVA", 11. 8. 2026, „krev" chip, „Kontrolní odběr", the verdict „4 parametry mimo rozmezí · celkem 15 parametrů", and all four flagged parameters with value, unit, flag and delta. Newest visit, verdict and what changed, no scrolling past chrome. |
| 2 | Calm, not clinical | 3 | `home-*`: verdict in a tinted callout with a signal left-rule, not a red field; one arrow per row; ink for labels, signal for the numbers that mean something. `visit-annual-*` earns „vše v normě · 15 parametrů" and drops all red. `timeline-*` reassures four times over. |
| 3 | Trend legibility at phone width | 2 | `chart-lab-mobile-*`: reference band shaded with both bounds labelled, „Referenční rozmezí 135–175 g/l" spelled out, Czech decimals („5,39", „5,3"), Czech dates in the header, no horizontal scroll. Docked for the „144"/„135" overprint (New defect 1) and because no state proves the per-row sparklines. |
| 4 | The delta view | 2 | `home-desktop-*`: names its comparator („srovnání s odběrem 9. 6. 2026"), every delta rounded, arrow plus signed number so no legend is needed. Docked hard for row raggedness — Ferritin is one line, Železo two, Saturace transferrinu two, Kreatinkináza three, with „nad rozmezím" stranded on its own line and „6,80 µkat/l" a line below that. It is recoverable, not one-pass. |
| 5 | Timeline scannability | 3 | `timeline-desktop-*`, `timeline-mobile-*`, `timeline-sparse-mobile-*`: icon+word kind badges (krev / tHb / prohlídka / spiroergometrie) legible without reading, italic gap rows, deterministic count summaries, correct Czech plurals throughout („1 parametr", „2 parametry", „4 výkonnostní hodnoty", „13 výkonnostních hodnot", „9 návštěv"). Seven years read as a story. Still the strongest screen. |
| 6 | The note as a document | 2 | `note-mobile-light/dark`: serif face, generous leading, sane measure, „Uvolněno 9. 6. 2026" under the title, letterhead stripped — it reads as a letter. Docked for truncation at „Spirometrie…", for source line breaks surviving mid-sentence („…bez repolarizačních / změn."), and for „Objektivně" / „EKG" / „Spirometrie" rendering as plain body lines rather than as the headings they are. No page image in any state. |
| 7 | Czech copy fit | 3 | All 32 states: no overflow, no orphaned label, no mid-word break. Vykání in frames („Vyberte svou kartu", „Vaše poslední návštěva"), nominative clinical labels, „parametr" never „analyt", dates „11. 8. 2026", decimals with comma, error/dead-end copy Czech („Objednávání připravujeme.", „Tato část karty zatím není v provozu."). |
| 8 | Palette parity | 3 | All 16 dark states measured: zero green pixels in either palette (also zero across the 16 light states); no light artifact — largest near-white area in any dark state is 3.3 % and it is the note's body type. Contrast held: verdict red #EC8A8A on #171716 (dark) vs #B32828 on #FAF9F6 (light); „Objednat se" 7.5:1 dark / 6.5:1 light. Ink tokens carry type, signal tokens carry the rule, the flag and the plot. The CSM mark is a tinted crimson stack distinct from the alarm red in both palettes. |
| 9 | Mobile ergonomics | 2 | `visit-scrolled-mobile-*`: the compact sticky header keeps the name and „Objednat se" reachable mid-scroll; timeline rows, tab pills and „Rozumím" are generous targets. Docked: „‹ Zpět" is a bare text link with a small hit area on drill-in views (`visit-annual-mobile-*`, `chart-*-mobile-*`), and PWA chrome (icon, theme colour) is not assessable from screenshots. |
| 10 | Wow, honestly earned | 2 | `timeline-desktop-light` and `book-dead-end-mobile-*` are photographable, and `home-mobile-*` is now a clean first screen rather than a broken one. Held back from 3 because the two cards a director would linger on — „Hodnoty mimo rozmezí" and „Od minulé návštěvy" — still wrap into ragged 1/2/3-line rows with holes in them, and the flagship lab chart overprints two numbers at phone width. |

**Total: 25/30** (pass 1: 14/30)

## 3. Open, most severe first

1. **Lab chart overprints its own numbers at 390 px.** `chart-lab-mobile-light` and
   `chart-lab-mobile-dark`: the bold last-value label „144" sits on the dashed lower-bound
   line and overlaps the grey „135" bound label — the digits physically cross. It happens
   at exactly the place a patient looks to answer „am I near the bottom of the range?".
   `chart-lab-desktop-*` is clean („dolní mez 135" under a clear „144"), so this is
   390-px-only, in both palettes. **Fixed =** at narrow widths the value label offsets
   above/left of the last point, or the bound label yields to it; the two never share a box.
   *Consequential — an illegibility.*

2. **Row wrap is inconsistent inside a single card.** `home-mobile-*`: in „Hodnoty mimo
   rozmezí", Ferritin, Železo and Kreatinkináza push value and flag onto their own lines,
   leaving a wide hole to the right of the label, while Saturace transferrinu keeps its
   value inline — four rows, three different shapes. `home-desktop-*`: „Od minulé návštěvy"
   runs 1, 2, 2 and 3 lines, with „pod rozmezím" / „nad rozmezím" stranded on a line of
   their own, drifting toward the divider that precedes the *next* parameter. Grouping is
   still correct (hairlines hold the rows) and every figure is legible, so this is not
   patient-visible wrongness — but it is the ugliest thing left and the reason criteria 4
   and 10 lose points. **Fixed =** one grid for the row (label · flag · delta · value) with
   a defined wrap order, so all rows in a card have the same height. *Not consequential —
   raggedness, not error.*

3. **The doctor's letter is never fully readable in any captured state.** `note-mobile-*`
   ends at „Spirometrie…" behind „Celá zpráva včetně stránek ›". Since portal-spec.md lists
   no URL affordance for the note viewer, the camera cannot reach it, so the „page images
   when present" MUST is unproven rather than violated. **Fixed =** either a `note` URL in
   the spec's affordance list so the viewer can be shot, or the test id moved to the viewer.
   *Not consequential on the pixels available — but it is the one MUST still unverified.*

4. **Same visit, two different summaries.** `timeline-desktop-*` summarises 9. 6. 2026 as
   „vše v normě · 13 výkonnostních hodnot"; `visit-annual-*`, the detail for that same visit,
   says „vše v normě · 15 parametrů". Both are honest counts of different things, and
   `timeline-sparse-mobile-*` proves the timeline can print both („2 parametry mimo rozmezí ·
   13 výkonnostních hodnot"), so the all-normal case silently drops the lab count. A patient
   who moves between the two screens sees 13 and 15 for one day. **Fixed =** the same count
   pair on both surfaces. *Not consequential — no number is wrong.*

5. **Gap arithmetic rounds up on calendar boundaries.** `timeline-sparse-mobile-*`:
   26. 4. 2022 → 3. 10. 2023 is 17 months and 7 days, printed „18 měsíců bez návštěvy".
   The other gaps (10, 19, 7) check out. **Fixed =** floor the elapsed months.
   *Not consequential.*

6. **Cosmetic, explicitly not counted:** the active tab pill is only ~1.1:1 against its
   track — but it measures 1.11:1 in dark and 1.15:1 in light, i.e. symmetric, and the
   bold white/near-black label carries the state, so it is not a parity failure; the
   mobile chart states leave the lower half of the viewport empty; the CSM mark is dim by
   design in both palettes. Taste, not defects.

**No disqualifier.** No colour outside the kit's idiom is visible; green-free measured in
both palettes; every summary reads as a pure count; ghost patients only (Jakub Svoboda,
Lucie Dvořáková, Petr Beneš); no diagnosis-flavoured prose anywhere.

## 4. Keep list (unchanged from pass 1, plus)

The timeline treatment, the sticky patient header, the dead-end modal, the home verdict
card — all survived the polish intact. New keepers: the labelled reference band with its
spelled-out „Referenční rozmezí 135–175 g/l" caption and the honest „Bez referenčního
rozmezí." for metrics without bounds; the serif note body; the now-correct dark ThemeSwitch.

ANOTHER PASS — 1 consequential defect
