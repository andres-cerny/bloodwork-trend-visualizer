# R1 — critique pass 3 (final)

Shots judged: all 34 in scratchpad/shots/R1-3, mobile read as if at 1x.

## Verdict on each pass-2 defect

1. **Document cards were 6–9 lines of letterhead — GONE.** Every document card
   now carries a 1–2 line excerpt with ellipses on both sides and no header
   block: card 5 „…Diagnóza: stav po plastice předního zkříženého vazu…", card 7
   „…RA: bez kardiovaskulární zátěže…". Cards 3, 4 and 8 show a tail-ish line
   („Provedené vyšetření / Technika:…", „Datum výkonu / Operatér:…", „Věk: 31 let
   / Pohlaví:…") — that is the known payload limit, not a layout defect. On
   mobile a document card is now ~230px instead of a full screen.
2. **Light streaming skeleton invisible — GONE.** Sampled: bar rgb(224,222,214)
   on page rgb(242,241,237) in `midstream-desktop-light` / `-mobile-light`,
   against rgb(38,38,37) on rgb(13,13,12) in dark. Same order of delta, the
   shapes read as bars in both palettes; „Agent pracuje…" plus the filled blue
   pending dot still carry the progress.
3. **Summary-thread odběr cards carry no values — UNFIXED, and out of reach.**
   Cards 1–6 in `answer-desktop-*` / `cite-focus-*` / `sources-open-mobile-*`
   still read only „Odběr · 24. 2. 2026 / Laboratoř Zelený Ostrov". This is the
   declared server-side limit (no per-parameter data on the event), so it is not
   re-charged here. Mitigation landed: clicking `[6]` now rings card 6 with a
   blue border *and* fills all four `[6]` markers in the answer, so the link is
   unambiguous even without a number, in both palettes.
4. **Mobile chart type 5–7px — GONE.** `chart-mobile-light` / `-dark` drop the
   inline mez labels to bare „175" / „135" at the right edge (~11px at 1x), axis
   ticks 140–170 at ~13px, month ticks at ~13px; the caption „Referenční rozmezí
   135–175 g/l" still names the range. No size mismatch inside the card.

## Remaining consequential defects

CLEAN

Below the bar, recorded only so the next reader does not re-find it: in
`sources-open-mobile-light` and `-dark`, the „+" expander on card 4 („Operační
protokol") renders in accent blue — sampled rgb(231,239,249) light / (26,36,47)
dark at that glyph — while cards 1, 2, 3 and 5 render it neutral; the same cards
on desktop are all neutral. A stray accent glyph on one card in one state, no
clinical consequence; fix only if a fix round happens for another reason.
