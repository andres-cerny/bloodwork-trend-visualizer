# Candidate A — critique, round 2 (verification pass)

## Pass-1 defects, verified state by state

1. **Rail crops unreadable at rail width — PARTIALLY FIXED.** The full-page
   renders are gone everywhere and the lab card now has a legible compact
   reference band where one exists (`chart-desktop-light/dark`: „B_Hemoglobin …
   149" at ~11 px with a signal ring), but in the flagship summary the same
   card renders title + laboratoř + date and nothing else — illegible evidence
   became absent evidence.
2. **Gate block ate 47 % of the mobile viewport — FIXED.** Input + one-line
   explainer + Turnstile now measures ~160 CSS px of 844 (≈19 %) in
   `answer-mobile-light/dark`, `chart-mobile-*`, `midstream-mobile-*`; the
   transcript keeps the screen and no bullet is clipped behind it.
3. **Punctuation detached from the word — FIXED.** The period now precedes the
   marker in every occurrence („roku 2023. ⁷", „týdně. ⁷", „zásobám železa. ⁸"
   in `answer-end-desktop-light`, „samotného. ⁷" in `answer-desktop-*`), and no
   marker orphans onto its own line in `answer-mobile-light`.
4. **Chart not doing its two jobs — FIXED.** The y domain now clears the
   reference band on both edges with dashed, labelled „horní mez 175" /
   „dolní mez 135" limits and a bold end-point label (150); mobile axis type
   renders at ~12 CSS px in `chart-mobile-light/dark`, above the caption's
   weight rather than below it.
5. **Dark: crop as a full-bleed white block — FIXED.** No white page asset
   remains in `answer-desktop-dark`, `cite-focus-desktop-dark` or
   `sources-open-mobile-dark`; the dark reference band is dimmed to a grey
   paper tone rather than a glare panel. (The glare moved to the Turnstile
   iframe — see new defect 3.)
6. **Two Michal Nováks rendered as prose — FIXED.** `ambiguity-desktop-light/dark`
   and `ambiguity-mobile-light/dark` show numbered, bordered candidate rows with
   the birth date as the bold discriminator, identical in both palettes.

## Remaining / new, ranked

1. **The evidence rail carries no evidence in the flagship answer** —
   `cite-focus-desktop-light/dark`, `answer-desktop-light/dark`,
   `sources-open-mobile-light/dark`: the focused card 6 („Odběr 2026-02-24")
   contains only a title, a lab name and a date, so the four cited numbers
   (CK 5,1 · ferritin 21 · saturace 13,9 · železo 8,1) land on an empty box —
   while the identical component in `chart-desktop-*` proves a value band can
   render; emit one compact reference row per cited parametr in the card
   (name · hodnota · jednotka · ref) instead of only for single-value citations.

2. **Document excerpts are letterhead, and they are sliced through the glyphs** —
   every state with document sources, both themes and viewports (cards 7–8 in
   `answer-desktop-*`/`cite-focus-desktop-*`, cards 3–5 in `ambiguity-desktop-*`,
   cards 3–4 in `sources-open-mobile-*`): the seven visible lines are „Ortopedie
   a fyzioterapie Podhájí s.r.o. / … / Pacient: / Datum narození:" and the cited
   finding never appears, and the block is cut mid-x-height ("Datum vyšetření:")
   bleeding past the card's rounded border; start the excerpt at the cited
   passage and clamp with `-webkit-line-clamp` (whole lines + ellipsis) or a
   bottom fade instead of a fixed max-height overflow.

3. **The Turnstile widget is now the brightest object on every dark screen** —
   `midstream-mobile-dark`, `empty-mobile-dark`, `sources-open-mobile-dark`,
   `answer-desktop-dark`, `chart-desktop-dark`: a ~300×75 CSS px pure-white
   iframe sits in the composer against near-black chrome, exactly the
   "light asset dropped in" that defect 5 removed from the rail; pass
   `theme: 'dark' | 'auto'` to the Turnstile render options from the same
   `data-theme` value the app already reads.

4. **Two copy slips introduced by the fixes** — `empty-desktop-light/dark` and
   `midstream-desktop-*` promise „Číslo [1] v textu sem odkazuje" while the
   markers now render as a bracket-less pale-grey chip, and the new candidate
   rows in `ambiguity-*` read „narozen 19. 7. 1963", a verb in what is now a
   label row; align the rail copy with the rendered marker („Číslo u věty sem
   odkazuje") and set the rows nominative — „nar. 19. 7. 1963".
