# Candidate A — critique, round 1

Six consequential defects, ranked. Everything else in the 34 shots holds up:
the cite-focus interaction (blue markers + ringed rail card) is genuinely good,
the follow-up rows read like Perplexity's "Related", the drawer and the tenant
picker are clean, and the hierarchy question → Kroky agenta → answer → Související
is correct in both palettes.

## 1. Rail crops render the whole page at rail width — the evidence is unreadable

**Where:** answer-desktop-light, answer-desktop-dark, cite-focus-desktop-light/dark,
ambiguity-desktop-light/dark (every desktop state with sources).

The source card is ~311 CSS px wide and the crop is a full A4 page render scaled
to fit it, so the lab table's body type lands at roughly 4–6 CSS px — the numbers
a doctor is being asked to trust are literally illegible. Nothing inside the crop
marks *which* row was cited: card 6 backs four different parameters (CK, ferritin,
saturace transferinu, železo) and shows an undifferentiated table. Verified by
downscaling the 2x shot to true 1x: the "S_Ferritin 21" line is a grey smudge.
The mobile disclosure has the same problem (~355 CSS px, ~6.5 px type) —
sources-open-mobile-dark only looks readable when viewed at 2x.

**Fix:** crop to the bbox band in *both* axes, not just vertically. Clip the page
image horizontally to the Analyt / Výsledek / Jednotka / Referenční meze columns
and scale the band so its text renders at ≥ 11 CSS px (overflow hidden on the
container, `transform: scale()` or a wider source render — not `width: 100%` on a
full page). Draw the cited row with a signal-token ring or tint so `[6]` lands on
a row, not a page. Keep click-to-expand to the full page image unchanged.

## 2. The gate block eats 47 % of the mobile viewport

**Where:** every mobile shot — answer-mobile-light, chart-mobile-dark,
ambiguity-mobile-light, midstream-mobile-light, empty-mobile-light.

Input + two-line explainer + Turnstile = ~400 CSS px of a 844 px viewport, pinned
over the transcript. In answer-mobile-light the reading area is down to four
bullets and the fifth ("Železo: aktuálně 8,1 µmol/l – pod rozmezím 11–") is
clipped mid-sentence behind it. Since the shots never reach `gate.ready`, this is
the state a doctor meets on first load.

**Fix:** compact the pre-ready composer to ≤ 200 CSS px at 390 px: explainer to a
single line („Odeslání odemkne krátké ověření."), Turnstile in its compact size,
or collapse the widget behind a one-line „Ověřit pro odeslání" bar that expands on
input focus. The reading path must never be the minority of the screen.

## 3. Citation markers push sentence punctuation off the word

**Where:** answer-desktop-light/dark („dle pacienta samotného [7] ."),
answer-end-desktop-light (four bullets in a row: [7] ., [7] ., [8] .),
answer-end-mobile-light („vyčerpaným zásobám železa [8] ."), ambiguity-desktop-light.

The marker carries horizontal margin on both sides plus a whitespace text node, so
the closing period detaches and floats a full space away. It reads as a typo, and
it repeats on nearly every bullet of the flagship answer.

**Fix:** `margin-left: .15em; margin-right: 0` on the citation marker and strip the
whitespace between the marker and following punctuation when rendering (or emit the
marker after the period). Also give the marker a non-breaking bond to the preceding
word so it never wraps alone — it already orphans onto its own line in
answer-mobile-light (the [6] under the ferritin bullet) and answer-desktop-light
(the [6] under saturace transferinu).

## 4. The chart is not doing its two jobs

**Where:** chart-desktop-light, chart-mobile-light/dark.

(a) The y domain is clipped to the data (~148–170) while the reference range is
135–175, so the tinted reference band fills the entire plot rect with no visible
top or bottom edge. It reads as decorative background, and the one thing a doctor
wants to see — how much headroom is left before 135 — is invisible.
(b) On mobile the whole SVG is uniformly scaled to fit, so axis labels
("170", "1/24") render at ~7 CSS px, smaller than any other type on screen and
smaller than the caption directly beneath them, inverting the hierarchy.

**Fix:** (a) set the y domain to `min(data, refLow) … max(data, refHigh)` with
padding so the band's edges land inside the plot, and draw the two limits as 1 px
dashed lines labelled 135 / 175. (b) render the chart responsively — axis text at a
fixed CSS size (≥ 11 px at 390 px) instead of scaling a fixed viewBox — and raise
the mobile plot height to ~220 CSS px.

## 5. Dark palette: the crop is a full-bleed white block, not a designed surface

**Where:** answer-desktop-dark, sources-open-mobile-dark, cite-focus-desktop-dark.

The page image runs edge-to-edge inside the card at 100 % white against near-black
chrome — a ~290×220 px lightbox in the middle of a dark rail. It is the one place
dark mode reads as "light asset dropped in", not designed.

**Fix:** inset the crop in the card (8 px padding on a token surface, 1 px token
border, matching radius) and dim the page image in dark so it reads as paper under
low light rather than a glare panel. Same rule in both palettes, differing only by
token value — do not add a dark-only rule.

## 6. The two Michal Nováks are rendered as prose

**Where:** ambiguity-desktop-light/dark, ambiguity-mobile-light/dark.

The riskiest moment in the product — two patients with the same name — renders as
three ordinary body paragraphs ("1. narozen 19. 7. 1963", "2. narozen 27. 2. 1988",
"Kterého z nich máte na mysli?") with the same weight, size and colour as the rest
of the answer. The discriminator (the birth date) gets no emphasis at all, and the
list is not visually a set of candidates.

**Fix:** when a turn's answer is a clarification, render the numbered candidates as
a bordered list of rows — name in medium weight, „nar. 19. 7. 1963" as the
emphasised discriminator, one per row with the same left-rail treatment as the
sources cards. Presentation only; do not invent chips client-side (spec §Follow-ups).
