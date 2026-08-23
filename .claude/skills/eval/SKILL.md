---
name: eval
description: Run the agent's regression cases, read the result, and decide whether a prompt change was an improvement. Use when asked to evaluate the agent, check for regressions after a prompt change, or promote a baseline.
---

# Eval

**This spends real money.** Every case is a real agent turn with real tool
calls. Confirm before running; `EVAL_MAX_USD` (default 5) stops a runaway.

Read [evals/CONTEXT.md](../../../tests/evals/CONTEXT.md) for the contract.

## Run

```sh
npm run eval                      # every case, 2 reps
npm run eval -- --case tools_changes --reps 5
```

Needs `ANTHROPIC_API_KEY` and the demo data present.

## Read the result

**FLAKY is not a pass.** A case that passes some reps and fails others means the
behaviour is not reliable — that is the whole reason reps exist. `tools_changes`
was ported precisely because it did this: one rep called `summarize_changes`,
the other answered the same question from context.

Three failures worth naming rather than re-running:

- **Ungrounded numbers** (`grounded_panel`) — the model stated a decimal the
  data does not contain. This is the failure the entire deterministic layer
  exists to prevent. Never dismiss it as flakiness.
- **A tool not called** — the agent answered from whatever was in the prompt.
  Looks identical to answering correctly until the data lives in a database.
- **No chart event** (`chart_named_not_filled`) — `propose_chart` refused, or
  the model tried to draw one itself. Check which; a refusal may be correct.

## Promote

```sh
npm run eval -- --promote
```

Only after reading the FLAKY and FAIL rows and deciding the change was an
improvement. A baseline that updates itself cannot detect a regression, so this
is deliberately a separate, human decision. Never promote to make a run green.
