"""Bad phone photos: the conditions a photo check must warn on or refuse
(docs/plans/photo-capture.md, Phase A1).

`simulate_photos.py` makes the photos the readers are *expected* to read —
flat, angle, glare, dark, crop, twopage. This script makes the ones a check in
the browser has to say something about, from the same real sample pages and
with the same helpers (imported, not copied, and that file is not edited):

    blur        defocus: a Gaussian blur that smears the print     -> warn
    motion      shake: a 1-D smear along a slanted line            -> warn
    tilt_hard   ~40 degree perspective, the page small in frame    -> ok (flattened)
    corner_cut  one page corner outside the frame                  -> warn
    tiny        long edge 600 px                                   -> warn
    blown       a large fully clipped highlight over the table     -> warn
    table       the page at ~half size on a busy background        -> ok (flattened)
    screen      a photo of the report on a monitor (moire, tint)   -> ok
    micro       long edge 200 px: no text can survive              -> refuse
    black       a lens-cap frame: near-uniform dark noise          -> refuse
    wall        a blank, evenly lit wall                           -> refuse
    sheet       a blank A4 sheet on the desk                       -> warn (not a lab sheet)

`tilt_hard` and `table` are `ok` because the page is found and flattened
(Phase C); the plan's table lists strong tilt as a warning, and the calibration
decides which it is — see docs/plans/photo-capture.md, "Stage 1 results".

Each file's expected outcome is in `manifest.json` beside it, with the page's
four corners (fractions of the frame, clockwise from top-left) whenever the
geometry is known, so the page detector can be scored for corner accuracy.
`corners_angle.json` adds the same for `data/photos-sim/*_angle.jpg`, by
replaying the random draws `simulate_photos.cond_angle` makes for each file.

Output: `data/photos-bad/` (git-ignored, derived from real reports).

    <scratch venv>/bin/python tools/pipeline/scripts/simulate_bad_photos.py
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from simulate_photos import (  # noqa: E402  (the sibling is the source of truth)
    DESK,
    JPEG_QUALITY,
    LONG_EDGE,
    SAMPLES,
    as_float,
    baseline_keys,
    cond_flat,
    find_coeffs,
    from_float,
    gradient,
    jpeg_roundtrip,
    render,
    to_phone,
)

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "data" / "photos-bad"
SIM = ROOT / "data" / "photos-sim"

# First pages of reports spread across the four labs; chosen by position in
# the sorted list so the script carries no patient-derived names of its own.
SOURCE_COUNT = 6

EXPECTED = {
    "blur": "warn",
    "motion": "warn",
    "tilt_hard": "ok",
    "corner_cut": "warn",
    "tiny": "warn",
    "blown": "warn",
    "table": "ok",
    "screen": "ok",
    "micro": "refuse",
}
BLANK_EXPECTED = {"black": "refuse", "wall": "refuse", "sheet": "warn"}

Quad = list[tuple[float, float]]


# ---------------------------------------------------------------- geometry

def place(page: Image.Image, frame: tuple[int, int], quad: Quad, ground: Image.Image | None = None) -> Image.Image:
    """Draw `page` into a `frame`-sized picture with its corners at `quad`
    (fractions of the frame, clockwise from top-left), over `ground` or the desk."""
    fw, fh = frame
    pw, ph = page.size
    dst = [(x * fw, y * fh) for x, y in quad]
    coeffs = find_coeffs([(0, 0), (pw, 0), (pw, ph), (0, ph)], dst)
    warped = page.transform((fw, fh), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(0, 0, 0))
    mask = Image.new("L", (pw, ph), 255).transform((fw, fh), Image.PERSPECTIVE, coeffs, Image.BILINEAR, fillcolor=0)
    base = ground.copy() if ground is not None else Image.new("RGB", (fw, fh), DESK)
    base.paste(warped, (0, 0), mask)
    return base


def frame_for(page: Image.Image) -> tuple[int, int]:
    return page.size


def phone_size(size: tuple[int, int]) -> tuple[int, int]:
    w, h = size
    k = LONG_EDGE / max(w, h)
    return round(w * k), round(h * k)


# ---------------------------------------------------------------- conditions
# Each returns (image at any size, corners or None). `to_phone` scales to the
# phone's long edge afterwards; corners are fractions, so they survive that.

def cond_blur(im: Image.Image, rng: random.Random):
    # Radius in pixels of the 220 DPI render: 6-8 px is ~0.7-0.9 mm on paper,
    # the height of a lowercase letter in 8 pt print.
    out = im.filter(ImageFilter.GaussianBlur(radius=rng.uniform(6.0, 8.0)))
    return cond_flat(out, rng), [(0, 0), (1, 0), (1, 1), (0, 1)]


def motion_kernel(length: int, angle_deg: float) -> np.ndarray:
    k = np.zeros((length, length), dtype=np.float32)
    c = (length - 1) / 2
    t = np.radians(angle_deg)
    for s in np.linspace(-c, c, length * 3):
        x, y = int(round(c + s * np.cos(t))), int(round(c + s * np.sin(t)))
        k[y, x] = 1
    return k / k.sum()


def convolve(a: np.ndarray, k: np.ndarray) -> np.ndarray:
    """Per-channel 2-D convolution by FFT (numpy only; no scipy in the venv)."""
    h, w = a.shape[:2]
    kh, kw = k.shape
    ph, pw = h + kh, w + kw
    kf = np.fft.rfft2(k, s=(ph, pw))
    out = np.empty_like(a)
    for ch in range(a.shape[2]):
        padded = np.pad(a[..., ch], ((0, kh), (0, kw)), mode="edge")
        r = np.fft.irfft2(np.fft.rfft2(padded, s=(ph, pw)) * kf, s=(ph, pw))
        out[..., ch] = r[kh // 2: kh // 2 + h, kw // 2: kw // 2 + w]
    return out


def cond_motion(im: Image.Image, rng: random.Random):
    a = as_float(im)
    k = motion_kernel(rng.randint(21, 29), rng.uniform(-25, 25))
    return cond_flat(from_float(convolve(a, k)), rng), [(0, 0), (1, 0), (1, 1), (0, 1)]


def cond_tilt_hard(im: Image.Image, rng: random.Random):
    # Far edge ~55-60 % of the near edge: the phone held ~40 degrees off the
    # perpendicular. The page is smaller in frame and the desk shows all round.
    k = rng.uniform(0.55, 0.62)
    top = (1 - k) / 2 * 0.8
    quad = [(0.10 + top, 0.08), (0.90 - top, 0.08), (0.95, 0.94), (0.05, 0.94)]
    if rng.random() < 0.5:  # tilted sideways rather than away
        quad = [(0.08, 0.05), (0.92, 0.05 + top), (0.92, 0.95 - top), (0.08, 0.95)]
    out = place(im, frame_for(im), quad)
    a = as_float(out) * gradient(out.size[1], out.size[0], 0.5, 0.0, 0.5, 1.0, 1.02, 0.8)
    return jpeg_roundtrip(from_float(a), rng.randint(70, 80)), quad


def cond_corner_cut(im: Image.Image, rng: random.Random):
    # The page slightly rotated and too close: one corner falls outside the
    # frame, the other three are on the desk.
    corner = rng.randrange(4)
    quad: Quad = [(0.06, 0.04), (0.94, 0.03), (0.95, 0.97), (0.05, 0.96)]
    out_pt = [(-0.07, -0.06), (1.07, -0.06), (1.07, 1.06), (-0.07, 1.06)][corner]
    quad[corner] = out_pt
    out = place(im, frame_for(im), quad)
    return cond_flat(out, rng), quad


def cond_tiny(im: Image.Image, rng: random.Random):
    return cond_flat(im, rng), [(0, 0), (1, 0), (1, 1), (0, 1)]


def cond_micro(im: Image.Image, rng: random.Random):
    return cond_flat(im, rng), [(0, 0), (1, 0), (1, 1), (0, 1)]


def cond_blown(im: Image.Image, rng: random.Random):
    # Stronger than `glare`: a lamp straight above glossy paper clips a wide
    # area to pure white, ink included — print there is gone, not faint.
    # The camera exposes for the whole sheet, so the paper outside the
    # highlight sits well below white (~215-225) — only the reflection clips.
    a = as_float(im) * rng.uniform(0.84, 0.88)
    h, w = a.shape[:2]
    cx, cy = rng.uniform(0.4, 0.6) * w, rng.uniform(0.3, 0.55) * h
    radius = rng.uniform(0.30, 0.36) * w
    ys, xs = np.mgrid[0:h, 0:w]
    d2 = ((xs - cx) ** 2 + (ys - cy) ** 2) / (radius * radius)
    glare = np.clip(1.6 * np.exp(-d2 * 1.2), 0, 1)[..., None]
    a = a + (1.2 - a) * glare
    return jpeg_roundtrip(from_float(a), rng.randint(72, 82)), [(0, 0), (1, 0), (1, 1), (0, 1)]


def busy_ground(size: tuple[int, int], rng: random.Random) -> Image.Image:
    """A wooden table with things on it: grain, a coloured book, a mug ring,
    a second sheet of paper at the edge — strong straight edges that are not
    the page, which is what trips a naive page finder."""
    w, h = size
    nrng = np.random.default_rng(rng.randint(0, 2**31))
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    grain = 0.5 + 0.5 * np.sin(xs / w * 40 + 3 * np.sin(ys / h * 6) + nrng.normal(0, 0.3, (h, w)))
    base = np.stack([0.45 + 0.15 * grain, 0.30 + 0.10 * grain, 0.18 + 0.06 * grain], axis=-1)
    im = from_float(base.astype(np.float32))
    d = ImageDraw.Draw(im)
    d.rectangle([int(0.62 * w), int(0.05 * h), int(0.98 * w), int(0.40 * h)], fill=(40, 70, 140))   # book
    d.rectangle([int(0.64 * w), int(0.08 * h), int(0.96 * w), int(0.12 * h)], fill=(230, 220, 90))  # its label
    d.ellipse([int(0.05 * w), int(0.70 * h), int(0.30 * w), int(0.70 * h + 0.25 * w)], outline=(120, 80, 40), width=max(4, w // 150))
    d.polygon([(0.70 * w, 0.62 * h), (1.02 * w, 0.58 * h), (1.02 * w, 1.02 * h), (0.74 * w, 1.02 * h)], fill=(225, 222, 214))  # other paper
    return im


def cond_table(im: Image.Image, rng: random.Random):
    w, h = im.size
    fw, fh = round(w * 1.6), round(h * 1.25)  # wider frame: landscape-ish shot of a desk
    s = rng.uniform(0.62, 0.68)             # page height as a fraction of the frame
    ph = s
    pw = s * (w / h) * fh / fw
    x0, y0 = rng.uniform(0.08, 0.14), (1 - ph) / 2
    rot = rng.uniform(-0.03, 0.03)
    quad = [(x0 + rot, y0), (x0 + pw + rot, y0 + rot), (x0 + pw - rot, y0 + ph + rot), (x0 - rot, y0 + ph)]
    out = place(im, (fw, fh), quad, busy_ground((fw, fh), rng))
    return jpeg_roundtrip(out, rng.randint(72, 80)), quad


def cond_screen(im: Image.Image, rng: random.Random):
    # The report open on a monitor: an RGB sub-pixel grid resampled at a
    # non-integer ratio (the moire), a cool tint, a dark bezel round it, a
    # slight keystone from holding the phone low.
    w, h = im.size
    a = as_float(im)
    period = 3
    xs = np.arange(w) % period
    stripes = np.stack([(xs == 0), (xs == 1), (xs == 2)], axis=-1).astype(np.float32)
    rows = (np.arange(h) % 4 != 3).astype(np.float32)[:, None, None]
    lit = a * (0.35 + 0.65 * stripes[None, :, :]) * (0.8 + 0.2 * rows)
    lit = lit * np.array([0.88, 0.95, 1.05], dtype=np.float32) + 0.04
    sub = from_float(lit).resize((round(w / 1.37), round(h / 1.37)), Image.NEAREST)
    quad = [(0.08, 0.06), (0.92, 0.07), (0.94, 0.95), (0.06, 0.94)]
    ground = Image.new("RGB", sub.size, (18, 18, 20))
    out = place(sub, sub.size, quad, ground)
    return jpeg_roundtrip(out, rng.randint(72, 82)), quad


CONDITIONS = {
    "blur": cond_blur,
    "motion": cond_motion,
    "tilt_hard": cond_tilt_hard,
    "corner_cut": cond_corner_cut,
    "tiny": cond_tiny,
    "blown": cond_blown,
    "table": cond_table,
    "screen": cond_screen,
    "micro": cond_micro,
}
EDGE = {"tiny": 600, "micro": 200}


def blank(kind: str, rng: random.Random) -> Image.Image:
    w, h = 2268, 3024
    nrng = np.random.default_rng(rng.randint(0, 2**31))
    if kind == "black":
        a = np.clip(nrng.normal(0.035, 0.015, (h, w, 3)), 0, 1)
    elif kind == "sheet":
        # A blank A4 sheet on the desk: not uniform (paper against wood), no
        # print. The photo checks cannot call it blank; the lab-sheet score can.
        sheet = Image.new("RGB", (2100, 2970), (236, 234, 228))
        quad = [(0.1, 0.07), (0.9, 0.08), (0.92, 0.93), (0.08, 0.92)]
        im = place(sheet, (w, h), quad)
        a = as_float(im) * gradient(h, w, 0.0, 0.0, 1.0, 1.0, 1.0, 0.85) + nrng.normal(0, 0.01, (h, w, 3))
    else:
        a = gradient(h, w, 0.0, 0.0, 1.0, 1.0, 0.82, 0.74) * np.array([0.96, 0.94, 0.9]) + nrng.normal(0, 0.01, (h, w, 3))
    return jpeg_roundtrip(from_float(a.astype(np.float32)), 80)


# ---------------------------------------------------------------- two sheets

TWOPAGE_COUNT = 10


def cond_twopage(pages: list[Image.Image], rng: random.Random):
    """Two pages of one report side by side on the desk, as a phone shot
    (docs/plans/photo-highlight.md, the two-sheet guard). Varied per shot: the
    gap between the sheets, a slight rotation and keystone of each, which
    sheet sits higher, and where the light falls. Returns the frame and each
    page's corners (fractions of the frame, clockwise from top-left)."""
    w, h = pages[0].size
    gap = rng.uniform(0.0, 0.10)                  # between the sheets, in page widths
    margin = rng.uniform(0.03, 0.08)
    fw = round(w * (2 + gap + 2 * margin))
    fh = round(h * (1 + 2 * margin))
    pw, ph = w / fw, h / fh                        # one page as a fraction of the frame
    keystone = rng.uniform(0.0, 0.04)              # the far edge a little shorter
    quads: list[Quad] = []
    x = margin * w / fw
    for i in range(2):
        rot = rng.uniform(-0.012, 0.012)           # ~±1.5 degrees, as fractions
        dy = rng.uniform(-0.02, 0.02)
        y0 = (1 - ph) / 2 + dy
        k = keystone * ph / 2
        quads.append([
            (x + rot, y0 + k), (x + pw + rot, y0 - rot + k),
            (x + pw - rot, y0 + ph - rot - k), (x - rot, y0 + ph - k),
        ])
        x += pw + gap * w / fw
    frame = Image.new("RGB", (fw, fh), DESK)
    for page, quad in zip(pages, quads):
        frame = place(page, (fw, fh), quad, frame)
    a = as_float(frame)
    x0, y0, x1, y1 = rng.choice([(0, 0, 1, 1), (1, 0, 0, 1), (0.5, 0, 0.5, 1), (0, 0.5, 1, 0.5)])
    a = a * gradient(fh, fw, x0, y0, x1, y1, rng.uniform(1.0, 1.06), rng.uniform(0.7, 0.9))
    return jpeg_roundtrip(from_float(a), rng.randint(70, 80)), quads


def twopage_shots(pdfs: list[Path], baseline: set[str]) -> list[tuple[Path, int, int]]:
    """Ten page pairs, one per report, skipping the report simulate_photos
    already shoots as a two-page photo; a report with a third scored page
    contributes pages 2+3 instead of 1+2, so the pairs vary."""
    out: list[tuple[Path, int, int]] = []
    for pdf in pdfs[1:]:
        scored = [n for n in range(1, 5) if f"{pdf.name}#{n}" in baseline]
        if len(scored) < 2:
            continue
        a, b = (scored[1], scored[2]) if len(scored) >= 3 else (scored[0], scored[1])
        out.append((pdf, a, b))
    return out[:TWOPAGE_COUNT]


# ------------------------------------------------- sheets filling the frame
# No page edge in the picture, so the page finder cannot find it and OCR reads
# the photo as it is (docs/plans/photo-highlight.md, the no-page guards).

FILL_TILTS = (2.0, 3.0, 5.0)
FILL_PER_TILT = 3
FILL_TWOPAGE_COUNT = 3


def rotated_quad(theta_deg: float, frame: tuple[int, int], page: tuple[int, int], scale: float, cx: float = 0.5, cy: float = 0.5) -> Quad:
    """A page of `page` size scaled by `scale`, turned by theta about (cx, cy),
    as corners in fractions of `frame`, clockwise from top-left."""
    fw, fh = frame
    pw, ph = page[0] * scale, page[1] * scale
    t = np.radians(theta_deg)
    c, s = np.cos(t), np.sin(t)
    out: Quad = []
    for dx, dy in ((-pw / 2, -ph / 2), (pw / 2, -ph / 2), (pw / 2, ph / 2), (-pw / 2, ph / 2)):
        x = cx * fw + dx * c - dy * s
        y = cy * fh + dx * s + dy * c
        out.append((float(x / fw), float(y / fh)))
    return out


def cond_fill_tilt(im: Image.Image, theta: float, rng: random.Random):
    """The sheet held a few degrees off level and so close it fills the frame:
    scaled just enough that the frame lies wholly inside the turned page."""
    w, h = im.size
    t = np.radians(abs(theta))
    scale = max(np.cos(t) + (h / w) * np.sin(t), (w / h) * np.sin(t) + np.cos(t)) * 1.01
    quad = rotated_quad(theta, (w, h), (w, h), scale)
    return cond_flat(place(im, (w, h), quad), rng), quad


def cond_fill_twopage(pages: list[Image.Image], rng: random.Random):
    """Two sheets side by side, so close that no outer page edge is in frame:
    the frame shows the inner 90 % of their height and cuts both outer sides.
    A sliver of desk may show between them."""
    w, h = pages[0].size
    gap = rng.uniform(0.0, 0.02) * w
    fw, fh = round(2 * w * 0.93 + gap), round(h * 0.9)
    quads: list[Quad] = []
    for i in range(2):
        cx = (fw / 2 + (-1 if i == 0 else 1) * (gap / 2 + w / 2)) / fw
        quads.append(rotated_quad(rng.uniform(-0.6, 0.6), (fw, fh), (w, h), 1.0, cx, 0.5 + rng.uniform(-0.01, 0.01)))
    frame = Image.new("RGB", (fw, fh), DESK)
    for page, quad in zip(pages, quads):
        frame = place(page, (fw, fh), quad, frame)
    return cond_flat(frame, rng), quads


# --------------------------------------------------------- angle truth corners

def angle_quad(source: str, n: int) -> Quad:
    """The corners `simulate_photos.cond_angle` drew for this page — its first
    two random draws replayed with the same seed. If that function's draws
    change, this goes stale: `corner accuracy` on angle will say so loudly."""
    rng = random.Random(f"{source}#{n}#angle")
    k = rng.uniform(0.80, 0.86)
    inset = (1 - k) / 2
    if rng.random() < 0.5:
        return [(0.04, 0.02), (0.93, inset + 0.02), (0.92, 1 - inset - 0.02), (0.02, 0.98)]
    return [(0.07, inset + 0.02), (0.96, 0.02), (0.98, 0.98), (0.08, 1 - inset - 0.02)]


# ---------------------------------------------------------------- main

def main() -> int:
    pdfs = sorted(p for p in SAMPLES.glob("*.pdf") if p.is_file() or p.is_symlink())
    if not pdfs:
        print(f"no PDFs under {SAMPLES}", file=sys.stderr)
        return 1
    baseline = baseline_keys()
    firsts = [p for p in pdfs if f"{p.name}#1" in baseline] if baseline else pdfs
    step = max(len(firsts) // SOURCE_COUNT, 1)
    chosen = firsts[::step][:SOURCE_COUNT]

    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}
    for pdf in chosen:
        im = render(pymupdf.open(pdf)[0])
        stem = pdf.name[:-4]
        for cond, fn in CONDITIONS.items():
            rng = random.Random(f"{pdf.name}#1#bad#{cond}")
            out, quad = fn(im, rng)
            out = to_phone(out)
            if cond in EDGE:
                w, h = out.size
                k = EDGE[cond] / max(w, h)
                out = out.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
            name = f"{stem}_p1_{cond}.jpg"
            out.save(OUT / name, "JPEG", quality=JPEG_QUALITY, optimize=True)
            manifest[name] = {"source_file": pdf.name, "pages": [1], "condition": cond,
                              "expected": EXPECTED[cond], "corners": [list(map(float, c)) for c in quad]}
    # Two sheets in one frame. `corners` stays null (there is no one page);
    # `page_corners` holds each page's corners, index-aligned with `pages`.
    for pdf, a, b in twopage_shots(pdfs, baseline):
        doc = pymupdf.open(pdf)
        rng = random.Random(f"{pdf.name}#{a}-{b}#bad#twopage")
        out, quads = cond_twopage([render(doc[a - 1]), render(doc[b - 1])], rng)
        name = f"{pdf.name[:-4]}_p{a}-{b}_twopage.jpg"
        to_phone(out).save(OUT / name, "JPEG", quality=JPEG_QUALITY, optimize=True)
        manifest[name] = {"source_file": pdf.name, "pages": [a, b], "condition": "twopage", "expected": "ok",
                          "corners": None, "page_corners": [[list(map(float, c)) for c in q] for q in quads]}
    # Sheets filling the frame: tilted a few degrees, and two sheets side by side.
    fill_sources = [p for p in pdfs if f"{p.name}#1" in baseline] if baseline else pdfs
    k = 0
    for theta in FILL_TILTS:
        for j in range(FILL_PER_TILT):
            pdf = fill_sources[(k * 5 + 2) % len(fill_sources)]
            k += 1
            rng = random.Random(f"{pdf.name}#1#bad#fill_tilt{theta}#{j}")
            signed = theta if rng.random() < 0.5 else -theta
            out, quad = cond_fill_tilt(render(pymupdf.open(pdf)[0]), signed, rng)
            cond = f"fill_tilt{int(theta)}"
            name = f"{pdf.name[:-4]}_p1_{cond}.jpg"
            to_phone(out).save(OUT / name, "JPEG", quality=JPEG_QUALITY, optimize=True)
            manifest[name] = {"source_file": pdf.name, "pages": [1], "condition": cond, "expected": "ok",
                              "corners": [list(map(float, c)) for c in quad]}
    for pdf, a, b in twopage_shots(pdfs, baseline)[-FILL_TWOPAGE_COUNT:]:
        doc = pymupdf.open(pdf)
        rng = random.Random(f"{pdf.name}#{a}-{b}#bad#fill_twopage")
        out, quads = cond_fill_twopage([render(doc[a - 1]), render(doc[b - 1])], rng)
        name = f"{pdf.name[:-4]}_p{a}-{b}_fill_twopage.jpg"
        to_phone(out).save(OUT / name, "JPEG", quality=JPEG_QUALITY, optimize=True)
        manifest[name] = {"source_file": pdf.name, "pages": [a, b], "condition": "fill_twopage", "expected": "ok",
                          "corners": None, "page_corners": [[list(map(float, c)) for c in q] for q in quads]}
    for kind, expected in BLANK_EXPECTED.items():
        name = f"blank_{kind}.jpg"
        blank(kind, random.Random(f"blank#{kind}")).save(OUT / name, "JPEG", quality=JPEG_QUALITY)
        manifest[name] = {"source_file": None, "pages": [], "condition": kind, "expected": expected, "corners": None}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    corners: dict[str, list] = {}
    sim_manifest = SIM / "manifest.json"
    if sim_manifest.exists():
        for name, m in json.loads(sim_manifest.read_text(encoding="utf-8")).items():
            if m["condition"] == "angle":
                corners[name] = [list(c) for c in angle_quad(m["source_file"], m["pages"][0])]
        (OUT / "corners_angle.json").write_text(json.dumps(corners, indent=1) + "\n", encoding="utf-8")

    print(f"{len(chosen)} source pages x {len(CONDITIONS)} conditions + {len(BLANK_EXPECTED)} blanks "
          f"= {len(manifest)} files -> {OUT}; angle corners for {len(corners)} sim photos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
