# Plan: the Ověření highlight on photos — which locator to trust

Drafted 2026-09-26 (session with Ondřej). A research plan: measure, then
choose. It feeds Phase E of [photo-capture](photo-capture.md).

## The problem

On a digital PDF the verify screen frames the row a value came from. The box
comes from pdf.js text coordinates, and the reader only names the row
(`row_index` → `rowBoxAt`, `apps/portal/src/lib/interpret.ts:132`). A photo
has no text layer, so `bbox` is `null` and the person checks the value
against the whole page by eye. The readers already return, per row, a
`source_snippet`: the printed row as they read it
(`packages/extraction/src/extract.ts:203`). What is missing is *where*.

## The rule that decides every arm

**A wrong highlight is worse than none.** The person trusts the frame, and a
frame on the neighbour row makes a misread look confirmed. So the score has
two columns, never averaged: **wrong** (must be 0, or so close that the
remaining cases are explained) and **coverage** (rows that get a box). An arm
that covers 60 % with 0 wrong beats one that covers 95 % with 2 wrong.

## Ground truth, exact and free

`tools/pipeline/scripts/simulate_photos.py` makes every photo in
`data/photos-sim/` from a known page render and known transforms (the
`angle` condition calls `Image.PERSPECTIVE` with explicit coefficients). So:

1. Extend the simulator (not `_fonts.py`) to write, per photo, the transform
   it applied, into `manifest.json` or a sidecar.
2. Take each row's box from the source PDF's text layer (`buildRows` over
   pdf.js words, the path the PDF upload uses), map it through the
   transform, and that is the row's true quadrilateral on the photo.
3. The row a value belongs to is known from the accepted report
   (`loadBaseline()`, key `${src}#${page}`), matched to its printed row.

A predicted box is **right** when its centre lies inside the true row's
quadrilateral and it overlaps no other row's quadrilateral by more than half
its own height. Otherwise it is **wrong**. No box is **uncovered**. The
scorer is a pure function with unit tests, including a box one row off,
which must count as wrong.

### Corrections after building it (2026-09-26)

- **The simulator is not extended.** `tests/bench/highlight/replay_transforms.py`
  runs its `main()` into a temp folder with the geometric calls wrapped. It
  checks that all 133 photos come out byte-identical, then writes one
  homography per page (PDF points to photo pixels).
- **Truth boxes use the glyphs, not the pdf.js box.** pdf.js gives
  `[baseline − size, baseline]`, about a quarter line above the ink. Truth
  boxes use the font's ascent and descent instead. Each is widened to a
  horizontal band out to the text margins, or to a neighbouring table on the
  same line. Rotated margin labels (a vertical "ANÉMIE") are left out, because
  `buildRows` merged them into one row and that row swallowed its neighbour.
  A mapping check on ink passes on every angle and twopage view, and fails
  when a transform is shifted by 4 pt.
- **A strict rule is reported beside the plan rule.** The plan rule passes a
  tall box that frames three or four slanted rows, as long as no single
  neighbour covers half of it. The strict rule also requires the true row to
  hold at least ⅔ of the printed-row area inside the box. Both wrong counts
  go in every table. The strict one decides.
- **32 angle shots, not 21.** The 21 in photo-capture came from the
  identity-item count. Only angle and twopage have a flattened view that
  differs (34 page images). The other 100 photos are identical flattened, so
  they are a control set, not a second condition, and are not paid for twice.
- **Flattening is a precondition.** Unflattened angle shots give wrong boxes
  in every arm, T and M included. So photo-capture Phase C comes before
  Phase E, not beside it.
- **The half-line layout.** One lab prints the analyte name half a line above
  its value, so every box on that layout straddles two printed lines. Any arm
  shipped needs a case from it in its tests.

The simulator's photos are rendered, not taken. Before any arm is chosen,
repeat the winner on real phone shots (photo-capture Phase A3), scored by
eye on a sample. Those are printed demo pages, not patient reports.

## The arms

Each arm is run on the original photo and on a flattened one. Flattening
comes from photo-capture Phase C. If it is not built yet, use the inverse of
the simulator's known transform as an oracle flattening and label it so.

| Arm | How it locates a row | Cost |
|---|---|---|
| **T — OCR** | Tesseract.js (`ces`) → phrase-merging adapter → rows. The reader's value and name are matched to one OCR row; box only when both sit on it | free |
| **G — Gemini coordinates** | Gemini returns a box per row (its native `[ymin, xmin, ymax, xmax]` on 0–1000) as a separate locate call, not a change to the deployed reading call | paid |
| ~~**C — Claude coordinates**~~ | **Dropped 2026-09-26.** Tier 1 on 20 photos: 304 of 648 boxes wrong even after flattening, including clean flat shots. The subagents estimated each row from the row pitch, and the estimate drifts by a row or more down a page. No change to the prompt fixes a missing capability | — |
| **M — numbered rows** | OCR row boxes are drawn on the image with a small number each ("set of marks"); a reader is asked which number each of its rows sits on. That turns the photo into the PDF path's `row_index` problem | subagent arm free; Gemini variant paid |
| **V — two locators agree** | A box only when two independent arms (e.g. T and G, or M and T) point at the same row | sum of both |

V is expected to win on the "wrong" column: two methods with different
failure modes rarely point at the same wrong row. It is the same argument as
two readers from two vendors.

## Rules carried over from lab-adaptability

- **Claude arms run through subagents, not the API**, with the deployed
  prompt and tool schema imported, never paraphrased. The API is used once,
  for the final gate.
- **Paid runs need approval.** Gemini and any API gate run are proposed to
  Ondřej with page count and USD estimate first. `BENCH_MAX_USD` stays the
  hard stop.
- **The deployed reading call is not touched in this plan.** Locating is a
  separate pass. Folding it into the reading call is a later decision, taken
  only if the chosen arm needs the reader's own output.
- **Results.** `tests/bench/results/` is git-ignored because it is derived
  from real PDFs. Hand-copy the summary table into
  [`docs/lab-adaptability.md`](../lab-adaptability.md) under a new heading.

## Order

1. The ground truth plus the scorer, with a unit test for the one-row-off case.
2. Arm T on all 133 photos, original and flattened.
3. Arms C and M-with-Claude through subagents, on a spread of about 20
   photos over all conditions, then on all 133 if promising.
4. A cost proposal for G and M-with-Gemini on all 133 photos. Stop there
   until Ondřej approves.
5. Arm V from whatever pairs exist.
6. The table: arm × condition × {wrong, coverage}, time and USD per page.
   Recommend one arm, and name the case each rejected arm lost on.

Prior art worth reading first: the chat demo's citation boxes
(`packages/agent/tools/src/citations.ts`) and why its evidence rail stayed
empty.
