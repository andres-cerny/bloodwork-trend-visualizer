"""Generate the chat demo's synthetic lab corpus — two practices, no real patient.

Same discipline as ``make_demo_data.py``, and for the same reasons: fonts come
from ``scripts/_fonts.py`` (never the system), the PDFs are rendered at 220 DPI
by PyMuPDF, every row's ``bbox`` comes from the same ``search_for`` lookup
``src/locate.py`` performs, and every number is parsed by ``src/normalize.py``.
The shipped corpus is therefore produced by the real deterministic code path
rather than hand-written JSON — a citation crop in the chat UI is drawn from a
box that was actually measured on the actually rendered page.

Two tenants, one generator:

* ``sport`` — five synthetic endurance athletes. (Sport patient #6 is Ondřej's
  own real record, by his explicit 2026-08-23 decision. It is **not** created
  here and never will be: a second script, ``seed_real_patient.py``, extracts it
  from the git-ignored ``samples/`` at deploy time and writes its page images to
  R2. Nothing real is ever committed, so this generator must stay ignorant of
  it.)
* ``orto`` — six synthetic patients, two of them deliberately both named
  "Michal Novák" with different birth years, so the disambiguation moment in
  the demo can be triggered on demand rather than hoped for.

Documents (performance evaluations, physio notes, imaging) are Phase 4 and are
not generated here; ``documents`` / ``document_pages`` are left empty.

    cd tools/pipeline && python3 -m scripts.make_chat_demo

Outputs:
    apps/chat/public/demo/{sport,orto}/pages/*.png      committed page images
    apps/chat/public/demo/{sport,orto}/reports.json     committed corpus
    tools/pipeline/out/seed_{sport,orto}.sql            committed seed SQL
"""
from __future__ import annotations

import json
import random
import shutil
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from scripts._fonts import czech_fonts  # noqa: E402

FONT, FONT_BOLD = czech_fonts()

from src.matching import Registry  # noqa: E402
from src.models import AnalyteDef, Measurement  # noqa: E402
from src.normalize import normalize_measurement  # noqa: E402

OUT = ROOT / "apps" / "chat" / "public" / "demo"
SQL_OUT = ROOT / "tools" / "pipeline" / "out"
RENDER_DPI = 220

# Every random draw in this file comes from a Random seeded with this string
# plus the patient id and the analyte name, so a value depends only on *which*
# number it is — never on iteration order, insertion order or the clock.
SEED = "bloodwork-chat-demo-2026"

EXTRACTED_BY = "claude-sonnet-5"


# --- the analytes ------------------------------------------------------------
# Printed names are the registry's own Czech synonyms (see data/registry.json),
# so the same matcher the real pipeline uses maps them without a special case.
# Reference intervals are sex-specific where clinical practice is, and they are
# what the flag is computed from — the interval printed on the patient's own
# report, never a global table.

@dataclass(frozen=True)
class Analyte:
    raw: str          # exactly as printed on the report
    unit: str
    ref_m: str
    ref_f: str
    decimals: int
    base_m: float     # centre of the healthy jitter, when no arc overrides it
    base_f: float
    jitter: float
    floor: float = 0.0

    def ref(self, sex: str) -> str:
        return self.ref_m if sex == "m" else self.ref_f

    def base(self, sex: str) -> float:
        return self.base_m if sex == "m" else self.base_f


ANALYTES: dict[str, Analyte] = {a.raw: a for a in [
    Analyte("B_Hemoglobin",     "g/l",     "(135-175)",     "(120-160)",     0, 150,   134,   4.0),
    Analyte("B_Hematokrit",     "1",       "(0,400-0,500)", "(0,350-0,470)", 3, 0.445, 0.400, 0.012),
    Analyte("B_Erytrocyty",     "10^12/l", "(4,20-5,80)",   "(3,80-5,20)",   2, 4.95,  4.45,  0.15),
    Analyte("B_Leukocyty",      "10^9/l",  "(4,00-10,00)",  "(4,00-10,00)",  2, 6.30,  6.10,  0.90),
    Analyte("B_Trombocyty",     "10^9/l",  "(150-400)",     "(150-400)",     0, 245,   258,   25.0),
    Analyte("S_Ferritin",       "µg/l",    "(30-400)",      "(13-150)",      0, 120,   55,    12.0, 1.0),
    Analyte("S_Železo",         "µmol/l",  "(11,0-28,0)",   "(6,6-26,0)",    1, 18.5,  14.0,  2.5, 0.5),
    Analyte("S_Saturace Trf",   "%",       "(20,0-45,0)",   "(20,0-45,0)",   1, 31.0,  26.0,  4.0, 0.5),
    Analyte("S_Kreatinin",      "µmol/l",  "(62,00-110)",   "(44,00-104)",   0, 88,    68,    5.0),
    Analyte("S_Urea",           "mmol/l",  "(2,80-8,00)",   "(2,80-8,00)",   2, 5.20,  4.60,  0.60),
    Analyte("S_Kreatinkináza",  "µkat/l",  "(0,40-3,20)",   "(0,40-2,85)",   2, 2.40,  1.60,  0.55, 0.10),
    Analyte("S_ALT",            "µkat/l",  "(0,17-0,78)",   "(0,17-0,55)",   2, 0.52,  0.36,  0.09, 0.05),
    Analyte("S_AST",            "µkat/l",  "(0,17-0,85)",   "(0,17-0,60)",   2, 0.55,  0.40,  0.09, 0.05),
    Analyte("S_CRP",            "mg/l",    "(0,0-5,0)",     "(0,0-5,0)",     1, 1.4,   1.4,   0.8, 0.1),
    Analyte("S_Glukóza",        "mmol/l",  "(3,90-5,60)",   "(3,90-5,60)",   2, 4.85,  4.75,  0.30),
]}

# Which rows a given draw prints. A sports-medicine full panel, the iron-focused
# subset an entry examination gets, an orthopaedic pre-operative panel and the
# short panel a physiotherapy referral comes with.
PANELS: dict[str, list[str]] = {
    "sport_full": [
        "B_Hemoglobin", "B_Hematokrit", "B_Erytrocyty", "S_Ferritin", "S_Železo",
        "S_Saturace Trf", "S_Kreatinin", "S_Urea", "S_Kreatinkináza", "S_ALT",
        "S_AST", "S_CRP", "S_Glukóza",
    ],
    "sport_iron": [
        "B_Hemoglobin", "B_Hematokrit", "B_Erytrocyty", "S_Ferritin", "S_Železo",
        "S_Saturace Trf", "S_CRP", "S_Kreatinin", "S_Glukóza",
    ],
    "orto_preop": [
        "B_Hemoglobin", "B_Hematokrit", "B_Erytrocyty", "B_Leukocyty",
        "B_Trombocyty", "S_Kreatinin", "S_Urea", "S_Glukóza", "S_ALT", "S_AST",
        "S_CRP",
    ],
    "orto_basic": [
        "B_Hemoglobin", "B_Leukocyty", "B_Trombocyty", "S_CRP", "S_Glukóza",
        "S_Kreatinin", "S_Urea", "S_ALT",
    ],
}


# --- the patients ------------------------------------------------------------
# One row per patient: who they are, when they were drawn, and the arc the
# numbers have to tell. `arcs` names the analytes whose series is deliberate —
# one value per draw, in draw order. Everything else jitters around a healthy
# baseline, because a report where *every* line moves with the story reads as
# fabricated; real panels are mostly boring.

@dataclass(frozen=True)
class Story:
    pid: str          # D1 patients.id — "p-slug"
    name: str
    birth: str        # ISO
    sex: str          # 'm' | 'f'
    note: str         # short Czech clinical note, shown to the agent
    physician: str    # fictional ordering physician, printed on the report
    panel: str
    draws: tuple[str, ...]
    arcs: dict[str, tuple[float, ...]] = field(default_factory=dict)


# Fictional laboratories. Deliberately not any real Czech lab — no SPADIA, no
# AGILAB, no CASRI — and no address, IČ or accreditation number, because a
# plausible-looking identifier is exactly the kind of detail that outlives the
# demo it was invented for.
LABS: dict[str, tuple[str, ...]] = {
    "sport": ("Laboratoře Modrý Kámen s.r.o.", "Laboratoř Zelený Ostrov s.r.o."),
    "orto": ("Ortolab Podhájí s.r.o.", "Laboratoř Nemocnice Podhájí"),
}

SPORT: list[Story] = [
    # Overtraining: ferritin walks out of the bottom of its interval over three
    # seasons, with iron and transferrin saturation following it down and
    # haemoglobin only starting to give way at the end — the sequence a sports
    # physician is meant to catch before the haemogram does.
    Story(
        pid="p-hruby-1994", name="Tomáš Hrubý", birth="1994-03-12", sex="m",
        note="Vytrvalostní běžec, maraton. Sledování zásob železa při vysokém objemu tréninku.",
        physician="MUDr. Pavla Hejduková", panel="sport_full",
        draws=("2023-02-14", "2023-08-22", "2024-03-05", "2024-09-17",
               "2025-04-08", "2026-02-24"),
        arcs={
            "S_Ferritin":      (126, 104, 88, 61, 34, 21),
            "S_Železo":        (19.4, 17.2, 15.8, 12.6, 9.8, 8.1),
            "S_Saturace Trf":  (34.2, 30.1, 27.4, 22.8, 17.6, 13.9),
            "B_Hemoglobin":    (152, 150, 148, 145, 141, 136),
            "B_Hematokrit":    (0.448, 0.443, 0.437, 0.430, 0.419, 0.408),
            # Drawn on different days relative to hard sessions, which is why a
            # single high CK is not a finding.
            "S_Kreatinkináza": (2.61, 3.94, 2.88, 4.72, 3.35, 5.10),
        },
    ),
    # Altitude camp: the July draw is two days after coming down from a
    # three-week camp — haemoglobin, haematocrit and red cells up together, and
    # ferritin down because it was spent building them.
    Story(
        pid="p-palan-1997", name="Vojtěch Palán", birth="1997-06-30", sex="m",
        note="Silniční cyklista. Sledování hematologické odpovědi na výškové soustředění.",
        physician="MUDr. Radek Šimáně", panel="sport_full",
        draws=("2024-01-16", "2024-05-21", "2024-07-09", "2024-11-12", "2025-05-19"),
        arcs={
            "B_Hemoglobin": (149, 151, 166, 158, 150),
            "B_Hematokrit": (0.442, 0.447, 0.492, 0.470, 0.446),
            "B_Erytrocyty": (4.92, 4.98, 5.44, 5.21, 4.96),
            "S_Ferritin":   (96, 88, 52, 61, 79),
        },
    ),
    # Anaemia workup under treatment: everything starts below its interval and
    # climbs back into it. The recovery is the point — a demo where the only
    # abnormal patient stays abnormal cannot show a trend being answered.
    Story(
        pid="p-sebestova-1999", name="Klára Šebestová", birth="1999-11-08", sex="f",
        note="Triatlonistka. Sideropenická anémie, kontroly při substituci železa.",
        physician="MUDr. Pavla Hejduková", panel="sport_full",
        draws=("2024-02-27", "2024-05-14", "2024-09-03", "2025-01-21", "2025-06-10"),
        arcs={
            "B_Hemoglobin":   (106, 112, 119, 126, 131),
            "B_Hematokrit":   (0.322, 0.341, 0.356, 0.379, 0.396),
            "B_Erytrocyty":   (3.62, 3.78, 3.95, 4.18, 4.34),
            "S_Ferritin":     (6, 9, 16, 28, 44),
            "S_Železo":       (4.8, 6.2, 9.5, 13.4, 16.8),
            "S_Saturace Trf": (8.4, 11.2, 16.5, 22.7, 27.3),
        },
    ),
    # Four clean seasons. No arc at all: the answer to "jak je na tom" must
    # sometimes be "nothing to report", or the agent learns that every patient
    # has a finding.
    Story(
        pid="p-krizak-1991", name="Adam Křižák", birth="1991-09-23", sex="m",
        note="Běžec na lyžích. Pravidelná sezónní kontrola, bez obtíží.",
        physician="MUDr. Tereza Malíková", panel="sport_full",
        draws=("2023-05-09", "2023-11-28", "2024-06-11", "2025-05-27", "2026-03-17"),
    ),
    # One draw only — the case where every direction is 'single' and no trend
    # exists to chart. The agent must say so rather than draw a line.
    Story(
        pid="p-bartonova-2001", name="Nikola Bartoňová", birth="2001-04-05", sex="f",
        note="Plavkyně. Vstupní sportovní prohlídka, první odběr.",
        physician="MUDr. Radek Šimáně", panel="sport_iron",
        draws=("2026-01-13",),
    ),
    # Sport patient #6 is Ondřej's real record. Seeded separately by
    # seed_real_patient.py at deploy time, straight from samples/ into D1 + R2.
    # It is deliberately absent from this table: nothing real is committed.
]

ORTO: list[Story] = [
    # The ambiguity pair, first half. Post-operative course of a hip
    # replacement: pre-op panel, day-3 panel (blood loss + an inflammatory
    # response that is expected, not alarming), and the rehabilitation check
    # where both have come most of the way back.
    Story(
        pid="p-novak-1963", name="Michal Novák", birth="1963-07-19", sex="m",
        note="Stav po TEP levé kyčle (02/2025), ambulantní rehabilitace.",
        physician="MUDr. Kamil Brandejs", panel="orto_preop",
        draws=("2025-01-14", "2025-02-06", "2025-04-22"),
        arcs={
            "B_Hemoglobin": (147, 104, 128),
            "B_Hematokrit": (0.436, 0.311, 0.382),
            "B_Erytrocyty": (4.81, 3.44, 4.19),
            "B_Leukocyty":  (6.40, 11.80, 7.20),
            "B_Trombocyty": (238, 402, 311),
            "S_CRP":        (2.1, 78.4, 6.2),
        },
    ),
    # The ambiguity pair, second half — same name, twenty-five years apart.
    # "Dej mi souhrn Michala Nováka" has to ask which one.
    Story(
        pid="p-novak-1988", name="Michal Novák", birth="1988-02-27", sex="m",
        note="Plastika LCA pravého kolena (10/2024), návrat ke sportu.",
        physician="MUDr. Kamil Brandejs", panel="orto_preop",
        draws=("2024-10-02", "2024-12-11"),
        arcs={
            "B_Hemoglobin": (156, 151),
            "S_CRP":        (1.8, 3.4),
        },
    ),
    Story(
        pid="p-bezdickova-1971", name="Jarmila Bezdíčková", birth="1971-05-14", sex="f",
        note="Chronické bolesti bederní páteře, konzervativní terapie a fyzioterapie.",
        physician="MUDr. Iveta Roubalová", panel="orto_basic",
        draws=("2024-04-18", "2025-09-30"),
        arcs={"S_CRP": (4.2, 5.8)},
    ),
    Story(
        pid="p-vondrusak-1985", name="Petr Vondrušák", birth="1985-12-03", sex="m",
        note="Impingement pravého ramene, fyzioterapie bez operace.",
        physician="MUDr. Iveta Roubalová", panel="orto_basic",
        draws=("2025-06-05",),
    ),
    Story(
        pid="p-trefilova-1958", name="Hana Trefilová", birth="1958-08-21", sex="f",
        note="Gonartróza vlevo, konzervativní postup.",
        physician="MUDr. Kamil Brandejs", panel="orto_basic",
        draws=("2026-01-29",),
    ),
    Story(
        pid="p-skaloud-1993", name="Radim Škaloud", birth="1993-03-08", sex="m",
        note="Distorze pravého hlezna, nekomplikované hojení.",
        physician="MUDr. Iveta Roubalová", panel="orto_basic",
        draws=("2025-03-19", "2025-11-04"),
    ),
]

PRACTICES: dict[str, list[Story]] = {"sport": SPORT, "orto": ORTO}


# --- helpers -----------------------------------------------------------------
def cz_date(iso: str) -> str:
    y, m, d = iso.split("-")
    return f"{int(d)}.{int(m)}.{y}"


def cz_number(value: float, decimals: int) -> str:
    return f"{value:.{decimals}f}".replace(".", ",")


def normalize_name(name: str) -> str:
    """The one name-normalisation rule, Python side.

    Mirrors ``normalizeName`` in ``packages/agent/datasource/src/d1.ts``: NFD,
    drop combining marks, lowercase, collapse whitespace. The two must not
    drift — ``find_patient`` matches what this writes into ``patients.name_norm``.
    """
    decomposed = unicodedata.normalize("NFD", name)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(stripped.lower().split())


def series(story: Story, analyte: Analyte) -> list[float]:
    """The printed values for one analyte across this patient's draws."""
    arc = story.arcs.get(analyte.raw)
    if arc is not None:
        assert len(arc) == len(story.draws), f"{story.pid}/{analyte.raw}: arc length"
        return [float(v) for v in arc]
    rng = random.Random(f"{SEED}|{story.pid}|{analyte.raw}")
    base = analyte.base(story.sex)
    return [
        max(analyte.floor, round(base + rng.uniform(-analyte.jitter, analyte.jitter),
                                 analyte.decimals))
        for _ in story.draws
    ]


def build_pdf(path: Path, story: Story, date_iso: str, lab_name: str,
              rows: list[tuple[str, str, str, str]]) -> None:
    """Render one synthetic Czech lab report to a real PDF, with a text layer."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)  # A4 points
    page.insert_font(fontname="dj", fontfile=FONT)
    page.insert_font(fontname="djb", fontfile=FONT_BOLD)

    page.insert_text((50, 60), lab_name, fontname="djb", fontsize=15)
    page.insert_text((50, 80), "Výsledky laboratorního vyšetření", fontname="dj", fontsize=10)
    page.insert_text((50, 108), f"Pacient: {story.name}", fontname="dj", fontsize=10)
    # Date of birth rather than a rodné číslo: the demo needs a birth year to
    # tell the two Michal Nováks apart, and inventing eleven national
    # identifiers that happen to be checksum-valid would create exactly the kind
    # of real-looking data this corpus exists to avoid.
    page.insert_text((50, 124), f"Datum narození: {cz_date(story.birth)}",
                     fontname="dj", fontsize=10)
    page.insert_text((50, 140), f"Datum odběru: {cz_date(date_iso)}",
                     fontname="dj", fontsize=10)
    page.insert_text((50, 156), f"Odesílající lékař: {story.physician}",
                     fontname="dj", fontsize=10)

    y = 194
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
        "Ukázková data — smyšlený pacient i laboratoř, negenerováno z reálného vyšetření.",
        fontname="dj",
        fontsize=7,
    )
    doc.save(path)
    doc.close()


def row_bbox(pg, zoom: float, name: str, value: str, unit: str, ref: str):
    """The printed row's box in page-image pixels.

    The same ``search_for`` lookup ``src/locate.py`` uses, widened from the
    analyte name across the rest of the printed line: a doctor checking a
    citation is checking the number, and a box drawn around the word
    "Hemoglobin" frames the only part they already believe.
    """
    rects = pg.search_for(name)
    if not rects:
        return None
    r = sorted(rects, key=lambda rr: rr.y0)[0]
    x0, y0, x1, y1 = r.x0, r.y0, r.x1, r.y1
    for other in (value, unit, ref):
        if not other or not other.strip():
            continue
        for cand in pg.search_for(other.strip()):
            if abs(cand.y0 - r.y0) <= 3 and cand.x0 >= r.x0:
                x1 = max(x1, cand.x1)
                y0 = min(y0, cand.y0)
                y1 = max(y1, cand.y1)
    return [round(x0 * zoom, 1), round(y0 * zoom, 1),
            round(x1 * zoom, 1), round(y1 * zoom, 1)]


# --- the corpus --------------------------------------------------------------
def build_practice(tenant: str, stories: list[Story], registry: Registry) -> list[dict]:
    """Render every draw of every patient in one practice; return the reports."""
    img_dir = OUT / tenant / "pages"
    if (OUT / tenant).exists():
        shutil.rmtree(OUT / tenant)
    img_dir.mkdir(parents=True, exist_ok=True)
    tmp = OUT / tenant / "_tmp"
    tmp.mkdir(parents=True, exist_ok=True)

    labs = LABS[tenant]
    reports: list[dict] = []

    for story in stories:
        panel = [ANALYTES[raw] for raw in PANELS[story.panel]]
        values = {a.raw: series(story, a) for a in panel}

        for di, date_iso in enumerate(story.draws):
            # Which lab drew which sample is fixed by position, not chosen at
            # random: a corpus that reshuffles its letterheads between runs is
            # not byte-identical.
            lab_name = labs[di % len(labs)]
            page_rows = [
                (a.raw, cz_number(values[a.raw][di], a.decimals), a.unit, a.ref(story.sex))
                for a in panel
            ]

            report_id = f"{story.pid}-r{di + 1}"
            pdf_path = tmp / f"{report_id}.pdf"
            build_pdf(pdf_path, story, date_iso, lab_name, page_rows)

            doc = pymupdf.open(pdf_path)
            pg = doc[0]
            zoom = RENDER_DPI / 72.0
            pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
            img_name = f"{report_id}_p1.png"
            pix.save(img_dir / img_name)

            measurements = []
            for name, value, unit, ref in page_rows:
                m = Measurement(
                    raw_analyte_name=name,
                    value_raw=value,
                    unit_raw=unit,
                    ref_range_raw=ref,
                    source_snippet=f"{name}   {value}   {unit}   {ref}",
                    source_page=1,
                    extracted_by=EXTRACTED_BY,
                )
                normalize_measurement(m)
                m.canonical_id = registry.match(name)
                assert m.canonical_id, f"unmapped analyte name: {name}"
                assert m.value is not None, f"unparsed value: {name} = {value}"

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
                    "bbox": row_bbox(pg, zoom, name, value, unit, ref),
                })

            reports.append({
                "id": report_id,
                # patientRef is the one addition to the bloodwork demo's report
                # shape: this file is flat, and a report has to say whose it is.
                "patientRef": story.pid,
                "sourceFile": f"{report_id}.pdf",
                "reportDate": date_iso,
                "labName": lab_name,
                "patientName": story.name,
                "patientId": None,
                "pages": [{
                    "pageNum": 1,
                    "imageUrl": f"/demo/{tenant}/pages/{img_name}",
                    "imageWidth": pix.width,
                    "imageHeight": pix.height,
                }],
                "measurements": measurements,
            })
            doc.close()

    shutil.rmtree(tmp)
    (OUT / tenant / "reports.json").write_text(
        json.dumps(reports, ensure_ascii=False, indent=1), encoding="utf-8")
    return reports


# --- the seed SQL ------------------------------------------------------------
def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def sql_num(x: float | None) -> str:
    return "NULL" if x is None else repr(float(x))


def direction_of(last: float, previous: float | None) -> tuple[float | None, str]:
    """Where a patient's series for one analyte currently stands. Delta and
    direction, and **this is the only place the rule is written**.

    The cohort tool is a filter over the column this produces; it must not
    recompute, re-threshold or second-guess it, and neither must the prompt.
    One draw is 'single', not 'stable' — an unknown direction and a flat one are
    different clinical facts and the demo must not blur them. Otherwise a move
    of 5 % or less of the previous value is noise ('stable'); anything larger is
    'rising' or 'falling' by its sign.
    """
    if previous is None:
        return None, "single"
    delta = round(last - previous, 6)
    if abs(delta) <= abs(previous) * 0.05:
        return delta, "stable"
    return delta, ("rising" if delta > 0 else "falling")


def build_sql(tenant: str, stories: list[Story], reports: list[dict],
              registry: Registry) -> str:
    by_patient = {s.pid: [r for r in reports if r["patientRef"] == s.pid] for s in stories}

    lines: list[str] = [
        f"-- Seed for the '{tenant}' practice — generated by",
        "-- tools/pipeline/scripts/make_chat_demo.py. Do not edit by hand:",
        "-- regenerate it, or the committed corpus and the database disagree.",
        "--",
        "-- Every patient here is fictional. reports.payload is the lossless",
        "-- LabReport JSON exactly as apps/chat/public/demo/*/reports.json holds",
        "-- it; measurements and patient_analyte_summary are derived indexes,",
        "-- rebuilt from it, never a second source of truth.",
        "--",
        "-- Re-applying this file replaces the synthetic corpus rather than",
        "-- duplicating it, so a re-seed during deploy is safe. Children first,",
        "-- so nothing is left orphaned.",
        "",
        "DELETE FROM patient_analyte_summary;",
        "DELETE FROM measurements;",
        "DELETE FROM document_pages;",
        "DELETE FROM documents;",
        "DELETE FROM reports;",
        "DELETE FROM patients;",
        "",
    ]

    lines.append("-- patients")
    for s in stories:
        lines.append(
            "INSERT INTO patients (id, full_name, name_norm, birth_date, sex, note) VALUES ("
            f"{sql_str(s.pid)}, {sql_str(s.name)}, {sql_str(normalize_name(s.name))}, "
            f"{sql_str(s.birth)}, {sql_str(s.sex)}, {sql_str(s.note)});"
        )
    lines.append("")

    lines.append("-- reports: the lossless payload, one row per rendered draw")
    for s in stories:
        for r in by_patient[s.pid]:
            payload = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
            lines.append(
                "INSERT INTO reports (id, patient_id, report_date, lab_name, payload) VALUES ("
                f"{sql_str(r['id'])}, {sql_str(s.pid)}, {sql_str(r['reportDate'])}, "
                f"{sql_str(r['labName'])}, {sql_str(payload)});"
            )
    lines.append("")

    lines.append("-- measurements: derived index, normalized numeric results only")
    lines.append("-- (a censored or qualitative cell has no number to filter on)")
    for s in stories:
        for r in by_patient[s.pid]:
            for m in r["measurements"]:
                if m["value"] is None or not m["canonicalId"]:
                    continue
                lines.append(
                    "INSERT INTO measurements (patient_id, report_id, report_date, "
                    "canonical_id, display_name, unit, value, flag, ref_low, ref_high) VALUES ("
                    f"{sql_str(s.pid)}, {sql_str(r['id'])}, {sql_str(r['reportDate'])}, "
                    f"{sql_str(m['canonicalId'])}, "
                    f"{sql_str(registry.display_name(m['canonicalId']))}, "
                    f"{sql_str(m['unit'] or '')}, {sql_num(m['value'])}, "
                    f"{sql_str(m['flag'])}, {sql_num(m['refRangeLow'])}, "
                    f"{sql_num(m['refRangeHigh'])});"
                )
    lines.append("")

    lines.append("-- patient_analyte_summary: where each series stands and which")
    lines.append("-- way it moves. See direction_of() — the rule lives there.")
    for s in stories:
        # Sorted by date, then by the order the analyte was printed, so the file
        # is stable regardless of dict iteration.
        points: dict[str, list[dict]] = {}
        for r in sorted(by_patient[s.pid], key=lambda r: r["reportDate"]):
            for m in r["measurements"]:
                if m["value"] is None or not m["canonicalId"]:
                    continue
                points.setdefault(m["canonicalId"], []).append(
                    {"value": m["value"], "date": r["reportDate"], "flag": m["flag"],
                     "unit": m["unit"] or ""})
        for cid in sorted(points):
            hist = points[cid]
            last = hist[-1]
            previous = hist[-2]["value"] if len(hist) > 1 else None
            delta, direction = direction_of(last["value"], previous)
            lines.append(
                "INSERT INTO patient_analyte_summary (patient_id, canonical_id, "
                "display_name, unit, last_value, last_date, last_flag, delta, direction) VALUES ("
                f"{sql_str(s.pid)}, {sql_str(cid)}, {sql_str(registry.display_name(cid))}, "
                f"{sql_str(last['unit'])}, {sql_num(last['value'])}, "
                f"{sql_str(last['date'])}, {sql_str(last['flag'])}, {sql_num(delta)}, "
                f"{sql_str(direction)});"
            )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    registry = Registry([AnalyteDef.from_dict(d) for d in
                         json.loads((ROOT / "data" / "registry.json").read_text("utf-8"))])
    SQL_OUT.mkdir(parents=True, exist_ok=True)

    for tenant, stories in PRACTICES.items():
        reports = build_practice(tenant, stories, registry)
        sql = build_sql(tenant, stories, reports, registry)
        (SQL_OUT / f"seed_{tenant}.sql").write_text(sql, encoding="utf-8")
        rows = sum(len(r["measurements"]) for r in reports)
        print(f"{tenant}: {len(stories)} patients, {len(reports)} draws, "
              f"{rows} measurements → {OUT / tenant}")
        print(f"{tenant}: seed → {SQL_OUT / f'seed_{tenant}.sql'}")


if __name__ == "__main__":
    main()
