# R2 — critique 3 (closing call)

Shots: `/private/tmp/claude-501/-Users-ondrejcerny-dev-bloodwork-app/110f29a9-6f1d-4dfe-9d96-976adc2dc672/scratchpad/shots/R2-3/`
(34 PNGs, 2x — mobile judged at 1x). Known intentional limits not re-flagged.

Gates (run this pass, outside the pixel scope): `npm run test:audit` 119/119 pass,
exit 0 · `npm run check:bundle:chat` exit 0 · `npm test packages/ui-kit/tests/theme.test.ts`
2/2 pass, exit 0.

## Pass-2 ranked defects

1. **Crop clipped through the value column — gone.** `chart-desktop-light/dark`, all
   five cards: the blue ring now closes on its right side and 149 / 151 / 166 / 158 /
   150 sit whole inside the card; residue is cosmetic only — the header word
   „Výsledek" still loses its final glyph to the card edge in both palettes.
2. **Mobile thread sliced by the header — gone.** `answer-end-mobile-light/dark`: the
   first partial line now fades out under the header, mirroring the composer scrim.
3. **Identification boilerplate in excerpts — gone.** `answer-desktop-light/dark` card
   7 opens at „… Anamnéza / RA: bez kardiovaskulární zátěže …", card 8 renders no
   excerpt; `ambiguity-*` / `sources-open-mobile-*` card 4 renders none and card 5
   opens at „… Diagnóza: stav po plastice předního zkříženého vazu …". No patient id
   on screen anywhere.
4. **Follow-up glyph — gone.** `answer-end-desktop-light/dark`,
   `answer-end-mobile-light/dark`: „Související" rows carry „↗", matching the empty
   state's suggestions; „+" is left to the source cards.

## Pass-2 unranked notes

5. **Dead band under composer — gone.** Desktop and mobile, both palettes: the
   composer's last row sits ~18 CSS px off the bottom edge, no orphan strip.
6. **Mobile chart limit labels — gone.** `chart-mobile-light/dark`: the limits read as
   bare „175" / „135" at the dashed lines, unclipped, with „Referenční rozmezí
   135–175 g/l" naming them under the plot.

## Fresh-eyes sweep

Hierarchy, cite→card focus (`cite-focus-desktop-*` rings card 6 and fills every [6]),
drawer, picker, mid-stream and dark parity of chart, crops and excerpt tints all hold.
Czech on screen is clean and nominative („parametry", „Kroky agenta", „Další podklady")
— the only „Analyt" is inside the quoted document band, which is not app copy. Three
things remain.

## Remaining defects — ranked

1. **`empty-desktop-dark` (and every desktop dark state) — the Turnstile widget renders
   in its light theme and in English:** a ~420×100 CSS px white block with „Verifying…"
   sits mid-screen on the first thing a doctor sees, and it is the only English string
   in the product; pass `theme` (bound to the app theme) and `language: 'cs'` to the
   widget's render options.
2. **`ambiguity-desktop-light/dark`, `sources-open-mobile-light/dark`, card 3 — an
   excerpt block with no payload:** „… Provedené vyšetření / Technika: …" is a section
   header plus a label whose value is elided, so the evidence for [3] („kompletní
   ruptura LCA") proves nothing while cards 4 and 8 with the same gap correctly render
   nothing at all; treat a line that ends at its colon as non-substantive — fall through
   to the next line that carries a value, else suppress the block.
3. **`ambiguity-desktop-light/dark`, `sources-open-mobile-light/dark` — the rail counts
   3, 4, 5, 1, 2:** cited cards are ordered by first mention but keep source-list
   numbers, so a doctor chasing [1] finds it fourth in a five-card rail; sort the cited
   group by its number.
