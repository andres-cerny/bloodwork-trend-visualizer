# packages/lab-core — the deterministic layer

The LLM only ever transcribes. **Every number a reader sees is computed here**,
which is what makes a misread decimal catchable rather than plausible.

## The root export must stay DOM-free

`workers/agent` imports this for its tools, `bench/` and `tests/live/` import it
in plain node. `pdf/pdf.ts` is browser-only and reachable **only** as
`@bw/lab-core/pdf` — that subpath is what keeps `pdfjs-dist` and canvas out of
workerd. `pdf/rows.ts` is in the root export because it is pure coordinate
arithmetic.

## This code exists twice

`normalize.ts` mirrors `tools/pipeline/src/normalize.py`. Both read
`tools/pipeline/tests/parity_cases.json`, and CI runs both sides. A change to
one that is not mirrored fails there rather than drifting silently.

## Four rules with teeth

- **`review.ts` is the single authority on doubt.** Anything uncertain reaches
  the screen through it. A value withheld from one view and shown in another is
  the defect this prevents.
- **`derived.ts` refuses rather than approximates.** Friedewald above the
  triglyceride cutoff returns nothing; a definition whose inputs are missing is
  left out, not offered empty.
- **`chartSpec.ts` is the only door for a model-named chart.** It reads exactly
  four fields and drops everything else, including anything resembling a value.
- **A filtered value is not a normal one.** Excluding an implausible reading is
  not the same as saying the patient is fine.

## Ranges

Three kinds, and confusing them causes harm: a reference interval, a detection
limit, and a printed one-sided bound. `<1,0` against a `1,0–5,0` CRP renders as
"below range" today, and a low CRP is a good result — that is a known open
issue, not a bug to fix casually.

Full reasoning: [docs/constraints.md](../../docs/constraints.md).
