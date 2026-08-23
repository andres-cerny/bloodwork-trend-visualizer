# evals — the agent's regression suite

**This spends real money.** Every case is a real agent turn with real tool calls;
`EVAL_MAX_USD` (default 5) stops a run, and a hook asks before one starts.

Read [CONTEXT.md](CONTEXT.md) first — it states the inputs, the process and the
human check.

## Reps are not optional

A case that passes some reps and fails others is **FLAKY, not passed**. This is
not caution: `tools_changes` was ported from a run where one rep called
`summarize_changes` and the other answered the same question from context. One
rep calls that green half the time.

## The baseline is promoted by hand

`npm run eval -- --promote`, deliberately, after reading the FLAKY and FAIL rows.
A baseline that updated itself could not detect a regression.

## The corpus is synthetic on purpose

Cases run against `apps/bloodwork/public/demo/reports.json` — committed,
deterministic, and asserted by CI to regenerate byte-identically. So a score
change means the model or the prompt changed, not the data. No real patient
values are involved, which is what makes these runnable by anyone.

## This directory is the one ICM workspace here

Numbered stages, `_templates/` copied never edited, per-run `output/`. It earns
that shape by genuinely being a sequential, human-reviewed, repeatable pipeline.
The rest of the repo takes its structure from npm workspaces and wrangler
configs, and renumbering those would break the build.
