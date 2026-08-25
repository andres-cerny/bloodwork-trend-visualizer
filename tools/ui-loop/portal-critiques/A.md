# Candidate A — blind critique (screenshots only)

Judged from 18 shots in `shots/A`; two states (note-mobile-light, note-mobile-dark)
are MISSING because the camera timed out reaching test id `note` from the visit
URL — treated below as a concrete defect, not an unknown.

## 1. Score table

| # | Criterion | Score (0–3) | Justification |
|---|---|---|---|
| 1 | First-screen answer | 3 | home-mobile-light/dark: name, „Poslední návštěva · 11. 8. 2026", KREV badge, „Kontrolní odběr", verdict „4 parametry mimo rozmezí" and the first flagged rows all inside one 390px viewport, no chrome to scroll past. |
| 2 | Calm, not clinical | 2 | Flags honest and confined to values/arrows (home-mobile); „Vše v normě" earns its place as the visit subtitle (visit-annual) and in timeline rows. Docked one point: above the fold the red verdict line plus four red arrow+value pairs stack five red elements — signal is honest but salience is doubled (arrow, number, and headline all red). |
| 3 | Trend legibility at phone width | 2 | chart-lab-mobile: fits 390 with no h-scroll, Czech decimals („5,39", „14,8"), big axis type. Docked: the reference band is invisible as a band — it fills the entire plot (see defect 3). Sparklines (book-dead-end-mobile) read as direction at a glance. |
| 4 | The delta view | 3 | home-mobile „Od minulé návštěvy — ve srovnání s návštěvou 9. 6. 2026": direction (arrow), magnitude with unit („↓ −3 g/l"), and the comparison visit named. No legend needed. Chart header repeats it („↓ −3 g/l od 9. 6. 2026"). |
| 5 | Timeline scannability | 2 | timeline-sparse-mobile: honest gap rows („10 měsíců bez návštěvy") are exemplary; deterministic summaries scan as a story. Docked: kind badges are not distinguishable without reading (KREV gray-filled vs SPIROERGOMETRIE gray-outlined), badge placement wraps inconsistently, and the date column wraps „19. 11. / 2024" even at desktop. |
| 6 | The note as a document | 1 | visit-scrolled-mobile (both themes): the note's „Tréninkové intenzity" table has collapsed into one-cell-per-line prose — zone, TF range and RPE lose their pairing entirely; „2 / 2" floats as a bare line. The dedicated note view is unreachable at mobile (missing shots). Serif body and „Uvolněno 11. 8. 2026" (home card) save it from 0. |
| 7 | Czech copy fit | 2 | Vykání frames („Vyberte, prosím, své jméno.", „Přejete si další termín?"), correct plural morphology (1 parametr / 2 parametry / 7 ukazatelů / 10 měsíců), Czech dates and decimal commas throughout. Docked: „Hb mass rel." is English on screen (book-dead-end), „TRÉNINKOVÉ INTENZITY:" carries a trailing colon, date wrap at desktop. |
| 8 | Palette parity | 3 | Every captured state has a complete dark twin: note card, badges, gap rules, chart band and gridlines, and the „Objednat se" button re-toned (navy → periwinkle with dark text) rather than left navy-on-black. No confirmed light artifact; signal red shifts to a lighter rose for dark contrast. |
| 9 | Mobile ergonomics | 2 | Row targets are tall, „Objednat se" is a full-width thumb-sized button and its dead-end („Objednávání připravujeme.") is polite and in place (book-dead-end-mobile). Docked: lab rows show no affordance at all (no chevron on home/visit-annual lab rows — nothing says they open the chart), and the note is unreachable from the visit at 390px. |
| 10 | Wow, honestly earned | 2 | The sparse timeline with dashed „bez návštěvy" markers and the serif home hero are photograph-worthy. The collapsed note table and the band-less chart keep it from 3. |

**Total: 22/30**

## 2. Defect list (by severity)

1. **Note unreachable at mobile — two states missing.** note-mobile-light and
   note-mobile-dark do not exist because the camera timed out reaching test id
   `note` from the visit URL at 390px. Fixed = navigating the visit at 390px
   reaches `[data-testid="note"]` in both palettes and both shots exist.
2. **The doctor's table renders as flattened prose.** visit-scrolled-mobile,
   both themes: „Tréninkové intenzity" emits header cells and data cells as
   sequential single lines (Intenzita / zóna → TF (/min) → RPE → I0 —
   regenerace → do 140 → 2–3 …). The reader cannot pair a zone with its TF
   range without counting lines. „2 / 2" floats as a bare paragraph. Fixed =
   the note's tabular content renders as a table (or label–value pairs) and
   page markers are styled as chrome, not body text.
3. **Reference band is invisible as a band.** chart-lab (all four shots): the
   caption says „Referenční rozmezí 135–175 g/l — vyznačeno podkladem", but the
   tinted background fills essentially the whole plot — neither bound is inside
   the visible y-domain, so the „band" reads as a plain chart background. Fixed
   = y-domain padded beyond both bounds so two band edges are visible, at 390px
   and 1440, both palettes.
4. **English label on screen: „Hb mass rel."** book-dead-end-mobile, both
   themes, performance list. Fixed = Czech nominative label (e.g. „Hmota Hb
   relativní" per the inventory's Czech naming), consistent with „Objem krve"
   beside it.
5. **Lab rows: no sparklines seen, no tap affordance.** No captured state shows
   a per-row sparkline for lab results (performance rows have them;
   book-dead-end-mobile). Home and visit-annual lab rows also lack any chevron
   or affordance, so nothing suggests a row opens its chart. If lab sparklines
   are genuinely absent this is a spec MUST miss, not taste. Fixed = word-sized
   sparkline on each lab trend row and a visible affordance on rows that open
   the full chart.
6. **Date column wraps at desktop.** timeline-desktop light+dark: „19. 11. /
   2024" breaks onto two lines at 1440 — the one width where space is
   abundant. Fixed = date column wide enough for the longest Czech date, or
   white-space: nowrap.
7. **Kind badges not distinguishable without reading.** timeline-mobile/desktop:
   KREV (gray filled) vs SPIROERGOMETRIE (gray outlined) differ only in
   border; THB is gold-outlined, PROHLÍDKA blue-filled. Badge placement also
   wanders — inline after short titles, own line after long ones. Fixed = one
   distinct token-hue per kind and a fixed badge slot.
8. **Label with trailing colon.** visit-scrolled-mobile: „TRÉNINKOVÉ
   INTENZITY:" — the only section label with a colon; labels elsewhere
   (LABORATOŘ, ZPRÁVA LÉKAŘE) are bare. Fixed = drop the colon.
9. **Theme switch names the state, not the action.** All states: the pill reads
   „Světlý" in light mode and „Tmavý" in dark — ambiguous whether it names the
   current or the target palette. Low, but a one-word fix (or icon-only).
10. **Desktop is a centered phone column.** picker/home/timeline/chart-desktop:
    ~2/3 of a 1440 viewport is empty margin; only visit-annual-desktop uses
    columns. Spec allows „desktop the adaptation," but this is the weakest
    reading of it. Low priority; do not fix at the cost of mobile.
11. **Unconfirmed: hairline light strip at the very bottom edge of the dark
    mobile captures** (first renders of picker/home-mobile-dark). Could be a
    capture artifact or a horizontal scrollbar track; could not be reproduced
    on re-crop. Worth a one-line overflow-x check; not scored.

## 3. Keep list

- **The honest gap markers.** „10 měsíců bez návštěvy" between dashed rules
  (timeline-sparse-mobile) is the best expression of „gaps honest" I've seen in
  this exercise — keep the wording and the dashed treatment exactly.
- **Czech numeral and plural discipline.** 1 parametr / 2 parametry /
  7 ukazatelů / 10 měsíců, decimal commas, thin-space thousands („7 150 ml"),
  Czech date format everywhere including axis labels. Do not let a polish pass
  regress this.
- **The home hero hierarchy.** Kicker → serif title → one-line deterministic
  verdict answers „jak na tom jsem?" in a single glance; the verdict doubles as
  the timeline summary string, so the language is consistent app-wide.
- **„Všechna měření" under the full chart** plus the honest „Bez referenčního
  rozmezí." caption — the numbers stay accessible when the drawing can't carry
  them.

## 4. Disqualifier watch (suspicion only — I cannot read code)

- **URL/test-id MUST, suspected violation:** `note` was not reachable from the
  visit URL at 390px (camera timeout; two states missing). If the note view or
  its test id only mounts at desktop widths, that is a MUST failure, not taste.
- **Fixed-scope MUST, suspected gap:** no evidence of per-row sparklines for
  lab results in any captured state (performance rows have them). Verify in
  code before disqualifying — the middle of the home scroll was not captured.
- No visible colour-token violations: palette is green-free; line/badge/flag
  colours (blue, rose-red, gold) are plausible kit tokens and dark values shift
  consistently, suggesting tokens rather than hard-coded colours.
- All interpretation text seen is count-derived („4 parametry mimo rozmezí",
  „vše v normě") — no diagnosis-flavoured prose anywhere.
