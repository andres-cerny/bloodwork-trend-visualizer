"""Export locally-processed reports into the public web demo — anonymized.

Reads the reports you already processed with the Streamlit tool (``data/``),
strips the patient's identity from both the JSON *and* the rendered page
images, and writes the result into ``web/public/demo/`` where the SPA reads it.

The page images are the part that is easy to get wrong: they are pictures of
the original lab reports, and the printed header carries the patient's name and
rodné číslo. Anonymizing the JSON does nothing about those pixels, and the
verification tab is exactly where a reader studies the page closely. So the
identifiers are redacted from the PDF *before* it is rendered, and the export
refuses to finish if any of them survive into the output.

    python3 -m scripts.export_web_data --name "Jan Ukázka" --id "800101/0011"

Everything it reads is git-ignored; everything it writes is publishable.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import date, timedelta
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent

# Typical adult intervals, used only to tell analytes apart when mapping.
# Never used to decide whether a result is abnormal — that comes from the
# interval printed on the patient's own report.
REF_RANGES: dict[str, list[float]] = json.loads(
    (Path(__file__).resolve().parent / "reference_ranges.json").read_text("utf-8")
)["ranges"]
sys.path.insert(0, str(ROOT))

from src.config import RENDER_DPI, SAMPLES_DIR, UPLOADS_DIR  # noqa: E402
from src.storage import list_reports  # noqa: E402

OUT = ROOT / "web" / "public" / "demo"
IMG_DIR = OUT / "pages"


def find_source_pdf(source_file: str) -> Path | None:
    for d in (UPLOADS_DIR, SAMPLES_DIR):
        p = d / source_file
        if p.exists():
            return p
    return None


def shift_date(iso: str | None, days: int) -> str | None:
    if not iso:
        return None
    try:
        return (date.fromisoformat(iso) + timedelta(days=days)).isoformat()
    except ValueError:
        return iso


def identifier_variants(value: str | None) -> list[str]:
    """Spellings of an identifier worth searching for on the page.

    Rodné číslo is printed with and without the slash, and names appear both
    'Jan Novák' and 'NOVÁK Jan', so cover the obvious variants rather than
    trusting one exact match.
    """
    if not value:
        return []
    v = value.strip()
    out = {v, v.upper(), v.replace("/", ""), v.replace("/", " / ")}
    parts = [p for p in re.split(r"\s+", v) if p]
    if len(parts) > 1:
        out.add(" ".join(reversed(parts)))
        out.update(parts)  # surname or given name alone
    return [s for s in out if len(s) >= 3]


# Below this much extractable text, a page cannot be treated as digital: we
# would be "verifying" redaction against a text layer that barely exists.
MIN_TEXT_CHARS = 200


def redact_and_render(pdf_path: Path, page_num: int, secrets: list[str], dest: Path):
    """Paint over every identifier occurrence, then render the page to PNG.

    Returns (width, height, hits, problems). ``problems`` is empty only when
    the page could actually be verified.

    The subtlety that makes this worth reading carefully: finding zero
    identifiers is only reassuring if we *could* have found them. Redaction and
    verification both run through the PDF text layer, so on a scanned page the
    search matches nothing, nothing is painted over, the "did anything survive"
    check also matches nothing — and a page whose printed header carries the
    patient's name and rodné číslo renders straight through, looking clean.
    That is precisely the case the redaction exists for.

    So a page without a usable text layer is refused rather than exported. The
    verification here is honest about its own reach: it can clear a digital
    page, and it cannot clear a scan.
    """
    doc = fitz.open(pdf_path)
    page = doc[page_num - 1]
    problems: list[str] = []

    text_len = len(page.get_text("text").strip())
    if text_len < MIN_TEXT_CHARS:
        doc.close()
        return 0, 0, 0, [
            f"page {page_num} has almost no text layer ({text_len} chars) — it is a scan, "
            f"so identifiers printed on it cannot be located or verified. "
            f"Redact it by hand, or exclude this report."
        ]

    hits = 0
    for s in secrets:
        for rect in page.search_for(s):
            page.add_redact_annot(rect, fill=(0, 0, 0))
            hits += 1
    if hits:
        page.apply_redactions()

    zoom = RENDER_DPI / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    pix.save(dest)

    # Now meaningful: the page has a text layer, so a surviving match is a
    # genuine failure and no match means the identifier really is not printed.
    for s in secrets:
        if page.search_for(s):
            problems.append(f"page {page_num}: '{s}' survived redaction")
    doc.close()
    return pix.width, pix.height, hits, problems


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="Jan Ukázka", help="Replacement patient name.")
    ap.add_argument("--id", dest="pid", default="800101/0011", help="Replacement rodné číslo.")
    ap.add_argument("--shift-days", type=int, default=0, help="Shift all sample dates by N days.")
    args = ap.parse_args()

    reports = list_reports()
    if not reports:
        sys.exit("No processed reports in data/reports/. Run the pipeline first.")

    # Every report must actually carry an identity to redact. A report whose
    # name or rodné číslo the extractor missed contributes no search variants,
    # so a spelling that appears only there would never be looked for on any
    # page — silently weakening the redaction for the whole run.
    missing = [r.source_file for r in reports if not (r.patient_name and r.patient_id)]
    if missing:
        sys.exit(
            "REFUSING TO EXPORT — these reports have no extracted patient name or rodné číslo, "
            "so their spellings cannot be redacted from any page:\n  "
            + "\n  ".join(missing)
        )

    # Stage into a temp directory and publish only once every page has passed.
    # Writing straight into the published folder meant a refusal still left the
    # offending images sitting there, under a message saying nothing was
    # written.
    staging = OUT / "_staging_pages"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)

    secrets: set[str] = set()
    for r in reports:
        secrets.update(identifier_variants(r.patient_name))
        secrets.update(identifier_variants(r.patient_id))
    secrets_list = sorted(secrets, key=len, reverse=True)
    print(f"Redacting {len(secrets_list)} identifier spellings from page images.")

    out_reports, failures, total_hits = [], [], 0
    for ri, r in enumerate(reports):
        pdf = find_source_pdf(r.source_file)
        if pdf is None:
            print(f"  ! source PDF missing for {r.source_file} — skipping its pages")

        pages, page_dims = [], {}
        for p in r.pages:
            if pdf is None:
                continue
            img_name = f"report{ri}_p{p.page_num}.png"
            w, h, hits, problems = redact_and_render(pdf, p.page_num, secrets_list, staging / img_name)
            total_hits += hits
            if problems:
                failures.extend(f"{r.source_file}: {msg}" for msg in problems)
                continue
            page_dims[p.page_num] = (w, h)
            pages.append({
                "pageNum": p.page_num,
                "imageUrl": f"/demo/pages/{img_name}",
                "imageWidth": w,
                "imageHeight": h,
            })

        measurements = []
        for m in r.measurements:
            d = m.to_dict()
            bbox = None
            if pdf is not None:
                doc = fitz.open(pdf)
                rects = doc[m.source_page - 1].search_for(m.raw_analyte_name)
                if rects:
                    zoom = RENDER_DPI / 72.0
                    rc = sorted(rects, key=lambda r_: r_.y0)[0]
                    bbox = [round(rc.x0 * zoom, 1), round(rc.y0 * zoom, 1),
                            round(rc.x1 * zoom, 1), round(rc.y1 * zoom, 1)]
                doc.close()
            measurements.append({
                "rawAnalyteName": d["raw_analyte_name"], "valueRaw": d["value_raw"],
                "unitRaw": d["unit_raw"], "refRangeRaw": d["ref_range_raw"],
                "sourceSnippet": d["source_snippet"], "sourcePage": d["source_page"],
                "confidence": d["confidence"], "canonicalId": d["canonical_id"],
                "value": d["value"], "unit": d["unit"],
                "refRangeLow": d["ref_range_low"], "refRangeHigh": d["ref_range_high"],
                "refRangeText": d["ref_range_text"], "flag": d["flag"],
                "extractedBy": d["extracted_by"], "escalated": d["escalated"],
                "disagreement": d["disagreement"], "corrected": d["corrected"],
                "bbox": bbox,
            })

        out_reports.append({
            "id": f"r{ri}",
            "sourceFile": f"report{ri}.pdf",          # original filename dropped
            "reportDate": shift_date(r.report_date, args.shift_days),
            "labName": r.lab_name,
            "patientName": args.name,
            "patientId": args.pid,
            "pages": pages,
            "measurements": measurements,
        })

    if failures:
        shutil.rmtree(staging, ignore_errors=True)
        print("\nREFUSING TO WRITE — pages could not be cleared:")
        for f in failures:
            print(f"  {f}")
        print("\nNothing was published; the staged images have been deleted.")
        sys.exit(1)

    # Belt and braces: no original identifier may appear anywhere in the JSON.
    blob = json.dumps(out_reports, ensure_ascii=False)
    leaked = [s for s in secrets_list if s in blob]
    if leaked:
        sys.exit(f"REFUSING TO WRITE — identifiers present in JSON: {leaked}")

    # Every page cleared — publish the staged images now, not before.
    if IMG_DIR.exists():
        shutil.rmtree(IMG_DIR)
    shutil.move(str(staging), str(IMG_DIR))

    (OUT / "reports.json").write_text(json.dumps(out_reports, ensure_ascii=False, indent=1), "utf-8")

    registry = json.loads((ROOT / "data" / "registry.json").read_text("utf-8"))
    (OUT / "registry.json").write_text(json.dumps([{
        "canonicalId": a["canonical_id"], "displayNameCs": a["display_name_cs"],
        "synonyms": a["synonyms"], "canonicalUnit": a["canonical_unit"],
        "unitConversions": a["unit_conversions"],
        "referenceRange": REF_RANGES.get(a["canonical_id"]),
    } for a in registry], ensure_ascii=False, indent=1), "utf-8")

    print(f"\nWrote {len(out_reports)} reports, redacted {total_hits} identifier occurrences.")
    print(f"Output → {OUT}. Rebuild with: npm run build")
    print(
        "\nThe automated check clears a page's *text layer*. Look at the images in\n"
        f"{IMG_DIR} before deploying — a stamp, a signature or a handwritten note is\n"
        "invisible to it."
    )


if __name__ == "__main__":
    main()
