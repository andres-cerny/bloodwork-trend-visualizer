# packages — the shared halves

Two have their own file: [lab-core](lab-core/CLAUDE.md) (the deterministic
layer) and [agent](agent/CLAUDE.md) (prompts, tools, data source). The four
below are small enough to state here.

**No package may be built.** They are raw TypeScript, via `exports` pointing at
`.ts`. An emit step reintroduces a build-order graph and a stale-`dist` failure
mode invisible until runtime.

## Barrels are a boundary, not a convenience

`api-client` imports the stream reader from `@bw/agent-core/events`, never the
barrel — via the barrel it pulled the tool loop and the SDK into the browser,
217 kB to 387 kB, with nothing failing. `check-bundle.mjs` refuses that now.

## gate

Session verification and the KV ledger, shared by both workers. **The only
package holding `@cloudflare/workers-types`**, and it must stay alone in
`types` — with `@types/node` it collides on `Request`, `Response` and `fetch`.

Pricing deliberately lives in `agent/core`, not here: bench and the live tests
price calls from plain node, and pricing beside the ledger is what dragged
`KVNamespace` into a node program in the first place.

## extraction

The model transcribes and never computes. Prompts are lifted from
`tools/pipeline/src` and must stay in step with it — if the Czech drifts, the
demo and the local tool stop extracting the same way.

## ui-kit

Owns the theme tokens and the two shared components. `Chart` is here because
both apps draw one and "the model may name a chart, never fill one" has to be
enforced once. `useTurnstile` is here because the widget used to live inside
the upload panel, where an app without an upload panel could never unlock chat.

## api-client

Transport only. It knows about sessions and streams, and nothing about a lab —
that is what lets the chat app use it without learning what an analyte is.
