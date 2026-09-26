"""Replay the photo simulator and record the geometry it applied (docs/plans/photo-highlight.md, step 1).

`tools/pipeline/scripts/simulate_photos.py` is not changed. This script runs its
own `main()` with the output directory pointed at a scratch folder and with the
three geometric operations it uses (`Image.transform`, `Image.rotate`,
`to_phone`) wrapped so that their arguments are recorded. Then it checks that
every photo it re-made is byte-identical to the one in `data/photos-sim/` — if
it is not, the recorded geometry is not the geometry of the photo, and the
script fails.

Per photo it writes a 3x3 homography per source page: PDF points (top-left
origin, y down, the page's own width/height) -> photo pixels. It also writes
the oracle flattening (photo-highlight.md: "use the inverse of the simulator's
known transform as an oracle flattening and label it so") for the two
conditions that move geometry: `angle` (inverse perspective) and `twopage`
(each page cut out and rotated back). flat/dark/glare/crop carry no geometry,
so their flattened image *is* the original.

    BW_ROOT=/path/to/checkout-with-data .venv-mac/bin/python tests/bench/highlight/replay_transforms.py

Everything it writes lands in $BW_ROOT/tests/bench/results/highlight/ (git-ignored).
"""
from __future__ import annotations

import filecmp
import json
import math
import os
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image

HERE = Path(__file__).resolve()
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO / "tools" / "pipeline"))
from scripts import simulate_photos as sim  # noqa: E402

BW_ROOT = Path(os.environ.get("BW_ROOT", REPO)).resolve()
PHOTOS = BW_ROOT / "data" / "photos-sim"
OUT = BW_ROOT / "tests" / "bench" / "results" / "highlight"


def mat_scale(sx: float, sy: float) -> np.ndarray:
    return np.array([[sx, 0, 0], [0, sy, 0], [0, 0, 1]], dtype=np.float64)


def mat_shift(tx: float, ty: float) -> np.ndarray:
    return np.array([[1, 0, tx], [0, 1, ty], [0, 0, 1]], dtype=np.float64)


def pil_rotate_forward(angle_deg: float, w: int, h: int) -> np.ndarray:
    """Input -> output pixel map of `Image.rotate(angle, expand=False)`: counter-clockwise about (w/2, h/2)."""
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    cx, cy = w / 2.0, h / 2.0
    # y points down, so a counter-clockwise turn on screen is x' = c*dx + s*dy, y' = -s*dx + c*dy.
    rot = np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]], dtype=np.float64)
    return mat_shift(cx, cy) @ rot @ mat_shift(-cx, -cy)


def check_rotate_semantics() -> None:
    """Prove `pil_rotate_forward` against PIL itself on a single bright dot."""
    w, h, px, py = 400, 300, 300, 60
    im = Image.new("L", (w, h), 0)
    im.putpixel((px, py), 255)
    for ang in (1.3, -1.4, 20.0):
        out = np.asarray(im.rotate(ang, Image.BICUBIC, expand=False, fillcolor=0), dtype=np.float64)
        ys, xs = np.nonzero(out > out.max() * 0.5)
        got = (xs.mean(), ys.mean())
        want = pil_rotate_forward(ang, w, h) @ np.array([px + 0.5, py + 0.5, 1.0])
        if abs(got[0] + 0.5 - want[0]) > 1.0 or abs(got[1] + 0.5 - want[1]) > 1.0:
            raise SystemExit(f"rotate semantics wrong at {ang}: PIL {got}, model {want[:2]}")


# ---------------------------------------------------------------- recording

class Recorder:
    def __init__(self) -> None:
        self.current: dict | None = None
        self.done: list[dict] = []

    def start(self, cond: str, sizes: list[tuple[int, int]]) -> None:
        self.current = {"condition": cond, "render_sizes": sizes, "ops": []}


REC = Recorder()


def wrap_condition(cond: str, fn):
    def inner(im, rng):
        REC.start(cond, [im.size])
        return fn(im, rng)
    return inner


def wrap_twopage(fn):
    def inner(pages, rng):
        REC.start("twopage", [p.size for p in pages[:2]])
        return fn(pages, rng)
    return inner


_orig_transform = Image.Image.transform
_orig_rotate = Image.Image.rotate
_orig_crop = Image.Image.crop


def rec_transform(self, size, method, data=None, *a, **k):
    if REC.current is not None and method == Image.PERSPECTIVE:
        REC.current["ops"].append({"op": "perspective", "size": list(size), "coeffs": [float(c) for c in data]})
    return _orig_transform(self, size, method, data, *a, **k)


def rec_rotate(self, angle, *a, **k):
    if REC.current is not None:
        REC.current["ops"].append({"op": "rotate", "angle": float(angle), "size": list(self.size)})
    return _orig_rotate(self, angle, *a, **k)


def rec_crop(self, box=None):
    if REC.current is not None and box is not None:
        REC.current["ops"].append({"op": "crop", "box": [int(v) for v in box]})
    return _orig_crop(self, box)


_orig_to_phone = sim.to_phone


def rec_to_phone(im):
    out = _orig_to_phone(im)
    assert REC.current is not None
    REC.current["pre_phone_size"] = list(im.size)
    REC.current["photo_size"] = list(out.size)
    REC.done.append(REC.current)
    REC.current = None
    return out


# ---------------------------------------------------------------- geometry

def page_homographies(rec: dict, manifest_entry: dict, pdf_sizes: dict) -> list[dict]:
    """PDF points -> photo pixels, one per source page in the photo."""
    src = manifest_entry["source_file"]
    pw, ph = rec["pre_phone_size"]
    fw, fh = rec["photo_size"]
    phone = mat_scale(fw / pw, fh / ph)
    out = []
    for i, page in enumerate(manifest_entry["pages"]):
        pdf_w, pdf_h = pdf_sizes[f"{src}#{page}"]
        rw, rh = rec["render_sizes"][i]
        render = mat_scale(rw / pdf_w, rh / pdf_h)
        cond = rec["condition"]
        if cond in ("flat", "dark", "glare", "crop"):
            geo = np.eye(3)
        elif cond == "angle":
            (op,) = [o for o in rec["ops"] if o["op"] == "perspective"]
            a, b, c, d, e, f, g, h = op["coeffs"]
            inv = np.array([[a, b, c], [d, e, f], [g, h, 1.0]])  # output -> input
            geo = np.linalg.inv(inv)
        elif cond == "twopage":
            rots = [o for o in rec["ops"] if o["op"] == "rotate"]
            w, h = rec["render_sizes"][0]
            gap, margin = round(w * 0.04), round(w * 0.05)
            geo = mat_shift(margin + i * (w + gap), margin) @ pil_rotate_forward(rots[i]["angle"], *rots[i]["size"])
        else:
            raise ValueError(cond)
        H = phone @ geo @ render
        out.append({"page": page, "pdf_size": [pdf_w, pdf_h], "H": (H / H[2, 2]).tolist(),
                    "geo_render_to_prephone": (geo / geo[2, 2]).tolist(),
                    "render_size": [rw, rh]})
    return out


def flatten(name: str, rec: dict, pages: list[dict]) -> list[dict]:
    """Oracle flattening: each page back to an axis-aligned page image at the photo's scale."""
    photo = Image.open(PHOTOS / name).convert("RGB")
    pw, ph = rec["pre_phone_size"]
    fw, fh = rec["photo_size"]
    sx, sy = fw / pw, fh / ph
    flats = []
    for i, pg in enumerate(pages):
        rw, rh = pg["render_size"]
        tw, th = round(rw * sx), round(rh * sy)
        # flat pixel -> render pixel -> pre-phone (geo) -> photo pixel
        geo = np.array(pg["geo_render_to_prephone"])
        F = mat_scale(sx, sy) @ geo @ mat_scale(rw / tw, rh / th)
        F = F / F[2, 2]
        coeffs = [F[0, 0], F[0, 1], F[0, 2], F[1, 0], F[1, 1], F[1, 2], F[2, 0], F[2, 1]]
        flat = photo.transform((tw, th), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=sim.DESK)
        suffix = "" if len(pages) == 1 else f"_page{pg['page']}"
        fname = name.replace(".jpg", f"{suffix}.flat.jpg")
        (OUT / "flat").mkdir(parents=True, exist_ok=True)
        flat.save(OUT / "flat" / fname, "JPEG", quality=95)
        pdf_w, pdf_h = pg["pdf_size"]
        Hf = mat_scale(tw / pdf_w, th / pdf_h)
        flats.append({"file": fname, "page": pg["page"], "size": [tw, th], "H": Hf.tolist()})
    return flats


def main() -> int:
    check_rotate_semantics()
    samples = BW_ROOT / "samples"
    sim.SAMPLES = samples
    sim.REPORTS = BW_ROOT / "data" / "reports"
    scratch = Path(tempfile.mkdtemp(prefix="replay-photos-"))
    sim.OUT = scratch

    sim.CONDITIONS = {k: wrap_condition(k, v) for k, v in sim.CONDITIONS.items()}
    sim.cond_crop = wrap_condition("crop", sim.cond_crop)
    sim.cond_twopage = wrap_twopage(sim.cond_twopage)
    sim.to_phone = rec_to_phone
    Image.Image.transform = rec_transform
    Image.Image.rotate = rec_rotate
    Image.Image.crop = rec_crop
    try:
        rc = sim.main()
    finally:
        Image.Image.transform = _orig_transform
        Image.Image.rotate = _orig_rotate
        Image.Image.crop = _orig_crop
    if rc:
        return rc

    manifest = json.loads((PHOTOS / "manifest.json").read_text(encoding="utf-8"))
    replayed = json.loads((scratch / "manifest.json").read_text(encoding="utf-8"))
    if list(manifest) != list(replayed) or manifest != replayed:
        raise SystemExit("replayed manifest differs from data/photos-sim/manifest.json")
    if len(REC.done) != len(manifest):
        raise SystemExit(f"recorded {len(REC.done)} emits for {len(manifest)} photos")
    mismatched = [n for n in manifest if not filecmp.cmp(PHOTOS / n, scratch / n, shallow=False)]
    # The re-made photos are patient pages; they do not outlive the comparison.
    shutil.rmtree(scratch, ignore_errors=True)
    if mismatched:
        raise SystemExit(f"{len(mismatched)} replayed photos are not byte-identical, e.g. {mismatched[:3]}")

    pdf_sizes: dict[str, tuple[float, float]] = {}
    for src in {m["source_file"] for m in manifest.values()}:
        doc = pymupdf.open(samples / src)
        for i, page in enumerate(doc, start=1):
            r = page.rect
            pdf_sizes[f"{src}#{i}"] = (r.width, r.height)

    out: dict[str, dict] = {}
    for (name, entry), rec in zip(manifest.items(), REC.done):
        if rec["condition"] != entry["condition"]:
            raise SystemExit(f"emit order drifted at {name}")
        pages = page_homographies(rec, entry, pdf_sizes)
        item = {**entry, "photo_size": rec["photo_size"], "pages_geo": pages}
        if entry["condition"] in ("angle", "twopage"):
            item["flat"] = flatten(name, rec, pages)
            item["flat_kind"] = "oracle"
        out[name] = item

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "transforms.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"{len(out)} photos replayed byte-identically; transforms -> {OUT / 'transforms.json'}")
    print(f"oracle-flattened: {sum(len(v.get('flat', [])) for v in out.values())} page images -> {OUT / 'flat'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
