# Handoff — finishing the web demo locally

Give this file to Claude in a local session. It has everything needed to test
extraction against real PDFs, improve it, and deploy.

## What this is

A Cloudflare-hosted demo of the bloodwork visualizer, built on the branch
`claude/web-app-demo-hosting-ymbgkc`. `main` is untouched. It is a React SPA
plus one Worker: the site opens on a pre-baked synthetic dataset, and visitors
can upload their own PDF behind a Cloudflare Turnstile check.

Design doc: `docs/web-demo-plan.md`. Deploy steps: `docs/deploy.md`.

## State

Built and tested — **88 tests pass** (`npm test`):

| Area | File | Covers |
|---|---|---|
| Deterministic parsing | `web/tests/normalize.test.ts` | 25 parity tests mirroring `tests/test_normalize.py` case for case |
| Row reconstruction | `web/tests/rows.test.ts`, `layouts.test.ts` | Real `buildRows` against real PDFs through real pdf.js, across 8 awkward layouts |
| Two-model union | `web/tests/reconcile.test.ts` | Disagreement and the silent under-extraction case |
| Mapping evidence | `web/tests/mapping.test.ts` | Occurrence provenance, observed stats, unit/value plausibility |
| Czech summary | `web/tests/summary.test.ts` | Arithmetic *and* wording, incl. absence of diagnostic language |
| Chart axis | `web/tests/chart.test.ts` | Round tick values |
| Worker routes | `worker/tests/routes.test.ts` | Session gate, path selection, and the budget freeze |
| Session tokens | `worker/tests/auth.test.ts` | Forgery, wrong secret, expiry |
| Spend ledger | `worker/tests/budget.test.ts` | Shard accumulation, freeze boundary, pricing |

Also built: the SPA with all four tabs, chat, Turnstile-gated upload,
text-layer extraction for digital PDFs with a vision fallback for scans, and a
mapping review showing where each unmapped value came from and what data
already sits under each candidate.

**Not done, because this environment could not do it:**

1. **No real Claude calls have ever been made.** There was no
   `ANTHROPIC_API_KEY` in the build environment. Every test so far exercises
   the deterministic layer only. *The end-to-end extraction path is unproven.*
2. **Never deployed.** `wrangler` was not authenticated.
3. **Never tested against a real lab PDF.** Network egress was policy-blocked,
   so no real Czech lab documents could be downloaded. All fixtures are
   synthetic.

Items 1 and 3 are the real risk. Everything below is about closing them.

## First: get it running

```sh
npm install
npm test                 # 53 tests, should all pass
npm run dev              # SPA on the pre-baked data, no API needed
```

Then follow `docs/deploy.md` for KV, Turnstile and secrets. For local
full-stack work you need a git-ignored `.dev.vars`:

```
ANTHROPIC_API_KEY=sk-ant-...
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
SESSION_SECRET=<openssl rand -base64 32>
```

Those Turnstile values are Cloudflare's official always-pass test keys. Put the
matching test site key in `.env`:

```
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

Then `npx wrangler dev` serves the whole thing including the API routes.

## The main job: test extraction on real PDFs

Budget: **$10 maximum, ideally under $5.** Rough costs per page with both
models running:

| Path | ~cost/page | Notes |
|---|---|---|
| Text layer (digital PDF) | ~$0.08 | The common case. |
| Vision (scan) | ~$0.10 | Only when there is no text layer. |

So $5 is roughly 60 pages of cross-checked extraction — plenty. Set
`SINGLE_MODEL: "1"` in `wrangler.jsonc` while iterating to halve that; turn it
back to `"0"` before deploying, because the two-model disagreement flagging is
the most persuasive part of the verification tab.

The `BUDGET_USD_LIMIT` in `wrangler.jsonc` is a genuine hard stop — the Worker
refuses once the ledger reaches it. Set it to `10` while testing so an
accident cannot overrun. Check spend at any time:

```sh
curl http://localhost:8787/api/status
```

### The loop

1. `npx wrangler dev`, open the site, upload a real lab PDF.
2. Watch the verification tab. Every row that came out wrong is a bug with a
   reproducible cause — find which stage lost it.
3. Add a fixture that reproduces it (below), fix, re-run `npm test`.
4. Repeat with a different lab's layout.

### Where things go wrong, in order of likelihood

**Row reconstruction** (`web/src/pdf/rows.ts`) is the newest and least proven
code. `buildRows` clusters pdf.js text items into printed rows by vertical
centre. Two known-fragile spots:

- **Clustering tolerance.** `tol` is 60% of the median glyph height. A layout
  with tight line spacing merges two printed rows into one; a layout with cells
  on visibly different baselines splits one row into two. This is the first
  knob to try.
- **Side-by-side tables.** `splitSideBySideTables` undoes the merge when a page
  prints two tables next to each other. It is deliberately conservative: it
  only splits when the two halves *mirror* each other's column offsets, because
  a wrongly split row corrupts good data while a merged row merely reproduces
  the old behaviour. **A real two-column report whose halves are not mirrored
  will still merge.** If you hit one, that is the function to extend — and note
  that gap width alone cannot solve it (measured: a legitimate row had gaps
  [154, 60, 59] while a genuine table boundary was only 52).

**Column assignment** is Claude's job, in `SYSTEM_EXTRACT_TEXT` in
`worker/claude.ts`. If rows are reconstructed correctly but values land in the
wrong field, fix the prompt, not the clustering.

**Provenance rejections.** `isPrintedOnPage` flags any value not literally on
the page. If real PDFs produce false rejections, the cause is usually pdf.js
splitting a cell across items in a way the whitespace-normalized comparison
misses — widen the comparison there rather than weakening the check. The check
is the strongest accuracy guarantee in the project; do not remove it.

### Adding a fixture

`scripts/make_layout_fixtures.py` generates awkward layouts as PDFs into
`web/tests/fixtures/`, and `web/tests/layouts.test.ts` runs the real
`buildRows` against them through real pdf.js. When a real PDF breaks something,
add a fixture function modelling that layout and a test asserting the rows come
out right. Do not commit the real PDF.

```sh
python3 -m scripts.make_layout_fixtures
npx vitest run tests/layouts.test.ts
```

## Privacy — the one hard rule

`data/`, `samples/*.pdf` and `web/public/demo/real/` are git-ignored because
they hold real medical data. Keep it that way.

The shipped demo dataset is synthetic (`scripts/make_demo_data.py`) and safe to
publish. To ship real reports instead:

```sh
python3 -m scripts.export_web_data --name "Jan Ukázka" --id "800101/0011" --shift-days -37
```

That replaces the patient identity in the JSON **and redacts the printed name
and rodné číslo from the page images before rendering them** — the images are
photographs of the original reports, and the verification tab is exactly where
someone studies them closely. It aborts rather than writing if an identifier
survives.

Its automated check reads the PDF text layer. It cannot catch an identifier
that exists only as pixels in a scanned page, so **look at
`web/public/demo/pages/` before deploying.**

## Deploying

```sh
npm run deploy
```

Before you do: `SINGLE_MODEL` back to `"0"`, `BUDGET_USD_LIMIT` set to whatever
ceiling you actually want (default 20), and the demo pages checked by eye.

After deploying, confirm on a real phone — the verification tab's side-by-side
layout is the part most likely to disappoint on a small screen, and it is the
tab that carries the pitch.
