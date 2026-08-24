# R1 — critique pass 1

Six consequential defects, ranked. Pixels only.

## 1. The chart's y-axis excludes its own reference range, so "vše v pásmu normy" reads as the opposite
**Where:** `chart-desktop-light.png`, `chart-mobile-dark.png`

The reference band 135–175 g/l is drawn as a tint that fills the *entire* plot
area, because the y-axis runs roughly 148–170. The consequence: the band conveys
nothing (everything is inside it by construction), the top of the band is clipped
below 175, and the final point (150 g/l) sits flush on the bottom axis line — a
doctor scanning the shape reads "falling to the lower limit" while the prose two
lines below says "vše v pásmu normy". The band tint is also the same blue hue as
the data line, so band and series do not separate.

**Fix:** set the y-domain to `[min(refLow, minValue) - pad, max(refHigh, maxValue) + pad]`
so 135 and 175 are both inside the plot; draw the band as a neutral surface tint
(a low-alpha neutral/surface token, not the series blue) with a hairline at 135
and at 175, each labelled at the right edge; keep the series line the only blue
object in the plot.

## 2. Eight source crops that all show the same letterhead, not the cited row
**Where:** `answer-desktop-light.png` / `-dark`, `sources-open-mobile-dark.png`,
`ambiguity-desktop-light.png`

In the summary thread every one of the 8 rail cards renders an identical band:
lab name, "Výsledky laboratorního vyšetření", Pacient / Datum narození / Datum
odběru / Odesílající lékař. None of them shows the value the answer cites, so the
rail is a stack of eight indistinguishable letterheads — the rubric's "looks like
printed evidence" is technically met and "the crop proves the number" is not. The
chart thread proves the component works: its crops show `B_Hemoglobin  149  g/l
(135-175)`, which is exactly right. Document sources (3, 4, 5 in the ortho thread)
degrade further to a 4-line text stub ending in "Pacient:…" — the truncation lands
before any clinical content.

**Fix:** crop to the cited row's bbox, as the hemoglobin fixture does, not to the
page header; when a citation is document-level with no row bbox, render the quoted
sentence the answer draws on (first ~180 chars of the cited passage) instead of the
document's first four lines, and drop the letterhead entirely.

## 3. Patient disambiguation is unclickable-looking text, numbered like citations, with no names
**Where:** `ambiguity-desktop-light.png`, `ambiguity-mobile-light.png`

The two candidate patients render as bare rows — a grey `1` / `2` numeral chip
identical in shape and colour to the `[n]` citation chips in the answer body, then
"narozen 19. 7. 1963". No name, no button, no hover/tap affordance, no distinguishing
context. Two failures at once: the numerals invite a read as citations into the
ZDROJE rail (which really does have unrelated entries 1 and 2 on the same screen),
and picking the wrong patient is the one clinical error this screen exists to prevent.

**Fix:** render each candidate as a full-width button (surface card, border, hover
and focus ring, min 44px tall) containing `Michal Novák` in medium weight, `nar.
19. 7. 1963` beneath it, and one disambiguating fact on the right (e.g. "poslední
odběr 2. 10. 2024"); remove the citation-style numeral or replace it with a
radio/chevron so it cannot be confused with `[n]`.

## 4. Mid-stream is mostly void, and the pending step does not look alive
**Where:** `midstream-mobile-dark.png` (worst), `midstream-desktop-light.png`

After the four step lines there is a three-dot row and then ~900px of empty dark
(mobile) / ~700px of empty page (desktop) down to the composer. The screen reads
as a request that died, not as work in progress: the pending step "otevírá
dokument…" is styled blue but static, and the dots are small enough to miss.

**Fix:** under the step list, render a skeleton of the incoming answer — a bold
title bar plus 4–6 shimmering text lines at the answer's real measure — so the
column has the shape of the thing that is coming; give the pending step's bullet a
pulsing ring animation (`@media (prefers-reduced-motion: reduce)` falls back to a
static filled dot); drop the standalone three-dot row once the skeleton exists.

## 5. Dark palette: crops are 100%-white slabs on near-black
**Where:** `answer-desktop-dark.png`, `sources-open-mobile-dark.png`

Each crop is a full-luminance white rectangle sitting directly on a #0d0d0d card
with no frame and no inset — at rail width, eight of them stacked make the rail
glare while the text around it is dimmed. This is the "dark is inverted, not
designed" tell; the chart in the same palette got the opposite treatment (a proper
dark plot surface).

**Fix:** in dark, wrap each crop in a 1px border token and knock the image back —
`filter: brightness(.86) contrast(1.06)` on the crop image inside the dark palette,
restored to full brightness on the expanded page view; define the rule for both
palettes (light gets `filter: none`) so the pin holds.

## 6. Two date formats and two "ask this" glyphs on the same screens
**Where:** `chart-desktop-light.png`, `answer-desktop-light.png`,
`answer-end-desktop-light.png` vs `empty-desktop-light.png`

- The rail titles carry raw ISO on screen — "Odběr 2023-02-14" — directly above the
  same date in Czech form, "· 14. 2. 2023". The same card states one date twice, in
  two conventions, one of which is not Czech.
- In the chart answer the body list uses "16.1.2024" (no spaces) while the rail two
  inches to the right uses "16. 1. 2024".
- Follow-ups under an answer are rows ending in `+`; the empty-state suggestions are
  rows ending in `↗`. Same action, two glyphs — and `+` is also the rail's
  expand-crop control, so it reads as "add", not "ask this".

**Fix:** title the rail cards "Odběr · 14. 2. 2023" (Czech spacing, one date, no
ISO); normalise every rendered date through one formatter with `d. M. yyyy` spacing;
use `↗` for both suggestion rows and follow-up rows and reserve `+` for the crop
expander.
