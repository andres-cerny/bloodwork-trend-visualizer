"""
Arm A7 — Docling, the layout-parser answer, measured on this corpus.

    .venv-mac/bin/python bench/docling_arm.py [n_files]

Docling skips OCR entirely on a born-digital PDF and matches TableFormer's
predicted row/column structure back onto the PDF's own text cells — the same
job the LLM does on the text path, with no model call and no network. It is
the strongest available stand-in for the whole "just use a layout parser"
family, and the point of running it is to find out whether that family clears
the bar on real Czech lab layouts.

Emits bench/results/docling.json: {"file#page": [ {raw_analyte_name, value_raw,
unit_raw, ref_range_raw}, ... ]}, scored by bench/docling_eval.bench.ts against
the same baseline and the same three columns as every paid arm.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

from docling.document_converter import DocumentConverter

NUMERIC = re.compile(r"^[<>]?\s*-?\d[\d\s.,]*\s*[!*]?$")
WORDY = re.compile(r"\p{L}{2}" if False else r"[^\W\d_]{2}", re.UNICODE)

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "bench" / "results" / "docling.json"


def rows_from_table(table) -> list[list[str]]:
    """Table -> list of rows of cell strings, however this Docling version
    prefers to express it."""
    try:
        df = table.export_to_dataframe()
        return [[("" if v is None else str(v)).strip() for v in rec]
                for rec in df.itertuples(index=False, name=None)]
    except Exception:
        pass
    try:
        grid = table.data.grid
        return [[(c.text or "").strip() for c in row] for row in grid]
    except Exception:
        return []


def measurements_from_rows(rows: list[list[str]]) -> list[dict]:
    """Pick name / value / unit / range out of a parsed table row.

    Deliberately generous: the question is whether Docling recovered the table
    at all, so the role assignment must not be the thing that fails. The name
    is the first wordy cell, the value the first numeric cell after it, the
    range the first cell that looks like an interval, the unit the first
    remaining wordy-but-not-name cell.
    """
    out = []
    for cells in rows:
        cells = [c for c in cells if c is not None]
        name_i = next((i for i, c in enumerate(cells) if WORDY.search(c) and not NUMERIC.match(c)), None)
        if name_i is None:
            continue
        val_i = next((i for i in range(name_i + 1, len(cells)) if NUMERIC.match(cells[i])), None)
        if val_i is None:
            continue
        rest = cells[val_i + 1:]
        rng = next((c for c in rest if re.search(r"\d[\d.,]*\s*[-–—]\s*\d", c)), "")
        unit = next((c for c in rest if WORDY.search(c) and c != rng and not NUMERIC.match(c)), "")
        out.append({
            "raw_analyte_name": cells[name_i],
            "value_raw": cells[val_i],
            "unit_raw": unit,
            "ref_range_raw": rng,
            "confidence": "high",
        })
    return out


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 15
    samples = sorted((REPO / "samples").glob("*.pdf"))[:n]
    converter = DocumentConverter()

    result: dict[str, list[dict]] = {}
    timings = []
    for path in samples:
        t0 = time.monotonic()
        try:
            conv = converter.convert(str(path))
        except Exception as e:  # a parser that cannot read a page is a finding
            print(f"{path.name:<24} FAILED: {type(e).__name__}: {e}")
            continue
        elapsed = time.monotonic() - t0
        timings.append((path.name, elapsed))

        doc = conv.document
        per_page: dict[int, list[dict]] = {}
        for table in getattr(doc, "tables", []) or []:
            page_no = 1
            prov = getattr(table, "prov", None)
            if prov:
                page_no = getattr(prov[0], "page_no", 1)
            per_page.setdefault(page_no, []).extend(
                measurements_from_rows(rows_from_table(table))
            )
        for page_no, ms in per_page.items():
            result[f"{path.name}#{page_no}"] = ms

        found = sum(len(v) for v in per_page.values())
        print(f"{path.name:<24}{elapsed:7.1f}s  tables={len(getattr(doc,'tables',[]) or []):3d}  "
              f"measurement-rows={found:3d}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1))
    total = sum(t for _, t in timings)
    if timings:
        print(f"\n{len(timings)} files in {total:.1f}s ({total/len(timings):.1f}s per file), $0.00")
        print(f"wrote {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
