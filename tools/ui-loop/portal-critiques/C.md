# Candidate C — blind critique (screenshots only)

34 of 36 states captured. `note-mobile-light` and `note-mobile-dark` are MISSING —
the camera timed out reaching test id `note` from the visit URL. Judged as a
concrete defect, not an unknown.

## 1. Score table

| # | Criterion | Score | Justification (state seen) |
|---|---|---|---|
| 1 | First-screen answer | 2 | home-mobile-light/dark: newest visit, date, kind chip and the verdict „4 parametry mimo rozmezí · celkem 15 parametrů" all inside the first 390px viewport. „Co se změnilo" (delta card) is below the fold, and the very next card is typographically broken. |
| 2 | Calm, not clinical | 2 | home-*: verdict in a bordered callout, not a red wall; visit-annual-* earns its „vše v normě · 15 parametrů". Docked a point for double red per flagged row („↓ pod rozmezím ↓ −14 µg/l") — alarm repeated twice per line. |
| 3 | Trend legibility at phone width | 1 | chart-lab-mobile-*: last x-ticks collide into „6/8/626"; ticks are M/YY („6/23"), not Czech; reference band bounds show only at desktop as „horní/dolní mez". No per-row sparkline appears in any captured state, so direction-at-a-glance is unproven. |
| 4 | The delta view | 1 | home-desktop-*: the card names its comparator („srovnání s odběrem 9. 6. 2026") — good — but raw float deltas („−1,9000000000000004 µmol/l", „+3,6999999999999997 µkat/l") and per-row layout drift (Saturace transferrinu wraps its arrow to a second line, Hematokrit shows „−0,0080000000000000007 1") destroy the one-pass read. |
| 5 | Timeline scannability | 3 | timeline-* and timeline-sparse-*: icon+text kind badges legible without reading, italic gap rows („19 měsíců bez návštěvy"), deterministic per-visit summaries, correct Czech numerals („1 parametr / 2 parametry mimo rozmezí"). The strongest screen. |
| 6 | The note as a document | 0 | The note states are missing (camera timeout on test id `note`), and the only trace of the letter — visit-scrolled-* preview — leads with letterhead boilerplate (address, phone, e-mail), not the doctor's words. |
| 7 | Czech copy fit | 0 | home-mobile+desktop, visit-annual-mobile, both themes: label column breaks mid-word, one letter per line — „Ž e l e z o", „K r e a…", „Hemat/okrit", „Erytroc/yty", „Leuko/cyty"; „rozmezí 11–28" splits across three lines. Vykání and nominative labels are otherwise right, which makes the breakage the more visible. |
| 8 | Palette parity | 2 | All captured states have a real dark rendering with held contrast (book-dead-end-dark included). Docked: the ThemeSwitch pill stays light-styled (white fill, black text) in every dark state — a light artifact in the chrome. |
| 9 | Mobile ergonomics | 2 | visit-scrolled-*: sticky compact header keeps the name and „Objednat se" reachable mid-scroll; tab bar and „Rozumím" are generous targets. „Zpět" is a bare text link on the small side; PWA chrome not assessable from shots. |
| 10 | Wow, honestly earned | 1 | The timeline and the blurred-backdrop dead-end modal are photographable; the home and visit screens — the ones a director would actually open — are disfigured by the label wrap and float noise. |

**Total: 14/30**

## 2. Defects, by severity

1. **Note unreachable — spec MUST.** `note-mobile-light/dark` missing; camera timed
   out reaching test id `note` from the visit URL. Fixed = from `/?fx=1&p=<id>&v=<visitId>`
   the note view renders with `data-testid="note"` and both palette shots exist.
2. **Label column breaks words vertically.** home-mobile + home-desktop (both themes):
   „Železo" renders as one letter per line, next row starts „K r e a…"; visit-annual-mobile
   (both themes): „Hemat/okrit", „Erytroc/yty", „Leuko/cyty"; „rozmezí 11–28" splits over
   three lines. Present even at 1440, so it is not a width edge case. Fixed = labels never
   break inside a word at 390 or 1440; the label cell gets a workable min-width and
   `overflow-wrap: anywhere`/`break-all` is gone.
3. **Raw floating-point deltas.** home-* („−1,9000000000000004 µmol/l",
   „+3,6999999999999997 µkat/l", „−0,0080000000000000007"), visit-annual-*
   („−0,0050000000000000044", „−0,33999999999999986"), visit-scrolled-*
   („−0,6999999999999993 km/h", „−3,1999999999999886 ml/kg/min"). Fixed = every delta
   rounded to the parameter's display precision before formatting.
4. **Dimensionless unit rendered as „1".** visit-annual-* and home-* Hematokrit:
   „0,436 1", „… −0,005 1". Fixed = suppress the unit (or write „podíl") for
   dimensionless parameters.
5. **Chart x-axis at 390px.** chart-lab-mobile-*: final ticks overlap into „6/8/626";
   all charts use „6/23"-style M/YY ticks, not Czech date formatting. Fixed = Czech
   month/year ticks („6/2023" or „čvn 23") with collision-aware thinning at 390px.
6. **ThemeSwitch not themed in dark.** Every dark state: the „Tmavý" pill keeps a white
   fill and black text — the one light artifact on an otherwise dark page. Fixed = the
   control draws from surface/ink tokens in both palettes.
7. **Note preview is letterhead, not the letter.** visit-scrolled-* (both themes):
   „Zpráva lékaře" card previews „Centrum sportovní medicíny z.s. Pod altánem 67/352,
   100 00 Praha 10 · tel +420 …" before reaching any clinical sentence. Fixed = preview
   starts at the doctor's first content line; header/contact block stripped.
8. **Double arrow per flagged row.** home-* „Hodnoty mimo rozmezí": „↓ pod rozmezím
   ↓ −14 µg/l" — the same direction twice. Fixed = one arrow, on the delta; the flag
   stays textual.
9. **No active tab on detail views.** visit-annual-* and chart-*: none of
   Přehled/Historie/Výsledky is highlighted, so the „where am I" thread breaks. Fixed =
   the owning tab stays selected on drill-in views.
10. **Perf chart data label collides with the line.** chart-perf-* (all four): „5,39"
    sits on the descending stroke. Fixed = label offset above/right of the last point.
11. **Perf chart y-axis is two gridlines.** chart-perf-*: only 5,6 and 5,4 — magnitude
    is hard to judge. Fixed = three-plus ticks or a labeled min/max.
12. **Sparklines unproven.** No captured state shows a results list with word-sized
    sparklines (spec's Results & trends). If the Výsledky list exists, it never made it
    in front of the camera; verify with a dedicated state next round.

## 3. Keep list

- **The timeline treatment** (timeline-*, timeline-sparse-*): icon+label kind badges,
  italic honest-gap rows, deterministic count summaries with correct Czech plurals —
  seven years reads as a story. Do not sand this off.
- **The sticky patient header** (visit-scrolled-*): name + „Objednat se" survive deep
  scroll without eating vertical space.
- **The dead-end modal** (book-dead-end-*): blurred backdrop, exact „Objednávání
  připravujeme." copy, a single generous „Rozumím" — polite and complete in both palettes.
- **The home verdict card** (home-*): big date, kind chip, accent-bordered count verdict —
  the right first-screen hierarchy, once the cards below it stop breaking.

## 4. Disqualifier suspicions (from pixels only; cannot read code)

- **MUST ignored — test ids / note reachability:** the camera could not reach test id
  `note` from the visit URL (both note states missing). If the id is absent or the note
  view is not wired to `v=<visitId>` navigation, that is a portal-spec MUST violation.
- No green anywhere; signal red and the blue accent look kit-plausible; ghost patients
  only (Jakub Svoboda, Lucie Dvořáková, Petr Beneš); summaries read as pure counts.
  The float-tail deltas are formatting rot, not non-deterministic prose — a defect
  (item 3), not a disqualifier.
