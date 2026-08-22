# Web demo hosting plan — Cloudflare

Plan for publishing the bloodwork visualizer as a link-shareable demo that works
on phone and desktop, hosted on Cloudflare with no custom domain.

Status: **shipped and live** at https://bloodwork-demo.andres-cerny.workers.dev

This document is kept as the record of *why* the design went the way it did —
the alternatives weighed, and what each decision was protecting against. It is
no longer a plan to work through. For what must not be broken see
[constraints.md](constraints.md); for the UI see
[design-notes.md](design-notes.md); for how to deploy it see
[deploy.md](deploy.md).

> **One decision here was reversed, and it was the central one.** The plan
> below plans for Cloudflare Workers AI's free tier, on the reasoning that a
> demo nobody can bill is a demo you can hand to a stranger. What shipped calls
> **Claude** — Sonnet 5 and Opus 4.8, the same two models the local pipeline
> uses — from a Worker secret, bounded by a spend ceiling rather than by a free
> tier. The passages arguing for free models are left as written, marked where
> they no longer describe the system; see [After the plan: Claude, and a
> ceiling instead of a free tier](#after-the-plan-claude-and-a-ceiling-instead-of-a-free-tier).

## Goal

A URL (`*.workers.dev`) that can be sent to a doctor, opened on a phone, and
used to see the product's story end to end: transcribed lab values, the
verification view that proves the numbers are right, trends over time, a plain
Czech summary of what changed, and a chat to ask about it.

## Shape

**Everything expensive happens offline, on your machine, before deploy.** You
run the existing Python pipeline over your PDFs; it emits JSON reports, page
images and row bounding boxes. Those ship as static assets.

The consequences are worth stating plainly, because they remove most of the
original plan:

- **No key needed to browse.** Opening the site and clicking through the
  pre-baked dataset reaches no model at all. *(Held.)*
- **No cost for the demo itself.** A stranger clicking around costs nothing,
  because there is nothing to bill. *(Held — the ceiling below governs upload
  and chat only.)*
- **No storage.** Uploaded PDFs are parsed in the browser and never written to
  a server disk. Closing the tab ends the session. *(Held.)*
- ~~**Live upload runs on free models only** (Workers AI), behind a Cloudflare
  Turnstile check. Your Anthropic key is not in the deployment at any point.~~
  **Superseded.** Upload and chat call Claude with a key held as a Worker
  secret, still behind Turnstile, and a KV spend ledger freezes both at
  `BUDGET_USD_LIMIT` (default $20).

The site opens on the pre-baked dataset — instant, flawless, zero risk — and
"zkus vlastní PDF" is offered on top of it.

## Architecture

```
BUILD TIME (your machine, existing Python)      RUNTIME (public)
------------------------------------------      ----------------
PDFs                                            Worker with static assets
  → src/pipeline.py  (Sonnet 5 + Opus 4.8)        ├─ SPA (the five tabs)
  → src/normalize.py (values, units, flags)       ├─ /api/extract → Claude
  → src/locate.py    (row bboxes, px coords)      │    (Turnstile-gated, metered)
  → anonymize + redact                            └─ /api/chat    → Claude
  → JSON + page PNGs  ──────────────────────▶   fetched as static JSON
```

As planned, both API routes read "Workers AI". See [the section at the
end](#after-the-plan-claude-and-a-ceiling-instead-of-a-free-tier).

### Live upload

Opt-in, on top of the pre-baked set. Two extraction paths, chosen per document:

1. **Text layer (default).** pdf.js reads the embedded text with x/y
   coordinates, and `buildRows` clusters items into printed rows by vertical
   centre, ordering cells left to right. Claude then does *column assignment*
   rather than character recognition — the characters come from the file.

   This makes provenance checkable rather than a matter of trust:
   `isPrintedOnPage` verifies every returned value literally appears on the
   page, and anything that does not is flagged for review instead of reaching
   a trend. A misread decimal stops being unlikely and becomes impossible.

   It is also cheaper (a page of text costs a fraction of a 220 DPI image in
   input tokens) and lighter on phones — the page is rendered at 110 DPI for
   human display only, never at model resolution.

2. **Vision fallback.** Pages with no usable text layer are rendered at the
   full 220 DPI and sent to the same two models with the original image
   prompt. Retained deliberately: a doctor may bring a scan, and the demo
   should not simply refuse it.

The path is chosen per page at runtime from whether the page carries a usable
text layer, so a mixed document works without configuration.

The two-model cross-check survives: two different models, unioned row-by-row,
disagreements flagged into the verification tab. That design was reasoned about
for *free* models, where it matters more rather than less — a weak model
degrades into "more rows to review" rather than into silent wrongness. It
shipped against Sonnet 5 and Opus 4.8, where the same property buys less but
costs nothing extra to keep.

### Abuse gate

**Cloudflare Turnstile** (free, unlimited) in front of upload. The Worker
verifies the token server-side before accepting any extraction work. Because a
Turnstile token is single-use and a report is many pages, one successful
verification mints a short-lived HMAC-signed session token covering a bounded
page count — so the visitor solves one challenge, not one per page.

A per-IP daily counter in KV backs it up. As planned this was for availability
rather than cost — cost was to be structurally zero. With Claude behind the
route it is now doing both jobs, and the spend ledger is the real backstop: one
abuser should not be able to burn the budget an hour before you demo.

`row_bbox` in `src/locate.py` already returns pixel coordinates in image space
(it scales PDF points by `RENDER_DPI / 72`), so the boxes map 1:1 onto the
cached PNGs with no further work at runtime.

### Hosting

A single Worker with the static-assets binding serves the built SPA and the API
routes from one deployment. Free plan: 100k requests/day on Workers — still
true and still the binding constraint on serving. *(The 10,000 Neurons/day this
paragraph also counted on is not in play: the AI routes call Claude, and what
bounds them is the spend ceiling.)*

## Anonymization — hard prerequisite

The dataset **is** the demo now, and it is fully public with no gate in front of
it. Nothing ships until this is done.

**1. The JSON.** Substitute patient names, synthesize a valid-format rodné
číslo, shift all dates by a constant offset. Analytes, values, units, reference
ranges, flags and model disagreements stay exactly as they are — everything a
doctor evaluates is preserved.

**2. The page images — the easy one to miss.** The rendered PNGs are pictures of
the original lab reports, and the printed header carries the patient's name and
rodné číslo. Anonymizing the JSON does nothing about that; the identifiers are
visible in the verification tab, which is the tab we most want the doctor to
look at.

Fix: redact the identifier region of each page image at build time. PyMuPDF
already gives us the machinery — `search_for` locates the printed name and
rodné číslo, and we paint over those rectangles before the PNG is written. A
build-time check should refuse to emit any image whose source page still
matches a known identifier, so this cannot silently regress.

## Port inventory

Only what drives *interaction* needs to run in the browser. Everything static is
precomputed.

| Python | Runtime target | Why |
| --- | --- | --- |
| `src/normalize.py` | `web/src/lib/normalize.ts` | Live re-derivation when a value is corrected in the verify tab. Correcting a misread decimal and watching the flag, trend and summary all update is the demo's strongest moment. |
| `src/trends.py` | `web/src/lib/trends.ts` | Rebuilds series on date filtering and on accepting a mapping. Tiny and pure. |
| `src/summary.py` | `web/src/lib/summary.ts` | So the summary responds to corrections rather than sitting frozen. Deterministic Czech templates. |
| `src/models.py` | `web/src/lib/models.ts` | Dataclasses → interfaces. The `*_raw` vs derived split must survive the port intact. |
| `src/matching.py` | **precomputed** | The analyte set is fixed, so ranked suggestions and their evidence are emitted at build time. Accepting one is an in-memory state change. |
| `src/locate.py` | **precomputed** + `web/src/pdf/rows.ts` | Bboxes precomputed for the pre-baked set. For uploads the row bbox falls out of the clustering directly — no text search needed at all. |
| `src/extract.py`, `ingest.py`, `pipeline.py`, `process.py`, `storage.py` | **build time only** | Unchanged. They run on your machine and never ship. |
| `app.py` | `web/src/ui/*` | 37KB of Streamlit → components. Altair → a JS charting layer. |

About 17KB of pure, already-unit-tested logic to port. The tests port with it,
so parity is asserted rather than assumed.

## Chat

New subsystem — nothing in the repo today.

~~**Model: Cloudflare Workers AI free tier.** No Claude tier — your key stays
out of the deployment entirely. On-platform, no extra credentials,
10,000 Neurons/day, and it hard-fails rather than billing when exhausted.~~
**Superseded — chat runs on Sonnet 5.** The "hard-fails rather than billing"
property was the point of the free tier, and it is the property the spend
ledger reproduces: at the ceiling the AI routes return 402 and the site falls
back to the pre-baked demo. The key lives as a Worker secret, never in the
browser — that part is unchanged.

**Design note: prefer context injection over tool-calling.** Free-tier models
handle multi-step tool use poorly, and a chat that fumbles its tool calls in
front of a doctor is worse than no chat. The dataset is small and already
structured, so inject the relevant normalized values directly into the prompt
and constrain the model to quoting only numbers it was given. Same guarantee the
tool-calling design was reaching for, more reliably, on a weaker model.

~~**Open risk: Czech quality.**~~ **Overtaken.** The plan was to evaluate
Workers AI's Czech on real questions and swap tiers if it disappointed. No such
evaluation is recorded in this repository — the Worker was built against Claude
from its first commit, and the free tier was never measured. The risk was
answered by not taking it.

**Light per-IP throttle.** Planned when cost was structurally zero, to protect
the daily allowance. It shipped alongside a server-side page allowance per
session and the spend ledger, which is what actually bounds the loss.

## Phases

### Phase 1 — anonymized dataset

Build script: run the pipeline, anonymize the JSON, redact the page images, emit
static assets plus the precomputed mapping suggestions and row bboxes. Includes
the regression check that refuses to emit an image still showing an identifier.

Nothing else starts until the output of this phase is clean.

### Phase 2 — port the deterministic core

`normalize`, `trends`, `summary`, `models` to TypeScript with their test suites.
Finished when the TS tests pass with the same assertions as the Python ones.

No UI, no network.

### Phase 3 — the UI

Four tabs, responsive, mobile-first:

- **Trendy** — per-analyte charts with reference bands, date filtering.
- **Souhrn změn** — rule-based Czech summary, recomputed from current state.
- **Ověření** — extracted table beside the source page image; selecting a row
  highlights its bbox on the PNG; "jen sporné řádky" filter; inline correction
  that re-runs `normalize.ts` live. This is the tab that most justifies leaving
  Streamlit — a side-by-side layout Streamlit handles badly on a phone.
- **Namapování analytů** — precomputed ranked suggestions with their evidence,
  one-click accept, trends rebuild on accept.

Corrections and accepted mappings live in memory only. They demonstrate the
feature and reset on reload, which is correct for a demo.

### Phase 4 — live upload

Turnstile widget and server-side verification, HMAC session tokens, the pdf.js
text-layer path, the vision fallback, per-IP KV counter. Uploaded data joins the
same in-memory session state the pre-baked set uses, so all five tabs work on it
unchanged.

### Phase 5 — chat

Worker route, provider interface, context injection, Czech quality evaluation.

### Phase 6 — deploy

Wrangler config, build pipeline, Turnstile keys, KV namespace for the ledger,
three Worker secrets, deploy, verify on a real phone and a real desktop.

## Risks

| Risk | Mitigation |
| --- | --- |
| Patient identifiers surviving into the public build | Redaction plus a build-time check that fails the build, not a manual review step. |
| Free-tier chat's Czech is too weak | Avoided rather than measured — the Worker shipped on Claude. |
| Port drift in the deterministic core | Ported tests are the contract. |
| Demo looks static / canned | Live upload plus correction re-derivation and mapping acceptance. |
| A model fabricates a value on upload | On the text path this is caught deterministically — a value not printed on the page is flagged, never trended. On the vision path the two-model cross-check flags disagreement, and the pre-baked set still carries the pitch. |

## Out of scope

Auth, a database, cross-session persistence, custom domain, production security
hardening. This is a demo. ~~Claude anywhere in the deployed runtime~~ — this
last one is what the next section is about.

## After the plan: Claude, and a ceiling instead of a free tier

The plan above is built on one load-bearing assumption: that the deployment
must be **unbillable**, so that a link sent to a stranger cannot cost anything.
Workers AI's free tier delivers that by construction — it stops serving rather
than starts charging.

**Be clear about what the record shows.** The Worker called Claude in the
commit that first introduced it (`45d01f3`), and no Workers AI implementation
or Czech evaluation was ever committed. This was not a measured reversal — the
free tier was set aside before it was tried, and the plan's own mitigation for
the Czech risk (build behind a provider interface, evaluate, swap if it
disappoints) was skipped in favour of the swap itself.

The reasoning that makes that defensible, offered as reasoning and not as
evidence: the audience is a Czech doctor reading Czech lab reports, free-tier
models are visibly weaker in Czech than in English, and the text-layer path
asks the model to assign printed cells to columns. `isPrintedOnPage` means a
weak model cannot fabricate a value, but nothing stops it mis-columning one,
and every mis-columned row lands in the verification tab. Past some error rate
"more rows to review" stops being graceful degradation and becomes the demo's
whole story. **That error rate was never measured** — which is the honest gap
here, and where the work would start if this ever needs to run unbillable
again.

What the reversal had to reconstruct is the unbillable property, since the free
tier had been providing it by construction:

- **A hard ceiling, not a rate limit.** `BUDGET_USD_LIMIT` (default $20) bounds
  total spend for the whole site across all visitors for the life of the KV
  namespace. Every call is priced from the token usage the API reports.
- **Freezing degrades rather than breaks.** At the ceiling `/api/extract` and
  `/api/chat` return 402 and the UI disables upload and chat. The pre-baked
  demo keeps working, because serving it costs nothing — the same shape as the
  free tier's "hard-fails rather than billing", reached differently.
- **Everything gating the free-tier design was kept**: Turnstile in front of
  upload, one challenge minting a short-lived HMAC session token, a
  server-side page allowance spent per session, per-IP counters in KV.

What the reversal cost: the key is now a Worker secret, so this is no longer a
deployment you could hand to someone else to host unchanged, and the ceiling is
a budget guard rather than an accounting system — KV is eventually consistent,
so heavy parallel load can overshoot it slightly. Both were judged acceptable
for a demo. Neither would be for a product.

Operationally this all lives in [deploy.md](deploy.md).
