# bloodwork — two apps over one clinical agent

**apps/bloodwork** reads Czech lab PDFs: upload, extract, verify, trend.
**apps/chat** is a clinical agent UI. Both talk to **workers/agent**; only
bloodwork talks to **workers/extract**.

```
apps/ packages/ workers/   the product
tests/  tools/  docs/      verification · pipeline & scripts · the arguments
data/ samples/             git-ignored patient data
```

Packages are raw TypeScript. Vite, wrangler's esbuild and Vitest compile `.ts`
directly, so there is no build step and no `dist` to go stale.

## Three rules that break something real

1. **Patient data never leaves the machine.** `data/` and `samples/*.pdf` are
   git-ignored, and `.claude/hooks/privacy-guard.mjs` refuses to stage them.
2. **The parsing layer exists twice** and must stay in step: Python in
   `tools/pipeline/src/normalize.py`, TypeScript in `packages/lab-core`, both
   reading `tools/pipeline/tests/parity_cases.json`.
3. **The PDF generators are font-locked.** Never touch
   `tools/pipeline/scripts/_fonts.py` — the demo data must regenerate
   byte-identically or CI's zero-diff check means nothing.

## Commands

```sh
npm test  ·  npm run typecheck  ·  npm run docs:check  ·  npm run build
npm run dev:extract + dev:agent + dev:bloodwork    # one terminal each
```

`npm install` points git at `.githooks/`; pre-push runs `docs:check`.

| For | Read |
|---|---|
| UI rules, Czech copy | [apps](apps/CLAUDE.md) |
| Prompts, tools, profiles | [packages/agent](packages/agent/CLAUDE.md) |
| Parsing, flags, charts | [packages/lab-core](packages/lab-core/CLAUDE.md) |
| Bindings, gate, deploy | [workers](workers/CLAUDE.md) |
| Which suites cost money | [tests](tests/CLAUDE.md) |
| Demo data, fixtures | [tools/pipeline](tools/pipeline/CLAUDE.md) |
| The invariants, in full | [docs/constraints.md](docs/constraints.md) |
| The chat demo, planned | [docs/plans/chat-demo.md](docs/plans/chat-demo.md) |
| The chat UI second pass | [docs/plans/chat-ui.md](docs/plans/chat-ui.md) |
