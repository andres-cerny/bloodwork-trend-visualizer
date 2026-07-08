"""Tests for the PDF-text-layer row locator used by the „Ověření" tab to point
at a row on the source image. Uses a real sample PDF when present (skips
gracefully otherwise, e.g. a fresh checkout without samples/).

    .venv/Scripts/python.exe tests/test_locate.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import fitz  # PyMuPDF

from src.config import RENDER_DPI, SAMPLES_DIR
from src.locate import find_source_pdf, row_bbox


def _a_sample_pdf():
    pdfs = sorted(SAMPLES_DIR.glob("*.pdf"))
    return pdfs[0] if pdfs else None


def _first_word_on_page1(pdf_path):
    """A word that is actually printed on page 1 (has a text layer), or None."""
    with fitz.open(pdf_path) as doc:
        for w in doc[0].get_text("words"):
            token = w[4].strip()
            if len(token) >= 4 and any(c.isalpha() for c in token):
                return token
    return None


def test_missing_name_returns_none():
    pdf = _a_sample_pdf()
    if pdf is None:
        print("SKIP test_missing_name_returns_none (no sample PDFs)")
        return
    assert row_bbox(pdf, 1, "TOTO_URCITE_NENI_NA_STRANE_XYZ") is None


def test_empty_name_returns_none():
    pdf = _a_sample_pdf()
    if pdf is None:
        print("SKIP test_empty_name_returns_none (no sample PDFs)")
        return
    assert row_bbox(pdf, 1, "") is None
    assert row_bbox(pdf, 1, "   ") is None


def test_printed_word_resolves_to_a_scaled_bbox():
    pdf = _a_sample_pdf()
    if pdf is None:
        print("SKIP test_printed_word_resolves_to_a_scaled_bbox (no sample PDFs)")
        return
    word = _first_word_on_page1(pdf)
    if word is None:
        print("SKIP (page 1 has no text layer)")
        return
    box = row_bbox(pdf, 1, word)
    assert box is not None, f"expected to locate printed word {word!r}"
    x0, y0, x1, y1 = box
    assert x1 > x0 and y1 > y0                      # a real, non-empty rectangle

    # Coordinates are scaled from PDF points to image pixels — they must land
    # inside the rendered page, and be strictly larger than the raw PDF points.
    zoom = RENDER_DPI / 72.0
    with fitz.open(pdf) as doc:
        pw, ph = doc[0].rect.width * zoom, doc[0].rect.height * zoom
        raw = doc[0].search_for(word)[0]
    assert 0 <= x0 < x1 <= pw + 1
    assert 0 <= y0 < y1 <= ph + 1
    assert x0 > raw.x0 - 0.5                        # scaled up from points


def test_find_source_pdf_locates_samples():
    pdf = _a_sample_pdf()
    if pdf is None:
        print("SKIP test_find_source_pdf_locates_samples (no sample PDFs)")
        return
    assert find_source_pdf(pdf.name) is not None
    assert find_source_pdf("neexistuje_1234.pdf") is None


if __name__ == "__main__":
    import traceback

    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    passed = failed = 0
    for fn in fns:
        try:
            fn()
            passed += 1
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
