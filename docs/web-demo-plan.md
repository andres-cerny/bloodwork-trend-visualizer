# Web demo hosting plan — Cloudflare

Plan for turning the local Streamlit tool into a link-shareable web demo that
works on phone and desktop, hosted on Cloudflare with no custom domain.

Status: **proposed** — not yet started. `main` is untouched; this document and
all subsequent work live on `claude/web-app-demo-hosting-ymbgkc`.

## Goal

A URL (`*.pages.dev` / `*.workers.dev`) that can be sent to a doctor, opened on
a phone, and used to see the product's story end to end: upload lab PDFs, watch
them get transcribed and verified, explore trends, ask the chat about them.
When the tab closes, the data is gone.

## Constraints

| Constraint | Consequence |
| --- | --- |
| No custom domain | Ship on the platform-provided subdomain. |
| Uploaded PDFs vanish on close | No server-side persistence at all. |
| Chat must not cost money when strangers use it | Free-tier model for ungated visitors. |
| Demo, not production | No auth system, no database, no audit trail. |

## Assumptions

These resolve the questions left open in discussion. Each is a default that can
be flipped without reshaping the plan.

1. **Live upload is gated behind an access code.** Ungated visitors get the
   pre-baked demo dataset. The code is the same one that unlocks Claude-quality
   chat, so it is one mechanism, not two.
2. **A daily token ceiling is enforced in Workers KV.** Invisible to trusted
   users; converts the worst case from an unbounded Anthropic bill into a
   "demo limit reached" message.
3. **The pre-baked dataset is anonymized before it ships.** See
   [Demo dataset](#phase-4--demo-dataset-and-gate).
4. **UI stays Czech.** Same copy as the Streamlit app.

## Target architecture

Nothing touches a server disk. The Worker is a keyholder and a rate limiter,
never a store.

```
Browser                                  Cloudflare Worker            Anthropic
-------                                  -----------------            ---------
pdf.js renders page N at ~220 DPI
  → JPEG, downscaled for the model
  → POST /api/extract  ─────────────────▶ inject API key
                                          check KV daily budget
                                          fan out to Sonnet 5 ────────▶
                                                  + Opus 4.8 ─────────▶
                        ◀───────────────  union rows, mark disagreement
normalize.ts parses decimals/units
  recomputes low/normal/high flags
  → state in memory + sessionStorage
  → closing the tab ends it
```

The privacy claim this buys is stronger than the current one and it is literally
true: the PDF never leaves the browser as a file. Only rendered page images go
out, to Anthropic, for transcription.

### Why the browser does the rendering

Cloudflare Workers cannot run PyMuPDF — the runtime is JS/Wasm, not CPython with
native extensions. Moving page rendering to pdf.js removes the dependency
entirely rather than working around it, and it is what makes the zero-storage
design possible.

### Hosting shape

A single Worker with the static-assets binding serves the built SPA and the
`/api/*` routes from one deployment. (Pages + Functions is equivalent; the
single Worker is the currently recommended path and keeps one wrangler config.)

Free plan covers this: 100k requests/day on Workers, 10,000 Neurons/day on
Workers AI, which hard-fails rather than bills when exhausted.

## Port inventory

The deterministic core is the trust story — it is the reason a misread decimal
cannot silently become a trend line. It ports as pure functions with its tests.

| Python | Target | Notes |
| --- | --- | --- |
| `src/normalize.py` | `web/src/lib/normalize.ts` | Decimal/unit/range parsing, flag recomputation. Pure. Port tests for parity. |
| `src/matching.py` | `web/src/lib/matching.ts` | `suggest_mappings` — fuzzy name + unit compatibility + value plausibility. Pure, zero-API. |
| `src/trends.py` | `web/src/lib/trends.ts` | `build_trends`, `latest_two`. Small and pure. |
| `src/summary.py` | `web/src/lib/summary.ts` | Rule-based Czech summary. Pure. |
| `src/models.py` | `web/src/lib/models.ts` | Dataclasses → interfaces. The `*_raw` vs derived split must survive the port intact. |
| `src/locate.py` | `web/src/pdf/locate.ts` | **Rewrite**, not port: PyMuPDF text layer → pdf.js `getTextContent()`. Same bbox concept. |
| `src/extract.py` | split | Prompt + schema → Worker. Two-model union, retry, completeness check → Worker. Page loop → browser. |
| `src/ingest.py`, `pipeline.py`, `process.py`, `storage.py` | dropped | Replaced by the in-browser session store. |
| `app.py` | `web/src/ui/*` | 37KB of Streamlit → components. Altair → a JS charting layer. |
| `scripts/seed_registry.py` | keep in Python | Build-time step; emits a JSON asset. |

Roughly 25KB of pure logic to port, all of it already unit-tested.

## Phases

### Phase 0 — spike

Prove the risky part before committing to the port. Build a throwaway page that
renders one PDF with pdf.js and sends one page through Claude vision via a
minimal Worker.

Answers: does in-browser rendering match PyMuPDF's output quality closely enough
that extraction accuracy holds, and what does a 37-page report cost in time and
memory **on an actual phone**.

Exit criteria: one page round-trips with rows matching the Python pipeline's
output for the same page; phone memory profile is known.

### Phase 1 — port the deterministic core

`normalize`, `matching`, `trends`, `summary`, `models` to TypeScript, with the
existing test suites ported alongside. Parity is provable: same inputs, same
outputs as the Python tests assert today.

No UI, no network. This phase is finished when the TS tests pass.

### Phase 2 — extraction pipeline

Worker routes (`/api/extract`), KV budget counter, two-model union with
disagreement marking, retry/backoff, per-page fan-out from the browser with live
progress. Port `locate.ts` against pdf.js here since verification depends on it.

### Phase 3 — the UI

Four tabs, responsive, mobile-first:

- **Trendy** — per-analyte charts with reference bands.
- **Souhrn změn** — rule-based Czech summary.
- **Ověření** — extracted table beside the source page image, row click crops
  and highlights the source region, "jen sporné řádky" filter, inline
  correction. This is the tab that most justifies leaving Streamlit: it is a
  side-by-side layout that Streamlit handles badly on a phone.
- **Namapování analytů** — ranked suggestions with their evidence, one-click
  accept, remembered for later reports.

### Phase 4 — demo dataset and gate

**Anonymize before anything ships.** The current `data/` and `samples/` contents
are real patient data — real names, real rodné číslo — which is exactly why they
are git-ignored today. Baking them into a deploy means committing them and
serving them from a public URL.

The anonymization: substitute names, synthesize valid-format rodné číslo, shift
dates by a constant offset. Analytes, values, units, ranges, flags, model
disagreements and page images stay as they are — everything a doctor evaluates
is preserved, and the demo stops carrying a real person's medical history.

Then the gate: access code check, pre-baked dataset for ungated visitors, live
upload for code holders.

### Phase 5 — chat

New subsystem — nothing in the repo today. Tool-calling over the already
extracted, already normalized data, so every number the chat states is read from
the deterministic layer rather than generated.

- Code holders → Claude.
- Ungated → Workers AI free tier.

Same tool definitions behind both; only the model swaps. Czech output from the
free model will be visibly weaker, which is the reason for the tiering.

### Phase 6 — deploy

Wrangler config, build pipeline, secrets, deploy, verify on a real phone and a
real desktop.

## Risks

| Risk | Mitigation |
| --- | --- |
| Mobile memory on long reports at 220 DPI | Sequential rendering, concurrency cap, downscale for the model, JPEG not PNG. Measured in Phase 0. |
| pdf.js rendering differs enough to hurt extraction accuracy | Phase 0 compares against the Python pipeline on the same pages before any port work starts. |
| Port drift in the deterministic core | Ported tests are the contract; parity is asserted, not assumed. |
| Free-tier chat quality undercuts the demo | Tiering — the doctor sees Claude. |
| Link leaks and upload is abused | Access code plus KV daily ceiling. |

## Out of scope

Real auth, a database, multi-user accounts, cross-session persistence,
production security hardening, custom domain. This is a demo.
