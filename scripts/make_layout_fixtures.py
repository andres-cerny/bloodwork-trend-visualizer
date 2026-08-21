"""Generate Czech lab-report PDFs in deliberately awkward layouts.

These exist to attack `buildRows` in web/src/pdf/rows.ts, not to look pretty.
Each one models a layout convention seen in real Czech lab output — a material
prefix, a value carrying the lab's own out-of-range marker, a reference range
split across two columns, an analyte name wrapped onto a second line, two
tables printed side by side on one page — plus a scan with no text layer at all.

No patient data of any kind: names and identifiers are invented.

    python3 -m scripts.make_layout_fixtures
"""
from __future__ import annotations

from pathlib import Path

import fitz

OUT = Path(__file__).resolve().parent.parent / "web" / "tests" / "fixtures"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def new_page(doc, landscape=False):
    page = doc.new_page(width=842 if landscape else 595, height=595 if landscape else 842)
    page.insert_font(fontname="dj", fontfile=FONT)
    page.insert_font(fontname="djb", fontfile=FONT_B)
    return page


def header(page, title="Laboratoř Vzor a.s."):
    page.insert_text((50, 55), title, fontname="djb", fontsize=13)
    page.insert_text((50, 74), "Pacient: Testovací Vzorek", fontname="dj", fontsize=9)
    page.insert_text((50, 88), "Datum odběru: 3.6.2025", fontname="dj", fontsize=9)


# 1 — baseline: the layout the demo generator already produces.
def standard(doc):
    page = new_page(doc)
    header(page)
    y = 130
    for label, x in [("Analyt", 50), ("Výsledek", 250), ("Jednotka", 330), ("Referenční meze", 420)]:
        page.insert_text((x, y), label, fontname="djb", fontsize=9)
    y += 20
    for name, val, unit, ref in [
        ("S_Glukóza", "5,32", "mmol/l", "(4,11-5,60)"),
        ("S_Cholesterol", "6,01", "mmol/l", "(2,90-5,00)"),
        ("S_CRP", "<1,0", "mg/l", "(1,0-5,0)"),
    ]:
        page.insert_text((50, y), name, fontname="dj", fontsize=9)
        page.insert_text((250, y), val, fontname="dj", fontsize=9)
        page.insert_text((330, y), unit, fontname="dj", fontsize=9)
        page.insert_text((420, y), ref, fontname="dj", fontsize=9)
        y += 19


# 2 — two tables printed side by side. The hard case: two unrelated rows share
#     a vertical position, and naive clustering merges them into one.
def two_column(doc):
    page = new_page(doc)
    header(page)
    left = [("S_Sodík", "141", "mmol/l", "137-145"),
            ("S_Draslík", "4,32", "mmol/l", "(3,80-5,20)"),
            ("S_Chloridy", "104", "mmol/l", "(97-108)")]
    right = [("B_Hemoglobin", "148", "g/l", "(135-175)"),
             ("B_Leukocyty", "6,20", "10^9/l", "(4,00-10,00)"),
             ("B_Trombocyty", "243", "10^9/l", "(150-400)")]
    y0 = 150
    for i, (rows, x0) in enumerate([(left, 50), (right, 330)]):
        page.insert_text((x0, y0 - 20), "BIOCHEMIE" if i == 0 else "HEMATOLOGIE",
                         fontname="djb", fontsize=9)
        y = y0
        for name, val, unit, ref in rows:
            page.insert_text((x0, y), name, fontname="dj", fontsize=8)
            page.insert_text((x0 + 105, y), val, fontname="dj", fontsize=8)
            page.insert_text((x0 + 145, y), unit, fontname="dj", fontsize=8)
            page.insert_text((x0 + 195, y), ref, fontname="dj", fontsize=8)
            y += 18


# 3 — long analyte name wrapped onto a second line, value on the first.
def wrapped_names(doc):
    page = new_page(doc)
    header(page)
    y = 140
    page.insert_text((50, y), "Kyselina močová v", fontname="dj", fontsize=9)
    page.insert_text((250, y), "331", fontname="dj", fontsize=9)
    page.insert_text((330, y), "µmol/l", fontname="dj", fontsize=9)
    page.insert_text((420, y), "(202-417)", fontname="dj", fontsize=9)
    page.insert_text((50, y + 11), "séru", fontname="dj", fontsize=9)
    y += 34
    page.insert_text((50, y), "Alaninaminotransferáza", fontname="dj", fontsize=9)
    page.insert_text((250, y), "0,93", fontname="dj", fontsize=9)
    page.insert_text((330, y), "µkat/l", fontname="dj", fontsize=9)
    page.insert_text((420, y), "(0,17-0,78)", fontname="dj", fontsize=9)
    page.insert_text((50, y + 11), "(ALT)", fontname="dj", fontsize=9)


# 4 — reference range as separate "od"/"do" columns, values carrying the lab's
#     own out-of-range marker.
def split_range(doc):
    page = new_page(doc)
    header(page)
    y = 130
    for label, x in [("Analyt", 50), ("Výsledek", 240), ("Jedn.", 320), ("od", 400), ("do", 460)]:
        page.insert_text((x, y), label, fontname="djb", fontsize=9)
    y += 20
    for name, val, unit, lo, hi in [
        ("S_ALT", "0,93 !", "µkat/l", "0,17", "0,78"),
        ("S_AST", "0,60", "µkat/l", "0,17", "0,85"),
        ("S_GGT", "1,04 *", "µkat/l", "0,14", "0,84"),
    ]:
        page.insert_text((50, y), name, fontname="dj", fontsize=9)
        page.insert_text((240, y), val, fontname="dj", fontsize=9)
        page.insert_text((320, y), unit, fontname="dj", fontsize=9)
        page.insert_text((400, y), lo, fontname="dj", fontsize=9)
        page.insert_text((460, y), hi, fontname="dj", fontsize=9)
        y += 19


# 5 — landscape page with section headings between groups of rows.
def landscape_sections(doc):
    page = new_page(doc, landscape=True)
    header(page)
    y = 130
    for section, rows in [
        ("BIOCHEMIE", [("S_Urea", "5,62", "mmol/l", "(2,80-8,00)"),
                       ("S_Kreatinin", "89", "µmol/l", "(62,00 - 110)")]),
        ("HEMATOLOGIE", [("B_Erytrocyty", "5,02", "10^12/l", "(4,20-5,80)")]),
    ]:
        page.insert_text((50, y), section, fontname="djb", fontsize=10)
        y += 20
        for name, val, unit, ref in rows:
            page.insert_text((60, y), name, fontname="dj", fontsize=9)
            page.insert_text((300, y), val, fontname="dj", fontsize=9)
            page.insert_text((420, y), unit, fontname="dj", fontsize=9)
            page.insert_text((520, y), ref, fontname="dj", fontsize=9)
            y += 19
        y += 12


# 6 — tight line spacing. Attacks the clustering tolerance directly: rows
#     11pt apart with 9pt text leave very little vertical separation.
def tight_rows(doc):
    page = new_page(doc)
    header(page)
    y = 130
    for name, val, unit, ref in [
        ("S_Sodík", "141", "mmol/l", "137-145"),
        ("S_Draslík", "4,32", "mmol/l", "(3,80-5,20)"),
        ("S_Chloridy", "104", "mmol/l", "(97-108)"),
        ("S_Vápník", "2,38", "mmol/l", "(2,15-2,55)"),
    ]:
        page.insert_text((50, y), name, fontname="dj", fontsize=9)
        page.insert_text((250, y), val, fontname="dj", fontsize=9)
        page.insert_text((330, y), unit, fontname="dj", fontsize=9)
        page.insert_text((420, y), ref, fontname="dj", fontsize=9)
        y += 11


# 7 — value and unit printed as one cell ("5,32 mmol/l"), a common variant.
def unit_in_value(doc):
    page = new_page(doc)
    header(page)
    y = 130
    for name, val, ref in [
        ("S_Glukóza", "5,32 mmol/l", "4,11 - 5,60"),
        ("S_Cholesterol", "6,01 mmol/l", "2,90 - 5,00"),
        ("S_CRP", "<1,0 mg/l", "1,0 - 5,0"),
    ]:
        page.insert_text((50, y), name, fontname="dj", fontsize=9)
        page.insert_text((260, y), val, fontname="dj", fontsize=9)
        page.insert_text((420, y), ref, fontname="dj", fontsize=9)
        y += 19


# 8 — a report spilling onto a second page, header repeated.
def multipage(doc):
    for part in (0, 1):
        page = new_page(doc)
        header(page)
        y = 130
        rows = [("S_Urea", "5,62", "mmol/l", "(2,80-8,00)")] if part == 0 else [
            ("B_Erytrocyty", "5,02", "10^12/l", "(4,20-5,80)"),
            ("B_Hemoglobin", "149", "g/l", "(135-175)"),
        ]
        for name, val, unit, ref in rows:
            page.insert_text((50, y), name, fontname="dj", fontsize=9)
            page.insert_text((250, y), val, fontname="dj", fontsize=9)
            page.insert_text((330, y), unit, fontname="dj", fontsize=9)
            page.insert_text((420, y), ref, fontname="dj", fontsize=9)
            y += 19


def scanned(doc_path: Path):
    """A page with no text layer at all — must route to the vision path."""
    src = fitz.open()
    page = new_page(src)
    header(page, "Laboratoř Sken s.r.o.")
    page.insert_text((50, 140), "S_Glukóza      5,32     mmol/l    (4,11-5,60)", fontname="dj", fontsize=9)
    pix = page.get_pixmap(matrix=fitz.Matrix(150 / 72, 150 / 72))
    out = fitz.open()
    p2 = out.new_page(width=595, height=842)
    p2.insert_image(fitz.Rect(0, 0, 595, 842), pixmap=pix)
    out.save(doc_path)
    out.close()
    src.close()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in [
        ("standard", standard),
        ("two_column", two_column),
        ("wrapped_names", wrapped_names),
        ("split_range", split_range),
        ("landscape_sections", landscape_sections),
        ("tight_rows", tight_rows),
        ("unit_in_value", unit_in_value),
        ("multipage", multipage),
    ]:
        doc = fitz.open()
        fn(doc)
        doc.save(OUT / f"{name}.pdf")
        doc.close()
        print(f"  {name}.pdf")
    scanned(OUT / "scanned.pdf")
    print("  scanned.pdf (no text layer)")
    print(f"Fixtures → {OUT}")


if __name__ == "__main__":
    main()
