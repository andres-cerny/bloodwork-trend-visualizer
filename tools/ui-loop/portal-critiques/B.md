# Candidate B — blind critique (screenshots only)

32 shots reviewed: picker, home, timeline, timeline-sparse, visit-annual,
visit-scrolled, note, chart-lab, chart-perf, book-dead-end · mobile+desktop ·
light+dark where provided.

## 1 · Score table

| # | Criterion | Score | Justification |
|---|---|---|---|
| 1 | First-screen answer | 2 | home-mobile-*: date, kind badge, title and „4 parametry mimo rozmezí z 15 měřených" fit in one 390px viewport — but *what changed* (deltas) is below the fold, pushed out by a note preview that spends its space on letterhead. |
| 2 | Calm, not clinical | 2 | Verdicts honest, „vše v normě" earns its place in timeline; but the display-size red „4" (home-*) shouts, and timeline-sparse paints the neutral perf count red (see defect 4). |
| 3 | Trend legibility at phone width | 3 | chart-lab-mobile-*: reference band with labeled „max 175 / min 135", y-axis, year ticks, Czech decimals, no h-scroll; sparklines in visit-annual-mobile read as direction at a glance. |
| 4 | Delta view | 3 | visit-annual-*, chart-*: „↘ −0,20 l/min od 4. 11. 2025 · měřeno 9. 6. 2026" — direction, magnitude, comparison visit, no legend needed. Best-in-class pattern. |
| 5 | Timeline scannability | 2 | timeline-sparse-mobile-* gap markers are exemplary; but date column wraps („19. 11." on two lines, timeline-mobile 2024), badge placement is inconsistent (inline vs below title), and the red summary bullet misaligns on two-line summaries. |
| 6 | Note as a document | 1 | Serif type and „Uvolněno" line are right, scanned pages politely collapsed — but note-mobile-* and visit-scrolled-* flatten every table into one-cell-per-line lists: „156 / 178 / 192" under „Tepová frekvence" with no stage context; letterhead and „2 / 2" page marker render as body prose. The letter is illegible where it matters most. |
| 7 | Czech copy fit | 2 | Pluralization flawless (1 parametr / 4 parametry / 5 návštěv / 10 měsíců), nominative labels, Czech dates and decimal commas throughout; docked for the wrapped date „19. 11." and the orphaned „Datum kontroly:…" truncation in the home note preview. |
| 8 | Palette parity | 3 | Every state shipped in both palettes; dark is a real palette (ink type, token surfaces, gold note border kept), no light artifacts found. Only nit: the reference-band fill in chart-lab-*-dark is nearly invisible. |
| 9 | Mobile ergonomics | 2 | Sticky „Objednat se" always reachable; big row targets; but the sticky bar occludes the first flagged result on home-mobile, and „změnit" / „‹ Přehled" / „Historie" are small text links, likely under 44px. PWA chrome not assessable from shots. |
| 10 | Wow, honestly earned | 2 | The sparse timeline (honest gaps) and the full chart with labeled band + stat cards are photographable; the flattened note and letterhead-first home preview keep it from a 3. |

**Total: 22/30**

## 2 · Defect list (by severity)

1. **Note tables are flattened into meaningless vertical lists.**
   note-mobile-light/dark, visit-scrolled-mobile-light/dark. The training-zone
   table (Intenzita/TF/RPE) and the spiro stage table (Tepová frekvence 156 /
   178 / 192, VO₂ 49,5 / 61,4 / 70,4 …) render one cell per line; the reader
   cannot tell which value belongs to which stage. Fixed = the note body
   preserves tabular structure (a real table or grouped rows per stage),
   letterhead set off as a header block, „2 / 2" page marker not body text.
2. **Home note preview spends the first screen on boilerplate.**
   home-mobile/desktop, light+dark. The preview shows clinic address, phone,
   e-mail, patient name and DOB, then truncates mid-label at „Datum
   kontroly:…" — an orphaned label with colon. Deltas fall below the fold.
   Fixed = preview starts at the clinical body (Souhrn/first sentence),
   truncates at a sentence boundary; the fold then answers „co se změnilo".
3. **Timeline date column wraps.** timeline-mobile-light/dark, 2024 entry:
   „19. 11." breaks into „19." / „11.". Fixed = white-space:nowrap or a wider
   date column at 390px.
4. **Red paints the neutral half of a summary.** timeline-sparse-mobile-*,
   6. 5. 2025 entry: „2 parametry mimo rozmezí · 13 výkonnostních ukazatelů"
   is red end-to-end; the perf count is not an alarm. The red bullet also sits
   misaligned beside the wrapped second line. Fixed = signal colour only on
   the flag phrase; bullet aligned to first line.
5. **Sticky CTA occludes content.** home-mobile-light/dark: the first card
   under „MIMO ROZMEZÍ 4" is cut behind the „Objednat se" bar. Fixed =
   scroll-padding/bottom inset equal to bar height so the last element can
   scroll clear.
6. **Badge placement inconsistent in timeline.** timeline-mobile-*: „krev"
   sits inline with the title, „tHb" and „spiroergometrie" wrap below,
   producing uneven rows. Fixed = one rule (badge always on its own line, or
   always inline with ellipsis on the title).
7. **„MIMO ROZMEZÍ 0" stat card on a metric with no reference range.**
   chart-perf-mobile/desktop, both themes: VO₂max has no band drawn, yet the
   card claims 0 out of range — implies a range was checked. Fixed = hide the
   card (or „bez rozmezí") when no bounds exist.
8. **Dark reference band nearly invisible.** chart-lab-mobile/desktop-dark:
   the in-range fill barely separates from the card surface; the band reads
   only from its dashed edges. Fixed = a stronger token tint so band parity
   with light holds.
9. **Unit stated twice in chart header.** chart-lab-*, chart-perf-*:
   „Hemoglobin g/l" then „144 g/l" directly beneath. Fixed = unit once, next
   to the value.
10. **Display-size red numeral on home.** home-* all four: the „4" at ~64px in
    alarm red is the loudest thing on the page for a patient with mostly
    normal results. Fixed = same card, numeral at heading size in the flag
    token, letting the words carry the message.
11. **Small text-link touch targets.** home/visit/chart mobile: „změnit",
    „‹ Přehled", „Historie", „Celá zpráva…" are bare links; likely below
    44px. Fixed = padded hit areas.

## 3 · Keep list

- **The gap markers.** „10 měsíců bez návštěvy" on a dotted spine between
  timeline cards (timeline-sparse) — the honest-gaps requirement done better
  than any typical take; do not sand this off.
- **The delta grammar.** „↘ −0,20 l/min od 4. 11. 2025 · měřeno 9. 6. 2026"
  — direction, magnitude, both dates, zero legend. Keep verbatim.
- **Czech pluralization and number formatting.** 1 parametr / 2 parametry /
  4 parametry / 5 návštěv / 10 měsíců, decimal commas, spaced dates — rare to
  see it this consistently right.
- **The full-chart package.** Labeled band bounds (max 175 / min 135), stat
  cards (MĚŘENÍ · MINIMUM · MAXIMUM · MIMO ROZMEZÍ) and the „Všechna měření"
  list under the chart — a complete, clinic-grade metric page.

## 4 · Disqualifier suspicions

None visible. Summaries read as count-derived („2 parametry mimo rozmezí ·
13 výkonnostních ukazatelů" — never prose interpretation); no green anywhere
in either palette; the book dead-end shows the exact mandated copy
(„Objednávání připravujeme."); fixture patients are ghosts (Jakub Svoboda,
Lucie Dvořáková, Petr Beneš) with an explicit „Ukázková data — smyšlený
pacient" disclaimer in the note. Cannot verify from pixels: dynamic fixture
import, data.ts-only fetching, URL pushes, test ids.
