# R2 — critique 1

Six defects, ranked. Shots referenced from
`/private/tmp/claude-501/-Users-ondrejcerny-dev-bloodwork-app/110f29a9-6f1d-4dfe-9d96-976adc2dc672/scratchpad/shots/R2/`.

## 1. The row crop is not readable evidence at 1× — in either of its two forms

**Where:** `answer-desktop-light/dark`, `cite-focus-desktop-light`,
`sources-open-mobile-dark`, `chart-desktop-light/dark`.

Two different crop renderings ship, and both fail the same way. For `odber`
sources the card embeds the **whole PDF page** scaled to rail width: at 1× the
table type measures ~4–5 px and nothing — not the lab name, not `S_Ferritin
21` — is readable; it is exactly the "broken thumbnail" the rubric penalises.
For value sources (`chart-*`) the band *is* cropped to the cited row, but it is
rendered ~10 px tall with ~5 px type and sits flush against the card's bottom
edge, so the card's corner radius slices its ends — it reads as a smear, not a
line of a printed report. In neither form is the cited row marked, so card 6 in
`cite-focus-desktop-light` proves *which document* but never *which number*.
On mobile the same bug costs scroll: each `sources-open-mobile-dark` card is
~350 CSS px of unreadable page, five of them ≈ 1 750 px of scrolling.

**Fix:** one RowCrop for both kinds. Crop to the bbox band plus one line of
context above and below; scale the band so its type renders at ≥ 12 CSS px
(bbox-band height drives the scale, not the card width — let the band overflow
horizontally and clip, page-width fit is what kills it); draw a 2 px ring in a
signal token around the cited row inside the band; give the band 8 px inset
padding on a paper surface so the card radius never cuts it. Keep expand-to-page
image behind the `+`.

## 2. The chart's reference band fills the whole plot, so "v pásmu normy" is unverifiable

**Where:** `chart-desktop-light`, `chart-desktop-dark`, `chart-mobile-dark`.

The caption promises „Referenční rozmezí 135–175 g/l", but the y-domain runs
only ~145–172, so the tinted band covers the plot edge to edge and reads as a
background colour. A doctor cannot see how much headroom 150 g/l has to the
lower limit — the one thing the band exists to show. The band tint is also the
same blue family as the series line, so tint and signal compete.

**Fix:** set the y-domain to `[min(dataMin, refLow), max(dataMax, refHigh)]`
padded ~8 %, and add axis ticks at 135 and 175 so the band has visible surface
above and below it. Draw the band in a neutral surface/tint token and keep the
signal token for the line and points only.

## 3. The document source excerpt shows the letterhead, not the cited passage

**Where:** `ambiguity-desktop-light`, source card 3 („MR pravého kolenního
kloubu — popis").

Citation `[3]` supports "kompletní rupturu předního zkříženého vazu (LCA)…",
but the excerpt opens with „Ortopedie a fyzioterapie Podhájí s.r.o. /
Radiodiagnostické pracoviště / MR pravého kolenního kloubu — popis / Pacient: /
Michal Novák" — five lines of boilerplate, with `Pacient:` and its value
hard-wrapped onto separate lines. It is also plain body text at UI size with no
paper surface, so it does not read as evidence next to the lab crops.

**Fix:** start the excerpt at the cited span, not at document offset 0; show
~3 lines before and after it and highlight the cited span with the same signal
ring used in defect 1. Render it on the same paper surface as the lab crops, in
the same smaller face, and collapse runs of whitespace/newlines so header
key/value pairs stay on one line.

## 4. The sources rail leads with five entries the answer never cites

**Where:** `answer-desktop-light/dark` (rail shows 1, 2, 3 above the fold;
answer text cites only `[6]`, `[7]`, `[8]`).

„ZDROJE 8" is ordered by sample date, so the first thing beside the answer is
three cards with no anchor anywhere in the visible text, and every marker the
reader can see points off-screen. `cite-focus` scrolls correctly, but the
resting state teaches the wrong mapping.

**Fix:** order the rail by first citation appearance in the answer, so `[6]`'s
card is card 1 in the rail. Keep uncited context sources, but move them below a
labelled divider („Další podklady") and drop their number chip so the numbering
in the rail matches the numbering in the text.

## 5. The composer's hard opaque edge slices a line of clinical text in half

**Where:** `answer-desktop-light` („…úsecích subjektivně těžší při stejné TF…"),
`answer-mobile-light` („…glukóza, hemoglobin, hematokrit, erytrocyty) jsou v…"),
`ambiguity-desktop-light`, `chart-mobile-dark` (the „Zdroje (5)" disclosure is
cut through its middle).

Mid-scroll, the composer card ends in a straight opaque edge that cuts glyphs
horizontally. The thread's bottom padding is right (`answer-end-*` clears the
composer), so this is only the missing scrim — but it looks like clipped, broken
text rather than content continuing under a surface.

**Fix:** add a 56 px `transparent → surface` gradient scrim above the composer
(pointer-events: none), sized from the same token as the thread background in
both palettes, and give the mobile composer the same treatment.

## 6. The verification slot inside the composer paints as a blank ~95 px box

**Where:** `empty-desktop-light`, `answer-desktop-light`,
`ambiguity-desktop-light`, `midstream-desktop-light` (blank);
`answer-end-desktop-light`, `chart-desktop-light`, `answer-desktop-dark` (widget
present).

The expanded verification region reserves its height before the Turnstile
iframe mounts, so in half the desktop captures the composer is a tall card with
an empty grey void under „OVĚŘENÍ — Číst můžete vše…". It self-heals, but on
first paint the primary control looks broken.

**Fix:** render a placeholder in the slot until the widget reports mount — a
centered, muted „Načítám ověření…" line at the widget's exact height — so the
box is never empty at any moment of load.
