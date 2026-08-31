# tests — four suites, two of which cost money

Unit tests live beside the code they test, in each package. This directory is
everything that needs a browser, a corpus, or an API key.

| Suite | Command | Cost |
|---|---|---|
| `e2e/` | `test:e2e`, `test:audit`, `test:audit:portal` | free, needs Chromium |
| `live/` | `test:live` | **real API**, ~$0.10 |
| `bench/` | `bench:*` | **real API**, sweeps |
| `evals/` | `eval` | **real API**, per case × reps |

A hook asks before the paid three. `BENCH_MAX_USD` and `EVAL_MAX_USD` stop a
runaway, but a ceiling only protects a run from itself.

## e2e is the gate for any UI change

Neither suite compares screenshots. `visual.e2e.ts` measures **rendered
geometry** — it exists because the two worst defects in this project passed
every unit test: a source highlight that pointed at the wrong row on a phone,
and a chart that plotted a value the app had itself flagged as a misread.
`audit.e2e.ts` sweeps every screen at five widths in both palettes through one
shared invariant set.

For a refactor, collect rather than fail:
`AUDIT_COLLECT=before.json npm run test:audit`, again after, and diff. Zero new
flaws is the bar.

## bench and evals answer different questions

`bench/` asks how fast and how accurate extraction is — sweeps that print tables
and write JSONL, with vitest used only as a loader. `evals/` asks whether the
agent still answers correctly, and has its own contract in
[evals/CONTEXT.md](evals/CONTEXT.md).

Results are git-ignored: both derive from real lab PDFs.

## Configs live here too

`config/` holds the two vitest configs for the paid and browser suites. They sit
outside `vitest.workspace.ts` deliberately — and one directory down, because
vitest looks for a workspace file beside the config it was given, and a root
workspace would silently void their `include`.
