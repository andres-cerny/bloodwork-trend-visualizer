"""Locate an analyte row on the rendered page image via the PDF text layer.

PyMuPDF's ``search_for`` gives the printed position of a row's analyte name in
PDF points; scaled by the render DPI this maps 1:1 onto the cached page PNG.
Zero API cost — it reuses the text layer already embedded in the PDF. Pages
without a text layer (pure scans) simply return no boxes and the UI degrades
to the plain full-page view.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF

from .config import RENDER_DPI, SAMPLES_DIR, UPLOADS_DIR

Box = tuple[float, float, float, float]  # x0, y0, x1, y1 in image pixels


def find_source_pdf(source_file: str) -> Optional[Path]:
    """The PDF a stored report came from, wherever it lives now."""
    for d in (UPLOADS_DIR, SAMPLES_DIR):
        p = d / source_file
        if p.exists():
            return p
    return None


@lru_cache(maxsize=512)
def _name_boxes(pdf_path: str, page_num: int, name: str) -> tuple[Box, ...]:
    """All printed occurrences of ``name`` on the page, top-to-bottom, scaled
    to image pixels. Cached — a verify-tab rerun costs nothing."""
    name = (name or "").strip()
    if not name:
        return ()
    try:
        with fitz.open(pdf_path) as doc:
            rects = doc[page_num - 1].search_for(name)
    except Exception:
        return ()
    zoom = RENDER_DPI / 72.0
    boxes = [(r.x0 * zoom, r.y0 * zoom, r.x1 * zoom, r.y1 * zoom) for r in rects]
    boxes.sort(key=lambda b: b[1])
    return tuple(boxes)


def row_bbox(
    pdf_path: Path | str, page_num: int, raw_name: str, occurrence: int = 0
) -> Optional[Box]:
    """Pixel bbox of the ``occurrence``-th printed instance of ``raw_name``.

    ``occurrence`` disambiguates duplicate names on one page: measurements are
    transcribed in reading order and search hits are sorted by y, so the n-th
    measurement with a given name pairs with the n-th hit.
    """
    boxes = _name_boxes(str(pdf_path), page_num, raw_name)
    if not boxes:
        return None
    return boxes[min(occurrence, len(boxes) - 1)]
