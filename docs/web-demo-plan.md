# Web demo hosting plan — Cloudflare

Plan for publishing the bloodwork visualizer as a link-shareable demo that works
on phone and desktop, hosted on Cloudflare with no custom domain.

Status: **proposed** — not yet started. `main` is untouched; this document and
all subsequent work live on `claude/web-app-demo-hosting-ymbgkc`.

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

- **No Anthropic key in the deployment.** Not in the browser bundle, not as a
  Worker secret. Extraction already happened.
- **No runtime extraction cost.** A stranger clicking around costs nothing,
  because there is nothing to bill.
- **No uploads, no storage, no access code, no KV budget ceiling.** All of that
  existed to make live upload safe. There is no live upload.
- **No pdf.js.** Page images are pre-rendered and row bounding boxes are
  pre-computed, so the browser draws a highlight rectangle over a PNG.

The only runtime API call in the entire product is the chat, on a free-tier
model whose key lives as a Worker secret and which cannot bill you.

## Architecture

```
BUILD TIME (your machine, existing Python)      RUNTIME (public, static)
------------------------------------------      ------------------------
PDFs
  → src/pipeline.py  (Sonnet 5 + Opus 4.8)      Worker with static assets
  → src/normalize.py (values, units, flags)       ├─ SPA  (the four tabs)
  → src/locate.py    (row bboxes, px coords)      └─ /api/chat → free model
  → anonymize + redact                                          (Worker secret)
  → JSON + page PNGs  ──────────────────────▶   fetched as static JSON
```

`row_bbox` in `src/locate.py` already returns pixel coordinates in image space
(it scales PDF points by `RENDER_DPI / 72`), so the boxes map 1:1 onto the
cached PNGs with no further work at runtime.

### Hosting

A single Worker with the static-assets binding serves the built SPA and the one
`/api/chat` route from one deployment. Free plan: 100k requests/day on Workers,
10,000 Neurons/day on Workers AI.

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
| `src/locate.py` | **precomputed** | Bboxes emitted as pixel coords in the JSON. No pdf.js. |
| `src/extract.py`, `ingest.py`, `pipeline.py`, `process.py`, `storage.py` | **build time only** | Unchanged. They run on your machine and never ship. |
| `app.py` | `web/src/ui/*` | 37KB of Streamlit → components. Altair → a JS charting layer. |

About 17KB of pure, already-unit-tested logic to port. The tests port with it,
so parity is asserted rather than assumed.

## Chat

New subsystem — nothing in the repo today.

**Model: Cloudflare Workers AI free tier.** On-platform, no extra credentials,
10,000 Neurons/day, and it hard-fails rather than billing when exhausted. Key
lives as a Worker secret, never in the browser.

**Design note: prefer context injection over tool-calling.** Free-tier models
handle multi-step tool use poorly, and a chat that fumbles its tool calls in
front of a doctor is worse than no chat. The dataset is small and already
structured, so inject the relevant normalized values directly into the prompt
and constrain the model to quoting only numbers it was given. Same guarantee the
tool-calling design was reaching for, more reliably, on a weaker model.

**Open risk: Czech quality.** This is a Czech demo for a Czech doctor, and
free-tier models are visibly weaker in Czech than in English. Build the chat
behind a thin provider interface and evaluate Workers AI's Czech on real
questions about this dataset. If it disappoints, the interface lets us swap to
another free tier (Google AI Studio's Gemini free tier is the obvious
alternative — separate key, still a Worker secret, still no billing) without
touching the UI.

**Light per-IP throttle.** Not for cost — cost is structurally zero — but so one
abuser cannot burn the daily Neuron allowance an hour before you demo.

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

### Phase 4 — chat

Worker route, provider interface, context injection, Czech quality evaluation,
per-IP throttle.

### Phase 5 — deploy

Wrangler config, build pipeline, the Workers AI binding, deploy, verify on a
real phone and a real desktop.

## Risks

| Risk | Mitigation |
| --- | --- |
| Patient identifiers surviving into the public build | Redaction plus a build-time check that fails the build, not a manual review step. |
| Free-tier chat's Czech is too weak | Provider interface; evaluate before deploy; swap tiers if needed. |
| Port drift in the deterministic core | Ported tests are the contract. |
| Demo looks static / canned | Live correction re-derivation and mapping acceptance are genuinely interactive, and they are the parts a doctor cares about. |

## Out of scope

Live upload, auth, a database, cross-session persistence, custom domain,
production security hardening. This is a demo.
