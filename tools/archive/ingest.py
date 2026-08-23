"""PDF ingest: render each page to a PNG and pull its text layer.

We always render an image (the source of truth for column alignment that the
vision model reads) and, when present, keep the embedded text layer as an
accuracy hint. A page with an empty text layer is effectively a scan and is
handled by the same image path.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import fitz  # PyMuPDF

from .config import PAGE_IMAGES_DIR, RENDER_DPI, ensure_dirs
from .models import Page


def report_id_for(pdf_path: Path) -> str:
    """Stable id from filename + content hash (first 8 hex chars)."""
    data = pdf_path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()[:8]
    return f"{pdf_path.stem}_{digest}"


def ingest_pdf(pdf_path: Path, report_id: str | None = None) -> list[Page]:
    """Render every page of ``pdf_path`` to a PNG and capture its text layer.

    Returns the list of Page objects (image_path + text_layer). Images are
    cached under data/page_images/<report_id>/page_<n>.png and reused if they
    already exist.
    """
    ensure_dirs()
    pdf_path = Path(pdf_path)
    rid = report_id or report_id_for(pdf_path)
    out_dir = PAGE_IMAGES_DIR / rid
    out_dir.mkdir(parents=True, exist_ok=True)

    zoom = RENDER_DPI / 72.0
    matrix = fitz.Matrix(zoom, zoom)

    pages: list[Page] = []
    with fitz.open(pdf_path) as doc:
        for i, page in enumerate(doc, start=1):
            img_path = out_dir / f"page_{i}.png"
            if not img_path.exists():
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                pix.save(img_path)
            text = page.get_text("text") or ""
            pages.append(
                Page(
                    page_num=i,
                    image_path=str(img_path),
                    text_layer=text.strip() or None,
                )
            )
    return pages


if __name__ == "__main__":  # quick manual smoke test
    import sys

    from .config import SAMPLES_DIR

    target = Path(sys.argv[1]) if len(sys.argv) > 1 else next(SAMPLES_DIR.glob("*.pdf"))
    pgs = ingest_pdf(target)
    for p in pgs:
        chars = len(p.text_layer or "")
        print(f"page {p.page_num}: {p.image_path}  (text layer: {chars} chars)")
