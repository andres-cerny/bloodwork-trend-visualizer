"""Four synthetic laboratories the catalog has never seen, with their truth.

Goal 2 of docs/plans/multi-user.md. Each lab is a born-digital PDF (a text
layer, as a real LIS prints) whose vocabulary and layout differ from the five
labs `seed_registry.py` knows — AGILAB, SPADIA, CASRI, PREVEDIG, BioLAB — so
the mapping bench (`npm run bench:mapping`) measures what the *next* lab
gets, not what the catalog already memorised:

  slovak   a Slovak private lab: Slovak spellings, a "Materiál" column with
           one-letter codes, no prefix on the name, en-dash intervals
  lis      a hospital LIS: abbreviation-only names with English echoes in
           parentheses, a "Hodnocení" column with H/L, the lab's own "*" on
           the value, the interval split into "Dolní mez" / "Horní mez"
  konvent  a lab printing conventional units — mg/dl, g/dl, U/l, ng/ml,
           pg/ml — under "S-" / "B-" dash prefixes, so the catalog's canonical
           units disagree and the mapping gate must not apply them unasked
  wellness a sports/wellness panel: long descriptive Czech names, a heading
           per panel, no prefixes, "< 0,5" and "negat." results

Every lab prints rows of all four classes, and `truth.json` labels each
printed name: a catalog id under a spelling no synonym list carries, `NEW:<id>`
for a test the catalog lacks, `NOT_BLOOD` for the urine block, `IGNORE` for a
row that is not a measurement. At least six rows per lab are near-miss traps
(free vs total, conjugated vs total, ionised vs total, serum vs urine, relative
vs absolute, transferrin vs its saturation vs its receptor, hemoglobin vs
HbA1c, 25-OH vs 1,25-OH vitamin D …) and carry a `wrong` list naming the id a
careless mapper would pick, so the bench scores "wrong", not just "unmatched".

The truth key is what lab-core's row parser yields for the row
(`packages/lab-core/tests/labFixtures.ts`), which is the printed name for
every row but the one comment line whose result the parser reads as a
qualitative measurement; `labs.test.ts` asserts the two sets are equal.

Output is byte-identical run to run: no timestamps, no randomness, and the
trailer /ID that PyMuPDF would otherwise randomise on every save is pinned in
save(), exactly as make_layout_fixtures.py does. Fonts come from _fonts.py —
the bundled DejaVu, never a system font (see tools/pipeline/CLAUDE.md).

No patient data of any kind. Every name, number, address, physician, lab and
IČ below is invented; the rodná čísla satisfy mod 11 so they decode like real
ones and nothing else.

    python3 -m scripts.make_lab_fixtures
"""
from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts._fonts import czech_fonts  # noqa: E402

OUT = Path(__file__).resolve().parent.parent.parent.parent / "packages" / "lab-core" / "tests" / "fixtures" / "labs"
FONT, FONT_B = czech_fonts()

PAGE_W, PAGE_H = 595, 842
BOTTOM = 790


def save(doc, path: Path) -> None:
    """Write the document with a trailer /ID derived from its path.

    PyMuPDF generates a fresh random /ID on every save — the one thing that
    made two runs differ. Pinning it is what lets `git diff --exit-code` mean
    "the fixtures did not change" rather than "nobody ran the generator".
    """
    digest = hashlib.md5(f"{path.parent.name}/{path.name}".encode("utf-8")).hexdigest().upper()
    doc.xref_set_key(-1, "ID", f"[<{digest}><{digest}>]")
    doc.save(path, no_new_id=True)


@dataclass
class Row:
    """One printed row and its truth.

    `answer` is a catalog id, `NEW:<id>`, `NOT_BLOOD` or `IGNORE`; `wrong`
    names the ids a careless mapper would pick; `key` overrides the truth key
    when the parser yields something other than the printed name.
    """
    name: str
    value: str
    unit: str = ""
    ref: str = ""
    lo: str = ""
    hi: str = ""
    mat: str = ""
    flag: str = ""
    answer: str = ""
    wrong: tuple[str, ...] = ()
    note: str = ""
    key: str | None = None


@dataclass
class Lab:
    slug: str
    columns: list[tuple[float, str]]
    cells: object  # Row -> list[(x, text)]
    header: object  # (page) -> y after the header
    sections: list[tuple[str, list[Row]]] = field(default_factory=list)
    about: str = ""
    row_step: int = 14
    font_size: int = 8


def new_page(doc):
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    page.insert_font(fontname="dj", fontfile=FONT)
    page.insert_font(fontname="djb", fontfile=FONT_B)
    return page


def text(page, x, y, s, size=8, bold=False):
    if s:
        page.insert_text((x, y), s, fontname="djb" if bold else "dj", fontsize=size)


def render(doc, lab: Lab) -> None:
    """Print the sections in order, opening a new page when the current one is full."""
    page_no = 0
    page = None
    y = 0.0

    def open_page():
        nonlocal page, y, page_no
        page_no += 1
        page = new_page(doc)
        y = lab.header(page, page_no)
        for x, label in lab.columns:
            text(page, x, y, label, size=lab.font_size, bold=True)
        y += lab.row_step + 4

    open_page()
    for heading, rows in lab.sections:
        if y + (len(rows[:2]) + 1) * lab.row_step > BOTTOM:
            open_page()
        text(page, 50, y, heading, size=lab.font_size + 1, bold=True)
        y += lab.row_step + 2
        for row in rows:
            if y > BOTTOM:
                open_page()
            for x, s in lab.cells(row):
                text(page, x, y, s, size=lab.font_size)
            y += lab.row_step
        y += 6


def truth_of(lab: Lab) -> dict:
    out: dict = {"_about": lab.about}
    for _, rows in lab.sections:
        for r in rows:
            key = r.key or r.name
            if key in out:
                raise SystemExit(f"{lab.slug}: printed name twice, the truth key would be ambiguous: {key}")
            entry: dict = {"answer": r.answer}
            if r.wrong:
                entry["wrong"] = list(r.wrong)
            entry["unit"] = r.unit
            entry["note"] = r.note
            out[key] = entry
    return out


# ---------------------------------------------------------------------------
# 1 — a Slovak private laboratory
# ---------------------------------------------------------------------------

def slovak() -> Lab:
    def header(page, n):
        text(page, 50, 50, "VZORLAB SK, s.r.o. — Laboratórium klinickej biochémie a hematológie", size=11, bold=True)
        text(page, 50, 64, "Vzorové Lazy 12, 999 01 Vzorovce · IČO 99 999 001 · tel. 000 000 001 · info@vzorlab.example")
        text(page, 50, 84, "Pacient: Vzorová Katarína", size=9)
        text(page, 300, 84, "Rodné číslo: 855505/1010", size=9)
        text(page, 50, 97, "Dátum narodenia: 5. 5. 1985", size=9)
        text(page, 300, 97, "Poisťovňa: 99", size=9)
        text(page, 50, 110, "Odosielajúci lekár: MUDr. Fiktívny Ján, Vzorovce", size=9)
        text(page, 300, 110, "Dátum odberu: 14. 5. 2026 07:40", size=9)
        text(page, 50, 123, "Číslo žiadanky: 2026-0514-0007", size=9)
        text(page, 300, 123, f"Strana {n}", size=9)
        return 148

    def cells(r: Row):
        return [(50, r.name), (240, r.value), (300, r.unit), (370, r.ref), (470, r.mat), (515, r.flag)]

    def R(name, value, unit, ref, mat, flag, answer, wrong=(), note=""):
        return Row(name, value, unit, ref, "", "", mat, flag, answer, tuple(wrong), note)

    S = [
        R("Sodík", "139", "mmol/l", "136 – 145", "S", "", "sodik", note="Slovak spelling equals Czech; folds to the catalog key"),
        R("Draslík", "4,3", "mmol/l", "3,5 – 5,1", "S", "", "draslik"),
        R("Chloridy", "103", "mmol/l", "98 – 107", "S", "", "chloridy"),
        R("Vápnik celkový", "2,35", "mmol/l", "2,15 – 2,55", "S", "", "vapnik", ("vapnik_ionizovany",), "total calcium; the ionised row sits right below"),
        R("Vápnik ionizovaný", "1,22", "mmol/l", "1,15 – 1,30", "S", "", "vapnik_ionizovany", ("vapnik",), "ionised, not total calcium"),
        R("Horčík", "0,85", "mmol/l", "0,66 – 1,07", "S", "", "horcik", ("horcik_ery",), "serum magnesium"),
        R("Horčík v erytrocytoch", "2,05", "mmol/l", "1,80 – 2,60", "B", "", "horcik_ery", ("horcik",), "erythrocyte magnesium, a different test"),
        R("Železo", "18,2", "µmol/l", "5,8 – 34,5", "S", "", "zelezo", ("ferritin",), "serum iron, not its store"),
        R("Glukóza (nalačno)", "5,1", "mmol/l", "3,9 – 5,6", "S", "", "glukoza", note="serum; the urine Glukóza is on page 2"),
        R("Močovina", "5,4", "mmol/l", "2,8 – 8,1", "S", "", "urea"),
        R("Kreatinín", "78", "µmol/l", "59 – 104", "S", "", "kreatinin", note="Slovak í; folds to the catalog key"),
        R("eGFR (CKD-EPI)", "1,62", "ml/s/1,73 m2", "> 1,00", "S", "", "egfr", ("egfr_mdrd",)),
        R("Kyselina močová", "312", "µmol/l", "143 – 339", "S", "", "kyselina_mocova"),
        R("Bilirubín celkový", "11,8", "µmol/l", "5,0 – 21,0", "S", "", "bilirubin_celkovy", ("bilirubin_konjugovany",), "total"),
        R("Bilirubín priamy", "3,1", "µmol/l", "0,0 – 5,0", "S", "", "bilirubin_konjugovany", ("bilirubin_celkovy",), "'priamy' = direct = conjugated"),
        R("ALT (GPT)", "0,52", "µkat/l", "0,10 – 0,78", "S", "", "alt"),
        R("AST (GOT)", "0,44", "µkat/l", "0,10 – 0,72", "S", "", "ast"),
        R("GMT", "0,61", "µkat/l", "0,10 – 1,19", "S", "", "ggt", note="Slovak/older Czech abbreviation of gamma-GT"),
        R("ALP", "1,30", "µkat/l", "0,66 – 2,20", "S", "", "alp"),
        R("CK", "2,40", "µkat/l", "0,40 – 3,24", "S", "", "ck", ("ck_mb",)),
        R("Amyláza celková", "1,10", "µkat/l", "0,47 – 1,67", "S", "", "amylaza", ("amylaza_pankreaticka",), "total amylase; the catalog has only the pancreatic isoenzyme"),
        R("Amyláza pankreatická", "0,55", "µkat/l", "0,22 – 0,88", "S", "", "amylaza_pankreaticka"),
        R("Celkové bielkoviny", "72", "g/l", "64 – 83", "S", "", "celkova_bilkovina"),
        R("Albumín", "44", "g/l", "35 – 52", "S", "", "albumin"),
        R("CRP", "2,1", "mg/l", "0,0 – 5,0", "S", "", "crp"),
    ]
    L = [
        R("Cholesterol celkový", "4,9", "mmol/l", "2,9 – 5,0", "S", "", "cholesterol", ("hdl", "ldl")),
        R("HDL-cholesterol", "1,45", "mmol/l", "1,00 – 2,10", "S", "", "hdl", ("non_hdl",)),
        R("LDL-cholesterol", "2,90", "mmol/l", "1,20 – 3,00", "S", "", "ldl", ("non_hdl",)),
        R("Non-HDL-cholesterol", "3,45", "mmol/l", "0,00 – 3,80", "S", "", "non_hdl", ("hdl", "ldl"), "computed non-HDL, not HDL and not LDL"),
        R("Triacylglyceroly", "1,20", "mmol/l", "0,45 – 1,70", "S", "", "triacylglyceroly"),
        R("Lipoproteín (a)", "25", "nmol/l", "< 75", "S", "", "lipoprotein_a", ("ldl",), "Lp(a) is not LDL"),
    ]
    FE = [
        R("Feritín", "95", "µg/l", "30 – 400", "S", "", "ferritin", ("zelezo",)),
        R("Transferín", "2,60", "g/l", "2,00 – 3,60", "S", "", "transferrin", ("saturace_trf", "str")),
        R("Saturácia transferínu", "28", "%", "20 – 55", "S", "", "saturace_trf", ("transferrin",), "the saturation, in percent, not the protein"),
        R("Solubilný transferínový receptor", "3,2", "mg/l", "1,9 – 4,4", "S", "", "str", ("transferrin", "saturace_trf")),
        R("Vitamín B12", "380", "pmol/l", "145 – 569", "S", "", "vitamin_b12", ("aktivni_b12",)),
        R("Koenzým Q10", "0,95", "mg/l", "0,50 – 1,50", "S", "", "NEW:koenzym_q10", note="not in the catalog"),
        R("Lítium", "0,6", "mmol/l", "0,5 – 1,2", "S", "", "NEW:lithium", note="drug level; not in the catalog"),
        R("Kyselina listová", "15,2", "nmol/l", "8,8 – 60,8", "S", "", "kyselina_listova", ("kyselina_listova_ery",), "serum folate"),
        R("Kyselina listová v erytrocytoch", "980", "nmol/l", "634 – 1780", "B", "", "kyselina_listova_ery", ("kyselina_listova",), "erythrocyte folate"),
        R("Vitamín D (25-OH)", "72", "nmol/l", "75 – 250", "S", "*", "vitamin_d", ("vitamin_d_1_25",)),
    ]
    H = [
        R("TSH", "1,9", "mIU/l", "0,27 – 4,20", "S", "", "tsh"),
        R("fT4 (voľný tyroxín)", "15,8", "pmol/l", "12,0 – 22,0", "S", "", "ft4", ("t4_celkovy",), "free T4"),
        R("T4 celkový", "98", "nmol/l", "66 – 181", "S", "", "t4_celkovy", ("ft4",), "total T4, nmol/l"),
        R("fT3 (voľný trijódtyronín)", "4,9", "pmol/l", "3,1 – 6,8", "S", "", "ft3", ("t3_celkovy",), "free T3"),
        R("Testosterón celkový", "18,5", "nmol/l", "8,6 – 29,0", "S", "", "testosteron", ("testosteron_volny",), "total"),
        R("Testosterón voľný", "310", "pmol/l", "160 – 700", "S", "", "testosteron_volny", ("testosteron",), "free, pmol/l"),
        R("PSA celkový", "0,8", "µg/l", "0,0 – 4,0", "S", "", "psa", ("psa_volny",)),
        R("PSA voľný", "0,25", "µg/l", "", "S", "", "psa_volny", ("psa",)),
        R("Glykovaný hemoglobín (HbA1c)", "36", "mmol/mol", "20 – 42", "B", "", "hba1c", ("hemoglobin",), "HbA1c in IFCC units is not hemoglobin"),
    ]
    KO = [
        R("Leukocyty", "6,4", "10^9/l", "4,0 – 10,0", "B", "", "leukocyty", note="blood; the urine Leukocyty is under Moč chemicky"),
        R("Erytrocyty", "4,9", "10^12/l", "4,2 – 5,8", "B", "", "erytrocyty"),
        R("Hemoglobín", "152", "g/l", "135 – 175", "B", "", "hemoglobin", ("hba1c",)),
        R("Hematokrit", "0,45", "l/l", "0,40 – 0,50", "B", "", "hematokrit"),
        R("Stredný objem erytrocytov", "90", "fl", "82 – 98", "B", "", "mcv"),
        R("Priemerná hmotnosť Hb v erytrocyte", "31", "pg", "27 – 33", "B", "", "mch", ("mchc",), "MCH, pg per cell"),
        R("Priemerná koncentrácia Hb v erytrocytoch", "340", "g/l", "320 – 360", "B", "", "mchc", ("mch",), "MCHC, g/l"),
        R("Trombocyty", "240", "10^9/l", "150 – 400", "B", "", "trombocyty"),
    ]
    DIF = [
        R("Neutrofilné granulocyty", "58,0", "%", "45,0 – 70,0", "B", "", "neutrofily", ("neutrofily_abs",), "relative"),
        R("Neutrofilné granulocyty abs.", "3,7", "10^9/l", "2,0 – 7,0", "B", "", "neutrofily_abs", ("neutrofily",), "absolute"),
        R("Lymfocyty", "31,0", "%", "20,0 – 40,0", "B", "", "lymfocyty", ("lymfocyty_abs",)),
        R("Lymfocyty abs.", "2,0", "10^9/l", "0,8 – 4,0", "B", "", "lymfocyty_abs", ("lymfocyty",)),
    ]
    U = [
        R("pH", "6,0", "", "5,0 – 7,0", "U", "", "NOT_BLOOD"),
        R("Bielkovina", "negat.", "", "negat.", "U", "", "NOT_BLOOD", ("celkova_bilkovina",), "urine strip"),
        R("Glukóza", "negat.", "", "negat.", "U", "", "NOT_BLOOD", ("glukoza",), "urine strip glucose under Moč chemicky"),
        R("Ketolátky", "negat.", "", "negat.", "U", "", "NOT_BLOOD"),
        R("Krv", "negat.", "", "negat.", "U", "", "NOT_BLOOD", ("hemoglobin", "erytrocyty"), "urine strip blood"),
        # Printed with "(moč)" so the truth key is unique on this sheet; the
        # strip glucose stays bare because the serum row says "(nalačno)".
        R("Leukocyty (moč)", "negat.", "", "negat.", "U", "", "NOT_BLOOD", ("leukocyty",), "urine strip leukocytes; the blood count is the bare word"),
    ]
    V = [
        R("BMI", "24,1", "kg/m2", "18,5 – 25,0", "", "", "IGNORE", note="not a measurement"),
        R("Poznámka", "nedostatok materiálu — lipáza nebola stanovená", "", "", "", "", "IGNORE", note="free-text comment; the parser reads it as a qualitative row"),
    ]
    return Lab(
        slug="slovak",
        columns=[(50, "Vyšetrenie"), (240, "Výsledok"), (300, "Jednotky"), (370, "Referenčné hodnoty"), (470, "Mat."), (515, "Hodn.")],
        cells=cells,
        header=header,
        sections=[
            ("Biochémia — sérum", S),
            ("Lipidy", L),
            ("Metabolizmus železa a vitamíny", FE),
            ("Hormóny a ostatné", H),
            ("Hematológia — krvný obraz", KO),
            ("Diferenciálny rozpočet leukocytov", DIF),
            ("Moč chemicky", U),
            ("Výpočty a poznámky", V),
        ],
        about="Synthetic Slovak private lab (make_lab_fixtures.py). Every printed name → the catalog id it belongs to, "
              "NEW:<id> for a test the catalog lacks, NOT_BLOOD for the urine strip, IGNORE for a non-measurement; "
              "`wrong` names the id a careless mapper would pick. Slovak spellings that differ from Czech only by "
              "diacritics fold to the catalog key already; the ones that do not are the point.",
    )


# ---------------------------------------------------------------------------
# 2 — a hospital LIS
# ---------------------------------------------------------------------------

def lis() -> Lab:
    def header(page, n):
        text(page, 50, 50, "Nemocnice Vzorov, a.s. — Ústav klinické biochemie a hematologie", size=11, bold=True)
        text(page, 50, 64, "Vzorová 1, 999 99 Vzorov · IČ 99999002 · tel. 000 000 002 · Vedoucí: MUDr. Fiktivní Alena, Ph.D.")
        text(page, 50, 84, "Příjmení, jméno: Vzorek Jaroslav", size=9)
        text(page, 320, 84, "RČ: 700808/1003", size=9)
        text(page, 50, 97, "Narozen: 8. 8. 1970", size=9)
        text(page, 320, 97, "Pojišťovna: 999", size=9)
        text(page, 50, 110, "Žadatel: MUDr. Fiktivní Bohumil, Interní oddělení, Vzorov", size=9)
        text(page, 320, 110, "Odběr: 20. 5. 2026 06:55", size=9)
        text(page, 50, 123, "Číslo vzorku: 26-05-000123", size=9)
        text(page, 320, 123, f"Strana {n}", size=9)
        return 148

    def cells(r: Row):
        return [(50, r.name), (260, r.value), (330, r.flag), (365, r.unit), (440, r.lo), (500, r.hi)]

    def R(name, value, unit, lo, hi, answer, wrong=(), note="", flag=""):
        return Row(name, value, unit, "", lo, hi, "", flag, answer, tuple(wrong), note)

    BIO = [
        R("NA (Sodium)", "140", "mmol/l", "136", "145", "sodik"),
        R("K (Potassium)", "5,4 *", "mmol/l", "3,5", "5,1", "draslik", flag="H"),
        R("CL (Chloride)", "102", "mmol/l", "98", "107", "chloridy"),
        R("CA (Calcium)", "2,31", "mmol/l", "2,15", "2,55", "vapnik", ("vapnik_ionizovany",), "total"),
        R("CA-ION (Ionized calcium)", "1,20", "mmol/l", "1,15", "1,30", "vapnik_ionizovany", ("vapnik",), "ionised"),
        R("GLU (Glucose)", "6,2 *", "mmol/l", "3,9", "5,6", "glukoza", note="serum; U-GLU is the strip", flag="H"),
        R("UREA", "6,1", "mmol/l", "2,8", "8,1", "urea"),
        R("CREA (Creatinine)", "88", "µmol/l", "59", "104", "kreatinin"),
        R("EGFR-EPI (eGFR CKD-EPI)", "1,45", "ml/s/1,73m2", "1,00", "", "egfr", ("egfr_mdrd",)),
        R("EGFR-MDRD", "1,38", "ml/s/1,73m2", "1,00", "", "egfr_mdrd", ("egfr",)),
        R("UA (Uric acid)", "405 *", "µmol/l", "202", "416", "kyselina_mocova", flag="H"),
        R("BILI-T (Bilirubin total)", "14,2", "µmol/l", "3,0", "21,0", "bilirubin_celkovy", ("bilirubin_konjugovany",), "total"),
        R("BILI-D (Bilirubin direct)", "4,0", "µmol/l", "0,0", "5,0", "bilirubin_konjugovany", ("bilirubin_celkovy",), "direct = conjugated"),
        R("ALT", "0,90 *", "µkat/l", "0,10", "0,78", "alt", flag="H"),
        R("AST", "0,55", "µkat/l", "0,10", "0,72", "ast"),
        R("GGT", "0,70", "µkat/l", "0,10", "1,19", "ggt"),
        R("ALP", "1,25", "µkat/l", "0,66", "2,20", "alp"),
        R("AMS (Amylase)", "1,05", "µkat/l", "0,47", "1,67", "amylaza", ("amylaza_pankreaticka",), "total amylase"),
        R("TP (Total protein)", "70", "g/l", "64", "83", "celkova_bilkovina"),
        R("ALB (Albumin)", "43", "g/l", "35", "52", "albumin"),
        R("CRP", "12,5 *", "mg/l", "0,0", "5,0", "crp", flag="H"),
        R("PCT (Procalcitonin)", "0,08", "µg/l", "0,00", "0,50", "prokalcitonin", ("trombokrit",), "the catalog's PCT is plateletcrit; this is procalcitonin"),
        R("CHOL", "5,6 *", "mmol/l", "2,9", "5,0", "cholesterol", ("hdl", "ldl"), flag="H"),
        R("TRIG", "1,9 *", "mmol/l", "0,45", "1,70", "triacylglyceroly", flag="H"),
        R("HDL", "1,10", "mmol/l", "1,00", "2,10", "hdl", ("non_hdl",)),
        R("LDL-C (LDL cholesterol, calc.)", "3,6 *", "mmol/l", "1,20", "3,00", "ldl", ("non_hdl",), "calculated LDL; the catalog has one ldl", flag="H"),
        R("NON-HDL", "4,5 *", "mmol/l", "0,0", "3,8", "non_hdl", ("hdl", "ldl"), flag="H"),
        R("FE (Iron)", "15,0", "µmol/l", "5,8", "34,5", "zelezo", ("ferritin",)),
        R("FERR (Ferritin)", "210", "µg/l", "30", "400", "ferritin", ("zelezo",)),
        R("TRF (Transferrin)", "2,4", "g/l", "2,0", "3,6", "transferrin", ("saturace_trf",)),
        R("TSAT (Transferrin saturation)", "25", "%", "20", "55", "saturace_trf", ("transferrin",)),
        R("B12 (Cobalamin)", "290", "pmol/l", "145", "569", "vitamin_b12", ("aktivni_b12",)),
        R("HOLO-TC (Active B12)", "60", "pmol/l", "35", "165", "aktivni_b12", ("vitamin_b12",), "holotranscobalamin"),
        R("PB (Lead)", "25", "µg/l", "0", "100", "NEW:olovo", note="trace metal; not in the catalog"),
        R("VPA (Valproate)", "62", "mg/l", "50", "100", "NEW:kyselina_valproova", note="drug level; not in the catalog"),
        R("FOL (Folate)", "12", "nmol/l", "8,8", "60,8", "kyselina_listova", ("kyselina_listova_ery",), "serum"),
        R("VIT-D (25-OH vitamin D)", "55 *", "nmol/l", "75", "250", "vitamin_d", ("vitamin_d_1_25",), flag="L"),
        R("TSH", "2,3", "mIU/l", "0,27", "4,20", "tsh"),
        R("FT4 (Free T4)", "16", "pmol/l", "12", "22", "ft4", ("t4_celkovy",), "free"),
        R("TT4 (Total T4)", "95", "nmol/l", "66", "181", "t4_celkovy", ("ft4",), "total"),
        R("FT3 (Free T3)", "4,5", "pmol/l", "3,1", "6,8", "ft3", ("t3_celkovy",), "free"),
        R("HBA1C (Glycated hemoglobin)", "41", "mmol/mol", "20", "42", "hba1c", ("hemoglobin",)),
        R("TNT-HS (Troponin T hs)", "8", "ng/l", "0", "14", "troponin_t", ("troponin_i",), "troponin T, not I"),
        R("CK", "2,2", "µkat/l", "0,4", "3,2", "ck", ("ck_mb",)),
        R("CKMB (CK-MB mass)", "1,8", "µg/l", "0,0", "5,0", "ck_mb", ("ck",)),
    ]
    HEM = [
        R("WBC (Leukocytes)", "7,1", "10^9/l", "4,0", "10,0", "leukocyty", note="blood; U-LEU is the strip"),
        R("RBC (Erythrocytes)", "4,7", "10^12/l", "4,2", "5,8", "erytrocyty"),
        R("HGB (Hemoglobin)", "148", "g/l", "135", "175", "hemoglobin", ("hba1c",)),
        R("HCT (Hematocrit)", "0,44", "l/l", "0,40", "0,50", "hematokrit"),
        R("MCV", "91", "fl", "82", "98", "mcv"),
        R("MCH", "31,5", "pg", "27", "33", "mch", ("mchc",)),
        R("MCHC", "345", "g/l", "320", "360", "mchc", ("mch",)),
        R("RDW-CV", "12,9", "%", "11,5", "14,5", "rdw"),
        R("PLT (Platelets)", "255", "10^9/l", "150", "400", "trombocyty"),
        R("MPV", "9,5", "fl", "7,8", "11,0", "mpv"),
        R("PCT (Plateletcrit)", "0,24", "%", "0,15", "0,40", "trombokrit", ("prokalcitonin",), "plateletcrit; the biochemistry PCT above is procalcitonin"),
        R("NEUT#", "4,1", "10^9/l", "2,0", "7,0", "neutrofily_abs", ("neutrofily",), "absolute"),
        R("NEUT%", "57,7", "%", "45", "70", "neutrofily", ("neutrofily_abs",), "relative"),
        R("LYMPH#", "2,2", "10^9/l", "0,8", "4,0", "lymfocyty_abs", ("lymfocyty",)),
        R("LYMPH%", "31,0", "%", "20", "40", "lymfocyty", ("lymfocyty_abs",)),
    ]
    KOAG = [
        R("INR", "1,02", "", "0,80", "1,20", "inr"),
        R("FIB (Fibrinogen)", "3,1", "g/l", "1,8", "4,2", "fibrinogen"),
    ]
    U = [
        R("U-PH", "5,5", "", "5,0", "7,0", "NOT_BLOOD"),
        R("U-PRO (Protein)", "negat.", "", "", "", "NOT_BLOOD", ("celkova_bilkovina",)),
        R("U-GLU (Glucose)", "negat.", "", "", "", "NOT_BLOOD", ("glukoza",), "urine strip glucose"),
        R("U-KET (Ketones)", "negat.", "", "", "", "NOT_BLOOD"),
        R("U-BLD (Blood)", "negat.", "", "", "", "NOT_BLOOD", ("hemoglobin",)),
        R("U-LEU (Leukocytes)", "negat.", "", "", "", "NOT_BLOOD", ("leukocyty",), "urine strip leukocytes"),
    ]
    V = [
        R("BMI", "26,3 *", "kg/m2", "18,5", "25,0", "IGNORE", note="not a measurement", flag="H"),
        R("BSA (Body surface, DuBois)", "2,01", "m2", "1,60", "2,20", "IGNORE", note="computed, not a measurement"),
        R("KOMENTÁŘ", "Nelze hodnotit lipidové spektrum, pacient nebyl nalačno.", "", "", "", "IGNORE", note="free-text comment; the parser reads it as a qualitative row"),
    ]
    return Lab(
        slug="lis",
        columns=[(50, "Vyšetření"), (260, "Výsledek"), (330, "Hodn."), (365, "Jednotka"), (440, "Dolní mez"), (500, "Horní mez")],
        cells=cells,
        header=header,
        sections=[
            ("BIOCHEMIE - SÉRUM", BIO),
            ("HEMATOLOGIE - KREVNÍ OBRAZ", HEM),
            ("KOAGULACE - PLAZMA", KOAG),
            ("MOČ CHEMICKY", U),
            ("VÝPOČTY A KOMENTÁŘE", V),
        ],
        about="Synthetic hospital LIS (make_lab_fixtures.py): abbreviation-only names with English echoes, H/L in a "
              "Hodnocení column, the lab's own '*' on the value, the interval split into two columns. Every printed "
              "name → catalog id, NEW:<id>, NOT_BLOOD or IGNORE; `wrong` names the id a careless mapper would pick.",
    )


# ---------------------------------------------------------------------------
# 3 — a laboratory printing conventional units
# ---------------------------------------------------------------------------

def konvent() -> Lab:
    def header(page, n):
        text(page, 50, 50, "Laboratoř KONVENTA s.r.o.", size=11, bold=True)
        text(page, 50, 64, "Vzorová 7, 999 99 Vzorov · IČ 99999003 · tel. 000 000 003 · Výsledky v konvenčních jednotkách")
        text(page, 50, 84, "Pacient: Vzorková Marie", size=9)
        text(page, 320, 84, "Rodné číslo: 655911/1009", size=9)
        text(page, 50, 97, "Datum narození: 11. 9. 1965", size=9)
        text(page, 320, 97, "Pohlaví: žena", size=9)
        text(page, 50, 110, "Indikující lékař: MUDr. Fiktivní Karel, Vzorov", size=9)
        text(page, 320, 110, "Datum odběru: 27. 5. 2026 08:10", size=9)
        text(page, 50, 123, "Bydliště: Vzorová 99, 999 99 Vzorov", size=9)
        text(page, 320, 123, f"Strana {n}", size=9)
        return 148

    def cells(r: Row):
        return [(50, r.name), (270, r.value), (330, r.unit), (400, r.ref), (520, r.flag)]

    def R(name, value, unit, ref, answer, wrong=(), note="", flag=""):
        return Row(name, value, unit, ref, "", "", "", flag, answer, tuple(wrong), note)

    BIO = [
        R("S-Glukosa", "92", "mg/dl", "70 - 99", "glukoza", note="older Czech spelling with s; mg/dl"),
        R("S-Močovina", "32", "mg/dl", "15 - 45", "urea", note="mg/dl, the catalog says mmol/l"),
        R("S-Kreatinin (enzymaticky)", "0,95", "mg/dl", "0,70 - 1,20", "kreatinin", note="mg/dl"),
        R("S-Kyselina močová", "5,8", "mg/dl", "3,4 - 7,0", "kyselina_mocova"),
        R("S-Bilirubin celk.", "0,8", "mg/dl", "0,2 - 1,2", "bilirubin_celkovy", ("bilirubin_konjugovany",), "total"),
        R("S-Bilirubin přímý", "0,2", "mg/dl", "0,0 - 0,3", "bilirubin_konjugovany", ("bilirubin_celkovy",), "direct = conjugated"),
        R("S-Bilirubin nepřímý", "0,6", "mg/dl", "0,1 - 0,9", "bilirubin_nekonjugovany", ("bilirubin_celkovy", "bilirubin_konjugovany"), "indirect = unconjugated; the catalog lacks it"),
        R("S-ALT (alaninaminotransferasa)", "38", "U/l", "10 - 50", "alt", note="U/l, not µkat/l"),
        R("S-AST (aspartátaminotransferasa)", "27", "U/l", "10 - 40", "ast"),
        R("S-GMT", "45", "U/l", "10 - 71", "ggt"),
        R("S-ALP (alkalická fosfatasa)", "68", "U/l", "40 - 130", "alp"),
        R("S-CK (kreatinkinasa)", "145", "U/l", "30 - 200", "ck", ("ck_mb",)),
        R("S-Amylasa", "62", "U/l", "28 - 100", "amylaza", ("amylaza_pankreaticka",), "total amylase"),
        R("S-Bílkovina celk.", "7,2", "g/dl", "6,4 - 8,3", "celkova_bilkovina", note="g/dl"),
        R("S-Albumin", "4,4", "g/dl", "3,5 - 5,2", "albumin", note="g/dl"),
        R("S-CRP", "1,8", "mg/l", "0,0 - 5,0", "crp"),
        R("S-Vápník celk.", "9,4", "mg/dl", "8,6 - 10,2", "vapnik", ("vapnik_ionizovany",), "total, mg/dl"),
        R("S-Vápník ionizovaný", "4,9", "mg/dl", "4,5 - 5,3", "vapnik_ionizovany", ("vapnik",), "ionised, mg/dl"),
        R("S-Hořčík", "2,0", "mg/dl", "1,6 - 2,6", "horcik", ("horcik_ery",), "serum, mg/dl"),
    ]
    LIP = [
        R("S-Cholesterol celk.", "198", "mg/dl", "< 200", "cholesterol", ("hdl", "ldl")),
        R("S-HDL-cholesterol", "58", "mg/dl", "> 40", "hdl", ("non_hdl",)),
        R("S-LDL-cholesterol (Friedewald)", "112", "mg/dl", "< 130", "ldl", ("non_hdl",), "calculated LDL; the catalog has one ldl"),
        R("S-Non-HDL-cholesterol", "140", "mg/dl", "< 160", "non_hdl", ("hdl", "ldl")),
        R("S-Triglyceridy", "130", "mg/dl", "< 150", "triacylglyceroly", note="'triglyceridy', the catalog says triacylglyceroly"),
        R("S-Apolipoprotein B", "95", "mg/dl", "55 - 130", "apolipoprotein_b", ("apolipoprotein_a1",), "apo B, not apo A-I"),
        R("S-Lipoprotein(a)", "18", "mg/dl", "< 30", "lipoprotein_a", ("ldl",)),
    ]
    FE = [
        R("S-Železo", "95", "µg/dl", "60 - 170", "zelezo", ("ferritin",), "µg/dl"),
        R("S-Ferritin", "85", "ng/ml", "30 - 400", "ferritin", ("zelezo",), "ng/ml"),
        R("S-Transferin", "260", "mg/dl", "200 - 360", "transferrin", ("saturace_trf",), "mg/dl"),
        R("S-Saturace transferinu", "26", "%", "20 - 50", "saturace_trf", ("transferrin",)),
        R("S-Vitamin B12", "450", "pg/ml", "200 - 900", "vitamin_b12", ("aktivni_b12",), "pg/ml"),
        R("S-Holotranskobalamin (aktivní B12)", "70", "pmol/l", "35 - 165", "aktivni_b12", ("vitamin_b12",)),
        R("S-Vitamin B2 (riboflavin)", "180", "µg/l", "137 - 370", "NEW:vitamin_b2", note="not in the catalog"),
        R("S-Leptin", "8,4", "ng/ml", "2,0 - 15,0", "NEW:leptin", note="not in the catalog"),
        R("S-Folát", "8,5", "ng/ml", "4,0 - 20,0", "kyselina_listova", ("kyselina_listova_ery",), "serum folate, ng/ml"),
        R("B-Folát v erytrocytech", "420", "ng/ml", "280 - 790", "kyselina_listova_ery", ("kyselina_listova",), "erythrocyte folate"),
        R("S-25-OH vitamin D", "28", "ng/ml", "30 - 100", "vitamin_d", ("vitamin_d_1_25",), "ng/ml; the S- prefix is not stripped because a digit follows the hyphen", flag="*"),
        R("S-1,25-dihydroxyvitamin D", "45", "pg/ml", "20 - 79", "vitamin_d_1_25", ("vitamin_d",), "calcitriol, not 25-OH"),
        R("B-Hořčík v erytrocytech", "5,2", "mg/dl", "4,2 - 6,4", "horcik_ery", ("horcik",), "erythrocyte magnesium"),
    ]
    HOR = [
        R("S-TSH", "1,75", "µIU/ml", "0,40 - 4,00", "tsh", note="µIU/ml = mU/l"),
        R("S-fT4", "1,2", "ng/dl", "0,8 - 1,8", "ft4", ("t4_celkovy",), "free, ng/dl"),
        R("S-T4 celkový", "7,8", "µg/dl", "5,1 - 14,1", "t4_celkovy", ("ft4",), "total, µg/dl"),
        R("S-fT3", "3,1", "pg/ml", "2,3 - 4,2", "ft3", ("t3_celkovy",), "free, pg/ml"),
        R("S-Kortizol (ráno)", "14,5", "µg/dl", "6,2 - 19,4", "kortizol", note="µg/dl"),
        R("S-Testosteron celkový", "520", "ng/dl", "264 - 916", "testosteron", ("testosteron_volny",), "total, ng/dl"),
        R("S-Testosteron volný", "12,5", "pg/ml", "6,8 - 21,5", "testosteron_volny", ("testosteron",), "free, pg/ml"),
        R("B-HbA1c", "5,4", "%", "4,0 - 5,6", "hba1c", ("hemoglobin",), "DCCT percent, not hemoglobin"),
    ]
    TUM = [
        R("S-PSA celkový", "1,1", "ng/ml", "0,0 - 4,0", "psa", ("psa_volny",)),
        R("S-PSA volný", "0,3", "ng/ml", "", "psa_volny", ("psa",)),
        R("S-CEA", "1,5", "ng/ml", "0,0 - 5,0", "cea"),
    ]
    KO = [
        R("B-Leukocyty", "6,8", "10^3/µl", "4,0 - 10,0", "leukocyty", note="10^3/µl"),
        R("B-Erytrocyty", "4,8", "10^6/µl", "4,2 - 5,8", "erytrocyty"),
        R("B-Hemoglobin", "15,1", "g/dl", "13,5 - 17,5", "hemoglobin", ("hba1c",), "g/dl"),
        R("B-Hematokrit", "44,5", "%", "40,0 - 50,0", "hematokrit"),
        R("B-MCV", "92", "fl", "82 - 98", "mcv"),
        R("B-MCH", "31", "pg", "27 - 33", "mch", ("mchc",)),
        R("B-MCHC", "34,0", "g/dl", "32,0 - 36,0", "mchc", ("mch",), "g/dl"),
        R("B-Trombocyty", "230", "10^3/µl", "150 - 400", "trombocyty"),
        R("B-Neutrofily relat.", "60", "%", "45 - 70", "neutrofily", ("neutrofily_abs",), "relative"),
        R("B-Neutrofily abs.", "4,1", "10^3/µl", "2,0 - 7,0", "neutrofily_abs", ("neutrofily",), "absolute"),
    ]
    U = [
        R("U-pH", "6,0", "", "5,0 - 7,0", "NOT_BLOOD"),
        R("U-Bílkovina", "negat.", "", "", "NOT_BLOOD", ("celkova_bilkovina",)),
        R("U-Glukóza", "negat.", "", "", "NOT_BLOOD", ("glukoza",), "urine strip glucose"),
        R("U-Ketolátky", "negat.", "", "", "NOT_BLOOD"),
        R("U-Krev", "negat.", "", "", "NOT_BLOOD", ("hemoglobin", "erytrocyty")),
        R("U-Leukocyty", "negat.", "", "", "NOT_BLOOD", ("leukocyty",), "urine strip leukocytes"),
    ]
    V = [
        R("BMI", "24,8", "kg/m2", "18,5 - 25,0", "IGNORE", note="not a measurement"),
        R("Povrch těla (DuBois)", "1,95", "m2", "1,60 - 2,20", "IGNORE", note="computed, not a measurement"),
        R("Stadium CKD (KDIGO)", "G1", "", "", "IGNORE", note="a code, not a number; the parser does not see this row"),
        R("Poznámka", "Hemolýza mírná — draslík hodnoťte s rezervou.", "", "", "IGNORE", note="free-text comment; the parser reads it as a qualitative row"),
    ]
    return Lab(
        slug="konvent",
        columns=[(50, "Vyšetření"), (270, "Výsledek"), (330, "Jednotka"), (400, "Referenční rozmezí"), (520, "Hodn.")],
        cells=cells,
        header=header,
        sections=[
            ("Klinická biochemie", BIO),
            ("Lipidový profil", LIP),
            ("Železo a vitaminy", FE),
            ("Hormony", HOR),
            ("Nádorové markery", TUM),
            ("Krevní obraz", KO),
            ("Moč chemicky", U),
            ("Výpočtové parametry", V),
        ],
        about="Synthetic lab printing conventional units (make_lab_fixtures.py): mg/dl, g/dl, U/l, ng/ml, pg/ml under "
              "S-/B- dash prefixes. Every printed name → catalog id, NEW:<id>, NOT_BLOOD or IGNORE; the catalog's "
              "canonical unit disagrees with most rows here, which is the point — the gate must not apply them unasked.",
    )


# ---------------------------------------------------------------------------
# 4 — a sports / wellness panel
# ---------------------------------------------------------------------------

def wellness() -> Lab:
    def header(page, n):
        text(page, 50, 50, "Wellness Lab Vzorov s.r.o. — Sportovní profil PRO", size=11, bold=True)
        text(page, 50, 64, "Vzorová 42, 999 99 Vzorov · IČ 99999004 · tel. 000 000 004 · sport@wellnesslab.example")
        text(page, 50, 84, "Klient: Vzorek Tomáš", size=9)
        text(page, 320, 84, "Rodné číslo: 920202/1004", size=9)
        text(page, 50, 97, "Datum narození: 2. 2. 1992", size=9)
        text(page, 320, 97, "Sport: běh na lyžích", size=9)
        text(page, 50, 110, "Doporučující lékař: MUDr. Fiktivní Dana", size=9)
        text(page, 320, 110, "Datum odběru: 3. 6. 2026 07:15", size=9)
        text(page, 50, 123, "Číslo profilu: SP-2026-0042", size=9)
        text(page, 320, 123, f"Strana {n}", size=9)
        return 148

    def cells(r: Row):
        return [(50, r.name), (300, r.value), (355, r.unit), (420, r.ref), (525, r.flag)]

    def R(name, value, unit, ref, answer, wrong=(), note="", flag=""):
        return Row(name, value, unit, ref, "", "", "", flag, answer, tuple(wrong), note)

    ION = [
        R("Sodný kation v séru", "140", "mmol/l", "136 - 145", "sodik"),
        R("Draselný kation v séru", "4,3", "mmol/l", "3,5 - 5,1", "draslik"),
        R("Vápník celkový v séru", "2,38", "mmol/l", "2,15 - 2,55", "vapnik", ("vapnik_ionizovany",), "total"),
        R("Vápník ionizovaný", "1,24", "mmol/l", "1,15 - 1,30", "vapnik_ionizovany", ("vapnik",), "ionised"),
        R("Magnezium v séru", "0,88", "mmol/l", "0,70 - 1,05", "horcik", ("horcik_ery",), "serum"),
        R("Magnezium v erytrocytech", "2,20", "mmol/l", "1,80 - 2,60", "horcik_ery", ("horcik",), "erythrocyte"),
        R("Zinek v séru", "14,5", "µmol/l", "10,7 - 18,4", "zinek"),
        R("Selen", "1,15", "µmol/l", "0,80 - 1,60", "selen"),
    ]
    LJ = [
        R("Kreatinin v séru", "84", "µmol/l", "59 - 104", "kreatinin", note="serum"),
        R("Kreatinin v moči", "12,5", "mmol/l", "3,5 - 25,0", "NOT_BLOOD", ("kreatinin",), "urine creatinine under a serum-looking panel; the name says v moči"),
        R("Odhad glomerulární filtrace (CKD-EPI 2021)", "1,70", "ml/s/1,73 m2", "> 1,00", "egfr", ("egfr_mdrd",)),
        R("Kyselina močová v séru", "330", "µmol/l", "202 - 416", "kyselina_mocova"),
        R("Alaninaminotransferáza (ALT)", "0,45", "µkat/l", "0,10 - 0,78", "alt"),
        R("Aspartátaminotransferáza (AST)", "0,50", "µkat/l", "0,10 - 0,72", "ast"),
        R("Kreatinkináza celková", "4,10", "µkat/l", "0,40 - 3,24", "ck", ("ck_mb",), "total CK, high after training", flag="*"),
        R("Bilirubin celkový v séru", "15,0", "µmol/l", "3,0 - 21,0", "bilirubin_celkovy", ("bilirubin_konjugovany",), "total"),
        R("Bilirubin konjugovaný (přímý)", "3,5", "µmol/l", "0,0 - 5,0", "bilirubin_konjugovany", ("bilirubin_celkovy",), "conjugated"),
        R("Albumin v séru", "46", "g/l", "35 - 52", "albumin"),
    ]
    LIP = [
        R("Celkový cholesterol", "4,6", "mmol/l", "2,9 - 5,0", "cholesterol", ("hdl", "ldl")),
        R("Cholesterol HDL", "1,70", "mmol/l", "1,00 - 2,10", "hdl", ("non_hdl",), "a spelling the catalog already knows; kept as the one familiar lipid row"),
        R("Cholesterol LDL (přímé stanovení)", "2,40", "mmol/l", "1,20 - 3,00", "ldl", ("non_hdl",), "directly measured LDL"),
        R("Cholesterol non-HDL", "2,90", "mmol/l", "0,00 - 3,80", "non_hdl", ("hdl", "ldl")),
        R("Triacylglyceroly nalačno", "0,95", "mmol/l", "0,45 - 1,70", "triacylglyceroly"),
        R("Omega-3 index", "6,8", "%", "> 8,0", "omega3_index", flag="*"),
        R("Apolipoprotein B", "0,85", "g/l", "0,55 - 1,30", "apolipoprotein_b", ("apolipoprotein_a1",), "apo B, not apo A-I"),
        R("Lipoprotein (a)", "< 20", "nmol/l", "< 75", "lipoprotein_a", ("ldl",), "a below-detection value"),
    ]
    FE = [
        R("Feritin", "60", "µg/l", "30 - 300", "ferritin", ("zelezo",)),
        R("Železo v séru", "20", "µmol/l", "5,8 - 34,5", "zelezo", ("ferritin",)),
        R("Transferin", "2,50", "g/l", "2,00 - 3,60", "transferrin", ("saturace_trf", "str")),
        R("Saturace transferinu", "30", "%", "20 - 55", "saturace_trf", ("transferrin",)),
        R("Solubilní transferinový receptor (sTfR)", "3,0", "mg/l", "1,9 - 4,4", "str", ("transferrin", "saturace_trf")),
        R("Vitamin B12 (kobalamin)", "400", "pmol/l", "145 - 569", "vitamin_b12", ("aktivni_b12",)),
        R("Aktivní vitamin B12 (holotranskobalamin)", "85", "pmol/l", "35 - 165", "aktivni_b12", ("vitamin_b12",)),
        R("Koenzym Q10 (ubichinon)", "1,10", "mg/l", "0,50 - 1,50", "NEW:koenzym_q10", note="not in the catalog"),
        R("Jód v séru", "62", "µg/l", "40 - 100", "NEW:jod", note="not in the catalog"),
        R("Kyselina listová v séru", "20", "nmol/l", "8,8 - 60,8", "kyselina_listova", ("kyselina_listova_ery",), "serum"),
        R("Kyselina listová v erytrocytech", "1100", "nmol/l", "634 - 1780", "kyselina_listova_ery", ("kyselina_listova",), "erythrocyte"),
    ]
    VIT = [
        R("Vitamin D (25-hydroxy)", "95", "nmol/l", "75 - 250", "vitamin_d", ("vitamin_d_1_25",), "25-OH"),
        R("Vitamin D aktivní (1,25-dihydroxy)", "120", "pmol/l", "48 - 190", "vitamin_d_1_25", ("vitamin_d",), "calcitriol"),
        R("Vitamin B6 (pyridoxal-5-fosfát)", "65", "nmol/l", "35 - 110", "vitamin_b6"),
        R("Homocystein", "8,5", "µmol/l", "5,0 - 15,0", "homocystein"),
    ]
    HOR = [
        R("Testosteron celkový", "22,0", "nmol/l", "8,6 - 29,0", "testosteron", ("testosteron_volny",), "total"),
        R("Volný testosteron", "380", "pmol/l", "160 - 700", "testosteron_volny", ("testosteron",), "free"),
        R("SHBG (globulin vázající pohlavní hormony)", "35", "nmol/l", "14,5 - 48,4", "shbg"),
        R("Index volných androgenů (FAI)", "62,9", "%", "34,0 - 106,0", "fai"),
        R("Kortizol ranní", "420", "nmol/l", "133 - 537", "kortizol"),
        R("TSH (tyreotropin)", "1,6", "mIU/l", "0,27 - 4,20", "tsh"),
        R("Volný tyroxin (fT4)", "17,0", "pmol/l", "12,0 - 22,0", "ft4", ("t4_celkovy",), "free"),
        R("Volný trijodtyronin (fT3)", "5,2", "pmol/l", "3,1 - 6,8", "ft3", ("t3_celkovy",), "free"),
        R("Protilátky proti tyreoidální peroxidáze (anti-TPO)", "12", "kIU/l", "0 - 34", "anti_tpo"),
    ]
    MET = [
        R("hs-CRP", "< 0,5", "mg/l", "< 1,0", "crp_hs", note="high-sensitivity assay of the same analyte; a below-detection value"),
        R("Glukóza nalačno", "4,9", "mmol/l", "3,9 - 5,6", "glukoza", note="serum; the strip Glukóza is under Moč chemicky"),
        R("Index HOMA-IR", "1,3", "", "< 2,0", "homa_ir"),
        R("Glykovaný hemoglobin (HbA1c)", "33", "mmol/mol", "20 - 42", "hba1c", ("hemoglobin",)),
    ]
    KO = [
        R("Hemoglobin", "155", "g/l", "135 - 175", "hemoglobin", ("hba1c",)),
        R("Střední objem erytrocytu", "90", "fl", "82 - 98", "mcv"),
        R("Leukocyty celkem", "5,9", "10^9/l", "4,0 - 10,0", "leukocyty", note="blood; the strip Leukocyty is under Moč chemicky"),
        R("Neutrofilní granulocyty (relativní)", "55", "%", "45 - 70", "neutrofily", ("neutrofily_abs",), "relative"),
        R("Neutrofilní granulocyty (absolutní počet)", "3,2", "10^9/l", "2,0 - 7,0", "neutrofily_abs", ("neutrofily",), "absolute"),
        R("Trombocyty", "245", "10^9/l", "150 - 400", "trombocyty"),
        R("Retikulocyty absolutně", "55", "10^9/l", "25 - 100", "retikulocyty_abs", ("retikulocyty",), "absolute count"),
    ]
    U = [
        R("pH", "6,0", "", "5,0 - 7,0", "NOT_BLOOD"),
        R("Bílkovina", "negat.", "", "", "NOT_BLOOD", ("celkova_bilkovina",), "urine strip"),
        R("Glukóza", "negat.", "", "", "NOT_BLOOD", ("glukoza",), "urine strip glucose, bare name under the Moč chemicky heading"),
        R("Ketolátky", "negat.", "", "", "NOT_BLOOD"),
        R("Krev", "negat.", "", "", "NOT_BLOOD", ("hemoglobin", "erytrocyty"), "urine strip blood"),
        R("Leukocyty", "negat.", "", "", "NOT_BLOOD", ("leukocyty",), "urine strip leukocytes, bare name under the Moč chemicky heading"),
    ]
    V = [
        R("BMI", "22,8", "kg/m2", "18,5 - 25,0", "IGNORE", note="not a measurement"),
        R("Povrch těla", "1,98", "m2", "", "IGNORE", note="no interval and no known unit; the parser does not see this row"),
        R("Hodnocení stadia CKD", "G1", "", "", "IGNORE", note="a code, not a number; the parser does not see this row"),
        R("Komentář laboratoře", "Nelze hodnotit omega-3 index — nedostatek materiálu.", "", "", "IGNORE", note="free-text comment; the parser reads it as a qualitative row"),
    ]
    return Lab(
        slug="wellness",
        columns=[(50, "Parametr"), (300, "Výsledek"), (355, "Jednotka"), (420, "Optimální rozmezí"), (525, "Hodn.")],
        cells=cells,
        header=header,
        sections=[
            ("Panel: Ionty a minerály", ION),
            ("Panel: Ledviny a játra", LJ),
            ("Panel: Lipidy", LIP),
            ("Panel: Železo a krvetvorba", FE),
            ("Panel: Vitaminy", VIT),
            ("Panel: Hormony", HOR),
            ("Panel: Zánět a metabolismus", MET),
            ("Panel: Krevní obraz", KO),
            ("Moč chemicky", U),
            ("Výpočty a komentář", V),
        ],
        about="Synthetic sports/wellness panel (make_lab_fixtures.py): long descriptive Czech names, a heading per "
              "panel, no prefixes, '< 0,5' and 'negat.' results. Every printed name → catalog id, NEW:<id>, "
              "NOT_BLOOD or IGNORE; `wrong` names the id a careless mapper would pick.",
    )


LABS = [slovak, lis, konvent, wellness]

# Rows the parser cannot see (no number, no interval, no unit it knows). They
# are printed so the sheet looks like a real one, and left out of the truth
# because a truth key nothing produces would only ever be "missing".
UNSEEN = {
    # On the LIS the interval is two bare numbers, so a row without a unit the
    # parser knows (INR, urine pH, BMI, BSA) has neither a unit nor a range.
    ("lis", "INR"),
    ("lis", "U-PH"),
    ("lis", "BMI"),
    ("lis", "BSA (Body surface, DuBois)"),
    ("konvent", "Stadium CKD (KDIGO)"),
    ("wellness", "Povrch těla"),
    ("wellness", "Hodnocení stadia CKD"),
}


def main() -> None:
    for build in LABS:
        lab = build()
        out = OUT / lab.slug
        out.mkdir(parents=True, exist_ok=True)
        doc = pymupdf.open()
        render(doc, lab)
        save(doc, out / "report.pdf")
        pages = doc.page_count
        doc.close()
        truth = truth_of(lab)
        for slug, name in UNSEEN:
            if slug == lab.slug:
                truth.pop(name)
        (out / "truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        rows = sum(len(r) for _, r in lab.sections)
        print(f"  {lab.slug}: {rows} rows on {pages} page(s), {len(truth) - 1} truth keys")
    print(f"Fixtures → {OUT}")


if __name__ == "__main__":
    main()
