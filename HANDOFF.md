# Handoff — finishing the web demo locally

Give this file to Claude in a local session. It has everything needed to test
extraction against real PDFs, improve it, and deploy.

## Step 0 — get the branch (do this first)

None of this work is on `main`. A fresh clone, or a checkout that has not
fetched since, will not have the branch at all — so start here:

```sh
git fetch origin
git switch claude/doctor-demo-bloodwork-trends-j55bb5
npm install
```

If `git switch` reports the branch does not exist, the fetch did not run or
did not reach the remote — re-run `git fetch origin` and check
`git branch -r` lists `origin/claude/doctor-demo-bloodwork-trends-j55bb5`.

`claude/web-app-demo-hosting-ymbgkc` is the earlier branch this continues from;
everything on it is included here, so you only need this one. `main` is
untouched at `242bd53`, so switching back and forth costs nothing.
Stash local changes first if `git status` is not clean.

Then confirm the tree is healthy before changing anything:

```sh
npm test               # 225 unit tests
python3 tests/test_parity.py   # 58 cross-language parity cases
```

Both should pass immediately. If they do not, something about the environment
is wrong — Node 22 and Python 3.11 are what this was built and tested against
— and it is worth fixing that before trusting any other result.

## What this is

A Cloudflare-hosted demo of the bloodwork visualizer, built on the branch
`claude/doctor-demo-bloodwork-trends-j55bb5`. `main` is untouched. It is a React SPA
plus one Worker: the site opens on a pre-baked synthetic dataset, and visitors
can upload their own PDF behind a Cloudflare Turnstile check.

Design doc: `docs/web-demo-plan.md`. Deploy steps: `docs/deploy.md`.

## State

Built and tested — **225 unit tests** (`npm test`), plus 20 browser tests and
17 live-extraction tests that need a browser or an API key (see *Tests only you
can run* below):

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
| Spend ledger | `worker/tests/budget.test.ts` | Shard accumulation, freeze boundary, cache-token pricing |
| Misread detection | `web/tests/implausible.test.ts` | A decimal slip caught; a real extreme left alone |
| Patient identity | `web/tests/identity.test.ts` | Rodné číslo and name matching, and every way the comparison can fail |
| Mapping evidence | `web/tests/mapping.test.ts` | Value plausibility, material mismatch, provenance |
| Cross-language parity | `tests/test_parity.py` + `web/tests/parity.test.ts` | **Both** read `tests/parity_cases.json` |
| Strategy benchmark | `web/tests/bench/plausibility.bench.test.ts` | Scores the plausibility detectors against each other |

Also built: the SPA with all four tabs, chat, Turnstile-gated upload,
text-layer extraction for digital PDFs with a vision fallback for scans, a
mapping review showing where each unmapped value came from and what data
already sits under each candidate, and the patient-identity guard on upload
described under *Two patients must never share a chart* below.

**Not done, because this environment could not do it:**

1. **No real Claude calls have ever been made.** There was no
   `ANTHROPIC_API_KEY` in the build environment. Every test so far exercises
   the deterministic layer only. *The end-to-end extraction path is unproven.*
2. **Never deployed.** `wrangler whoami` reported "not authenticated", no
   Cloudflare credentials were present in the environment, and
   `developers.cloudflare.com` is blocked by the egress proxy — so the
   official agent-setup flow could not be fetched either. Deploying is a
   local job: see `docs/deploy.md`. Prefer `wrangler login` (OAuth) over a
   long-lived API token; there is then no token to leak or clean up, and
   secrets go in via `wrangler secret put`, never into a file.
3. **Never tested against a real lab PDF.** Network egress was policy-blocked,
   so no real Czech lab documents could be downloaded. All fixtures are
   synthetic.

Items 1 and 3 are the real risk. Everything below is about closing them.

## Tests only you can run

Two suites are deliberately outside `npm test` and outside CI, because they
need a real API key or a real browser — the two things missing where this was
built. **Run both before you trust anything here.**

```sh
npm run test:e2e      # the built app in a real browser — no key needed
npm run test:live     # real extraction through Claude — costs ~$0.20
npm run test:handoff  # both
```

### `npm run test:e2e` — does it visualise correctly

Builds the app, serves it with `vite preview`, drives it with Playwright at
390px and 1200px, and asserts **rendered geometry** rather than state. It
covers the defects that passed every unit test in the project:

- the source highlight frames the same row on a phone as on a desktop, and
  stays aligned when the image is enlarged;
- a reading flagged as a misread is *not* plotted, and is named on the card;
- an unconfirmed reading *is* plotted and is named;
- chart points are spaced by real elapsed time, not by index;
- correcting a value re-derives the flag, the review count and the chart, and
  undo restores the original reading *and* its warning;
- `Vymazat vše` empties the app, takes the tabs and the chat with it, leaves
  the upload card reachable, and drops corrections made before it — the
  restored sample data is the shipped data, not the edited data;
- no page scrolls sideways on any tab at either width, including with a
  confirmation dialog open on a phone.

Needs Chromium. If Playwright cannot find one: `npx playwright install
chromium`, or point `CHROMIUM_PATH` at an existing binary.

Writing this suite immediately found two live regressions — a grid track
sized `1fr` letting the transcript table push the page 19px wide on a phone,
and the highlight still being timing-sensitive because it was positioned from
a measured pixel width. The highlight is now positioned in percentages of the
image's own dimensions, which cannot go stale.

### `npm run test:live` — does it extract correctly

```sh
ANTHROPIC_API_KEY=sk-ant-... npm run test:live
```

Runs the real extraction path — both models, cross-checked — against the
generated layout fixtures, and asserts **exact** output. That is possible
because `scripts/make_layout_fixtures.py` builds those PDFs from literal
values, so every character printed on each page is known: the Czech decimal
comma, the lab's `!` and `*` markers, the censored `<1,0`. A value that
arrives "correct" but normalised (comma to point, marker dropped) fails.

It also asserts the provenance guarantee — every returned value must be
literally printed on the page — that no row is invented, and that the vision
fallback transcribes a page with no text layer.

Cost is printed at the end and capped:

```sh
LIVE_MAX_USD=1 npm run test:live        # abort past $1 (default $2)
LIVE_SINGLE_MODEL=1 npm run test:live   # one model instead of two, ~half price
```

Without a key the suite **skips** with a message rather than failing, so
`npm test` stays green for anyone without one.

## Running it locally

```sh
npm run dev              # SPA on the pre-baked data — no key, no Worker needed
```

That is enough to look at every tab. For the AI features you need the Worker,
which means secrets. Follow `docs/deploy.md` for KV, Turnstile and the real
values; for local full-stack work put them in a git-ignored `.dev.vars`:

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

## The parsing layer exists twice — keep it in step

`src/normalize.py` and `web/src/lib/normalize.ts` implement the same rules.
`tests/parity_cases.json` is read by tests on both sides, so changing one
without the other fails. **To change a parsing rule: edit the fixture first,
then make both implementations satisfy it.** CI (`.github/workflows/test.yml`)
runs both suites plus a check that regenerating the demo data produces no diff.

## Where plausibility numbers come from

Three separate things use ranges, and confusing them causes real harm:

| Purpose | Source | File |
|---|---|---|
| Is this result abnormal? | The interval printed on the patient's own report | `src/normalize.py` / `normalize.ts` |
| Is this the same analyte? | Curated table, then printed intervals, then observed values | `web/src/lib/mapping.ts` |
| Is this number even possible? | Curated table, else the printed interval | `web/src/lib/implausible.ts` |

`scripts/reference_ranges.json` holds the curated intervals. **They are seeded
from commonly published adult values and are NOT verified against a Czech
clinical source** — check them against ČSKB recommendations or a lab handbook
before relying on them beyond a demo. They are only ever used to tell analytes
apart and to spot a misread; a result is never flagged normal or abnormal from
them.

The benchmark comparing the strategies is
`web/tests/bench/plausibility.bench.test.ts` — run it after changing any of
this. On its current cases: observed values 8/15 with 7 false accepts, printed
intervals 12/15, the curated table 15/15.

## Two patients must never share a chart

The demo opens on a synthetic patient and an upload **merges into what is
loaded** — `buildTrends` runs over every loaded report. Across several draws
from one person that is the entire feature; across two people it draws one line
through two patients' ALT and states something about nobody. Left alone, the
first thing a doctor would have seen after uploading is their patient's results
filed under "Jan Ukázka".

Two guards, both new:

**`web/src/lib/identity.ts`** compares the uploaded report against every
distinct identity already on screen. `patient_name` and `patient_id` were
always in the extractor's schema; the upload path used to hardcode them to
`null` and now keeps them. Rodné číslo decides when both sides have a usable
one (9 or 10 digits — anything else is a misread and is *not* compared, or a
dropped digit would read as a different patient); otherwise the name, with
diacritics, case, word order and titles normalized away. Only a positive match
is silent. A mismatch and an identity that could not be read *both* stop and
ask — replace, add anyway, or discard — because treating "could not read it" as
a pass would disable the check on exactly the documents that need it most.

**`Vymazat vše`** in the patient bar drops every report, the corrections made
against them, and the synonyms accepted in the mapping tab. Sample data comes
back with one click; an upload would need re-extracting, and the confirmation
says so.

The patient bar itself was also wrong in a way this made reachable: it found
the name and the rodné číslo with two independent `find` calls, so with two
patients loaded it could pair one patient's name with the other's number. Both
now come from one report, and a bar showing more than one identity says so —
"2 pacienti v jednom grafu" — rather than leaving the reader to notice.

Two consequences worth knowing before you demo:

- **An uploaded patient's real name and rodné číslo now render in the sticky
  patient bar**, where before the bar always said "Jan Ukázka". That is
  necessary — the bar's job is to say whose results these are — but it means
  screen-sharing the app with a real report loaded puts an identifier on
  screen. It is also what the mismatch dialog shows, deliberately: a warning
  the reader cannot check is a warning they will learn to click through.
- The "smyšlený pacient, žádné reálné zdravotní údaje" line now disappears from
  the banner once the sample data is gone. It must not sit above a real
  patient's results.

**What is not proven:** the dialog has never been triggered by a real upload,
because that needs a Turnstile pass and a live extraction. The decision logic
has 28 unit tests (`web/tests/identity.test.ts`) and the clear/restore flow has
6 browser tests, but the wiring between them — that a real lab PDF yields a
`patient_id` the check can actually use — is on the list below. **Add it to the
first real-PDF session:** upload one report, then upload a different patient's,
and confirm the dialog appears and each of its three answers does what it says.
If real reports come back with `patient_id: null` more often than not, the
check silently degrades to "unverifiable" on every upload, which is safe but
noisy — that is the outcome to watch for.

## A clinician reviewed the UI

Rounds of subagent evaluation role-playing Czech doctors drove the built app
and reported what a clinician could not use. Between them they caught things no
test would have:

- The mapping plausibility check accepted anything, so the UI showed a green
  tick recommending homocysteine be merged with uric acid.
- On mobile the source highlight pointed at the **wrong row** — the one feature
  meant to prove the numbers was telling the reader something untrue.
- Correcting a value and undoing it laundered a disputed row into a clean one.
- The x axis was not time, so a three-year gap drew like a six-month one.
- "Triacylglyceroly vzrostlo" — Czech verb agreement, across a 109-entry
  registry of mixed gender.
- A fix that rescued one flag and left the class: the misread check reached the
  chart while a model disagreement did not, so four readings the app had itself
  doubted were being plotted silently.

**The rule that came out of it, worth keeping:** a doubt raised anywhere must
travel to the screen a patient is shown. `web/src/lib/review.ts` is the single
authority; the verification chips, the filter, its counter and the trend
screen all read it. If you add a new kind of doubt, add it there — not at a
call site.

## Known clinical limitations, not yet addressed

Raised by reviewers and left open deliberately; worth deciding on before a
real clinic sees this:

- **Reference ranges are applied as two-sided.** A CRP printed as `1,0–5,0`
  makes `<1,0` render as "pod rozmezím", but a low CRP is a good result. Any
  analyte whose printed lower bound is a detection limit rather than a clinical
  threshold will show a false "abnormal". Fixing this means knowing, per
  analyte, whether the lower bound is clinical — a registry field, not a
  parsing change.
- **The summary compares only the two most recent draws.** ALT rising
  0,61 → 0,72 → 0,84 → 0,93 across four draws with GGT alongside is the
  clinically arresting fact, and the prose reports only "+11% since February".
- **In-range analytes are ranked by percent change**, which inside a wide
  reference interval is often assay noise rather than signal.

If you change the UI, it is worth repeating: spawn a subagent, tell it to
role-play a Czech doctor who has never seen the app, point it at
`npx vite preview` with Playwright, and make it *read its own screenshots*.
It caught things no test would. Two practical notes: do not rebuild `dist`
while a review is running (the preview serves from disk, so the reviewer sees
a moving target), and give each round the previous round's findings to verify
rather than only asking for fresh ones — the verification is where the
half-finished fixes surface.

## A security review found one real defect

`export_web_data.py`'s redaction guard could not detect the case it existed
for. Redaction and verification both ran through the PDF text layer, so on a
**scanned** page the search matched nothing, nothing was painted over, the
"did anything survive" check also matched nothing, and a page whose printed
header carries the patient's name and rodné číslo rendered straight through
looking clean. Fixed: a page without a usable text layer is refused, and images
are staged and published only once every page passes.

Confirmed sound in the same review: the HMAC session verification denies on
every malformed path rather than falling through; no secret can reach the
client bundle or an error body (the SDK's error stringification uses the
response body only, never request headers); the spend ledger is driven only by
token counts Anthropic reports; and the Worker's only outbound hosts are
hardcoded. Worth re-running before deploy if you change `worker/`.

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
2. Check the patient bar first: it should now carry the real name and rodné
   číslo off the page header. If it says "Neznámý pacient", the header did not
   transcribe and the identity check has nothing to work with — see *Two
   patients must never share a chart*.
3. Watch the verification tab. Every row that came out wrong is a bug with a
   reproducible cause — find which stage lost it.
4. Add a fixture that reproduces it (below), fix, re-run `npm test`.
5. Repeat with a different lab's layout — and with a *different patient's*
   report, to trigger the mismatch dialog and exercise its three answers.

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
