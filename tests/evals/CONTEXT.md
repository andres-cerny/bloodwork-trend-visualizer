# evals — does the agent still answer correctly?

One job: run a fixed set of questions against the agent and say which answers
regressed.

This directory is the one place in the repo organised as an ICM workspace —
numbered stages, a template folder, per-run output — because it is the one thing
here that genuinely is a sequential, human-reviewed, repeatable pipeline. The
rest of the repo has its structure dictated by npm workspaces, Vite roots and
wrangler configs, and renumbering those would break the build.

## Inputs

- Working: `cases/*.json` — one question per file, with what must be true of
  the answer.
- Reference: `apps/bloodwork/public/demo/reports.json` — the synthetic ten-draw
  patient. Committed, deterministic, and asserted by CI to regenerate
  byte-identically, which is what makes a score change mean the model or the
  prompt changed rather than the data.
- Reference: `_templates/case.json` — copied, never edited in place.

## Process

1. `npm run eval` runs every case N times against the agent.
2. Each rep records: tools called, whether the assertions held, cost.
3. A case that passes some reps and fails others is reported FLAKY, not passed.
   The historical run this was ported from had exactly one — `tools_changes`,
   where the model answered a "what got worse" question from context without
   calling `summarize_changes`. A single-rep harness would have called that a
   pass half the time.
4. Results are written to `output/<label>.json` and diffed against
   `output/baseline.json`.

## Outputs

- `output/<label>.json` — one run.
- Printed table: case, verdict, tools, cost, and the delta against the baseline.

## Human check

Read the FLAKY and FAIL rows and decide whether the prompt changed for the
better. Promote a run to the baseline deliberately — `npm run eval -- --promote`
— never automatically. A baseline that updates itself cannot detect a
regression.

## Cost

This spends real money against the Claude API. `EVAL_MAX_USD` (default 5) stops
the run; the spend guard hook asks before it starts.
