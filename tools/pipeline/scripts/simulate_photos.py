"""Simulate phone photos of the real sample reports (docs/plans/lab-adaptability.md, A4).

A stand-in until the owner shoots the real ones: every text-layer page under
`samples/*.pdf` (the files directly in samples/, not the subfolders) is
rendered at 220 DPI and degraded the way a phone camera would —

    flat     mild JPEG, slightly uneven brightness
    angle    ~15-20 degree perspective skew, a soft shadow across half the page
    glare    a bright radial highlight over part of the table, slight blur
    dark     gamma darkening plus sensor noise
    crop     the right 12 % of the page cut off               (four pages)
    twopage  two pages of one report side by side in a frame  (one report)

Output is JPEG quality 85 with a 3024 px long edge, phone-like, written to
`data/photos-sim/<stem>_p<N>_<condition>.jpg`, plus `manifest.json` mapping each
file to `{ source_file, pages, condition }` so the bench looks truth up as
`${source_file}#${page}` in `loadBaseline()` — the key `tests/bench/score.ts`
already uses. `twopage` truth is the union of its pages.

A page is used only when the baseline has rows for it (`data/reports/*.json`,
key `source_file#source_page`) — a photo without truth cannot be scored. When
no reports exist yet, pages with fewer than MIN_WORDS words (trailer pages) are
skipped instead. Skipped pages are listed.

Everything under data/ is git-ignored; this script contains no data.

    <scratch venv>/bin/python -m scripts.simulate_photos      # from tools/pipeline
    <scratch venv>/bin/python tools/pipeline/scripts/simulate_photos.py   # from repo root
"""
from __future__ import annotations

import io
import json
import random
import sys
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
SAMPLES = ROOT / "samples"
REPORTS = ROOT / "data" / "reports"
OUT = ROOT / "data" / "photos-sim"

RENDER_DPI = 220
LONG_EDGE = 3024
JPEG_QUALITY = 85
MIN_WORDS = 30
CROP_COUNT = 4
DESK = (176, 168, 156)  # the table the sheet lies on


# ---------------------------------------------------------------- helpers

def baseline_keys() -> set[str]:
    """`source_file#source_page` for every page the accepted reports have rows on."""
    keys: set[str] = set()
    if not REPORTS.is_dir():
        return keys
    for f in REPORTS.glob("*.json"):
        report = json.loads(f.read_text(encoding="utf-8"))
        src = Path(report.get("source_file", "")).name
        for m in report.get("measurements", []):
            keys.add(f"{src}#{m.get('source_page', 1)}")
    return keys


def render(page: pymupdf.Page) -> Image.Image:
    pix = page.get_pixmap(dpi=RENDER_DPI, colorspace=pymupdf.csRGB, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def to_phone(im: Image.Image) -> Image.Image:
    w, h = im.size
    scale = LONG_EDGE / max(w, h)
    return im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)


def jpeg_roundtrip(im: Image.Image, quality: int) -> Image.Image:
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def as_float(im: Image.Image) -> np.ndarray:
    return np.asarray(im, dtype=np.float32) / 255.0


def from_float(a: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), "RGB")


def gradient(h: int, w: int, x0: float, y0: float, x1: float, y1: float, lo: float, hi: float) -> np.ndarray:
    """Linear brightness ramp from lo at (x0,y0) to hi at (x1,y1), fractions of the frame."""
    ys, xs = np.mgrid[0:h, 0:w]
    xs = xs / max(w - 1, 1)
    ys = ys / max(h - 1, 1)
    dx, dy = x1 - x0, y1 - y0
    t = ((xs - x0) * dx + (ys - y0) * dy) / (dx * dx + dy * dy)
    t = np.clip(t, 0, 1)
    return (lo + (hi - lo) * t)[..., None]


def find_coeffs(src: list[tuple[float, float]], dst: list[tuple[float, float]]) -> list[float]:
    """PIL PERSPECTIVE coefficients mapping *output* points dst back to input points src."""
    matrix = []
    for (x, y), (u, v) in zip(dst, src):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    a = np.array(matrix, dtype=np.float64)
    b = np.array([c for p in src for c in p], dtype=np.float64)
    return list(np.linalg.solve(a, b))


# ---------------------------------------------------------------- conditions

def cond_flat(im: Image.Image, rng: random.Random) -> Image.Image:
    a = as_float(im)
    h, w = a.shape[:2]
    a = a * gradient(h, w, 0.0, 0.0, 1.0, 1.0, rng.uniform(1.02, 1.06), rng.uniform(0.86, 0.92))
    return jpeg_roundtrip(from_float(a), rng.randint(68, 78))


def cond_angle(im: Image.Image, rng: random.Random) -> Image.Image:
    w, h = im.size
    # The sheet on a desk, rotated ~15-20 degrees about its vertical axis:
    # the far edge shortens, the corners drift.
    k = rng.uniform(0.80, 0.86)          # far-edge height / near-edge height
    inset = (1 - k) / 2
    if rng.random() < 0.5:
        quad = [(0.04, 0.02), (0.93, inset + 0.02), (0.92, 1 - inset - 0.02), (0.02, 0.98)]
    else:
        quad = [(0.07, inset + 0.02), (0.96, 0.02), (0.98, 0.98), (0.08, 1 - inset - 0.02)]
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    dst = [(x * w, y * h) for x, y in quad]
    coeffs = find_coeffs(src, dst)
    warped = im.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=DESK)
    a = as_float(warped)
    # A soft shadow across half the page.
    if rng.random() < 0.5:
        a = a * gradient(h, w, 0.45, 0.0, 1.0, 0.3, 1.0, 0.58)
    else:
        a = a * gradient(h, w, 0.5, 1.0, 0.0, 0.6, 1.0, 0.6)
    return jpeg_roundtrip(from_float(a), rng.randint(70, 80))


def cond_glare(im: Image.Image, rng: random.Random) -> Image.Image:
    a = as_float(im)
    h, w = a.shape[:2]
    cx, cy = rng.uniform(0.35, 0.7) * w, rng.uniform(0.3, 0.6) * h
    radius = rng.uniform(0.22, 0.3) * w
    ys, xs = np.mgrid[0:h, 0:w]
    d2 = ((xs - cx) ** 2 + (ys - cy) ** 2) / (radius * radius)
    glare = np.exp(-d2 * 1.6)[..., None]
    a = a + (1.0 - a) * glare * 0.92          # lift toward white, washing the text out at the centre
    a = a * (1.0 - 0.08 * (1 - glare))        # the rest a touch dimmer, as auto-exposure would do
    out = from_float(a).filter(ImageFilter.GaussianBlur(radius=1.2))
    return jpeg_roundtrip(out, rng.randint(72, 82))


def cond_dark(im: Image.Image, rng: random.Random) -> Image.Image:
    a = as_float(im)
    h, w = a.shape[:2]
    a = a ** rng.uniform(1.6, 2.0)
    a = a * rng.uniform(0.5, 0.62)
    a = a * np.array([1.0, 0.94, 0.82], dtype=np.float32)   # evening room light
    a = a * gradient(h, w, 0.0, 0.0, 1.0, 1.0, 1.08, 0.8)
    noise = np.random.default_rng(rng.randint(0, 2**31)).normal(0, rng.uniform(0.025, 0.04), a.shape)
    a = a + noise.astype(np.float32)
    return jpeg_roundtrip(from_float(a), rng.randint(64, 74))


def cond_crop(im: Image.Image, rng: random.Random) -> Image.Image:
    w, h = im.size
    return cond_flat(im.crop((0, 0, round(w * 0.88), h)), rng)


def cond_twopage(pages: list[Image.Image], rng: random.Random) -> Image.Image:
    w, h = pages[0].size
    gap = round(w * 0.04)
    margin = round(w * 0.05)
    frame = Image.new("RGB", (2 * w + gap + 2 * margin, h + 2 * margin), DESK)
    for i, p in enumerate(pages[:2]):
        frame.paste(p.rotate(rng.uniform(-1.5, 1.5), Image.BICUBIC, expand=False, fillcolor=DESK),
                    (margin + i * (w + gap), margin))
    return cond_flat(frame, rng)


CONDITIONS = {"flat": cond_flat, "angle": cond_angle, "glare": cond_glare, "dark": cond_dark}


# ---------------------------------------------------------------- main

def main() -> int:
    pdfs = sorted(p for p in SAMPLES.glob("*.pdf") if p.is_file() or p.is_symlink())
    if not pdfs:
        print(f"no PDFs under {SAMPLES}", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    baseline = baseline_keys()

    manifest: dict[str, dict] = {}
    counts: dict[str, int] = {}
    skipped: list[str] = []
    usable: list[tuple[str, int, Image.Image]] = []

    for pdf in pdfs:
        doc = pymupdf.open(pdf)
        for i, page in enumerate(doc, start=1):
            key = f"{pdf.name}#{i}"
            has_truth = key in baseline if baseline else len(page.get_text("words")) >= MIN_WORDS
            if not has_truth:
                skipped.append(key)
                continue
            usable.append((pdf.name, i, render(page)))

    def emit(name: str, im: Image.Image, source: str, pages: list[int], condition: str) -> None:
        to_phone(im).save(OUT / name, "JPEG", quality=JPEG_QUALITY, optimize=True)
        manifest[name] = {"source_file": source, "pages": pages, "condition": condition}
        counts[condition] = counts.get(condition, 0) + 1

    for source, n, im in usable:
        stem = source[:-4]
        for cond, fn in CONDITIONS.items():
            rng = random.Random(f"{source}#{n}#{cond}")
            emit(f"{stem}_p{n}_{cond}.jpg", fn(im, rng), source, [n], cond)

    # crop: the first page of four reports spread across the list
    firsts = [(s, n, im) for s, n, im in usable if n == 1]
    step = max(len(firsts) // CROP_COUNT, 1)
    for source, n, im in firsts[::step][:CROP_COUNT]:
        rng = random.Random(f"{source}#{n}#crop")
        emit(f"{source[:-4]}_p{n}_crop.jpg", cond_crop(im, rng), source, [n], "crop")

    # twopage: the first report with two usable pages, pages 1 and 2 in one frame
    by_source: dict[str, list[tuple[int, Image.Image]]] = {}
    for source, n, im in usable:
        by_source.setdefault(source, []).append((n, im))
    for source, pages in by_source.items():
        if len(pages) >= 2:
            rng = random.Random(f"{source}#twopage")
            emit(f"{source[:-4]}_p1-2_twopage.jpg", cond_twopage([im for _, im in pages[:2]], rng),
                 source, [pages[0][0], pages[1][0]], "twopage")
            break

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    why = "no baseline rows" if baseline else f"< {MIN_WORDS} words"
    print(f"{len(pdfs)} PDFs, {len(usable)} pages used, {len(skipped)} skipped ({why}): {', '.join(skipped)}")
    for cond, c in counts.items():
        print(f"  {cond:8s} {c}")
    print(f"  total    {sum(counts.values())} files -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
