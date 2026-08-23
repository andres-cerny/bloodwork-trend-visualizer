# Round 2 — verdict

Judged blind from 3 × 34 screenshots (five states × two viewports × two palettes,
one fixed camera). No code was read. Crops below are cited by
`<state>-<viewport>-<theme>`.

## 1. Scores

| Dimension | A | B | C |
|---|---|---|---|
| Hierarchy | 5 | 3 | 4 |
| Reference-pattern likeness | 5 | 4 | 3 |
| Evidence legibility | 4 | 3 | 2 |
| Czech copy fit | 4 | 5 | 5 |
| Mobile ergonomics | 3 | 3 | 4 |
| Palette parity | 3 | 4 | 4 |
| Streaming states | 4 | 3 | 5 |
| Wow | 5 | 3 | 4 |
| **Total** | **33** | **28** | **31** |

## 2. Winner

**A** — it is the only variant where the answer, the citation link and a piece of
actually readable printed evidence all live on one screen, and it is the only one
a Perplexity user would navigate without a tour (centred landing composer in
`empty-desktop-light`, steps folded into one pill, related questions as
full-width `+` rows, numbered rail on the right).

## 3. The winner's five most consequential defects

1. **The rail shows one and a half sources.** `answer-desktop-light` /
   `-dark`: card 1 is a full lab page ≈ 500 CSS px tall, so of eight numbered
   sources only #1 and the header of #2 are above the fold; finding [7] means
   scrolling a rail with no map. Fix: collapse each entry to the bbox band by
   default (A already renders one in `chart-desktop-light`) with the numbered
   header pinned, and keep the full page behind the `+`.
2. **Dark mode fires a white flare.** `sources-open-mobile-dark`,
   `answer-desktop-dark`: the crops are un-dimmed pure-white page images on a
   near-black surface — on mobile a single crop is a 600 px white slab. The
   crops read as an asset that dark mode forgot. Fix: put the crop on a defined
   raised surface with an inset border and knock the page luminance back
   (~10 %) in the dark palette, both palettes defined side by side.
3. **The mobile composer eats the answer.** `answer-mobile-light`,
   `chart-mobile-dark`: the input + explanation + always-expanded Turnstile
   occupy ~400 of 844 px, and the last two bullets of the answer fade out
   underneath it. Fix: one-line verification copy with the widget collapsed
   until the input is focused (C's `OVĚŘENÍ` block is ~250 px and shows two
   more bullets).
4. **Citation markers are stray numerals at rest.** `answer-desktop-light`: the
   `6` after "pod rozmezím 30–400" and after "20–45" wraps alone onto the next
   line, superscripted, grey, unbracketed — it reads as a footnote artefact, not
   as a control (it only becomes a blue chip on focus, `cite-focus-desktop-light`,
   where it is excellent). Fix: bracket/box the marker at rest and bind it to
   the preceding word so it can never orphan.
5. **Czech number format is wrong in the chrome.** Sidebar footer of every
   desktop shot: „Rozpočet ukázky: zbývá 9.61 $" — decimal point, not comma
   (`ambiguity-desktop-light` shows „9.78 $"). B and C both render „9,61 $".
   Fix: format with `cs-CZ`.

Lesser, worth a line: A's chart card carries no parameter/unit title
(`chart-desktop-light`) — the reader learns it is hemoglobin only from the prose;
and the ambiguity answer renders its numbered options as loose paragraphs with no
clickable choice (`ambiguity-desktop-light`).

## 4. Grafts

- **From B — the row band scaled to be read.** `chart-desktop-light` rail: B
  blows the bbox band up to full rail width, so „B_Hemoglobin 149 g/l" is legible
  at rest without leaning in; A renders the same band at half that size
  (`chart-desktop-light`, card 1). Land it as A's default collapsed crop for
  every source (defect 1) — and fix B's bug while grafting: B's scaling pushes
  the „Referenční meze" column off the right edge, which is the one column a
  doctor needs.
- **From C — the compact verification block.** `answer-mobile-light` /
  `midstream-desktop-light`: C keeps „OVĚŘENÍ / Číst můžete vše. K odeslání
  dotazu stačí projít ověřením." as a short labelled block beside the widget and
  the input on its own row, and pays ~250 px for the whole composer. Land it in
  A's composer card (defect 3), where it buys back a quarter of the 390 px
  viewport. Runner-up idea, if a second is ever allowed: C's mid-stream skeleton
  lines under the step card, which say "the answer is being written" more plainly
  than A's three dots.
