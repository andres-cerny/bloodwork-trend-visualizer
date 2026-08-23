# Making upload fast enough to demo

Plain-language account of what was measured, what worked, what didn't, and why.
The numbers and graphs live in [`notebooks/bench.ipynb`](../tools/notebooks/bench.ipynb);
the harness that produced them is in [`bench/`](../tests/bench/), and every figure in
this document is read from `tests/bench/results/*.jsonl` rather than typed by hand.

## The question

A doctor drops **ten lab PDFs** into the demo and watches. That is ~21-24 pages.
As deployed, pages were read **one at a time**, two models on each. A spinner
that long is not a performance detail — it is the thing that makes a clinician
stop believing the output before they have looked at it.

Target: the batch finishes in under a minute, with no loss of accuracy.

## The headline

| | before | now |
|---|---|---|
| ten files, live in a browser | ~14 minutes (est.) | **182 s measured, then rebuilt — see below** |
| first rows on screen | after everything | **~6 s** |
| cost for the batch | ~$1.70 | **$1.82 measured** (both readers kept) |

### The benchmark measured a shape the app did not have

Worth stating plainly because it is the biggest methodological error in this
work. The pooled batch benchmark put all 21 pages into **one** queue at
concurrency 8 and measured 43.6 s. The app did not do that: `runQueue` took
**one file at a time**, and the page bound of 8 applied *within* a file. Real
reports are two or three pages, so the bound was never more than three deep and
a ten-file upload measured **182 s** live — four times the prediction.

Nothing was wrong with the arms, the fit, or the accuracy work. The instrument
simply did not have the same shape as the thing, which is the same class of
mistake as the duplicate-analyte scorer bug earlier in this document, and it is
why every number in the table above now comes from a browser rather than from a
harness.

### How far concurrency actually goes

Measured on the real corpus, both readers, no failed calls at any point:

| files | pages | concurrency | calls in flight | batch |
|---|---|---|---|---|
| 10 | 21 | 4 | 8 | 85.4 s |
| 10 | 21 | 8 | 16 | 43.6 s |
| 10 | 21 | 16 | 32 | **28.9 s** |
| 10 | 21 | 32 | 64 | 24.4 s |
| **30** | **66** | **72** | **144** | **27.8 s** |

There is no rate-limit wall anywhere near here — per-page latency stayed at
~18 s p50 throughout, and 144 simultaneous calls produced not one 429. So the
binding constraint is not throughput at all: **once every page is in flight the
batch simply *is* the slowest page**, whether that is ten files or thirty.
Thirty files cost $3.32, which makes spend, not speed, the thing that limits
how big a drop the demo should accept.

Shipped as 64 in-flight requests across up to 24 open files, with
`MAX_PAGES_PER_SESSION` at 100 so a thirty-file drop is not cut off at file
seventeen. The reason the request bound is not higher is memory rather than
throughput: each in-flight page holds a rendered canvas, and that has only been
verified on a desktop browser.

**The fix moved the bound rather than raising it.** `web/src/lib/inflight.ts`
holds one counting semaphore for the whole upload panel; several files are open
at once (`fileConcurrency`), and every page request — whichever file it belongs
to — queues on that single limit. Ten one-page files and one ten-page file now
saturate the same ceiling. Only the request holds a slot, so a waiting file
renders its next page while it waits rather than after.

Two changes get essentially all of it, and neither is a model swap.

Measured end to end on the ten real sample PDFs, both readers, no failed calls:

| readers | concurrency | batch | first page | page p50 | cost |
|---|---|---|---|---|---|
| Haiku 4.5 only | 4 | 70.0 s | 6.4 s | 10.8 s | $0.285 |
| Sonnet 5 + Haiku 4.5 | 4 | 85.4 s | 6.3 s | 16.6 s | $1.071 |
| **Sonnet 5 + Haiku 4.5** | **8** | **43.6 s** | **6.5 s** | 16.6 s | $1.065 |

Doubling concurrency nearly halved the batch and left per-page latency
untouched, with zero failures — so **rate limiting is not the ceiling at 8**,
and the cross-check can be kept rather than traded away for speed.

## What was actually wrong

### 1. Pages were read serially

`UploadPanel` looped `for (let p = 1; p <= pageCount; p++) { await extract(...) }`.
Every page waited for the one before it, so a report cost the *sum* of its
pages. The local Python pipeline had always processed pages in parallel; the web
demo — the one anyone actually sees — did not.

Pages are independent. They are now read **eight at a time**, reassembled in
page order, with fatal errors still stopping the queue while in-flight pages
land. Eight is measured, not guessed — see the table above.

### 2. The model was made to re-type the page

This was the surprise. The tool schema required `source_snippet` — *the whole
printed row, echoed back* — for every measurement. A 45-row page therefore
re-emitted 45 full rows. Its only consumer is one line of display in the
verification tab.

That matters because of the single most useful thing the benchmark established:

> **Latency is output tokens divided by a per-model rate, plus a fixed
> overhead, and almost nothing else.** Fitted over 46 controlled calls:
> Sonnet 5 **171 tok/s** (r² = 0.993), Opus 4.8 **126 tok/s** (r² = 0.999),
> Haiku 4.5 **331 tok/s**.

An r² of 0.99 means there is no second factor worth chasing. Anything that
reduces what the model *writes* reduces the wait proportionally; anything else
is noise. Replacing `source_snippet` with a `row_index` integer cut Sonnet's
output from 4,806 to 3,030 tokens and its page latency from **30.2 s to 19.8 s**.

## What did not work

Being specific about this matters more than the wins, because three of these
were the plan's leading hypotheses.

**`effort: "low"` — worth about 2%.** Column assignment over pre-reconstructed
rows is a mechanical copy, so there was reason to think high effort was wasted.
It is wasted, but it was never costing much: 30.2 s → 29.9 s on Sonnet.

**Turning thinking off — worth nothing at all.** The claim that Sonnet 5 was
"silently thinking" on every page was **wrong**. Every response in the grid came
back with no thinking block, deployed configuration included: a forced
`tool_choice` already suppresses it. This was settled by recording whether a
thinking block actually appeared, rather than by reading documentation.

**Model choice — much smaller than it looks.** Haiku is genuinely faster per
token (331 vs 171 tok/s) but carries ~6 s of fixed overhead, so on a dense page
it finishes within a second of Sonnet. It is a *cost* lever far more than a
speed one.

**A9, the column map — fast, incomplete.** The model returns four integers and a
list of row numbers; the client rebuilds every value from its own `rows` array.
Output collapsed from 3,030 tokens to **1,267** (Sonnet) and **973** (Haiku),
and because no text comes back a fabricated value is *unrepresentable* rather
than merely detectable — a stronger guarantee than the current
`isPrintedOnPage` check. But it **lost rows**: 33-40 of 154 missing against 1-12
for the row-based readers, and its reference-range column was wrong almost
everywhere. Real lab rows are ragged — a row missing its unit shifts every later
cell — so 44% of rows needed per-row overrides. Not shippable as it stands, and
genuinely interesting if the raggedness is solved.

**A10, x-position columns with no model at all — the negative result that
matters most.** Since cell indices are unstable but cell *x-coordinates* are
not, columns should be recoverable geometrically. It runs in **0.17 ms/page for
$0.00** and recovers only **61%** of baseline rows. A targeted fix for its worst
failure made it *worse* (61% → 56%), which is the more informative outcome: the
approach is brittle rather than one bug away.

That is the closest thing here to a test of the "just use a layout parser"
family of tools, and on this corpus it says the model is earning its keep on
column assignment.

**A6, escalate only on flagged pages — worse on every axis.** The intuition was
a better median: one round-trip on clean pages, two on dirty ones. Measured, it
is the opposite, because escalation makes the second read *serial*. A flagged
page costs Sonnet **plus** Opus end to end instead of `max(Sonnet, Opus)`, and
enough pages flag that most pay it:

| | A5 (both, concurrent) | A6 (escalate on flag) |
|---|---|---|
| batch | **43.6 s** | 89.7 s |
| page p95 | **20.9 s** | 46.2 s |
| cost | **$1.065** | $1.731 |

Conditional work saves *calls*. It does not save *time* once there is spare
concurrency — and it did not even save money here.

**A7, Docling — the layout-parser family, properly tested.** Docling skips OCR
on a born-digital PDF and matches TableFormer's predicted structure back onto
the PDF's own text cells: the same job, no model call, no network. It is fast
(**4.6 s per file** on CPU, 69.7 s for all fifteen, **$0.00**) and it recovers
**85%** of baseline rows — far better than the hand-rolled geometric arm at 61%,
and still well short of the 92-99% the LLM readers reach.

The disqualifying part is not the recall. Docling **merges adjacent printed
rows** on some layouts:

```
Glukóza Cholesterol       range = "3,6 - 5,6 2,9 - 5,0"
Monocyty Eozinofily       range = "2,0 - 12,0 0,0 - 5,0"
```

Two analytes fused into one record, with their reference intervals concatenated.
That is exactly the failure `data/_realpdf_check/rows.check.ts` exists to forbid
— and this repository's own `buildRows` passes that check on all fifteen files
while Docling does not. The 210 "fabrications" Docling scores should be read
with caution: it normalises cell text, so many are the checker disagreeing about
tokenisation rather than invented values. The merged rows are real.

So the layout-parser answer is genuinely viable as a *fallback* — free, offline,
85% — and not as the primary path for a tool whose entire claim is that the
numbers are right.

**A8, page triage — real, and much smaller than it first looked.** The naive
rule ("skip pages with no measurement rows") was written with a guard first, and
**the guard caught it**: a genuine scan of a real results page was classified
`skip`, because a scan and a blank footer page both carry only a handful of text
items. Switching the discriminator to *does the page paint a bitmap* (read from
pdf.js's operator list, without rasterising) fixes it — but it also reveals that
two of the three "wasted" pages do carry images and legitimately need reading.
The saving falls from 4 pages of 36 to **2 (6%)**, about 1.3 pages on a ten-file
batch. Worth having, not worth leading with — and the earlier claim that ~20% of
files send a blank page to two vision models was simply wrong.

## Accuracy — three columns, never averaged

| component | output tok | rows returned | matched | missing | fabrications |
|---|---|---|---|---|---|
| sonnet5/snippet *(deployed)* | 18,123 | 153 | 153 | 1 | **6** |
| sonnet5/index | 11,173 | 142 | 142 | 12 | **6** |
| opus48/index | 11,944 | 153 | 153 | 1 | 0 |
| haiku45/index | 12,023 | 142 | 142 | 12 | 0 |
| sonnet5/columnmap | 5,068 | 141 | 121 | 33 | 0 |
| haiku45/columnmap | 3,890 | 142 | 114 | 40 | 0 |

**Sonnet 5 fabricates units.** Six values on one page — `WBS leukocyty` came
back with `unit_raw="10^9/l"` where the page does not print it that way. The
prompt explicitly forbids converting units (`nepřeváděj jednotky`) and Sonnet
does it anyway; Opus 4.8 and Haiku 4.5 do not, on the same pages. This is in the
**currently deployed** configuration and is a stronger argument for keeping a
second reader than any speed number.

Two systematic disagreements with the stored reports are *not* errors:
`S_Myoglobin "79,3 !" → "79,3"` (every reader drops the lab's out-of-range
marker, which the pipeline ignores by design), and unit differences across all
arms (the stored reports came from the **vision** path, these from the text
path).

## Two things found that are not about speed

**`MAX_PAGES_PER_SESSION` is 12.** Ten files is ~21-24 pages, so the deployed
demo **refuses around file five** — the exact scenario being optimised for. Not
a slowness bug; the demo stops. Raise it before any of this matters.

**Three of fifteen files send a blank page to a vision model.** Their final page
carries zero measurement rows — a footer or signature page — but has no text
layer, so it is rendered at 220 DPI and sent to two vision models to be told
there is nothing there. That is the slowest and most expensive call the system
can make, on ~20% of files, for nothing. Skipping it is free and needs no model,
but the guard must be proven against a genuine scan first: a real scanned
results page also has few text rows, and silently skipping one would be far
worse than the waste.

**Time to first page is 6.5 s regardless of the batch.** If the table filled in
as pages landed instead of at the end, the *felt* wait would be six seconds
rather than forty-three. Streaming rows into the UI is worth more than the last
twenty seconds of batch time, and it is the one lever here that costs no
accuracy at all.

**The prompt cache does engage.** `worker/claude.ts:170` suspected the tools +
system prefix might sit under the 1024-token minimum and be inert. It is 1,181
tokens — it works, but clears the bar by only 157, so any future trim to the
tool schema could silently drop it back under.

## Where the benchmark was wrong about itself

Two of the results reported mid-run were defects in the *measurement*, not in
what was measured. Both are now covered by tests.

**Phantom value errors.** A lab page legitimately prints the same analyte twice
— a differential count gives `B_Neutrofily` as a fraction (`0,527`) and as an
absolute count (`# 2,900`, `10^9/l`) on two separate rows. The scorer keyed
measurements by name in a `Map`, so the second silently overwrote the first and
**every arm** was charged seven disagreements it had not made. Re-scored, the
column map's errors on that page went from 7 to 1.

**Paying twice.** The first accuracy run stored verdicts but not the raw model
output, so fixing the scorer meant re-running the calls. It now persists what
each reader actually returned.

The range-integrity guard was handled the other way round on purpose: before
being trusted on real data it was shown to fire on the exact historical defect
(`4,11-5,60` read back as `4,115,60`), and on the near-misses it must ignore.

## What shipped

A5, adopted: **`row_index` anchor, Sonnet 5 + Haiku 4.5, a global limit of 8
concurrent requests shared across up to 4 files at once, and rows published as
each page lands.** `MAX_PAGES_PER_SESSION` raised from 12 to 40 so a ten-file
batch fits, and `BUDGET_USD_LIMIT` from 20 to 40.

Confirmed live, which had never been done before: **Turnstile passes in
production** — it minted a session and accepted a ten-file upload without a
human click, closing the oldest open question about this deployment. Streaming
is visibly working (the document rail filled while files were still being
read), and the vision fallback fired correctly on the three scanned pages.

Two things the live test caught that no amount of benchmarking would have:

- **Haiku 4.5 rejects `output_config.effort` with a 400.** The parameter was
  measured at a 0.7% gain, so it was removed rather than special-cased — a knob
  worth nothing that breaks one of the two readers is not worth carrying.
- **The `row_index` instruction made the model literal about the input's own
  delimiter.** A reference interval printed in `od`/`do` columns came back as
  `"0,17 | 0,78"` instead of `"0,17 - 0,78"`, which does not parse and silently
  became flag `unknown` — the exact shape of the defect class this project
  cares most about. Fixed by one sentence in the prompt, and caught because
  `tests/live/extract.live.ts` asserts derived flags against fixtures whose
  printed values are known exactly.

## Recommendation

1. **Read pages concurrently** — done. This is most of the win, costs nothing,
   and changes no output.
2. **Replace `source_snippet` with `row_index`.** ~35% less output, ~35% less
   latency, and a more precise anchor for the verification highlight than a
   fuzzy string match.
3. **Raise `MAX_PAGES_PER_SESSION`** to at least 30, or the ten-file demo stops
   half way.
4. **Keep two readers, and make Haiku 4.5 the second one.** Not for speed —
   because Sonnet 5 invents units and Haiku does not, so the disagreement flag
   has something real to catch. This is what `docs/web-demo-plan.md` already
   argued for a weaker second model, now with evidence.
5. **Concurrency 8** — done, and measured: 85.4 s → 43.6 s with no failed calls
   and unchanged per-page latency. Revisit only if phone memory, not the API,
   turns out to be the binding constraint.
6. **Skip pages with no measurement rows** — but prove the guard against a real
   scan before trusting it.

Not recommended: chasing `effort`, `thinking`, or a different model tier for
speed. The measurements say there is nothing there.
