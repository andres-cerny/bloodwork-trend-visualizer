"""Generate Czech lab-report PDFs in deliberately awkward layouts.

These exist to attack `buildRows` in web/src/pdf/rows.ts, not to look pretty.
Each one models a layout convention seen in real Czech lab output — a material
prefix, a value carrying the lab's own out-of-range marker, a reference range
split across two columns, an analyte name wrapped onto a second line, two
tables printed side by side on one page — plus a scan with no text layer at all.

The second group (docs/plans/lab-adaptability.md, Phase A3) models the
conventions the four-lab corpus turned out not to cover: a slash prefix with a
separate "Hodnocení" column, hyphen and comma prefixes beside names that only
look prefixed, an abbreviation column with four-decimal values and signature
cells, a Slovak sheet with a "Materiál" column, prefix-free urine rows under a
heading, the same analyte name twice on one page, and a scan that is rotated
and washed out the way a phone shot is.

Output is byte-identical run to run: the trailer /ID that PyMuPDF would
otherwise randomise on every save is pinned in save().

No patient data of any kind: names and identifiers are invented.

    python3 -m scripts.make_layout_fixtures
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts._fonts import czech_fonts  # noqa: E402

OUT = Path(__file__).resolve().parent.parent.parent.parent / "packages" / "lab-core" / "tests" / "fixtures"
FONT, FONT_B = czech_fonts()


def save(doc, path: Path) -> None:
    """Write the document with a trailer /ID derived from its file name.

    PyMuPDF generates a fresh random /ID on every save, which is the one thing
    that made two runs of this script differ — 62 bytes in the trailer, with
    every glyph identical. Pinning it is what lets `git diff --exit-code` mean
    "the fixtures did not change" rather than "nobody ran the generator".
    """
    digest = hashlib.md5(path.name.encode("utf-8")).hexdigest().upper()
    doc.xref_set_key(-1, "ID", f"[<{digest}><{digest}>]")
    doc.save(path, no_new_id=True)


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


# 9 — the identity a real header carries, and the footer that repeats it with
#     no label in front. Attacks redact.ts rather than buildRows: the name
#     appears surname-first in the header and given-name-first in the footer,
#     the number with its slash above and without it below. Invented, all of
#     it — 800101/0006 is the demo generator's synthetic number, kept because
#     it satisfies mod 11 and so decodes like a real one.
def identity(doc):
    page = new_page(doc)
    page.insert_text((50, 55), "Laboratoř Vzor a.s.", fontname="djb", fontsize=13)
    page.insert_text((50, 74), "Pacient: Novák Jan", fontname="dj", fontsize=9)
    page.insert_text((300, 74), "Rodné číslo: 800101/0006", fontname="dj", fontsize=9)
    page.insert_text((50, 88), "Datum narození: 1. 1. 1980", fontname="dj", fontsize=9)
    page.insert_text((300, 88), "Bydliště: Dlouhá 12, Praha 1", fontname="dj", fontsize=9)
    page.insert_text((50, 102), "Datum odběru: 3.6.2025", fontname="dj", fontsize=9)
    y = 130
    for label, x in [("Analyt", 50), ("Výsledek", 250), ("Jednotka", 330), ("Referenční meze", 420)]:
        page.insert_text((x, y), label, fontname="djb", fontsize=9)
    y += 20
    for name, val, unit, ref in [
        ("S_Glukóza", "5,32", "mmol/l", "(4,11-5,60)"),
        ("S_Cholesterol", "6,01", "mmol/l", "(2,90-5,00)"),
        ("S_CRP", "<1,0", "mg/l", "(1,0-5,0)"),
        ("S_Urea", "5,62", "mmol/l", "(2,80-8,00)"),
        ("S_Kreatinin", "89", "µmol/l", "(62-110)"),
        ("S_ALT", "0,93", "µkat/l", "(0,17-0,78)"),
        ("S_AST", "0,60", "µkat/l", "(0,17-0,85)"),
        ("B_Hemoglobin", "148", "g/l", "(135-175)"),
    ]:
        page.insert_text((50, y), name, fontname="dj", fontsize=9)
        page.insert_text((250, y), val, fontname="dj", fontsize=9)
        page.insert_text((330, y), unit, fontname="dj", fontsize=9)
        page.insert_text((420, y), ref, fontname="dj", fontsize=9)
        y += 19
    page.insert_text((50, 800), "Jan Novák", fontname="dj", fontsize=8)
    page.insert_text((300, 800), "8001010006", fontname="dj", fontsize=8)
    page.insert_text((450, 800), "strana 1/1", fontname="dj", fontsize=8)


def scanned(doc_path: Path):
    """A page with no text layer at all — must route to the vision path."""
    src = pymupdf.open()
    page = new_page(src)
    header(page, "Laboratoř Sken s.r.o.")
    page.insert_text((50, 140), "S_Glukóza      5,32     mmol/l    (4,11-5,60)", fontname="dj", fontsize=9)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(150 / 72, 150 / 72))
    out = pymupdf.open()
    p2 = out.new_page(width=595, height=842)
    p2.insert_image(pymupdf.Rect(0, 0, 595, 842), pixmap=pix)
    save(out, doc_path)
    out.close()
    src.close()


# ---------------------------------------------------------------------------
# Phase A3 — the conventions the four-lab corpus did not cover.
# ---------------------------------------------------------------------------

def cells(page, y, items, size=9):
    """Print (x, text) pairs on one baseline."""
    for x, text in items:
        if text:
            page.insert_text((x, y), text, fontname="dj", fontsize=size)


# 10 — slash prefix ("S/Sodík", "B/Hemoglobin"), a separate "Hodnocení" column
#      that carries the out-of-range marker as "( * )", the unit printed last,
#      section names as single cells, and a legend line explaining the prefix.
def slash_prefix(doc):
    page = new_page(doc)
    header(page, "Poliklinika Vzor Sever s.r.o.")
    cols = [50, 230, 290, 350, 470]
    y = 130
    for x, label in zip(cols, ["Název metody", "Výsledek", "Hodnocení", "Ref. meze", "Jednotka"]):
        page.insert_text((x, y), label, fontname="djb", fontsize=9)
    y += 22
    for section, rows in [
        ("Biochemie", [
            ("S/Sodík", "141", "", "137 - 145", "mmol/l"),
            ("S/Draslík", "5,45", "( * )", "3,80 - 5,20", "mmol/l"),
            ("S/Chloridy", "104", "", "97 - 108", "mmol/l"),
            ("S/Glukóza", "5,32", "(*)", "4,11 - 5,60", "mmol/l"),
            ("S/Kreatinin", "89", "", "62 - 110", "µmol/l"),
        ]),
        ("Krevní obraz", [
            ("B/Hemoglobin", "148", "", "135 - 175", "g/l"),
            ("B/Leukocyty", "11,20", "( * )", "4,00 - 10,00", "10^9/l"),
            ("B/Trombocyty", "243", "", "150 - 400", "10^9/l"),
        ]),
    ]:
        page.insert_text((50, y), section, fontname="djb", fontsize=9)
        y += 19
        for row in rows:
            cells(page, y, zip(cols, row))
            y += 19
        y += 8
    page.insert_text((50, 790), "Označení vyšetřovaného materiálu: S=sérum, P=plazma, B=plná krev, U=moč",
                     fontname="dj", fontsize=8)


# 11 — hyphen, comma and underscore prefixes on one page ("S-Na", "S,P-glukóza",
#      "U-amyláza", "P_Amoniak", "dU_Kreatinin") beside two names that look
#      prefixed and are not: "anti-TPO" and "25-OH vitamin D".
def hyphen_comma_prefix(doc):
    page = new_page(doc)
    header(page)
    y = 130
    for label, x in [("Analyt", 50), ("Výsledek", 250), ("Jednotka", 330), ("Referenční meze", 420)]:
        page.insert_text((x, y), label, fontname="djb", fontsize=9)
    y += 20
    for row in [
        ("S-Na", "141", "mmol/l", "(137 - 145)"),
        ("S-K", "4,32", "mmol/l", "(3,80 - 5,20)"),
        ("S,P-glukóza", "5,32", "mmol/l", "(4,11 - 5,60)"),
        ("U-amyláza", "3,15", "µkat/l", "(0,00 - 7,50)"),
        ("P_Amoniak", "32", "µmol/l", "(11 - 51)"),
        ("dU_Kreatinin", "12,4", "mmol/d", "(7,0 - 17,7)"),
        ("anti-TPO", "18,5", "kIU/l", "(0,0 - 34,0)"),
        ("25-OH vitamin D", "62", "nmol/l", "(75 - 250)"),
    ]:
        cells(page, y, zip([50, 250, 330, 420], row))
        y += 19


# 12 — an abbreviation column in front of the name, four-decimal values, the
#      lab's "H" flag in its own "Text.výsl." column, a range printed with
#      spaces inside the parentheses, and two trailing signature cells.
def zkr_column(doc):
    page = new_page(doc)
    header(page, "Nemocnice Vzor, oddělení klinické biochemie")
    cols = [40, 75, 185, 245, 290, 340, 470, 530]
    y = 130
    for x, label in zip(cols, ["Zkr.", "Vyšetření", "Výsl.", "Text.výsl.", "Jedn.",
                               "Referenční hodnoty", "Kontrola I.stupně", "Uvolnil"]):
        page.insert_text((x, y), label, fontname="djb", fontsize=7)
    y += 20
    for row in [
        ("URE", "urea", "4,9000", "", "mmol/l", "( 2,5000 - 6,4000 )", "kontr1", "uvoln1"),
        ("KREA", "kreatinin", "78,0000", "", "µmol/l", "( 44,0000 - 80,0000 )", "kontr1", "uvoln1"),
        ("KM", "kyselina močová", "396,0000", "H", "µmol/l", "( 150,0000 - 350,0000 )", "kontr1", "uvoln1"),
        ("GLU", "glukóza", "5,1000", "", "mmol/l", "( 3,9000 - 5,6000 )", "kontr1", "uvoln1"),
        ("CHOL", "cholesterol", "4,8000", "", "mmol/l", "( 2,9000 - 5,0000 )", "kontr1", "uvoln1"),
    ]:
        cells(page, y, zip(cols, row), size=8)
        y += 18


# 13 — a Slovak sheet: group headings, a "Materiál" column, en-dash ranges,
#      and a qualitative row whose result and criteria are both words.
def slovak_grouped(doc):
    page = new_page(doc)
    page.insert_text((50, 55), "Laboratórium Vzor s.r.o.", fontname="djb", fontsize=13)
    page.insert_text((50, 74), "Pacient: Testovacia Vzorka", fontname="dj", fontsize=9)
    page.insert_text((50, 88), "Dátum odberu: 3.6.2025", fontname="dj", fontsize=9)
    cols = [50, 220, 290, 410, 460, 520]
    y = 130
    for x, label in zip(cols, ["Test", "Výsledok", "Hodnotiace kritériá", "Jednotky", "Materiál", "Schválil"]):
        page.insert_text((x, y), label, fontname="djb", fontsize=8)
    y += 22
    for section, rows in [
        ("Základná hematológia - Krvný obraz", [
            ("Leukocyty [WBC]", "6,90", "3,80–10,70", "10^9/l", "krv EDTA", "MUDr. Vzorová"),
            ("Erytrocyty [RBC]", "4,85", "4,20–5,80", "10^12/l", "krv EDTA", "MUDr. Vzorová"),
            ("Hemoglobín [HGB]", "151", "135–175", "g/l", "krv EDTA", "MUDr. Vzorová"),
            ("Trombocyty [PLT]", "238", "150–400", "10^9/l", "krv EDTA", "MUDr. Vzorová"),
        ]),
        ("Metabolity", [
            ("Glukóza", "5,10", "3,90–5,60", "mmol/l", "sérum", "MUDr. Vzorová"),
            ("Kreatinín", "82", "62–106", "µmol/l", "sérum", "MUDr. Vzorová"),
            ("Kyselina močová", "430", "202–417", "µmol/l", "sérum", "MUDr. Vzorová"),
        ]),
        ("Štítna žľaza", [
            ("TSH", "2,15", "0,27–4,20", "mIU/l", "sérum", "MUDr. Vzorová"),
            ("fT4", "16,2", "12,0–22,0", "pmol/l", "sérum", "MUDr. Vzorová"),
        ]),
        ("Infekčná sérológia", [
            ("Anti CMV IgM (skríning)", "<1,0 negatívne", "<1,0 negatívne, >=1,0 pozitívne",
             "index", "sérum", "MUDr. Vzorová"),
        ]),
    ]:
        page.insert_text((50, y), section, fontname="djb", fontsize=9)
        y += 18
        for row in rows:
            cells(page, y, zip(cols, row), size=8)
            y += 17
        y += 8


# 14 — no prefix anywhere: a serum block, then numeric urine rows under a
#      "Moč chemicky" heading whose ranges overlap the serum ones, and a
#      sediment line whose result is a word.
def urine_no_prefix(doc):
    page = new_page(doc)
    header(page, "Laboratoř Vzor Jih a.s.")
    cols = [50, 250, 330, 420]
    y = 130
    for x, label in zip(cols, ["Vyšetření", "Výsledek", "Jednotka", "Referenční meze"]):
        page.insert_text((x, y), label, fontname="djb", fontsize=9)
    y += 22
    for section, rows in [
        ("Biochemie", [
            ("Glukóza", "5,4", "mmol/l", "3,9 - 5,6"),
            ("Urea", "5,1", "mmol/l", "2,8 - 8,1"),
            ("Kreatinin", "84", "µmol/l", "62 - 106"),
        ]),
        ("Moč chemicky", [
            ("Glukóza", "0,3", "mmol/l", "0 - 0,8"),
            ("Bílkovina", "0,10", "g/l", "0 - 0,15"),
            ("pH", "6,0", "", "5,0 - 7,0"),
            ("Hustota", "1,015", "", "1,003 - 1,030"),
            ("Močový sediment", "negativní", "", ""),
        ]),
    ]:
        page.insert_text((50, y), section, fontname="djb", fontsize=9)
        y += 19
        for row in rows:
            cells(page, y, zip(cols, row))
            y += 19
        y += 8


# 15 — the disambiguation case: the same analyte name twice on one page, once
#      under "Sérum" and once under "Moč", with nothing but the heading to tell
#      them apart.
def mixed_material(doc):
    page = new_page(doc)
    header(page)
    cols = [50, 250, 330, 420]
    y = 130
    for x, label in zip(cols, ["Analyt", "Výsledek", "Jednotka", "Referenční meze"]):
        page.insert_text((x, y), label, fontname="djb", fontsize=9)
    y += 22
    for section, rows in [
        ("Sérum", [
            ("Glukóza", "5,4", "mmol/l", "3,9 - 5,6"),
            ("Kreatinin", "84", "µmol/l", "62 - 106"),
        ]),
        ("Moč", [
            ("Glukóza", "0,3", "mmol/l", "0 - 0,8"),
            ("Kreatinin", "9,8", "mmol/l", "3,5 - 25,0"),
        ]),
    ]:
        page.insert_text((50, y), section, fontname="djb", fontsize=9)
        y += 19
        for row in rows:
            cells(page, y, zip(cols, row))
            y += 19
        y += 8


def scanned_photo_like(doc_path: Path):
    """scanned() rotated 3° and washed out — the stand-in for a phone shot.

    Still no text layer, so it must route to the vision path; the rotation and
    the flattened contrast are what a photographed sheet adds to a scan.
    """
    src = pymupdf.open()
    page = new_page(src)
    header(page, "Laboratoř Sken s.r.o.")
    y = 140
    for line in [
        "S_Glukóza      5,32     mmol/l    (4,11-5,60)",
        "S_Cholesterol  6,01     mmol/l    (2,90-5,00)",
        "S_Kreatinin    89       µmol/l    (62-110)",
    ]:
        page.insert_text((50, y), line, fontname="dj", fontsize=9)
        y += 19
    pix = page.get_pixmap(matrix=pymupdf.Matrix(150 / 72, 150 / 72).prerotate(3), alpha=False)
    # Black → dark grey, white → light grey: the contrast a phone camera loses.
    pix.tint_with(0x505050, 0xD0D0D0)
    out = pymupdf.open()
    p2 = out.new_page(width=595, height=842)
    p2.insert_image(pymupdf.Rect(0, 0, 595, 842), pixmap=pix)
    save(out, doc_path)
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
        ("identity", identity),
        ("slash_prefix", slash_prefix),
        ("hyphen_comma_prefix", hyphen_comma_prefix),
        ("zkr_column", zkr_column),
        ("slovak_grouped", slovak_grouped),
        ("urine_no_prefix", urine_no_prefix),
        ("mixed_material", mixed_material),
    ]:
        doc = pymupdf.open()
        fn(doc)
        save(doc, OUT / f"{name}.pdf")
        doc.close()
        print(f"  {name}.pdf")
    scanned(OUT / "scanned.pdf")
    print("  scanned.pdf (no text layer)")
    scanned_photo_like(OUT / "scanned_photo_like.pdf")
    print("  scanned_photo_like.pdf (no text layer, rotated 3°, low contrast)")
    print(f"Fixtures → {OUT}")


if __name__ == "__main__":
    main()
