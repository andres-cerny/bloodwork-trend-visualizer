# R1 — critique pass 2 (verification + fresh look)

## Verdict on each pass-1 defect

1. **Chart y-axis excludes its own reference range — GONE.** All four chart
   shots now put 135 and 175 inside the plot as dashed hairlines labelled
   „horní mez 175" / „dolní mez 135"; the band is a neutral tint, the series is
   the only blue object, and the last point (150) floats clear of the axis.
2. **Eight identical letterhead crops — PARTIALLY FIXED.** The lab cards no
   longer render letterheads (chart thread: a compact `B_Hemoglobin 149 g/l
   (135-175)` row; summary thread: nothing at all). Document cards still open
   with 6–9 lines of letterhead and truncate before the cited sentence — see
   remaining defect 1.
3. **Patient disambiguation — GONE.** Both candidates are full-width bordered
   cards: `Michal Novák` in medium weight, `nar. 19. 7. 1963` beneath, chevron
   at the right, ~70px tall, no citation-style numeral. Light and dark, desktop
   and mobile.
4. **Mid-stream void / dead pending step — FIXED IN STRUCTURE, BROKEN IN
   LIGHT.** „Agent pracuje…" replaces the static chevron label, the pending step
   has a filled blue ring, the three-dot row is gone and a title-bar + 9-line
   skeleton fills the column. But the skeleton is invisible in the light
   palette — see remaining defect 2.
5. **Dark crops as 100%-white slabs — GONE.** Document excerpts now sit on a
   dark surface with light type; the only remaining paper facsimile is the
   one-line reference strip, knocked to #e1e1e1 and framed. No glare stack.
6. **Two date formats and two "ask this" glyphs — GONE.** Rail titles read
   „Odběr · 14. 2. 2023" (no ISO, no doubled date), body dates are „16. 1. 2024"
   with Czech spacing, and both the empty-state suggestions and the „Související"
   follow-ups use ↗ while `+` is only the crop expander.

## Remaining / new defects

### 1. Document source cards are still 6–9 lines of letterhead, and the cited sentence never appears
`ambiguity-desktop-light` / `-dark` (cards 3, 4, 5), `answer-desktop-light` /
`-dark` (cards 7, 8), `sources-open-mobile-light` / `-dark`. Card 3's excerpt
spends nine lines on „Ortopedie a fyzioterapie Podhájí s.r.o. / Radiodiagnostické
pracoviště / … / Popsal: MUDr. Eva Puchmertlová / Provedené vyšetření /
Technika:…" and stops there, while the answer cites `[3]` for „kompletní rupturu
LCA" — the excerpt is longer than in pass 1 and still proves nothing. On mobile
this consumes a full screen for zero clinical content.
**Fix:** start the excerpt at the passage the citation points at (the sentence
containing the cited claim, ~180 chars, ellipsis on both sides) and drop the
header block entirely; keep the document title in the card title, where it
already is.

### 2. The new streaming skeleton is invisible in the light palette
`midstream-desktop-light`, `midstream-mobile-light`. The skeleton bars are
`rgb(238,237,232)` on a `rgb(242,241,237)` page — 1.03:1, four levels of grey
apart. Dark got `rgb(38,38,37)` on `rgb(13,13,12)`, a delta of 25. The fix that
was supposed to make mid-stream read as progress works in one palette only, and
the default one is the broken one.
**Fix:** give the skeleton its own token pair and set the light value to roughly
the same delta as dark (about `rgb(224,222,216)` on the light page, ~1.2:1
against the surface but visible as shape); define it in both the media-query
dark block and `[data-theme="dark"]` so the parity pin holds.

### 3. The summary thread's lab cards are empty, including the one cite-focus highlights
`answer-desktop-light` / `-dark`, `cite-focus-desktop-light` / `-dark`,
`sources-open-mobile-*`. Cards 1–6 carry only „Odběr · 24. 2. 2026 / Laboratoř
Zelený Ostrov" — not the compact reference row the chart thread's lab cards get.
Clicking `[6]`, which four out-of-range claims (CK, ferritin, saturace
transferinu, železo) all point to, rings a card that shows no number at all.
**Fix:** in an odběr-level card render the compact reference rows for the
parametry the answer actually cites from it, same component as the chart thread
uses — four rows in card 6, none in cards 1–5 that nothing cites.

### 4. Mobile chart type is 5–7px at 1×
`chart-mobile-dark`, `chart-mobile-light`. The plot is scaled to the 390px
column with its text, so „horní mez 175" and „dolní mez 135" land at ~5px and the
axis ticks at ~6.5px — the labels the pass-1 fix added are unreadable exactly
where the chart is smallest. The caption below („Referenční rozmezí 135–175 g/l")
is 16px, so the mismatch is visible within one card.
**Fix:** size chart text after the scale (compensate the viewBox factor, or set
font-size in px on a non-scaling text layer) with an 11px floor; below ~480px
drop the inline mez labels to bare „175" / „135" at the right edge, since the
caption already names the range.
