"""Fetch public Czech/Slovak lab handbooks and find the pages that are sample result sheets.

Most "laboratorní příručka" PDFs contain no sheet at all — 13 of the 16 fetched
on 2026-09-06 had none — so this script does the boring part: download a list
of PDF URLs, score every page, render the few that look like a sheet, and leave
the eye check to a human. Nothing here is patient data: the sheets we are after
are the labs' own published samples with fictitious or redacted patients.

    python3 -m scripts.fetch_public_sheets data/public-sheets/fetched/urls.txt
    python3 -m scripts.fetch_public_sheets https://example.cz/prirucka.pdf ...

A page is "sheet-like" if its text layer has at least ROWS_NEEDED visual lines
of the shape *name  number  [flag]  [unit]  range* (words regrouped by baseline,
because get_text() splits table columns into separate lines), or if a bitmap
covering a quarter or more of the page sits next to one of the SHEET_WORDS (a
scanned sample pasted into an appendix). Reference-range tables still slip
through the first rule; the eye check is what decides.

Outputs, all git-ignored under data/public-sheets/fetched/:
    <slug>.pdf                      the download
    renders/<slug>_p<N>.png         candidate pages at 110 DPI
    candidates.md                   one line per candidate, for the eye check
"""
from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import unquote, urlparse

import pymupdf

# What to search for, and where. The searching itself is done by hand (or by a
# web-search tool) — this table only records the queries that were worth asking.
SEEDS = [
    ("laboratorní příručka výsledkový list vzor", None),
    ("vzor výsledkového listu", None),
    ("příloha výsledkový list vzor", None),
    ("laboratórna príručka výsledkový list vzor", None),
    ("OpenLIMS výsledkový list", None),
    ("LabSys výsledkový list", None),
    ("nálezový list vzor laboratoř", None),
    ("ukázka výsledkového listu", None),
    ("výsledkový list ISO 15189 vzor", None),
]
DOMAINS = [
    "unilabs.cz", "synlab.cz", "citylab.cz", "vidia.cz", "agellab.cz",
    "fnmotol.cz", "vfn.cz", "fnbrno.cz", "fnol.cz", "fno.cz", "fnhk.cz",
    "fnplzen.cz", "ikem.cz", "uvn.cz", "medirex.sk", "alphamedical.sk",
    "klinlab.cz", "sanglab.cz", "medila.cz", "mediekos.cz",
    "stapro.cz", "icz.cz", "dssoft.cz",
]
SEEDS += [(q, d) for d in DOMAINS for q in ("výsledkový list vzor", "laboratorní příručka")]

OUT = Path(__file__).resolve().parent.parent.parent.parent / "data" / "public-sheets" / "fetched"
RENDERS = OUT / "renders"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14) bloodwork-sheet-survey/1.0"
TIMEOUT_S = 60
MAX_BYTES = 30 * 1024 * 1024
ROWS_NEEDED = 8
DPI = 110

SHEET_WORDS = ("Výsledkový list", "Vzor výsledk", "vzor", "Výsledok", "Ref. meze", "Referenční", "Referenčné")
# name, a number, a unit, then a reference range — the shape of a result row.
# Requiring the range is what keeps needle lists ("Sarstedt 2,7 ml NaF") and
# phone directories out; a real sheet prints the range on nearly every row.
NUM = r"[<>]?\d+[.,]?\d*"
ROW = re.compile(
    rf"^[A-Za-zÁ-ž][A-Za-zÁ-ž0-9 ()/,._+-]{{1,40}}?\s+{NUM}\s+(?:[A-Z*!↑↓]{{1,2}}\s+)?"  # value, lab's own flag
    rf"(?:[a-zA-Zµμ%][a-zA-Zµμ/*^0-9]{{0,8}}\s+)?\(?\s*{NUM}\s*[-–]\s*{NUM}\s*\)?"  # unit, range
)


def slug_for(url: str) -> str:
    p = urlparse(url)
    host = p.netloc.replace("www.", "").split(".")[0]
    name = unquote(Path(p.path).stem).lower()
    name = re.sub(r"[^a-z0-9]+", "_", name).strip("_")[:40]
    return f"{host}_{name}" if name else host


def download(url: str, dest: Path) -> bool:
    if dest.exists():
        return True
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            length = int(r.headers.get("Content-Length") or 0)
            if length > MAX_BYTES:
                print(f"  skip >30 MB ({length} B)")
                return False
            data = r.read(MAX_BYTES + 1)
    except Exception as e:  # noqa: BLE001 — one bad host must not stop the batch
        print(f"  failed: {e}")
        return False
    if len(data) > MAX_BYTES or not data.startswith(b"%PDF"):
        print("  skip: too large or not a PDF")
        return False
    dest.write_bytes(data)
    return True


def visual_lines(page) -> list[str]:
    """Words regrouped by baseline, left to right — a table row is one line here,
    whereas get_text() splits every column into its own line."""
    rows: dict[int, list[tuple[float, str]]] = {}
    for x0, _y0, _x1, y1, word, *_ in page.get_text("words"):
        rows.setdefault(round(y1 / 3), []).append((x0, word))
    return [" ".join(w for _, w in sorted(r)) for _, r in sorted(rows.items())]


def score_page(page) -> tuple[str, int] | None:
    """Return (reason, strength) when the page looks like a result sheet."""
    text = page.get_text()
    rows = sum(1 for line in visual_lines(page) if ROW.match(line))
    if rows >= ROWS_NEEDED:
        return "rows", rows
    words = [w for w in SHEET_WORDS if w.lower() in text.lower()]
    if words:
        area = page.rect.get_area()
        for img in page.get_image_info():
            if pymupdf.Rect(img["bbox"]).get_area() > 0.25 * area:  # Břeclav pastes its vzor at ~28 % of the page
                return "bitmap+" + words[0], 1
    return None


def scan(pdf: Path, url: str, out) -> int:
    try:
        doc = pymupdf.open(pdf)
    except Exception as e:  # noqa: BLE001
        print(f"  unreadable: {e}")
        return 0
    hits = 0
    for page in doc:
        found = score_page(page)
        if not found:
            continue
        reason, strength = found
        n = page.number + 1
        png = RENDERS / f"{pdf.stem}_p{n}.png"
        page.get_pixmap(dpi=DPI).save(png)
        out.write(f"- {pdf.name} p{n}  {reason}={strength}  {png.relative_to(OUT)}  {url}\n")
        hits += 1
    print(f"  {doc.page_count} pages, {hits} candidate(s)")
    return hits


def main(argv: list[str]) -> None:
    urls: list[str] = []
    for arg in argv:
        if arg.startswith("http"):
            urls.append(arg)
        else:
            urls += [l.strip() for l in Path(arg).read_text().splitlines() if l.strip() and not l.startswith("#")]
    if not urls:
        sys.exit(__doc__)
    RENDERS.mkdir(parents=True, exist_ok=True)
    with (OUT / "candidates.md").open("a") as out:
        for url in urls:
            slug = slug_for(url)
            print(f"{slug}  {url}")
            pdf = OUT / f"{slug}.pdf"
            if download(url, pdf):
                scan(pdf, url, out)


if __name__ == "__main__":
    main(sys.argv[1:])
