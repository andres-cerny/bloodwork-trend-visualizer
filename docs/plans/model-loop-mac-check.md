# Confirming the cheap readers on the Mac — the steps for Ondřej

The model loop ([model-loop.md](model-loop.md)) found two cheaper ways to read
Moje krev pages. They were tested on 12 text pages and 11 photographed sheets.
Your Mac has the real corpora: 33 text pages and 133 photographed pages. These
steps check both changes there before any setting is flipped. Every step is one
line, run in a Terminal in the repo folder (`bloodwork-trend-visualizer`).

What it costs: about **$0.10** for the text check and **$0.25–1.50** for the
photos. The photo cost depends on what your earlier runs left on disk; step 3
prints the estimate before anything is spent.

## 0. Get the branch (free)

```sh
git fetch && git checkout claude/model-pipeline-loop && git pull && npm install
```

```sh
set -a; source .env; set +a
```

The second line loads your API keys into this Terminal window for the steps
below. It is the same `.env` the earlier benches used.

## 1. Text pages: Haiku 5.5 reading each page alone (~$0.07)

```sh
PORTAL_TEXT_CLASSES=real PORTAL_TEXT_CONFIGS=haiku55 PORTAL_TEXT_MAX_USD=0.3 npx vite-node --root . tests/bench/portal_text.ts
```

This reads every born-digital page of `samples/` once with Haiku 5.5. The
result then goes through the same checks Moje krev runs (`interpret.ts`).
It prints one line: truth rows, found, miss, rows asked about, **UNCAUGHT**,
unread.

**Go** if all three hold:
- UNCAUGHT is **0**;
- found is **at least 851 of 878**, the number today's two readers reached
  (docs/extraction-speed.md);
- every `miss` line is a qualitative or helper row ("málo materiálu",
  "přijato", height/weight), not a number.

Caveat: the truth there is your accepted reports. Nine of their rows were found
wrong in September, so a disagreement is something to look at on the page, not
automatically Haiku's error.

## 2. Photos, step one: what is already on disk (free)

```sh
BENCH_DRY_RUN=1 BENCH_CLASSES=photo BENCH_ARMS=sonnet5,gemini38_ultra,haiku55 npm run bench:adapt
```

Look at the `to call` column:
- `haiku55` will show 133. That is new, about $0.25.
- If `gemini38_ultra` or `sonnet5` also shows calls, their reads are no longer
  on disk. Gemini is about $1.20 for all 133 pages. **Leave `sonnet5` out of
  the next command if it shows calls** (it would be about $4.70): its numbers
  are already in lab-adaptability.md.

## 3. Photos, step two: the reads (~$0.25, or ~$1.45 with Gemini)

```sh
BENCH_MAX_USD=1.6 BENCH_CLASSES=photo BENCH_ARMS=gemini38_ultra,haiku55 npm run bench:adapt
```

Add `,sonnet5` to `BENCH_ARMS` only if step 2 showed its reads are on disk.

## 4. Photos, step three: score them the way the app does (free)

```sh
CLASSES=photo PAIRS=haiku55+gemini38_ultra,sonnet5+gemini38_ultra npx vite-node --root . tests/bench/reconcile_pairs.ts
```

This puts the stored reads through Moje krev's own cross-check (`reconcile` +
`reviewOf`). It prints, per pair: rows, ok, rows asked about, **UNCAUGHT**,
unmapped.

**Go** for Haiku 5.5 first + Gemini second if all three hold:
- UNCAUGHT is **0**;
- rows asked about are **no more than ~1.5× the Sonnet 5 + Gemini line** (or,
  without that line, a few dozen of ~3,600 rows);
- unmapped is within a handful of the Sonnet line.

## What to flip if it is a go

Settings on `moje-krev-extract`, in `workers/portal-extract/wrangler.jsonc`
`vars`, deployed the usual way:

| change | text path | photo path |
|---|---|---|
| step 1 go | `TEXT_READERS: "cheap"`, `MODEL_SECOND: "claude-haiku-5-5"` | — |
| step 4 go | — | `MODEL_PRIMARY: "claude-haiku-5-5"` |
| either way | `MODEL_MAP: "claude-haiku-5-5"` (mapping, same answers in the test) | |

`MODEL_PRIMARY` moves the first reader on **both** paths. With
`TEXT_READERS: "cheap"`, the text path uses the second slot only, so the two
changes do not collide.

To undo, delete the line and deploy again. The defaults are today's models.

Send the printed lines back. They go into the loop's log.
