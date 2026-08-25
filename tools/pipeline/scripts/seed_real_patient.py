"""Seed the one real patient record — Ondřej's own — into the sport practice.

Sport patient #6 is not synthetic. By his explicit 2026-08-23 decision (the
decision table in ``docs/plans/chat-demo.md``) his own lab reports and
performance evaluations are the sixth record in the ``sport`` demo. This script
is the only path that produces them, and it exists as a separate script from
``make_chat_demo.py`` for one reason: **nothing it reads or writes may ever
enter git**. Its inputs are ``samples/`` and ``samples/performance/``, its
outputs land in ``data/real_seed/``, and both trees are git-ignored and refused
by ``.claude/hooks/privacy-guard.mjs``. The committed corpus stays synthetic;
this output is applied to the remote database and evidence store at deploy time
and never committed. Do not add its outputs to the repo, and do not teach
``make_chat_demo.py`` about this patient.

    cd tools/pipeline && python3 -m scripts.seed_real_patient               # sport
    cd tools/pipeline && python3 -m scripts.seed_real_patient --tenant csm  # csm

Outputs (all git-ignored):
    data/real_seed/pages/<sha16>.png   content-addressed page images, 220 DPI
    data/real_seed/kv_bulk.json        the same images as a KV upload manifest
    data/real_seed/seed_real.sql       scoped INSERTs for p-cerny-1999

Then, from ``workers/agent`` — evidence first, so no row can point at an image
that is not there yet:
    npx wrangler kv bulk put ../../data/real_seed/kv_bulk.json \
        --namespace-id <EVIDENCE id> --remote
    npx wrangler d1 execute bloodwork-chat-sport --remote \
        --file ../../data/real_seed/seed_real.sql -y

``--tenant csm`` is the same record for the CSM tenant (docs/plans/csm-demo.md
Phase 2, real half), written to its own tree so the two seeds never overwrite
each other:
    data/real_seed_csm/pages/<sha16>.png
    data/real_seed_csm/kv_bulk.json
    data/real_seed_csm/seed_real_csm.sql

    npx wrangler kv bulk put ../../data/real_seed_csm/kv_bulk.json \
        --namespace-id <EVIDENCE id> --remote
    npx wrangler d1 execute bloodwork-chat-csm --remote \
        --file ../../data/real_seed_csm/seed_real_csm.sql -y

The csm seed adds what the sport tenant never had: the tHb Measurement Logs
from ``samples/thbmass/`` as documents, a derived ``visits`` spine over every
artifact date, and ``perf_metrics`` rows transcribed — verbatim, no
computation, no unit conversion — from the git-ignored, hand-verified
``data/csm-real/perf_documents.json`` and ``thb_series.json`` (see
``data/csm-real/VERIFY.md``). Entries flagged ``needs_ocr`` are skipped, and a
same-date conflict is resolved in favour of the zpráva document, with the
choice named (values never printed) in the run summary. Visit kinds and
titles, and the closed metric list, are imported from ``make_csm_demo`` — the
same single-home rule as ``direction_of`` and ``body_norm``.

The evidence store is the KV namespace bound as ``EVIDENCE`` in
``workers/agent/wrangler.jsonc`` (R2 would need a dashboard opt-in this account
has not made, and a page PNG sits far under KV's 25 MB value cap).

Where the numbers come from
---------------------------
The lab PDFs go through the **archived extraction pipeline** in
``tools/archive`` — Claude vision transcribes what is printed, and every
derived number is computed afterwards by ``src/normalize.py``, exactly as the
Streamlit tool did. The archive's own JSON store (``data/reports/``) is its
cache: a PDF whose content hash already has a stored report is not sent to the
API again, but its measurements are re-run through ``process_measurements`` so
normalisation, analyte matching and unit conversion are always the *current*
deterministic code, never whatever was current when the report was first read.
``--force-extract`` re-extracts regardless; ``COST_CAP_USD`` stops the run
before it can spend more than a couple of dollars either way.

Row boxes come from ``tools/archive/locate.py``'s ``search_for`` path against
the real text layer — a citation crop in the chat UI is therefore drawn on a
box that was actually measured on the actually rendered page, the same rule the
synthetic corpus follows.

Performance documents are not extracted at all: PyMuPDF's ``get_text`` is the
body text, because these PDFs carry their own text layer and a model would only
be a chance to paraphrase. Four of them are image-only scans with no text layer;
they are skipped and named in the run summary rather than OCR'd or invented.

The derived tables are not a second source of truth. ``direction_of`` is
imported from ``make_chat_demo`` and ``body_norm`` from ``make_chat_docs`` —
each rule has exactly one home, and a real patient must not get a second copy
of it that could drift from the synthetic one.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import shutil
import sys
import types
import unicodedata
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[3]

from scripts.make_chat_demo import direction_of, normalize_name, sql_num, sql_str  # noqa: E402
from scripts.make_chat_docs import body_norm  # noqa: E402
from src.config import RENDER_DPI  # noqa: E402
from src.matching import Registry, load_registry  # noqa: E402
from src.models import LabReport  # noqa: E402

# The archive imports its shared modules as siblings (``from .config import``),
# but those five modules were kept in ``tools/pipeline/src`` when the Streamlit
# tool was archived. Rather than copy them or rewrite the archive's imports,
# give the two directories one package name with a two-entry ``__path__``: a
# relative import inside the archive then finds ``src/config.py`` exactly as it
# found it before the split. This is the whole of the archive integration.
_ARCHIVE = types.ModuleType("archive_pipeline")
_ARCHIVE.__path__ = [str(ROOT / "tools" / "archive"), str(ROOT / "tools" / "pipeline" / "src")]
sys.modules["archive_pipeline"] = _ARCHIVE

from archive_pipeline.ingest import report_id_for  # noqa: E402
from archive_pipeline.locate import row_bbox  # noqa: E402
from archive_pipeline.process import process_measurements  # noqa: E402
from archive_pipeline.storage import load_report, report_exists  # noqa: E402

SAMPLES = ROOT / "samples"
PERF = SAMPLES / "performance"
THB = SAMPLES / "thbmass"
CSM_REAL = ROOT / "data" / "csm-real"
OUT = ROOT / "data" / "real_seed"
PAGES = OUT / "pages"

TENANT = "sport"

# Stop before the extraction can become an expensive accident. Cached reports
# cost nothing, so this only ever bites on a genuinely new or forced run.
COST_CAP_USD = 2.50

# The patient. His name and birth date are here because the demo has to find
# him by them, and because he chose to be findable. Nothing clinical is: see
# DOC_META below.
PID = "p-cerny-1999"
FULL_NAME = "Ondřej Černý"
BIRTH_DATE = "1999-03-04"
SEX = "m"

# Per-document metadata — deliberately NOT in this file.
#
# Each entry names a document's date, kind and Czech title, all read off the
# PDF itself. A document's title names the examination someone had, which is a
# health fact about a named person, and this script is committed: the titles
# would say in git exactly what the page images are kept out of git to avoid
# saying. So they live beside the PDFs, in the same git-ignored tree, and the
# seeder refuses to invent them.
#
# Shape:
#   {"note": "<the patients.note line>",
#    "documents": {"<file in samples/performance>": {
#        "id": "<suffix after d-cerny->", "kind": "perf_eval|physio_note|
#        imaging|op_report", "date": "YYYY-MM-DD", "title": "<Czech title>"}}}
#
# The date is the examination date the document prints, not the signature date
# and not the filename, wherever those disagree. Running without this file
# writes a template next to it and stops.
DOC_META = ROOT / "data" / "real_seed_docs.json"


def load_doc_meta() -> tuple[str, dict[str, dict[str, str]]]:
    """The note and the per-document table, or a template and a hard stop."""
    if not DOC_META.exists():
        template = {
            "_comment": "Fill in kind, date and title from each PDF. Not for git.",
            "note": "",
            "documents": {
                unicodedata.normalize("NFC", p.name):
                    {"id": "", "kind": "perf_eval", "date": "", "title": ""}
                for p in sorted(PERF.glob("*.pdf"))
            },
        }
        DOC_META.write_text(json.dumps(template, ensure_ascii=False, indent=2),
                            encoding="utf-8")
        raise SystemExit(
            f"wrote a template to {DOC_META} — fill in each document's printed "
            f"date, kind and title (and the patient note) and run again. It is "
            f"git-ignored, and it is the only place that metadata may live.")
    meta = json.loads(DOC_META.read_text(encoding="utf-8"))
    return meta.get("note", ""), meta.get("documents", {})


# --- pages -------------------------------------------------------------------
def render_page(page: pymupdf.Page) -> tuple[str, int, int]:
    """Render one page at 220 DPI and store it under its own content hash.

    Content-addressed for two reasons: re-running the seed overwrites rather
    than accumulating, and the evidence key is unguessable — which is the only
    thing standing between a real page image and anyone who tries
    ``/api/evidence/page_1.png``.
    """
    zoom = RENDER_DPI / 72.0
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    data = pix.tobytes("png")
    name = f"{hashlib.sha256(data).hexdigest()[:16]}.png"
    (PAGES / name).write_bytes(data)
    return name, pix.width, pix.height


def widen_to_row(page: pymupdf.Page, box: tuple[float, float, float, float],
                 zoom: float) -> list[float]:
    """Grow an analyte-name box rightwards across its printed row.

    ``locate.row_bbox`` finds where the *name* is printed. A doctor checking a
    citation is checking the number, and a box drawn around the word
    "Hemoglobin" frames the only part they already believe — so the box is
    extended across the words that share the line, stopping at a gap wide
    enough to mean a different column of the page rather than the next cell of
    this row.
    """
    x0, y0, x1, y1 = (v / zoom for v in box)  # back to PDF points
    yc = (y0 + y1) / 2
    line = sorted(
        (w for w in page.get_text("words") if w[1] <= yc <= w[3] and w[2] > x1),
        key=lambda w: w[0],
    )
    for wx0, wy0, wx1, wy1, *_ in line:
        if wx0 - x1 > 120:  # a gap this wide is another column, not this row
            break
        x1, y0, y1 = max(x1, wx1), min(y0, wy0), max(y1, wy1)
    return [round(v * zoom, 1) for v in (x0, y0, x1, y1)]


# --- labs --------------------------------------------------------------------
def extract_lab(pdf: Path, registry: Registry, spent: list[float],
                force: bool) -> tuple[LabReport, str]:
    """The archived pipeline for one lab PDF. Returns (report, how)."""
    rid = report_id_for(pdf)
    if not force and report_exists(rid):
        report = load_report(rid)
        # Deterministic post-processing, re-run against today's normalize.py
        # and registry so a cached transcription cannot carry an outdated
        # unit conversion or analyte mapping into the demo. Free, and the only
        # part of the pipeline that is allowed to change under a stored report.
        process_measurements(report.measurements, registry)
        return report, "cached"

    if spent[0] >= COST_CAP_USD:
        raise RuntimeError(f"cost cap ${COST_CAP_USD:.2f} reached")
    # Imported here, not at module scope: a run that hits the cache for every
    # PDF — the normal case — needs neither the API key nor the SDK.
    from archive_pipeline.pipeline import ingest_and_extract

    report, _unmatched = ingest_and_extract(pdf, registry, progress=lambda m: print("   ·", m))
    spent[0] += float((report.stats or {}).get("cost_usd") or 0.0)
    return report, f"extracted (${(report.stats or {}).get('cost_usd', 0):.2f})"


def lab_payload(report: LabReport, pdf: Path, report_id: str) -> dict:
    """One LabReport in the shape the demo's reports.json holds."""
    doc = pymupdf.open(pdf)
    zoom = RENDER_DPI / 72.0
    pages, sizes = [], {}
    for i, page in enumerate(doc, start=1):
        name, w, h = render_page(page)
        sizes[i] = (name, w, h)
        pages.append({"pageNum": i, "imageUrl": f"/api/evidence/{name}",
                      "imageWidth": w, "imageHeight": h})

    seen: dict[tuple[int, str], int] = {}
    measurements = []
    for m in report.measurements:
        page_num = m.source_page if m.source_page in sizes else 1
        key = (page_num, m.raw_analyte_name)
        occurrence = seen.get(key, 0)
        seen[key] = occurrence + 1
        box = row_bbox(pdf, page_num, m.raw_analyte_name, occurrence)
        d = m.to_dict()
        measurements.append({
            "rawAnalyteName": d["raw_analyte_name"],
            "valueRaw": d["value_raw"],
            "unitRaw": d["unit_raw"],
            "refRangeRaw": d["ref_range_raw"],
            "sourceSnippet": d["source_snippet"],
            "sourcePage": page_num,
            "confidence": d["confidence"],
            "canonicalId": d["canonical_id"],
            "value": d["value"],
            "unit": d["unit"],
            "refRangeLow": d["ref_range_low"],
            "refRangeHigh": d["ref_range_high"],
            "refRangeText": d["ref_range_text"],
            "flag": d["flag"],
            "extractedBy": d["extracted_by"],
            "escalated": d["escalated"],
            "disagreement": d["disagreement"],
            "corrected": d["corrected"],
            "bbox": widen_to_row(doc[page_num - 1], box, zoom) if box else None,
        })
    doc.close()

    return {
        "id": report_id,
        "patientRef": PID,
        "sourceFile": report.source_file,
        "reportDate": report.report_date,
        "labName": report.lab_name,
        "patientName": report.patient_name,
        "patientId": report.patient_id,
        "pages": pages,
        "measurements": measurements,
    }


# --- documents ---------------------------------------------------------------
def build_document(pdf: Path, meta: dict[str, dict[str, str]]) -> dict | None:
    """One performance document, or None if the PDF is an image-only scan.

    A scan has no text layer, so it has no body to search and nothing this
    script could honestly put in ``body_text``. It is skipped whole — page
    images without a searchable body would be evidence for a document the
    agent can never find.
    """
    doc = pymupdf.open(pdf)
    texts = [(page.get_text("text") or "").strip() for page in doc]
    if not any(texts):
        doc.close()
        return None
    # The text-layer test comes first: a scan is skipped on its own evidence,
    # so DOC_META only has to describe documents that will actually be seeded.
    # NFC on the name because macOS hands filenames back decomposed, and
    # "pásma" written in NFC on the other side would never match.
    entry = meta.get(unicodedata.normalize("NFC", pdf.name))
    if not entry or not all(entry.get(k) for k in ("id", "kind", "date", "title")):
        doc.close()
        raise SystemExit(
            f"{pdf.name}: no complete entry in {DOC_META.name}. Add its printed "
            f"date, kind and heading rather than letting the seeder guess.")

    pages = []
    for i, page in enumerate(doc, start=1):
        name, w, h = render_page(page)
        pages.append({"pageNum": i, "imageUrl": f"/api/evidence/{name}",
                      "width": w, "height": h})
    doc.close()

    return {
        "id": f"d-cerny-{entry['id']}",
        "docDate": entry["date"],
        "kind": entry["kind"],
        "title": entry["title"],
        "bodyText": "\n".join(texts),
        "pages": pages,
    }


# --- csm: tHb logs, visits, perf metrics -------------------------------------
# When two documents of one visit print the same metric, the one earlier in
# this list wins (VERIFY.md's rule: the zpráva is the clinic's own summary of
# the visit; device exports and companion headers defer to it). It also orders
# the pick of a visit's note document.
DOCTYPE_PREFERENCE = [
    "lekarska_zprava", "tvl_dekurz", "funkcni_vysetreni", "cpet_export_olymp",
    "spirometrie", "physioflow", "ekg_klidove", "moxy_export",
    "echokardiografie", "thb_measurement_log", "xlsx",
]


def build_thb_document(pdf: Path) -> dict:
    """One CO-rebreathing Measurement Log from ``samples/thbmass/``.

    These exports carry their own text layer, their own printed header (the
    title) and their own ``Date of measurement`` line — so unlike the
    performance documents they need no DOC_META entry: everything the row
    needs is read off the page, nothing is invented and nothing date-like has
    to live in a committed file.
    """
    doc = pymupdf.open(pdf)
    texts = [(page.get_text("text") or "").strip() for page in doc]
    body = "\n".join(texts)
    if not body:
        doc.close()
        raise SystemExit(f"{pdf.name}: no text layer — a tHb log should have one")
    m = re.search(r"Date of measurement\s*\n?\s*(\d{2})\.(\d{2})\.(\d{4})", body)
    if not m:
        doc.close()
        raise SystemExit(f"{pdf.name}: no 'Date of measurement' line found")
    date = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    title = next(line.strip() for line in body.splitlines() if line.strip())

    pages = []
    for i, page in enumerate(doc, start=1):
        name, w, h = render_page(page)
        pages.append({"pageNum": i, "imageUrl": f"/api/evidence/{name}",
                      "width": w, "height": h})
    doc.close()
    return {
        "id": f"d-cerny-thb-{date}",
        "docDate": date,
        "kind": "perf_eval",
        "title": title,
        "bodyText": body,
        "pages": pages,
        "docType": "thb_measurement_log",
    }


def load_transcription() -> tuple[list[dict], list[dict]]:
    """The hand-verified transcription in ``data/csm-real/`` — the only
    source ``perf_metrics`` values may come from. Refuses to run without it;
    this script transcribes nothing itself."""
    perf_path = CSM_REAL / "perf_documents.json"
    thb_path = CSM_REAL / "thb_series.json"
    for p in (perf_path, thb_path):
        if not p.exists():
            raise SystemExit(
                f"{p} missing — the csm seed reads the verified transcription "
                f"(see data/csm-real/VERIFY.md) and never extracts values itself.")
    return (json.loads(perf_path.read_text(encoding="utf-8")),
            json.loads(thb_path.read_text(encoding="utf-8")))


def derive_visits(reports: list[dict], documents: list[dict],
                  doc_meta: dict[str, dict[str, str]],
                  perf_entries: list[dict], thb_entries: list[dict],
                  metrics: dict[str, tuple[str, str]],
                  visit_titles: dict[str, str],
                  ) -> tuple[list[dict], list[dict], list[str]]:
    """The visit spine and perf rows, derived — never authored.

    A visit exists exactly where an artifact exists: a lab report, a seeded
    document, or a transcribed measurement. A ``needs_ocr`` scan contributes
    neither (its date only carries a visit if some other artifact lands
    there), so no visit can point at evidence the record does not hold.
    Kind per docs/csm-protocol.md's co-occurrence rules: annual when the date
    has a zpráva, else perf_test for performance documents, else thb for a
    tHb log or xlsx-only row, else blood.
    """
    def vid(date: str) -> str:
        return f"v-{PID[2:]}-{date}"

    # docType per seeded document id, via DOC_META's filename → id table.
    id_by_file = {name: f"d-cerny-{e['id']}" for name, e in doc_meta.items()
                  if e.get("id")}
    doctype_by_doc: dict[str, str] = {
        d["id"]: d["docType"] for d in documents if "docType" in d}
    metric_count: dict[str, int] = {}
    entry_date: dict[str, str] = {}  # seeded doc id → resolved visit date
    for e in perf_entries:
        name = unicodedata.normalize("NFC", Path(e["sourceFile"]).name)
        did = id_by_file.get(name)
        if did is None:
            continue  # a scan the document builder already skipped
        doctype_by_doc[did] = e["docType"]
        metric_count[did] = len(e.get("metrics", []))
        # The date DOC_META prints wins over the entry's own (which may be a
        # file-mtime or filename guess, per VERIFY.md) — the document row and
        # its transcribed values must land on one visit, not two.
        entry_date[did] = doc_meta[name]["date"]

    # Candidate values per (date, metric_id), from every source that prints one.
    candidates: dict[tuple[str, str], list[dict]] = {}

    def add_candidate(date: str, m: dict, doctype: str, source: str) -> None:
        mid = m["metricId"]
        if mid not in metrics:
            raise SystemExit(f"{source}: metric {mid!r} is not in the "
                             f"inventory's charted list — refusing to seed it")
        candidates.setdefault((date, mid), []).append(
            {"value": m["value"], "unit": m["unit"], "doctype": doctype,
             "source": source})

    for e in perf_entries:
        if e.get("needs_ocr"):
            continue
        name = unicodedata.normalize("NFC", Path(e["sourceFile"]).name)
        did = id_by_file.get(name)
        date = entry_date[did] if did else e["date"]
        for m in e.get("metrics", []):
            add_candidate(date, m, e["docType"], name)
    for row in thb_entries:
        doctype = "thb_measurement_log" if row["source"] == "pdf" else "xlsx"
        for m in row.get("metrics", []):
            add_candidate(row["date"], m, doctype, f"tHb {row['source']}")

    # Every artifact date gets exactly one visit.
    dates = sorted({r["reportDate"] for r in reports}
                   | {d["docDate"] for d in documents}
                   | {date for date, _ in candidates})
    docs_by_date: dict[str, list[dict]] = {}
    for d in sorted(documents, key=lambda d: d["id"]):
        docs_by_date.setdefault(d["docDate"], []).append(d)
    thb_dates = ({r["date"] for r in thb_entries}
                 | {d["docDate"] for d in documents
                    if doctype_by_doc.get(d["id"]) == "thb_measurement_log"})

    def rank(doc: dict) -> tuple[int, int, str]:
        dt = doctype_by_doc.get(doc["id"], "")
        pref = DOCTYPE_PREFERENCE.index(dt) if dt in DOCTYPE_PREFERENCE else 99
        return (pref, -metric_count.get(doc["id"], 0), doc["id"])

    visits = []
    for date in dates:
        day_docs = docs_by_date.get(date, [])
        doctypes = {doctype_by_doc.get(d["id"], "") for d in day_docs}
        if "lekarska_zprava" in doctypes:
            kind = "annual"
        elif doctypes - {"thb_measurement_log"}:
            kind = "perf_test"
        elif date in thb_dates:
            kind = "thb"
        else:
            kind = "blood"
        # The visit's note document: the zpráva when there is one, else the
        # best summary the visit holds (tHb log, funkční vyšetření, …), else
        # honestly none — the real record has visits where only tests survive.
        note_doc = min(day_docs, key=rank)["id"] if day_docs else None
        visits.append({"id": vid(date), "date": date, "kind": kind,
                       "title": visit_titles[kind], "note": note_doc})

    # One value per (visit, metric): identical repeats collapse silently, a
    # true conflict is resolved by DOCTYPE_PREFERENCE and reported (sources
    # only — never the values themselves, this summary goes to a terminal).
    perf_rows, conflicts = [], []
    for (date, mid) in sorted(candidates, key=lambda k: (k[0], list(metrics).index(k[1]))):
        cands = sorted(candidates[(date, mid)],
                       key=lambda c: (DOCTYPE_PREFERENCE.index(c["doctype"]),
                                      c["source"]))
        chosen = cands[0]
        if len({c["value"] for c in cands}) > 1:
            dropped = ", ".join(c["doctype"] for c in cands[1:])
            conflicts.append(f"{date} {mid}: kept the {chosen['doctype']} "
                             f"value, dropped {dropped}")
        display, _unit = metrics[mid]
        perf_rows.append({"visit": vid(date), "metric": mid, "display": display,
                          "unit": chosen["unit"], "value": float(chosen["value"]),
                          "date": date})

    visit_ids = {v["id"] for v in visits}
    doc_ids = {d["id"] for d in documents}
    for r in perf_rows:
        assert r["visit"] in visit_ids, r
    for v in visits:
        assert v["note"] is None or v["note"] in doc_ids, v
    return visits, perf_rows, conflicts


# --- the seed SQL ------------------------------------------------------------
def build_sql(reports: list[dict], documents: list[dict], registry: Registry,
              note: str, visits: list[dict] | None = None,
              perf: list[dict] | None = None) -> str:
    # The csm tenant's two extra tables. Children first here too:
    # perf_metrics references visits, and visits reference documents, so both
    # wipes come before every other DELETE. With the defaults (the sport
    # tenant) the SQL is byte-identical to what this function always built.
    extra_deletes = [] if visits is None else [
        f"DELETE FROM perf_metrics WHERE patient_id = {sql_str(PID)};",
        f"DELETE FROM visits WHERE patient_id = {sql_str(PID)};",
    ]
    lines: list[str] = [
        "-- The one real patient record — generated by",
        "-- tools/pipeline/scripts/seed_real_patient.py from the git-ignored",
        "-- samples/ tree. NEVER COMMIT THIS FILE: it holds a real name, a real",
        "-- rodné číslo and real results, by the record owner's explicit choice",
        "-- to be the sixth sport patient. Regenerate it, do not edit it.",
        "--",
        "-- Every DELETE below is scoped to this one patient. The synthetic",
        "-- corpus lives in the same database and is seeded by a different",
        "-- script; a bare DELETE here would silently take five other patients",
        "-- with it and the demo would look fine until someone asked about one",
        "-- of them. Children first, so nothing is left orphaned.",
        "",
        *extra_deletes,
        f"DELETE FROM patient_analyte_summary WHERE patient_id = {sql_str(PID)};",
        f"DELETE FROM measurements WHERE patient_id = {sql_str(PID)};",
        "DELETE FROM document_pages WHERE document_id IN "
        f"(SELECT id FROM documents WHERE patient_id = {sql_str(PID)});",
        f"DELETE FROM documents WHERE patient_id = {sql_str(PID)};",
        f"DELETE FROM reports WHERE patient_id = {sql_str(PID)};",
        f"DELETE FROM patients WHERE id = {sql_str(PID)};",
        "",
        "-- patient",
        "INSERT INTO patients (id, full_name, name_norm, birth_date, sex, note) VALUES ("
        f"{sql_str(PID)}, {sql_str(FULL_NAME)}, {sql_str(normalize_name(FULL_NAME))}, "
        f"{sql_str(BIRTH_DATE)}, {sql_str(SEX)}, {sql_str(note)});",
        "",
        "-- reports: the lossless payload, one row per lab report",
    ]
    for r in reports:
        payload = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
        lines.append(
            "INSERT INTO reports (id, patient_id, report_date, lab_name, payload) VALUES ("
            f"{sql_str(r['id'])}, {sql_str(PID)}, {sql_str(r['reportDate'])}, "
            f"{sql_str(r['labName'] or '')}, {sql_str(payload)});")
    lines += ["", "-- measurements: derived index, normalized numeric results only"]
    for r in reports:
        for m in r["measurements"]:
            if m["value"] is None or not m["canonicalId"]:
                continue
            lines.append(
                "INSERT INTO measurements (patient_id, report_id, report_date, "
                "canonical_id, display_name, unit, value, flag, ref_low, ref_high) VALUES ("
                f"{sql_str(PID)}, {sql_str(r['id'])}, {sql_str(r['reportDate'])}, "
                f"{sql_str(m['canonicalId'])}, "
                f"{sql_str(registry.display_name(m['canonicalId']))}, "
                f"{sql_str(m['unit'] or '')}, {sql_num(m['value'])}, "
                f"{sql_str(m['flag'])}, {sql_num(m['refRangeLow'])}, "
                f"{sql_num(m['refRangeHigh'])});")

    lines += ["", "-- patient_analyte_summary: where each series stands and which",
              "-- way it moves. The rule lives in make_chat_demo.direction_of(),",
              "-- imported above — a real patient gets the same one, not a copy."]
    points: dict[str, list[dict]] = {}
    for r in sorted(reports, key=lambda r: r["reportDate"]):
        for m in r["measurements"]:
            if m["value"] is None or not m["canonicalId"]:
                continue
            points.setdefault(m["canonicalId"], []).append(
                {"value": m["value"], "date": r["reportDate"], "flag": m["flag"],
                 "unit": m["unit"] or ""})
    for cid in sorted(points):
        hist = points[cid]
        last = hist[-1]
        previous = hist[-2]["value"] if len(hist) > 1 else None
        delta, direction = direction_of(last["value"], previous)
        lines.append(
            "INSERT INTO patient_analyte_summary (patient_id, canonical_id, "
            "display_name, unit, last_value, last_date, last_flag, delta, direction) VALUES ("
            f"{sql_str(PID)}, {sql_str(cid)}, {sql_str(registry.display_name(cid))}, "
            f"{sql_str(last['unit'])}, {sql_num(last['value'])}, {sql_str(last['date'])}, "
            f"{sql_str(last['flag'])}, {sql_num(delta)}, {sql_str(direction)});")

    lines += ["", "-- documents: body_text is the PDF's own text layer, read with",
              "-- get_text(); body_norm is the folded prefilter column."]
    for d in documents:
        lines.append(
            "INSERT INTO documents (id, patient_id, doc_date, kind, title, "
            "body_text, body_norm) VALUES ("
            f"{sql_str(d['id'])}, {sql_str(PID)}, {sql_str(d['docDate'])}, "
            f"{sql_str(d['kind'])}, {sql_str(d['title'])}, {sql_str(d['bodyText'])}, "
            f"{sql_str(body_norm(d['bodyText']))});")
    lines.append("")
    for d in documents:
        for p in d["pages"]:
            lines.append(
                "INSERT INTO document_pages (document_id, page_num, image_url, "
                "width, height) VALUES ("
                f"{sql_str(d['id'])}, {p['pageNum']}, {sql_str(p['imageUrl'])}, "
                f"{p['width']}, {p['height']});")

    if visits is not None:
        lines += ["", "-- visits: the derived spine — one row per artifact date;",
                  "-- a NULL note_document_id is an honest gap, not a defect."]
        for v in visits:
            note_sql = sql_str(v["note"]) if v["note"] else "NULL"
            lines.append(
                "INSERT INTO visits (id, patient_id, visit_date, kind, title, "
                "note_document_id) VALUES ("
                f"{sql_str(v['id'])}, {sql_str(PID)}, {sql_str(v['date'])}, "
                f"{sql_str(v['kind'])}, {sql_str(v['title'])}, {note_sql});")
        lines += ["", "-- perf_metrics: transcribed verbatim from the verified",
                  "-- data/csm-real/ tables; no bounds — no CSM protocol prints any."]
        for r in perf or []:
            lines.append(
                "INSERT INTO perf_metrics (patient_id, visit_id, metric_id, "
                "display_name, unit, value, ref_low, ref_high, test_date) VALUES ("
                f"{sql_str(PID)}, {sql_str(r['visit'])}, {sql_str(r['metric'])}, "
                f"{sql_str(r['display'])}, {sql_str(r['unit'])}, "
                f"{sql_num(r['value'])}, NULL, NULL, {sql_str(r['date'])});")
    lines.append("")
    return "\n".join(lines)


# --- the run -----------------------------------------------------------------
def main() -> None:
    global OUT, PAGES
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--force-extract", action="store_true",
                    help="re-extract every lab PDF through the API, ignoring "
                         "the archive's stored reports (costs money)")
    ap.add_argument("--tenant", choices=("sport", "csm"), default="sport",
                    help="which practice to seed: sport (the original sixth "
                         "patient) or csm (adds tHb logs, visits and "
                         "perf_metrics from the verified transcription)")
    args = ap.parse_args()
    if args.tenant == "csm":
        OUT = ROOT / "data" / "real_seed_csm"
        PAGES = OUT / "pages"

    registry = load_registry()
    note, doc_meta = load_doc_meta()
    if OUT.exists():
        shutil.rmtree(OUT)
    PAGES.mkdir(parents=True, exist_ok=True)

    spent = [0.0]
    extracted: list[tuple[LabReport, Path, str]] = []
    skipped_labs: list[tuple[str, str]] = []
    for pdf in sorted(SAMPLES.glob("*.pdf")):
        try:
            report, how = extract_lab(pdf, registry, spent, args.force_extract)
        except Exception as exc:  # a PDF the pipeline cannot read is skipped,
            skipped_labs.append((pdf.name, str(exc)))  # never hand-fixed
            print(f"  ! {pdf.name}: skipped — {exc}")
            continue
        extracted.append((report, pdf, how))

    # Report ids follow the corpus convention (<patient>-r<n>), numbered in
    # date order so r1 is the oldest draw in the chat UI as well as the file.
    extracted.sort(key=lambda t: (t[0].report_date or "", t[1].name))
    reports = []
    for i, (report, pdf, how) in enumerate(extracted, start=1):
        payload = lab_payload(report, pdf, f"{PID}-r{i}")
        reports.append(payload)
        print(f"  ok {pdf.name:26s} {payload['reportDate']}  "
              f"{len(payload['measurements']):3d} values, "
              f"{len(payload['pages'])} pages  [{how}]")

    documents, skipped_docs = [], []
    for pdf in sorted(PERF.glob("*.pdf")):
        d = build_document(pdf, doc_meta)
        if d is None:
            skipped_docs.append(pdf.name)
            print(f"  – {pdf.name}: image-only scan, no text layer — skipped")
            continue
        documents.append(d)
        print(f"  ok {pdf.name:32s} {d['docDate']}  {d['kind']:11s} "
              f"{len(d['pages'])} pages  {d['id']}")

    visits: list[dict] | None = None
    perf_rows: list[dict] | None = None
    conflicts: list[str] = []
    if args.tenant == "csm":
        # Imported here, not at module scope: the sport run must not depend
        # on the CSM corpus generator existing, and the import is the single
        # home of the metric list and the visit vocabulary.
        from scripts.make_csm_demo import METRICS, VISIT_TITLES

        for pdf in sorted(THB.glob("*.pdf")):
            d = build_thb_document(pdf)
            documents.append(d)
            print(f"  ok {pdf.name:32s} {d['docDate']}  {d['kind']:11s} "
                  f"{len(d['pages'])} pages  {d['id']}")
        perf_entries, thb_entries = load_transcription()
        visits, perf_rows, conflicts = derive_visits(
            reports, documents, doc_meta, perf_entries, thb_entries,
            METRICS, VISIT_TITLES)
    documents.sort(key=lambda d: (d["docDate"], d["id"]))

    seed_name = "seed_real.sql" if args.tenant == "sport" else "seed_real_csm.sql"
    sql = build_sql(reports, documents, registry, note, visits, perf_rows)
    (OUT / seed_name).write_text(sql, encoding="utf-8")

    pngs = sorted(PAGES.glob("*.png"))
    # The upload manifest, so the evidence store is filled by one command
    # rather than sixty-six: `wrangler kv bulk put` takes exactly this shape.
    (OUT / "kv_bulk.json").write_text(json.dumps(
        [{"key": p.name, "value": base64.b64encode(p.read_bytes()).decode(),
          "base64": True} for p in pngs]), encoding="utf-8")
    rows = sum(1 for r in reports for m in r["measurements"]
               if m["value"] is not None and m["canonicalId"])
    print(f"\n{len(reports)} reports, {rows} indexed measurements, "
          f"{len(documents)} documents, {len(pngs)} page images")
    if visits is not None:
        by_kind = {k: sum(1 for v in visits if v["kind"] == k)
                   for k in ("annual", "perf_test", "thb", "blood")}
        kinds = " · ".join(f"{k} {n}" for k, n in by_kind.items())
        print(f"{len(visits)} visits ({kinds}), {len(perf_rows or [])} perf rows")
        for c in conflicts:  # sources only — values never reach the terminal
            print(f"  conflict: {c}")
    if skipped_labs:
        print("skipped labs:", ", ".join(f"{n} ({w})" for n, w in skipped_labs))
    if skipped_docs:
        print("skipped scans:", ", ".join(skipped_docs))
    print(f"API spend this run: ${spent[0]:.2f} (cap ${COST_CAP_USD:.2f})")
    print(f"seed → {OUT / seed_name}")
    print(f"pages → {PAGES}")


if __name__ == "__main__":
    main()
