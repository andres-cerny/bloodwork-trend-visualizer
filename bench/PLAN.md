# Extraction speed & accuracy benchmark — plan

## The question

A doctor drops **~10 lab PDFs** into the demo and watches. Today that is
**~24 pages** (the 15 real samples average 2.4 pages each), processed **strictly
serially**, two models per page. That is minutes of spinner, and a spinner is
what makes a clinician stop believing the output.

Target: **a 10-file batch finishing in under 60 s**, ideally well under, with
**no loss of transcription accuracy** — measured, not asserted.

## Two blockers found before any measurement

1. **`MAX_PAGES_PER_SESSION` is 12** (`wrangler.jsonc:26`). Ten files is ~24
   pages, so the deployed demo **refuses partway through the exact scenario we
   are optimising for** — around file 5. This is not a speed defect; the demo
   stops. Must be raised (and the budget ledger re-checked against the new
   ceiling) before any of this matters.
2. **Rate limits, not model latency, may be the real ceiling.** Once pages run
   concurrently, the binding constraint becomes tokens-per-minute, not
   seconds-per-page. That makes output-token reduction (arm A3) a *throughput*
   lever as well as a latency one. The sweep must measure effective concurrency
   before 429s begin, not assume it.

## Metrics, in priority order

1. **Batch wall-clock** — 10 files / ~24 pages, end to end. The doctor's number.
2. **Time to first row on screen** — perceived speed, which is most of trust.
3. **Sustainable concurrency** — pages in flight before rate limiting bites.
4. **Accuracy**, in three separate columns, never averaged into one score:
   - **exact match** against `web/tests/fixtures/` (generated from literal
     values — real ground truth);
   - **agreement** with `data/reports/*.json` on the 15 real reports (the
     incumbent's *output*, not truth — disagreements are adjudicated by hand,
     not scored automatically, or the sweep just rewards imitating Sonnet 5);
   - **fabrication rate** — `isPrintedOnPage` failures.
5. **Cost** — recorded, not optimised.

### One named accuracy check, not a general score

Reference ranges and censored values get their own pass/fail column:
`4,11-5,60`, `<1,0`, decimal commas, the lab's `!`/`(X)` markers. `docs/` records
a hyphen loss that turned a printed range into a *plausible wrong number* rather
than a failure. Low effort and a weaker second reader are exactly where that
class returns, and it returns silently. The check is proven by feeding it a
deliberately collapsed range **before** trusting it on a real one.

## Arms

`A0` is the deployed configuration. Every later arm is a delta.

| Arm | Change | Hypothesis |
|---|---|---|
| A0 | Sonnet 5 + Opus 4.8, effort `high`, Sonnet silently thinking, `source_snippet` on | baseline |
| A1 | `effort: "low"` both | a verbatim copy needs no reasoning depth |
| A2 | A1 + `thinking: disabled` on Sonnet 5 | omitting `thinking` makes Sonnet adaptive; Opus 4.8 not — the two readers behave differently today by accident |
| A3 | A2 + `source_snippet` → `row_index` | the row is already in the input; echoing it back is pure output tokens, and output tokens are latency |
| A4 | A3, Sonnet 5 only | is the second read worth its latency |
| A5 | A3, second reader = Haiku 4.5 | keeps disagreement-flagging at ~1/5 the latency |
| A6 | A3 + escalate only on flagged pages | better median, worse tail |
| A7 | Docling, no model at all | the speed ceiling — how far the LLM arms are from free |

Arms are data (`bench/arms.ts`), so loop iterations add hypotheses cheaply.

**Orthogonal levers**, applied to whichever arm wins rather than tested as
separate arms: page concurrency, streaming, and whether prompt caching actually
engages (`worker/claude.ts:170` admits the prefix may sit under the 1024-token
minimum and be silently inert — `cacheReadTokens` settles it).

## Stages

### Free and paid are separated on purpose

Latency and accuracy were originally going to be measured by the same runs,
which is both expensive and sloppy — it pays API rates for information that
costs nothing.

- **Accuracy transfers from a subagent.** Running the same reader against two
  prompt/schema variants is a fair A/B, so anchor modes, prompt wording and
  output size can be screened at zero API cost.
- **Latency does not.** A subagent's wall-clock is dominated by harness
  overhead — a full system prompt and tool set as prefix, spawn scheduling,
  turn boundaries — which is larger than the differences being hunted. And
  `effort` and `thinking` have **no subagent equivalent at all**, so A1 and A2
  are only measurable through the API.
- **`count_tokens` is free**, giving exact input tokens for every arm.

So latency is measured once, as a *model*: `(model × effort × thinking)` over a
fixed page set. Any arm's latency is then predicted from its config and its
measured output size, instead of paying to run every arm end to end.

**Stage 0 — instrument, no API, $0.** Client-side floor: pdf.js load,
`pageAssets`, `buildRows`. Exact input tokens per arm via `count_tokens`.
Whether prompt caching engages at all (`worker/claude.ts:170` suspects it does
not).

**Stage 1a — free screen.** Subagent as reader, 4 files / ~10 pages spanning
labs and years, every arm whose difference is a prompt or schema difference.
Scores accuracy and output size. Kills weak arms before any spend.

**Stage 1b — the latency model, ~$3.** `(model × effort × thinking)` grid on a
fixed page set, repeated for a median. The only place A1 and A2 can be settled,
and the source of every latency number the notebook reports.

**Loop (×3).** After each Stage 1: read the results, form new hypotheses from
what the *data* showed rather than what was predicted, add arms, re-run Stage 0
+ 1.

Iteration 1 runs the eight arms above. **Iterations 2 and 3 add only two new
arms each** — two genuinely untested ideas earned from the previous results,
not variations on an arm that already ran. Twelve arms total, which is what
keeps the sweep inside its budget while still letting the data steer.

**Stage 2 — the 10 best arms × all 15 real PDFs (36 pages), ~$4.** Accuracy on
the full corpus runs free through subagents; the **top 3 arms are confirmed
against the real API**, because a subagent is a fair A/B between prompts but is
not the model the Worker actually calls. Every baseline disagreement is
adjudicated by hand against the printed page.

**Stage 3 — the real thing.** Winner + page concurrency + streaming, driven in a
real browser through the existing `e2e/` harness, on a **10-file batch**. Batch
wall-clock and time-to-first-row. This is the number that answers the question.

## Deliverables

- `notebooks/bench.ipynb` — findings with graphs.
- `docs/extraction-speed.md` — plain language: what worked, what didn't, why.

## Guardrails

- **Hard spend cap** (`BENCH_MAX_USD`, default 30). Cumulative spend is checked
  *before* every call, and the runner stops cleanly — writing partial results —
  rather than continuing past it. Projected total ≈ **$8–10**: ~$3 for the
  latency model, ~$4 confirming the top arms on the full corpus, ~$1.50 for the
  Stage 3 batch run. The cap is deliberately well above the projection so that
  a surprise shows up as a surprise rather than as a truncated sweep.
- `maxRetries: 0` in the harness — a silent backoff retry would otherwise be
  recorded as model latency.
- Arms run **round-robin**, not one arm at a time, so transient API slowness
  cannot systematically favour whichever arm ran in a quiet minute.
- **`bench/results/` is gitignored.** It holds extractions of real medical PDFs
  and falls under the same rule as `data/`.

---

## Stage 0 results (run 2026-08-22)

**The parse floor is nothing.** 15 files / 36 pages in **290 ms — 8.1 ms/page**.
A 10-file batch spends ~194 ms in pdf.js and `buildRows`. So essentially *100%*
of the wait is the model, and every millisecond saved has to come from there.

**The prompt-cache breakpoint is NOT inert.** tools + system = **1181 tokens**
against a 1024 minimum, so it engages — `worker/claude.ts:170` suspected
otherwise and was wrong. Worth knowing: it clears the bar by only 157 tokens, so
any future trim to the tool schema could silently drop it back under.

**`row_index` costs +114 input tokens** on a 57-row page (the numbering in the
prompt). Cheap input traded for expensive output — the direction the arm wants.

### The finding that outranks all of the above

Three of fifteen files (`file06`, `file09`, `file10`) route their
**final page to the vision path** — and every one of those pages has **zero
measurement rows**:

```
file06.pdf   p1:TXT/rows=52/meas=38  p2:TXT/rows=47/meas=28  p3:SCAN/rows=2/meas=0
file09.pdf   p1:TXT/rows=53/meas=33  p2:TXT/rows=52/meas=31  p3:SCAN/rows=6/meas=0
file10.pdf   p1:TXT/rows=53/meas=41  p2:TXT/rows=51/meas=29  p3:SCAN/rows=5/meas=0
```

They are trailing footer/signature pages. The demo currently renders each at
**220 DPI** and sends it to **two vision models**, which is the slowest and
priciest call the system can make — and gets back nothing. Two text pages also
carry zero measurements (`file07` p3, and `file11`/`file12` p3
carry only 5).

On the doctor's 10-file batch that is ~2 wasted vision round-trips plus a
couple of wasted text ones, and they sit on the critical path.

**New arm A8 — page triage.** Decide per page whether to send it at all, from
row and text-item counts, before any render or call. Costs zero tokens.

The risk is precisely the kind this project cares about: a rule that skips
"empty" pages could silently skip a *genuine scan* of real results, which also
has few text rows. The discriminator is that a blank trailing page in a digital
PDF still carries a few text items while a true scan carries almost none — so
the guard must be proven against `SCAN_FIXTURE` in `tests/live/fixtures.ts`
(a real scanned results page) **before** it is trusted, not after.
