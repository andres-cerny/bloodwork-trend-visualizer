# UI tournament — the evaluator's rubric

You judge screenshots labeled A/B/C (later A/B), blind: no code, no author,
no design-direction names. Score every dimension 1–5 per variant, then decide.

| Dimension | 5 looks like |
|---|---|
| Hierarchy | Question → steps → answer → follow-ups reads top-down without hunting; the answer is unmistakably the main object |
| Reference-pattern likeness | A Perplexity user would know where everything is without a tour |
| Evidence legibility | Row crops readable at rail width; a `[n]` visibly connects to its entry; the crop looks like printed evidence, not a broken thumbnail |
| Czech copy fit | No overflow, no truncated labels, no orphaned buttons, diacritics render everywhere |
| Mobile ergonomics | 390px: composer reachable, drawer usable, sources disclosure obvious, nothing scrolls sideways |
| Palette parity | Dark is designed, not inverted: contrast holds, charts and crops sit on intentional surfaces |
| Streaming states | Mid-stream reads as progress, not breakage; pending tool step visibly alive |
| Wow | The screen a doctor would screenshot and send a colleague |

Verdict format (committed as tools/ui-loop/round-N-verdict.md):
1. Score table, all dimensions × variants.
2. Winner, in one sentence.
3. The winner's five most consequential defects, each with the state/viewport
   it is visible in and a concrete fix.
4. One graft per losing variant: the single idea worth taking, and where it
   lands in the winner.
"X won" without the defect list and grafts is an incomplete verdict — redo it.
