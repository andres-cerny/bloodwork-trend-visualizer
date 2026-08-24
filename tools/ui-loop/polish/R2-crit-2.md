# R2 — critique 2 (verification pass)

Shots: `/private/tmp/claude-501/-Users-ondrejcerny-dev-bloodwork-app/110f29a9-6f1d-4dfe-9d96-976adc2dc672/scratchpad/shots/R2-2/` (34 PNGs, 2x).
Scope per instruction: pixels only — the audit sweep, the chat-bundle check and the
ui-kit theme pin were NOT run in this pass and remain unverified.

## Pass-1 defects — one line each

1. **Row crop unreadable — mostly gone.** Value sources now render a scaled band
   with a 2 px blue ring on the cited row, on a paper surface in both palettes
   (`chart-desktop-light/dark`, ~12 CSS px type at 1x); the whole-page thumbnails
   are gone and `sources-open-mobile-*` is now five compact cards instead of
   ~1 750 px of scrolling. Residue below (new defect 1).
2. **Reference band filling the plot — gone.** `chart-desktop-light/dark`,
   `chart-mobile-light/dark`: y-domain now clears 135 and 175, both limits are
   dashed and labelled, the band is a neutral tint and blue is left to the series.
3. **Excerpt shows the letterhead — partially fixed.** `ambiguity-*` card 3 now
   opens at „… Provedené vyšetření / Technika: …" on a paper surface, but card 4
   there and card 8 in `answer-desktop-*` still open on four lines of pure
   identification metadata, and no cited span is highlighted anywhere.
4. **Rail led with uncited sources — gone.** `answer-desktop-light/dark` now leads
   6, 7, 8 with the uncited five under „DALŠÍ PODKLADY" and no number chips;
   `cite-focus-desktop-light/dark` rings card 6 and fills every `[6]`.
5. **Composer sliced a line of text — fixed at the bottom only.** The scrim is
   present and correct in all eight desktop and mobile bottom edges, both
   palettes; the mobile thread's *top* edge got no equivalent (new defect 2).
6. **Blank verification box — gone.** The Turnstile widget is painted in every
   desktop capture (`empty-`, `answer-`, `ambiguity-`, `midstream-`,
   `chart-`, `answer-end-desktop-*`); mobile collapses it to a one-line
   „OVĚŘENÍ" row with a disclosure arrow.

## Remaining / new — ranked

1. **`chart-desktop-light` + `chart-desktop-dark`, all five source cards** — the
   crop is clipped exactly through the value column, so the ring never closes on
   its right side and the last digit of the cited number sits under the edge fade
   („149", „166", „158" all lose their final glyph to it) while the header reads
   „Výsl"; shift the crop window left (or scale ~10 % down) so the ringed row's
   value column ends ~16 px inside the card, and stop the fade after it.
2. **`answer-end-mobile-light` + `answer-end-mobile-dark`** — the first visible
   line of the thread („stanovena pásma A–E podle TF/rychlosti/VO₂,") is sliced
   horizontally at full opacity by the opaque header bar, the exact breakage the
   bottom scrim just removed; add the mirrored 40–56 px `surface → transparent`
   scrim (pointer-events: none) below the mobile header.
3. **`answer-desktop-light/dark` card 8, `ambiguity-desktop-light/dark` +
   `sources-open-mobile-light/dark` card 4** — the excerpt is four lines of
   identification boilerplate („… Identifikace / ID: p-hruby-1994 / Věk: 31 let /
   Pohlaví: …", „… Pacient: Michal Novák / Datum narození … / Operatér: …"),
   which proves nothing about the citation and leaks the internal patient id onto
   the screen; skip leading key/value identification blocks when choosing the
   excerpt start and fall back to the document's first substantive sentence.
4. **`answer-end-desktop-light/dark` and `answer-end-mobile-light/dark`** — the
   „Související" rows carry the same thin „+" glyph the source cards use for
   expand-to-page, while the identical action in the empty state carries „↗", so
   the follow-up reads as an accordion rather than a question that will be sent;
   use „↗" on the follow-up rows and reserve „+" for expanding evidence.
