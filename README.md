# Bloodwork — two apps over one clinical agent

Two web demos sharing an agent backend.

- **Bloodwork visualizer** — reads Czech lab-report PDFs, verifies every value
  against the printed page, and shows how each parameter develops over time.
  The hard part it derisks: **reliably and verifiably** transcribing the right
  numbers, units and decimals from varied Czech lab layouts.
- **Clinical agent** — a chat UI that answers questions about a patient, reaches
  for the data with tools, and can propose a chart. It holds no lab code: every
  number it shows arrived through the agent from the deterministic layer.

> **Privacy — read this first.** Lab reports are sensitive medical data. This
> repository ships **without any sample PDFs or extracted data**: `samples/*.pdf`
> and the whole `data/` directory are git-ignored, and a commit hook refuses to
> stage them. Bring your own PDFs. Everything runs on your machine.

## Layout

```
apps/bloodwork   the visualizer          workers/agent    chat, tools, streaming
apps/chat        the clinical agent      workers/extract  PDF -> JSON
packages/        lab-core, agent/*, gate, ui-kit, api-client
tools/pipeline   the Python CI needs     evals/           the agent's regression suite
```

Packages are consumed as raw TypeScript — there is no build step. Vite,
wrangler's esbuild and Vitest all compile `.ts` directly.

## How extraction works

```
PDF (upload) → rows from the page's own text layer, or a rendered image for scans
    → Claude transcribes each row verbatim (Sonnet 5 + Haiku 4.5, the two
      reads run in parallel and cross-check each other)
    → deterministic TypeScript parses decimals/units/ranges & recomputes flags
    → analyte synonym registry lines the same test up across labs
    → per-parameter trends + rule-based Czech summary + verification UI
```

The LLM only transcribes; **all numeric interpretation is deterministic**
(`packages/lab-core`, unit-tested against the Python original) so a misread
decimal cannot slip through silently.

## The two tabs that carry the trust story

- **🔍 Ověření (verification).** The extracted table sits next to the source
  page image. Pick a row and the app crops + highlights exactly where it sits on
  the page (via the PDF text layer, no extra API cost). A
  "jen sporné řádky" toggle filters to the rows that need a human: low
  confidence, model disagreement, or a numeric-looking value that failed to
  parse. Corrections are saved back into the report.
- **🗂️ Namapování (analyte mapping).** Unknown analyte names get a **ranked,
  zero-API suggestion** for what they map to — fuzzy name match plus unit
  compatibility and value plausibility against data already mapped
  (`suggestMappings` in `packages/lab-core`). Each candidate shows its evidence
  (unit, typical value, ✔/✘ checks); one click accepts the top suggestion, and
  the app remembers it for every future report.

## Setup

```sh
npm install
```

That is the whole setup for both apps and all four Workers.

Python is only needed to regenerate the demo data or run the parity tests:

```sh
python3.11 -m venv .venv-mac && .venv-mac/bin/pip install -r tools/pipeline/requirements.txt
```

## Run

```sh
npm run dev:extract     # :8787   ┐ one terminal each; wrangler connects
npm run dev:agent       # :8788   ┘ siblings through its dev registry
npm run dev:bloodwork   # Vite, proxying /api to both
npm run dev:chat        # the agent UI
```

Set `ANTHROPIC_API_KEY`, `TURNSTILE_SECRET_KEY` and `SESSION_SECRET` in
`workers/*/.dev.vars` for the AI routes. Turnstile publishes test keys that
always pass — see [docs/deploy.md](docs/deploy.md).

## The demos

**Live: https://bloodwork-demo.andres-cerny.workers.dev**

Both open on a **pre-baked synthetic dataset** — no API calls, no real patient —
and offer live use on top of it, gated by Cloudflare Turnstile. Uploaded PDFs
are parsed in the browser and never written to a server, so closing the tab
genuinely ends the session.

Uploads are read **concurrently**, sharing one global limit of in-flight
extraction requests, and rows appear as each page lands rather than when the
file finishes. The measurements, and the four hypotheses that turned out not to
matter, are in [docs/extraction-speed.md](docs/extraction-speed.md).

For **digital PDFs the page image is never sent**: pdf.js reconstructs the
printed rows from the text layer's own coordinates and Claude assigns columns,
so the characters come from the file. Every returned value is checked against
the printed page — one that is not there is flagged, never trended. Scans fall
back to a 220 DPI vision path automatically.

Keys live as Worker secrets, and a KV-backed ledger prices every call and
**freezes the AI features once spend hits a configured ceiling**, per
capability, at which point the pre-baked demo keeps working.

| Read this | For |
|---|---|
| [CLAUDE.md](CLAUDE.md) | The map, and the three rules that break something real |
| [docs/constraints.md](docs/constraints.md) | Invariants that break something real if changed blindly |
| [apps/bloodwork/docs/design-notes.md](apps/bloodwork/docs/design-notes.md) | Why the UI looks as it does; what a clinician could not use |
| [docs/deploy.md](docs/deploy.md) | Four Workers, secrets, service bindings, the spend ceiling |
| [docs/extraction-speed.md](docs/extraction-speed.md) | Why upload is fast, and the four hypotheses that died |
| [docs/archive/](docs/archive/README.md) | Plans that were carried out — history, not description |

## Tests

```sh
npm test             # unit tests across every package — no key, no browser
npm run typecheck    # every app, package and worker
npm run docs:check   # docs that contradict the code fail here
npm run test:audit   # every screen × width × palette, checked for layout flaws
npm run test:e2e     # the built app driven in a real browser
npm run test:all     # all of the above, plus parity and the bundle guards
```

These cost money and are outside the default run:

```sh
npm run test:live    # real extraction through Claude (~$0.10, needs a key)
npm run eval         # the agent's regression cases (see evals/CONTEXT.md)
npm run bench:stage0 # extraction sweeps
```

**The parsing layer exists twice** — Python for the pipeline, TypeScript for the
browser — and 58 shared cases run through both:

```sh
cd tools/pipeline && python3 tests/test_parity.py
```

Regenerate the demo data, or swap in your own (anonymized and redacted):

```sh
cd tools/pipeline
python3 -m scripts.make_demo_data                      # synthetic
python3 -m scripts.export_web_data --name "Jan Ukázka" # your processed reports
```

## Accuracy strategy

Every page is transcribed **independently by two models** (Sonnet 5 and Haiku
4.5) and the reads are unioned row-by-row. This is what makes it trustworthy:

- **Agreement** on a value → marked high-confidence.
- **Disagreement** → the row is flagged for review (verification tab).
- A row **only one model saw** → flagged for review. This catches *silent
  under-extraction* (a model occasionally drops most of a page and returns it
  with high confidence) — the failure a per-row confidence score alone misses.
- If one read returns far fewer rows than the other, that read is **retried**
  (the two models act as each other's completeness expectation).
- The two reads run **concurrently**, and pages are processed **in parallel**,
  so a report finishes in a fraction of the old serial wall-clock time. A page
  that fails even after retries is skipped (and noted) rather than failing the
  whole report; transient API errors are retried with backoff.

The lab's own out-of-range markers (`!`, `(X)`) are ignored; the normal/low/high
flag is recomputed in Python from the value vs. the parsed reference range.

## Cost

Extraction prices every call from the token usage the API reports; the pricing
table lives in `packages/agent/core/src/pricing.ts` and mirrors the Python one.
A full run over the sample corpus is roughly **$1**, and each processed report
shows its own cost and elapsed time. Usage is billed to your Anthropic API key,
separately from any Claude subscription.

The deployed demos are bounded rather than trusted: a KV-backed ledger freezes
each capability at its own ceiling. See [docs/deploy.md](docs/deploy.md).

## Local / self-hosted models

The retired Streamlit pipeline could also drive local or OpenAI-compatible
vision models through the same Czech prompt and schema, which is useful when the
data cannot leave the building. That code is in `tools/archive/extract_local.py`
and is **not wired into the Workers** — the deployed demos call Claude only.

The reasoning behind that choice, including the fact that it was never measured,
is recorded in [docs/archive/web-demo-plan.md](docs/archive/web-demo-plan.md).
It matters the day a demo has to run unbillable.

## Notes / scope

- The deployed demos have no auth and no database; a session lives in the
  browser and ends with the tab. The local pipeline writes JSON to `data/`.
- **Multiple patients:** reports are grouped by rodné číslo (name as fallback);
  a selector at the top scopes every tab to one patient. The rodné číslo is
  masked by default with a reveal toggle.
- Patient name + rodné číslo are stored and shown (used as a same-person sanity
  check on ingest). Note the source PDFs and `data/` JSON contain real personal
  medical data — keep them off any shared/remote location.
- Censored values (`<1,0`) and qualitative ones (`neprovedeno`) are kept
  verbatim and deliberately never turned into an invented trend number.
- Each trend table can be exported to CSV.

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE):
free to use, modify, and share **for any noncommercial purpose** (personal,
research, education, nonprofits, government). Commercial use is not permitted
without a separate license — contact the author.
