# packages/agent — core, tools, datasource

Three packages, one concern. Nested so this file loads whenever any of them is
touched.

## The apps never send a prompt

They send a **profile name**, resolved in `core/src/profiles.ts` against an
allowlist. This is a security boundary, not a style: a client that can send a
system prompt can delete every guardrail in one. An unknown name is **refused,
never defaulted** — quietly serving the clinical agent to a bad request is worse
than refusing it.

A profile fixes the prompt, the model, the tools and the auth policy. The policy
is data because the capabilities cost different things: extraction spends a
page, an agent turn spends a message.

## Tools are adapters, never new logic

Every tool in `tools/` wraps `@bw/lab-core`. The moment one computes something
itself there are two implementations of a clinical rule and the deterministic
one stops being the only one. If a tool needs a number lab-core does not expose,
**fix lab-core**.

**The model names a chart, never fills one.** `propose_chart` goes through
`parseChartSpec` and `validateChartSpec`; the server resolves the series from
the data source. Refusing is a correct outcome — an empty chart reads as a
finding.

## Everything reads through PatientDataSource

No tool may ask which implementation it holds. `SessionSource` ships;
`DatabaseSource` throws rather than returning nothing, because an empty source
would let the agent say "no cholesterol on file" when nothing was ever
connected.

## Streaming and cost

Usage accumulates across every tool round-trip and is emitted once, on `done`.
Pricing the terminal message alone under-reports a multi-round turn, and the
ledger is the only thing bounding spend. The loop is bounded at `MAX_ROUNDS`.

`core` compiles with `types: []` and a WebWorker lib: a `document.` reference
here cannot compile, which is what keeps it runnable in workerd and in node.
