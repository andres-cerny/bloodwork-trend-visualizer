---
name: add-agent-tool
description: Add a tool the clinical agent can call, with its schema, profile registration and eval case. Use when asked to give the agent a new capability or to let it look something up.
---

# Add an agent tool

A tool is an **adapter over `@bw/lab-core`, never new logic.** The moment one
computes something itself there are two implementations of a clinical rule and
the deterministic one stops being the only one. If the number you need is not
exposed, **fix lab-core first** — that is the change, and the tool is the
wrapper.

## Five edits, all in `packages/agent`

1. **`tools/src/index.ts` — the schema.** Add to `TOOLS`. Describe it in Czech,
   the way the model will read it. `additionalProperties: false`, and require
   only what you genuinely need.
2. **`tools/src/index.ts` — the case.** Add to `runTool`'s switch. It must:
   - read through `PatientDataSource` and never ask which implementation it has;
   - return `{ ok, summary, content }` — `summary` is shown to the reader as
     "what the agent just did", so write it as a Czech phrase;
   - **return errors, not throw.** A failing tool should let the model say so
     and carry on. What it must never do is return an empty result that reads
     like an answer.
3. **`core/src/profiles.ts`** — add the name to the `clinical` profile's
   `tools`. A tool not listed there cannot be called, which is the point: the
   client cannot widen the set.
4. **A test** in `workers/agent/tests/routes.test.ts`, driving it through the
   route with the streaming stub.
5. **An eval case** in `evals/cases/`. Copy `evals/_templates/case.json` — do
   not edit the template. State in `why` what would be broken if the answer were
   wrong.

## If it returns a chart

It does not. `propose_chart` is the only tool that may, and it works by naming:
`parseChartSpec` reads four fields and drops everything else including anything
resembling a value, then `validateChartSpec` resolves the series from the data
source. **The model names a chart, the server fills it.** A new tool that
returned plotted values would route around that.

## Verify

`npm test`, then `npm run eval -- --case <your_case>`.
