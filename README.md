# Bloodwork Trend Visualizer (demo)

Local tool that extracts structured values from Czech lab-report PDFs and shows
how each analyte develops over time, with a plain descriptive summary of what
changed. The hard part it derisks: **reliably and verifiably** transcribing the
right numbers/units/decimals from varied Czech lab layouts.

> **Privacy — read this first.** Lab reports are sensitive medical data. This
> repository ships **without any sample PDFs or extracted data**: the `samples/`
> PDFs and the entire `data/` directory (extracted JSON, page images, the
> registry) are git-ignored. Bring your own PDFs (drop them in `samples/` or
> upload them in the app). Everything runs locally on your machine.

## How it works

```
PDF (upload or samples/) → render page images (PyMuPDF)
    → Claude vision transcribes each row verbatim (Sonnet 5 + Opus 4.8,
      the two reads run in parallel and cross-check each other)
    → deterministic Python parses decimals/units/ranges & recomputes flags
    → analyte synonym registry lines the same test up across labs
    → reports grouped by patient (rodné číslo)
    → per-analyte trends + rule-based Czech summary + verification UI
```

The LLM only transcribes; **all numeric interpretation is deterministic Python**
(`src/normalize.py`, unit-tested) so a misread decimal can't slip through
silently.

## The two tabs that carry the trust story

- **🔍 Ověření (verification).** The extracted table sits next to the source
  page image. Pick a row and the app crops + highlights exactly where it sits on
  the page (via the PDF text layer — `src/locate.py`, no extra API cost). A
  "jen sporné řádky" toggle filters to the rows that need a human: low
  confidence, model disagreement, or a numeric-looking value that failed to
  parse. Corrections are saved back into the report.
- **🗂️ Namapování (analyte mapping).** Unknown analyte names get a **ranked,
  zero-API suggestion** for what they map to — fuzzy name match plus unit
  compatibility and value plausibility against data already mapped
  (`suggest_mappings` in `src/matching.py`). Each candidate shows its evidence
  (unit, typical value, ✔/✘ checks); one click accepts the top suggestion, and
  the app remembers it for every future report.

## Setup

```sh
# 1. Create venv (Windows-native Python 3.11+) and install deps
py -3.11 -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt

# 2. Add your Anthropic API key
cp .env.example .env          # then edit .env and paste your key

# 3. Seed the analyte registry (already checked in, but to regenerate):
.venv/Scripts/python.exe -m scripts.seed_registry
```

## Run

```sh
# Streamlit UI (upload/process reports, trends, summary, verification)
.venv/Scripts/streamlit.exe run app.py

# Or batch-process from the CLI:
.venv/Scripts/python.exe -m src.pipeline all           # all PDFs in samples/
.venv/Scripts/python.exe -m src.pipeline samples/2025_08.pdf
```

In the UI you can **drag-and-drop your own PDF** (or several) in the sidebar, or
pick one from `samples/`. Uploaded PDFs are saved under `data/uploads/`.
Processing shows live progress and a per-report cost/time readout when done;
already-processed files are detected (by content hash) and skipped rather than
re-billed.

## Web demo (Cloudflare)

A shareable version of this tool runs as a static SPA plus one Worker.
**Live: https://bloodwork-demo.andres-cerny.workers.dev**

```sh
npm install
npm run dev          # SPA against the pre-baked demo data — no key needed
npm test             # 199 unit tests (TS) — no key, no browser
npm run test:e2e     # the built app driven in a real browser
npm run test:live    # real extraction through Claude (~$0.10, needs a key)
npm run deploy       # build, check the bundle, push to Cloudflare
```

Also `python3 tests/test_parity.py` — 58 cases run through **both** the Python
and TypeScript parsing implementations, which must agree.

| Read this | For |
|---|---|
| [docs/constraints.md](docs/constraints.md) | Invariants that break something real if changed blindly |
| [docs/design-notes.md](docs/design-notes.md) | Why the UI looks as it does; what a clinician could not use |
| [docs/deploy.md](docs/deploy.md) | KV, Turnstile, secrets, the spend ceiling |
| [docs/web-demo-plan.md](docs/web-demo-plan.md) | The original design and why each decision went that way |

The site opens on a **pre-baked synthetic dataset** — no API calls, no real
patient — and offers live upload on top of it, gated by Cloudflare Turnstile.
Uploaded PDFs are parsed in the browser and never written to a server, so
closing the tab genuinely ends the session.

Extraction and chat use Claude exactly as the local tool does (Sonnet 5 and
Opus 4.8 cross-checking each other). For **digital PDFs the page image is
never sent**: pdf.js reconstructs the printed rows from the text layer's own
coordinates and Claude assigns columns, so the characters come from the file.
Every returned value is then checked against the printed page — one that is
not there is flagged, never trended. Scans fall back to the 220 DPI vision
path automatically. The key lives as a Worker secret, and a
KV-backed ledger prices every call and **freezes the AI features once total
spend hits a configured ceiling** (default $20) — at which point the pre-baked
demo keeps working.

The deterministic core (`normalize`, `trends`, `summary`) is ported to
TypeScript in `web/src/lib/` so that correcting a value in the verification tab
re-derives its flag, trend and summary live. `web/tests/normalize.test.ts`
mirrors `tests/test_normalize.py` case for case.

Regenerate the demo data, or swap in your own (anonymized and redacted):

```sh
python3 -m scripts.make_demo_data                      # synthetic
python3 -m scripts.export_web_data --name "Jan Ukázka" # your processed reports
```

## Tests

```sh
.venv/Scripts/python.exe tests/test_normalize.py       # deterministic parsing
.venv/Scripts/python.exe tests/test_matching.py        # mapping suggestions
.venv/Scripts/python.exe tests/test_locate.py          # source-row locator
.venv/Scripts/python.exe tests/test_trends_ui.py       # trends tab (Streamlit AppTest)
```

## Accuracy strategy

Every page is transcribed **independently by two models** (Sonnet 5 and Opus
4.8) and the reads are unioned row-by-row. This is what makes it trustworthy:

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

Vision extraction of the full sample set (~37 pages × two models) costs roughly
**~$3 per full run**. Each processed report shows its own token cost and elapsed
time (see `report.stats`; prices in `src/config.py`). API usage is billed to
your Anthropic API key, separately from any Claude subscription.

## Local / self-hosted models (optional)

Claude is the default, but the extractor also speaks to **local or
OpenAI-compatible** vision models (`src/extract_local.py`) using the same Czech
prompt and JSON schema — useful when the data can't leave the building. Select a
backend per role via environment variables (all optional; unset = the Claude
defaults above):

```sh
# Ollama (local): prefix a model tag with "ollama:"
BLOODWORK_MODEL_PRIMARY=ollama:qwen2.5vl:7b
BLOODWORK_MODEL_ESCALATION=none        # "none" disables the second read

# vLLM / any OpenAI-compatible server: prefix with "openai:" and set the URL
BLOODWORK_MODEL_PRIMARY=openai:Qwen2.5-VL-7B-Instruct
BLOODWORK_LOCAL_URL=http://localhost:8000/v1
```

You can also run **hybrid** (e.g. a local primary read cross-checked by Claude).
On a CPU-only laptop local vision is slow (minutes per page) — it's meant for
accuracy validation; for real throughput use a GPU server behind the `openai:`
backend.

## Notes / scope

- Local demo — no auth, no database, no cloud. Data lives in `data/` as JSON.
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
