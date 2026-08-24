# Portal rubric — what the evaluator scores

Each criterion 0–3 (0 broken · 1 weak · 2 solid · 3 exemplary), per state
where applicable, judged from the labeled screenshots alone. The critique
must name concrete defects — „B won" without reasons re-runs the round.

1. **First-screen answer.** Does the home state answer „jak na tom jsem?"
   within one 390px viewport — newest visit, its verdict, what changed —
   without scrolling past chrome to find out?
2. **Calm, not clinical.** A patient with one flagged value must see
   proportion: the flag visible and honest, the page not a wall of alarm.
   Reassurance where the data is normal („vše v normě" states earn their
   place). No panic red fields; signal colours mean what the kit says.
3. **Trend legibility at phone width.** Sparklines readable as direction at
   a glance; the full chart's reference band, axis labels and Czech number
   formatting legible at 390px without horizontal scroll.
4. **The delta view.** „Od minulé návštěvy" readable in one pass: direction,
   magnitude, and which visit it compares against. Arrows that need a legend
   score 1.
5. **Timeline scannability.** Seven years legible in one column: kind badges
   distinguishable without reading, gaps honest, per-visit summaries scan as
   a story.
6. **The note as a document.** The doctor's text reads as a letter from a
   doctor, not as app chrome — typographic care, the „Uvolněno" line, page
   images accessible but not shouting.
7. **Czech copy fit.** No overflow, no orphaned labels, vykání frames +
   nominative labels as the spec fixes; dates and decimals Czech-formatted.
8. **Palette parity.** Both palettes complete — no light artifact in dark,
   contrast held (ink tokens for type, signal for drawing), the CSM tenant
   accent present but not repainting clinical semantics.
9. **Mobile ergonomics.** Touch targets, sticky things that earn their
   stickiness, the fake „Objednat se" reachable, PWA chrome (icon, theme
   colour) coherent when added to a home screen.
10. **Wow, honestly earned.** The screen a clinic director would photograph:
    does any state produce it, without sacrificing 1–9?

Disqualifiers (score sheet notes them, evaluator stops): a MUST from
portal-spec.md ignored; a colour defined outside ui-kit tokens; interpretation
text that is not deterministic counts; the real record in a fixture.
