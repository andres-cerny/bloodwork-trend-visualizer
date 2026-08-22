"""Generate the pre-baked demo dataset — synthetic, publishable, no real patient.

Builds Czech lab-report PDFs from scratch, renders them exactly as the real
pipeline does (220 DPI, PyMuPDF), locates each row with the same
``search_for`` call ``src/locate.py`` uses, and normalizes every value through
``src/normalize.py``. So the shipped demo is produced by the real deterministic
code path, not hand-written JSON — and it contains no real medical data at all.

The data is shaped to exercise the parts of the UI that carry the pitch:
out-of-range trends, a censored value, a qualitative value, an unmapped
analyte name for the mapping tab, and rows carrying low confidence or a
model disagreement for the verification tab.

    python3 -m scripts.make_demo_data
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from scripts._fonts import czech_fonts  # noqa: E402

FONT, FONT_BOLD = czech_fonts()

# Typical adult intervals, used only to tell analytes apart when mapping.
# Never used to decide whether a result is abnormal — that comes from the
# interval printed on the patient's own report.
REF_RANGES: dict[str, list[float]] = json.loads(
    (Path(__file__).resolve().parent / "reference_ranges.json").read_text("utf-8")
)["ranges"]
sys.path.insert(0, str(ROOT))

from src.matching import Registry, norm_key  # noqa: E402
from src.models import AnalyteDef, Measurement  # noqa: E402
from src.normalize import normalize_measurement  # noqa: E402

OUT = ROOT / "web" / "public" / "demo"
IMG_DIR = OUT / "pages"
RENDER_DPI = 220


PATIENT_NAME = "Jan Ukázka"
PATIENT_ID = "800101/0006"  # synthetic; satisfies mod 11 so the app can decode it
LAB_NAME = "Laboratoř Demo s.r.o."

# (printed name, unit, ref range, [value per report]) — ten sample draws.
# Values tell a two-and-a-half-year story a doctor would recognise: cholesterol,
# triacylglycerols, ALT and GGT drifting up and out of range, vitamin D climbing
# from below range into it, ferritin falling, glucose creeping toward the top of
# its interval, and a haemogram that stays flat.
#
# The headline analytes end at their highest. The summary compares only the two
# most recent draws (see docs/design-notes.md), so a demo whose last point dips
# would print "−9 %" beside a chart showing two years of rise — the dataset must
# not manufacture the one case the summary reads wrong.
#
# Ten draws rather than four because several defects only appear with a longer
# series — an axis that spaces points by index, a summary that reads the last
# two draws and misses a monotonic rise, a chart that flattens a real slope.
ROWS: list[tuple[str, str, str, list[str]]] = [
    ("S_Glukóza",            "mmol/l",  "(4,11-5,60)",
     ["4,62", "4,45", "4,88", "5,02", "5,15", "5,10", "5,28", "5,32", "5,44", "5,58"]),
    ("S_Cholesterol",        "mmol/l",  "(2,90-5,00)",
     ["4,52", "4,80", "4,95", "5,20", "5,41", "5,64", "5,82", "6,01", "6,18", "6,32"]),
    ("S_HDL cholesterol",    "mmol/l",  "(1,00-2,10)",
     ["1,48", "1,42", "1,40", "1,38", "1,30", "1,21", "1,18", "1,15", "1,12", "1,09"]),
    ("S_Triacylglyceroly",   "mmol/l",  "(0,45-1,70)",
     ["1,38", "1,52", "1,61", "1,74", "1,88", "1,98", "2,14", "2,31", "2,42", "2,55"]),
    ("S_ALT",                "µkat/l",  "(0,17-0,78)",
     ["0,61", "0,58", "0,66", "0,72", "0,79", "0,84", "0,88", "0,93", "0,97", "1,02"]),
    ("S_AST",                "µkat/l",  "(0,17-0,85)",
     ["0,44", "0,48", "0,50", "0,52", "0,55", "0,57", "0,59", "0,60", "0,63", "0,66"]),
    ("S_GGT",                "µkat/l",  "(0,14-0,84)",
     ["0,58", "0,66", "0,71", "0,79", "0,86", "0,91", "0,98", "1,04", "1,11", "1,18"]),
    ("S_Kreatinin",          "µmol/l",  "(62,00 - 110)",
     ["86", "88", "90", "91", "93", "94", "92", "89", "90", "88"]),
    ("S_Urea",               "mmol/l",  "(2,80-8,00)",
     ["4,92", "5,10", "5,28", "5,44", "5,71", "5,90", "5,75", "5,62", "5,50", "5,38"]),
    ("S_Kyselina močová",    "µmol/l",  "(202-417)",
     ["318", "331", "344", "358", "366", "377", "385", "392", "401", "409"]),
    ("S_Sodík",              "mmol/l",  "137-145",
     ["140", "141", "139", "140", "142", "142", "141", "141", "140", "142"]),
    ("S_Draslík",            "mmol/l",  "(3,80-5,20)",
     ["4,25", "4,32", "4,38", "4,41", "4,35", "4,28", "4,44", "4,50", "4,41", "4,36"]),
    # Censored on every draw but one: a CRP measured ten times and reported
    # "<1,0" nine of them has exactly one numeric point, which must not be
    # drawn as a trend.
    ("S_CRP",                "mg/l",    "(1,0-5,0)",
     ["<1,0", "<1,0", "<1,0", "<1,0", "<1,0", "2,4", "<1,0", "<1,0", "<1,0", "<1,0"]),
    ("B_Hemoglobin",         "g/l",     "(135-175)",
     ["146", "148", "149", "150", "148", "147", "148", "149", "151", "150"]),
    ("B_Leukocyty",          "10^9/l",  "(4,00-10,00)",
     ["6,05", "6,20", "6,38", "6,55", "6,82", "7,10", "6,95", "6,80", "7,04", "6,72"]),
    ("B_Trombocyty",         "10^9/l",  "(150-400)",
     ["236", "243", "248", "251", "245", "238", "250", "262", "255", "248"]),
    ("B_Erytrocyty",         "10^12/l", "(4,20-5,80)",
     ["4,86", "4,91", "4,90", "4,88", "4,92", "4,95", "4,98", "5,02", "5,06", "4,99"]),
    ("S_TSH",                "mIU/l",   "(0,270-4,200)",
     ["1,92", "2,11", "2,28", "2,44", "2,62", "2,80", "2,98", "3,15", "3,32", "3,41"]),
    ("S_Feritin",            "µg/l",    "(30-400)",
     ["124", "112", "108", "104", "99", "96", "92", "88", "84", "80"]),
    ("S_Vitamin D",          "nmol/l",  "(75-125)",
     ["52", "58", "61", "64", "68", "71", "76", "80", "88", "96"]),
    # Deliberately unmapped: exercises the mapping tab. Not in the registry
    # under this printed spelling.
    ("S_Homocystein tot.",   "µmol/l",  "(5,0-15,0)",
     ["10,6", "11,2", "11,8", "12,4", "12,8", "13,1", "13,6", "14,0", "14,4", "14,9"]),
    # Qualitative — must never become a trend number.
    ("U_Bílkovina",          "-",       "negativní",
     ["negativní"] * 7 + ["stopy"] + ["negativní"] * 2),
]

# Ten draws over four years — two to three a year, which is what routine
# follow-up actually looks like. Unevenly spaced on purpose: four months apart
# and then seven months apart are different clinical facts, and an axis that
# spaces points by index renders them identically. Every date is in the past.
DATES = [
    "2022-02-08", "2022-09-13", "2023-01-24", "2023-06-06", "2023-11-14",
    "2024-04-16", "2024-10-08", "2025-03-11", "2025-09-23", "2026-04-14",
]

# Rows the "two models disagreed" / "hard to read" story hangs on, per report
# index. (row index, kind).
#
# Spread across the series rather than bunched at the start: a reviewer should
# find work on a recent report too, not only in the oldest history. Exactly one
# row is a misread — it is the demo's central claim, and a second one would
# only dilute it.
QA_MARKS: dict[int, list[tuple[int, str]]] = {
    # Row 12 is CRP, whose value is the censored "<1,0" on most reports —
    # marking it uncertain on one report only made identical printed text tell
    # two different stories across documents. Row 7 (kreatinin) is a plain
    # number, so the flag reads as being about legibility, which is what it
    # means.
    0: [(4, "disagreement"), (7, "low")],
    1: [(0, "misread")],
    3: [(9, "low"), (20, "disagreement")],
    5: [(1, "disagreement")],
    7: [(17, "low")],
    9: [(6, "disagreement")],
}

# One deliberately misread row, so the demo can show the check that matters
# most: a decimal point transcribed in the wrong place. The printed page keeps
# the correct value — only the extracted row is wrong, which is exactly the
# failure the verification tab exists to catch.
MISREAD_FACTOR = 10


def _nudge(value: str) -> str:
    """A plausible misreading of a printed value, for the demo's QA flags.

    Shifts one digit rather than inventing an unrelated number — a real
    disagreement between two reads looks like a confusable glyph, not noise.
    """
    digits = [i for i, c in enumerate(value) if c.isdigit()]
    if not digits:
        return value
    i = digits[-1]
    # Confusable pairs, and never a no-op: a "disagreement" showing the same
    # number twice is worse than no flag at all.
    swapped = {"0": "8", "1": "7", "2": "7", "3": "8", "4": "9",
               "5": "6", "6": "5", "7": "1", "8": "3", "9": "4"}
    replacement = swapped[value[i]]
    assert replacement != value[i]
    return value[:i] + replacement + value[i + 1:]


def cz_date(iso: str) -> str:
    y, m, d = iso.split("-")
    return f"{int(d)}.{int(m)}.{y}"


def build_pdf(path: Path, date_iso: str, rows: list[tuple[str, str, str, str]]) -> None:
    """Render one synthetic Czech lab report to a real PDF (with a text layer)."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)  # A4 points
    page.insert_font(fontname="dj", fontfile=FONT)
    page.insert_font(fontname="djb", fontfile=FONT_BOLD)

    page.insert_text((50, 60), LAB_NAME, fontname="djb", fontsize=15)
    page.insert_text((50, 80), "Výsledky laboratorního vyšetření", fontname="dj", fontsize=10)
    page.insert_text((50, 108), f"Pacient: {PATIENT_NAME}", fontname="dj", fontsize=10)
    page.insert_text((50, 124), f"Rodné číslo: {PATIENT_ID}", fontname="dj", fontsize=10)
    page.insert_text((50, 140), f"Datum odběru: {cz_date(date_iso)}", fontname="dj", fontsize=10)

    y = 178
    page.insert_text((50, y), "Analyt", fontname="djb", fontsize=9)
    page.insert_text((250, y), "Výsledek", fontname="djb", fontsize=9)
    page.insert_text((330, y), "Jednotka", fontname="djb", fontsize=9)
    page.insert_text((420, y), "Referenční meze", fontname="djb", fontsize=9)
    page.draw_line(pymupdf.Point(50, y + 5), pymupdf.Point(545, y + 5))

    y += 22
    for name, value, unit, ref in rows:
        page.insert_text((50, y), name, fontname="dj", fontsize=9)
        page.insert_text((250, y), value, fontname="dj", fontsize=9)
        page.insert_text((330, y), unit, fontname="dj", fontsize=9)
        page.insert_text((420, y), ref, fontname="dj", fontsize=9)
        y += 19

    page.insert_text(
        (50, 800),
        "Ukázková data — smyšlený pacient, negenerováno z reálného vyšetření.",
        fontname="dj",
        fontsize=7,
    )
    doc.save(path)
    doc.close()


def main() -> None:
    if IMG_DIR.exists():
        shutil.rmtree(IMG_DIR)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = OUT / "_tmp"
    tmp.mkdir(parents=True, exist_ok=True)

    registry = Registry([AnalyteDef.from_dict(d) for d in
                         json.loads((ROOT / "data" / "registry.json").read_text("utf-8"))])

    reports = []
    for ri, date_iso in enumerate(DATES):
        page_rows = [(n, vals[ri], u, r) for (n, u, r, vals) in ROWS]
        pdf_path = tmp / f"demo_{ri}.pdf"
        build_pdf(pdf_path, date_iso, page_rows)

        doc = pymupdf.open(pdf_path)
        pg = doc[0]
        zoom = RENDER_DPI / 72.0
        pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
        img_name = f"report{ri}_p1.png"
        pix.save(IMG_DIR / img_name)

        marks = dict(QA_MARKS.get(ri, []))
        measurements = []
        for mi, (name, value, unit, ref) in enumerate(page_rows):
            m = Measurement(
                raw_analyte_name=name,
                value_raw=value,
                unit_raw=unit,
                ref_range_raw=ref,
                source_snippet=f"{name}   {value}   {unit}   {ref}",
                source_page=1,
                extracted_by="claude-sonnet-5",
            )
            normalize_measurement(m)
            m.canonical_id = registry.match(name)

            kind = marks.get(mi)
            if kind == "misread":
                # Shift the decimal one place, as a vision model occasionally
                # does. Everything else about the row stays correct.
                shifted = value.replace(",", "")
                m.value_raw = f"{shifted[:-1]},{shifted[-1]}" if len(shifted) > 1 else shifted
                normalize_measurement(m)
                m.confidence = "low"
            elif kind == "disagreement":
                # Show both readings. A flag that says only "the models
                # disagreed" gives a reader nothing to check against.
                other = _nudge(value)
                m.disagreement = f"dvě nezávislá čtení se liší: {value} / {other}"
                m.escalated = True
            elif kind == "low":
                m.confidence = "low"

            # Same text-layer lookup src/locate.py performs, scaled to pixels
            # — but spanning the whole printed row, not just the analyte name.
            # A doctor verifying a result is checking the number; a box drawn
            # around the word "Homocystein" frames the one part they already
            # believe.
            rects = pg.search_for(name)
            bbox = None
            if rects:
                r = sorted(rects, key=lambda rr: rr.y0)[0]
                x0, y0, x1, y1 = r.x0, r.y0, r.x1, r.y1
                for other in (value, unit, ref):
                    if not other or not other.strip():
                        continue
                    for cand in pg.search_for(other.strip()):
                        # Same printed line, to the right of the name.
                        if abs(cand.y0 - r.y0) <= 3 and cand.x0 >= r.x0:
                            x1 = max(x1, cand.x1)
                            y0 = min(y0, cand.y0)
                            y1 = max(y1, cand.y1)
                bbox = [round(x0 * zoom, 1), round(y0 * zoom, 1),
                        round(x1 * zoom, 1), round(y1 * zoom, 1)]

            d = m.to_dict()
            measurements.append({
                "rawAnalyteName": d["raw_analyte_name"],
                "valueRaw": d["value_raw"],
                "unitRaw": d["unit_raw"],
                "refRangeRaw": d["ref_range_raw"],
                "sourceSnippet": d["source_snippet"],
                "sourcePage": d["source_page"],
                "confidence": d["confidence"],
                "canonicalId": d["canonical_id"],
                "value": d["value"],
                "unit": d["unit"],
                "refRangeLow": d["ref_range_low"],
                "refRangeHigh": d["ref_range_high"],
                "refRangeText": d["ref_range_text"],
                "flag": d["flag"],
                "extractedBy": d["extracted_by"],
                "escalated": d["escalated"],
                "disagreement": d["disagreement"],
                "corrected": False,
                "bbox": bbox,
            })

        reports.append({
            "id": f"demo-{ri}",
            "sourceFile": f"demo_{ri}.pdf",
            "reportDate": date_iso,
            "labName": LAB_NAME,
            "patientName": PATIENT_NAME,
            "patientId": PATIENT_ID,
            "pages": [{
                "pageNum": 1,
                "imageUrl": f"/demo/pages/{img_name}",
                "imageWidth": pix.width,
                "imageHeight": pix.height,
            }],
            "measurements": measurements,
        })
        doc.close()

    (OUT / "reports.json").write_text(
        json.dumps(reports, ensure_ascii=False, indent=1), encoding="utf-8")

    # Ship only the analytes the demo actually references, plus enough of the
    # registry for the mapping tab to have plausible alternatives to rank.
    used = {m["canonicalId"] for r in reports for m in r["measurements"] if m["canonicalId"]}
    slim = [a.to_dict() for a in registry.analytes.values()][:109]
    (OUT / "registry.json").write_text(
        json.dumps([{
            "canonicalId": a["canonical_id"],
            "displayNameCs": a["display_name_cs"],
            "synonyms": a["synonyms"],
            "canonicalUnit": a["canonical_unit"],
            "unitConversions": a["unit_conversions"],
            "referenceRange": REF_RANGES.get(a["canonical_id"]),
        } for a in slim], ensure_ascii=False, indent=1), encoding="utf-8")

    shutil.rmtree(tmp)
    unmapped = [m["rawAnalyteName"] for r in reports for m in r["measurements"]
                if not m["canonicalId"]]
    print(f"{len(reports)} reports, {len(reports[0]['measurements'])} rows each")
    print(f"mapped analytes: {len(used)}; unmapped (for the mapping tab): {sorted(set(unmapped))}")
    print(f"images → {IMG_DIR}")


if __name__ == "__main__":
    main()
