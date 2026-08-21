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


def redact_and_render(pdf_path: Path, page_num: int, secrets: list[str], dest: Path):
    """Paint over every identifier occurrence, then render the page to PNG."""
    doc = fitz.open(pdf_path)
    page = doc[page_num - 1]
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

    # Refuse to emit a page that still carries an identifier in its text layer.
    remaining = [s for s in secrets if page.search_for(s)]
    doc.close()
    return pix.width, pix.height, hits, remaining


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="Jan Ukázka", help="Replacement patient name.")
    ap.add_argument("--id", dest="pid", default="800101/0011", help="Replacement rodné číslo.")
    ap.add_argument("--shift-days", type=int, default=0, help="Shift all sample dates by N days.")
    args = ap.parse_args()

    reports = list_reports()
    if not reports:
        sys.exit("No processed reports in data/reports/. Run the pipeline first.")

    if IMG_DIR.exists():
        shutil.rmtree(IMG_DIR)
    IMG_DIR.mkdir(parents=True, exist_ok=True)

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
            w, h, hits, remaining = redact_and_render(pdf, p.page_num, secrets_list, IMG_DIR / img_name)
            total_hits += hits
            if remaining:
                failures.append(f"{r.source_file} p{p.page_num}: {remaining}")
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
        print("\nREFUSING TO WRITE — identifiers survived redaction:")
        for f in failures:
            print(f"  {f}")
        sys.exit(1)

    # Belt and braces: no original identifier may appear anywhere in the JSON.
    blob = json.dumps(out_reports, ensure_ascii=False)
    leaked = [s for s in secrets_list if s in blob]
    if leaked:
        sys.exit(f"REFUSING TO WRITE — identifiers present in JSON: {leaked}")

    (OUT / "reports.json").write_text(json.dumps(out_reports, ensure_ascii=False, indent=1), "utf-8")

    registry = json.loads((ROOT / "data" / "registry.json").read_text("utf-8"))
    (OUT / "registry.json").write_text(json.dumps([{
        "canonicalId": a["canonical_id"], "displayNameCs": a["display_name_cs"],
        "synonyms": a["synonyms"], "canonicalUnit": a["canonical_unit"],
        "unitConversions": a["unit_conversions"],
    } for a in registry], ensure_ascii=False, indent=1), "utf-8")

    print(f"\nWrote {len(out_reports)} reports, redacted {total_hits} identifier occurrences.")
    print(f"Output → {OUT}. Rebuild with: npm run build")


if __name__ == "__main__":
    main()
