# bloodwork — two apps over one clinical agent

**apps/bloodwork** reads Czech lab PDFs: upload, extract, verify, trend.
**apps/chat** is a clinical agent UI. Both talk to **workers/agent**; only
bloodwork talks to **workers/extract**.

Packages are raw TypeScript — no build step. Vite, wrangler's esbuild and
Vitest all compile `.ts` directly.

## Three rules that break something real

1. **Patient data never leaves the machine.** `data/`, `samples/*.pdf` and
   anything derived are git-ignored, and `.claude/hooks/privacy-guard.mjs`
   refuses to stage them. Not a preference — see docs/constraints.md.
2. **The parsing layer exists twice** and must stay in step: Python in
   `tools/pipeline/src/normalize.py`, TypeScript in `packages/lab-core`. Both
   read `tools/pipeline/tests/parity_cases.json`.
3. **The PDF generators are font-locked.** Never change
   `tools/pipeline/scripts/_fonts.py`; the demo data must regenerate
   byte-identically or CI's zero-diff check means nothing.

## Commands

```sh
npm test          # 361 unit tests, free      npm run typecheck
npm run build     # both apps                 npm run docs:check
npm run dev:extract + dev:agent + dev:bloodwork   # one terminal each
```

`test:live`, `bench:*` and `eval` call the real API and cost money.

## Where to go

| For | Read |
|---|---|
| UI rules, Czech copy | [apps/CLAUDE.md](apps/CLAUDE.md) |
| Prompts, tools, profiles | [packages/agent/CLAUDE.md](packages/agent/CLAUDE.md) |
| Parsing, flags, charts | [packages/lab-core/CLAUDE.md](packages/lab-core/CLAUDE.md) |
| Bindings, gate, deploy order | [workers/CLAUDE.md](workers/CLAUDE.md) |
| Demo data, fixtures | [tools/pipeline/CLAUDE.md](tools/pipeline/CLAUDE.md) |
| The invariants, in full | [docs/constraints.md](docs/constraints.md) |
