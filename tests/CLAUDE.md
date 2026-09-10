# tests — five suites, three of which cost money

Unit tests live beside the code they test. This directory holds what needs a
browser, a corpus or an API key — plus `guards/`, for rules no package owns.

| Suite | Command | Cost |
|---|---|---|
| `guards/` | `npm test` | free, repo-wide |
| `e2e/` | `test:e2e`, `test:audit*`, `test:upload*`, `test:identity` | free, needs Chromium |
| `live/` | `test:live` | **real API**, ~$0.10 |
| `bench/` | `bench:*` | **real API**, sweeps |
| `evals/` | `eval` | **real API**, per case × reps |

A hook asks before the paid three. `BENCH_MAX_USD` and `EVAL_MAX_USD` stop a
runaway, but a ceiling only protects a run from itself. `guards/` is the opposite:
free, in `npm test`, catching what only `wrangler dev` would — `entry-exports.test.ts`
reads every `wrangler.jsonc` and imports the entry it names, because workerd
rejects a Worker that exports anything but its handler.

## e2e is the gate for any UI change

Neither suite compares screenshots. `visual.e2e.ts` measures **rendered geometry**,
because the two worst defects here passed every unit test: a highlight pointing at
the wrong row on a phone, and a chart plotting a value the app had itself flagged
as a misread. `audit.e2e.ts` sweeps every screen at five widths in both palettes
through one invariant set; for a refactor collect rather than fail
(`AUDIT_COLLECT=before.json npm run test:audit`, again after, and diff) — zero new
flaws is the bar.

`upload.e2e.ts` walks a PDF, a photograph and a page only one reader answered for.
The last is the point: only a browser shows that a failed second read turns every row
unconfirmed on screen, and the app shipped the opposite once. It stubs `/api/extract`
and Turnstile and builds its own bundle — the panel needs a site key. Its Moje krev
twin `upload-portal.e2e.ts` (`test:upload:portal`) watches the redaction review a
photo must pass: nothing found *because nothing could be looked at*, no send without
the reader's yes, and the camera button only a media query reveals.

`identity.e2e.ts` (`test:identity`) is the same argument for the patient guard: only
a browser shows that the wrong person's PDF actually stops before it joins a trend.

## bench and evals answer different questions

`bench/` asks how fast and how accurate extraction is — sweeps printing tables and
JSONL, with vitest only as a loader. `evals/` asks whether the agent still answers
correctly; its contract is [evals/CONTEXT.md](evals/CONTEXT.md). Results are
git-ignored: both derive from real lab PDFs.

## Configs live here too

`config/` holds the two vitest configs for the paid and browser suites, outside
`vitest.workspace.ts` and one directory down deliberately: vitest looks for a
workspace beside the config it was given, and a root one would void their `include`.
