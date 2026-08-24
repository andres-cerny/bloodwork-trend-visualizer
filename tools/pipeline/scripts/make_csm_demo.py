"""Generate the CSM tenant's synthetic corpus — three fictional XC skiers.

The ghost half of docs/plans/csm-demo.md Phase 2. Everything here obeys the
same discipline as ``make_chat_demo.py`` / ``make_chat_docs.py`` — and where
possible it *is* those scripts, imported: the lab PDFs are rendered by
``make_chat_demo.build_practice`` (fonts from ``scripts/_fonts.py``, 220 DPI,
``search_for`` bboxes, ``src/normalize.py`` parsing, registry synonyms), and
the prose documents render through ``make_chat_docs.Sheet``. Nothing is drawn
at random without a fixed seed, so two runs are byte-identical.

Document shapes follow the closed inventory in ``docs/csm-protocol.md`` and
nothing else — the app only knows what the record says. The CSM letterhead
(name and address) is the inventory's deliberate demo branding; every patient,
physician and value is fictional, and the ordering labs are the chat demo's
fictional ones. The surnames of real CSM staff appear nowhere.

The three ghosts:

* ``p-dvorakova-2000`` — the ferritin arc. Five seasons, 3–4 visits a year,
  ferritin declining across two seasons into a flagged winter (iron and
  transferrin saturation coherent), recovery after supplementation. The
  notes track it visit by visit. Female reference intervals throughout.
* ``p-svoboda-2002`` — the worsening trend. An out-of-range panel *now*
  (low ferritin + elevated CK), a VO₂max plateau then decline over the last
  three tests; the notes grow concerned and the last one asks for follow-up.
* ``p-benes-1974`` — the sparse masters athlete. Six years with gaps, one
  blood-only year, borderline glucose and cholesterol, fewer tests.

Decisions the inventory left open, made here and flagged for review:

* ``documents.kind`` is CHECK-constrained to the four chat-demo kinds, so
  every CSM document (zpráva, spirometrie, tHb log, visit note) is stored as
  ``perf_eval``. If the card wants to badge them apart, the schema needs new
  kinds first.
* A tHb visit's ``note_document_id`` points at its Measurement Log — the
  visit's only document. Blood visits get a short Czech note; annuals get
  the zpráva.
* ``power_vt1`` / ``power_vt2`` are used for the one bike year (the charted
  metrics table names them for bike years); no other metric_id leaves the
  inventory's list.
* ``perf_metrics.ref_low/ref_high`` are always NULL — no CSM protocol prints
  numeric bounds for any charted metric (spiro norms are % náležité, which
  is itself the ``*_pct_norm`` metric).
* One seed file, ``seed_csm.sql``, carries everything (patients … documents,
  visits, perf_metrics) — unlike sport/orto's two-file split, because the
  visits table references documents and one file keeps the order right.

Run it from ``tools/pipeline`` (it regenerates only the ``csm`` tenant; the
sport/orto outputs are never touched):

    cd tools/pipeline && python3 -m scripts.make_csm_demo

Outputs:
    apps/chat/public/demo/csm/pages/*.png       committed page images
    apps/chat/public/demo/csm/reports.json      committed lab corpus
    apps/chat/public/demo/csm/documents.json    committed document corpus
    tools/pipeline/out/seed_csm.sql             committed seed SQL
"""
from __future__ import annotations

import json
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from scripts._fonts import czech_fonts  # noqa: E402

FONT, FONT_BOLD = czech_fonts()

import scripts.make_chat_demo as mcd  # noqa: E402
import scripts.make_chat_docs as mdocs  # noqa: E402
from scripts.make_chat_demo import Analyte, Story, cz_date, cz_number, sql_num, sql_str  # noqa: E402
from scripts.make_chat_docs import (  # noqa: E402
    BREAK, DISCLAIMER, GAP, H, KV, P, PANEL, TBL,
    Document, Sheet, age_at, body_norm, nearest_report, panel_units,
)
from src.matching import Registry  # noqa: E402
from src.models import AnalyteDef  # noqa: E402

OUT = ROOT / "apps" / "chat" / "public" / "demo"
SQL_OUT = ROOT / "tools" / "pipeline" / "out"
RENDER_DPI = 220
SEED = mcd.SEED  # one seed family for the whole chat demo

TENANT = "csm"

# The clinic. Deliberate demo branding per docs/csm-protocol.md — the pitch is
# to CSM about their own product. Physicians are fictional.
CLINIC = "Centrum sportovní medicíny z.s."
CLINIC_LINE = ("Pod altánem 67/352, 100 00 Praha 10 · tel +420 722 050 450 · "
               "info@centrumsportmed.cz")

DR_PROCHAZKOVA = "MUDr. Jana Procházková"
DR_KOLAR = "MUDr. Martin Kolář"

HEIGHT_CM = {"p-dvorakova-2000": 168, "p-svoboda-2002": 184, "p-benes-1974": 179}


# --- the closed metric list (docs/csm-protocol.md, charted metrics) ----------
METRICS: dict[str, tuple[str, str]] = {
    "vo2max_rel":    ("VO₂max", "ml/kg/min"),
    "vo2max_abs":    ("VO₂max absolutní", "l/min"),
    "hr_max":        ("TF max", "/min"),
    "hr_vt1":        ("TF na VT1", "/min"),
    "hr_vt2":        ("TF na VT2", "/min"),
    "speed_vt1":     ("Rychlost na VT1", "km/h"),
    "speed_vt2":     ("Rychlost na VT2", "km/h"),
    "power_vt1":     ("Výkon na VT1", "W"),
    "power_vt2":     ("Výkon na VT2", "W"),
    "fvc":           ("FVC", "l"),
    "fvc_pct_norm":  ("FVC % náležité", "%"),
    "fev1":          ("FEV1", "l"),
    "fev1_pct_norm": ("FEV1 % náležité", "%"),
    "body_mass":     ("Hmotnost", "kg"),
    "thb_mass":      ("Hb mass", "g"),
    "thb_mass_rel":  ("Hb mass rel.", "g/kg"),
    "blood_volume":  ("Objem krve", "ml"),
    "spo2_max":      ("SpO2 v maximu", "%"),
}


def register_csm() -> None:
    """Teach the imported lab generator the CSM practice.

    Additions only — the sport/orto tables are untouched, so re-running
    ``make_chat_demo`` on its own still produces the committed bytes.
    """
    # The inventory's blood roster includes lipids; the chat demo's analyte
    # table does not. Same fictional-lab reference-interval style.
    for a in (
        Analyte("S_Cholesterol",     "mmol/l", "(2,90-5,00)", "(2,90-5,00)", 2, 4.60, 4.50, 0.25, 1.0),
        Analyte("S_Triacylglyceroly", "mmol/l", "(0,45-1,70)", "(0,45-1,70)", 2, 1.15, 1.05, 0.20, 0.30),
    ):
        mcd.ANALYTES[a.raw] = a
    # Fictional laboratories, reused from the sport tenant by design — no
    # real Czech lab name anywhere near this corpus.
    mcd.LABS[TENANT] = mcd.LABS["sport"]
    mcd.PANELS["csm_full"] = [
        "B_Hemoglobin", "B_Hematokrit", "B_Erytrocyty", "B_Leukocyty",
        "B_Trombocyty", "S_Ferritin", "S_Železo", "S_Saturace Trf",
        "S_Kreatinin", "S_Urea", "S_Kreatinkináza", "S_ALT", "S_AST",
        "S_CRP", "S_Glukóza",
    ]
    mcd.PANELS["csm_masters"] = [
        "B_Hemoglobin", "B_Hematokrit", "B_Erytrocyty", "B_Leukocyty",
        "S_Glukóza", "S_Cholesterol", "S_Triacylglyceroly", "S_Kreatinin",
        "S_Urea", "S_ALT", "S_AST", "S_CRP", "S_Ferritin",
    ]


# --- the patients ------------------------------------------------------------
SKIERS: list[Story] = [
    # The ferritin arc: two seasons of decline into a flagged winter, then
    # recovery under supplementation. Haemoglobin bends but never leaves its
    # interval — sideropenia without anaemia; the flags story belongs to the
    # ferritin line and its iron/saturation companions.
    Story(
        pid="p-dvorakova-2000", name="Lucie Dvořáková", birth="2000-02-17", sex="f",
        note="Běžkyně na lyžích, reprezentační družstvo. Dlouhodobé sledování zásob železa.",
        physician=DR_PROCHAZKOVA, panel="csm_full",
        draws=("2022-05-10", "2022-11-08", "2023-05-16", "2023-11-14",
               "2024-05-14", "2024-11-05", "2025-01-21", "2025-04-15",
               "2025-05-20", "2025-12-09", "2026-05-12"),
        arcs={
            "S_Ferritin":      (78, 71, 65, 52, 44, 26, 11, 19, 27, 45, 58),
            "S_Železo":        (14.8, 13.9, 13.1, 12.0, 10.9, 8.4, 5.9, 7.4, 8.8, 11.6, 13.2),
            "S_Saturace Trf":  (27.4, 25.8, 24.0, 22.1, 20.6, 20.2, 9.8, 16.8, 21.5, 24.0, 25.6),
            "B_Hemoglobin":    (138, 137, 136, 135, 133, 128, 121, 124, 127, 131, 134),
            "B_Hematokrit":    (0.412, 0.409, 0.406, 0.403, 0.398, 0.385, 0.366, 0.373, 0.381, 0.392, 0.401),
            "B_Erytrocyty":    (4.42, 4.39, 4.36, 4.33, 4.28, 4.15, 3.96, 4.03, 4.11, 4.22, 4.31),
        },
    ),
    # The worsening trend: the last panel is the out-of-range one — low
    # ferritin with low iron and saturation, CK elevated — and VO₂max has
    # plateaued and then dropped over the last three tests.
    Story(
        pid="p-svoboda-2002", name="Jakub Svoboda", birth="2002-03-14", sex="m",
        note="Běžec na lyžích, družstvo do 23 let. Sledování výkonnosti a krevního obrazu.",
        physician=DR_PROCHAZKOVA, panel="csm_full",
        draws=("2023-06-13", "2023-11-21", "2024-06-11", "2024-11-19",
               "2025-06-10", "2026-06-09", "2026-08-11"),
        arcs={
            "S_Ferritin":      (94, 88, 82, 70, 55, 32, 18),
            "S_Železo":        (18.2, 17.0, 16.1, 14.4, 12.6, 11.3, 9.4),
            "S_Saturace Trf":  (30.5, 28.8, 27.2, 24.6, 22.0, 20.3, 14.8),
            "S_Kreatinkináza": (2.35, 2.80, 2.55, 2.95, 3.05, 3.10, 6.80),
            "B_Hemoglobin":    (152, 151, 153, 150, 149, 147, 144),
            "B_Hematokrit":    (0.448, 0.446, 0.451, 0.444, 0.441, 0.436, 0.428),
        },
    ),
    # The sparse masters athlete: six years with gaps, one blood-only year,
    # borderline glucose and mildly elevated cholesterol — the age-typical,
    # real-world-data record.
    Story(
        pid="p-benes-1974", name="Petr Beneš", birth="1974-01-28", sex="m",
        note="Běžec na lyžích, kategorie masters. Nepravidelné prohlídky, sledování metabolických parametrů.",
        physician=DR_KOLAR, panel="csm_masters",
        draws=("2020-09-15", "2022-04-26", "2023-10-03", "2025-05-06", "2026-03-10"),
        arcs={
            "S_Glukóza":          (5.12, 5.28, 5.44, 5.66, 5.74),
            "S_Cholesterol":      (4.82, 4.96, 5.12, 5.28, 5.41),
            "S_Triacylglyceroly": (1.28, 1.36, 1.48, 1.62, 1.68),
        },
    ),
]


# --- annual examinations -----------------------------------------------------
@dataclass(frozen=True)
class Annual:
    """One „Zpráva z vyšetření" and the metrics its visit carries.

    ``m`` holds every charted metric measured that day — the zpráva's tables
    and the ``perf_metrics`` rows are both printed from it, so the document
    and the database cannot disagree.
    """
    did: str
    pid: str
    date: str
    physician: str
    dg: str
    dg2: str                     # vedlejší dg., "" for none
    bp: str
    rest_hr: str
    ra: str
    oa: str
    sa: str
    na: str
    subjective: str
    objective: str
    ekg_rest: str
    ekg_load: str
    protocol: str
    mode: str                    # 'run' | 'bike'
    m: dict[str, float]
    vt1_vo2: float
    vt2_vo2: float
    max_load: float              # km/h (run) or W (bike) at Max
    rer: tuple[str, str, str]
    vent: tuple[str, str, str]
    spo2: tuple[str, str]        # VT1, VT2 (Max comes from m["spo2_max"])
    tiff_nal: int                # náležitá hodnota of the Tiffeneau index
    pef: float
    pef_pct: int
    conclusion: tuple[str, ...]
    recommendation: tuple[str, ...]
    thb_note: str = ""           # printed instead of the tHb table, if set
    spiro_doc: bool = True       # the battery's standalone spirometry export


@dataclass(frozen=True)
class Note:
    """A blood visit's short clinical note."""
    did: str
    pid: str
    date: str
    physician: str
    assessment: tuple[str, ...]
    plan: tuple[str, ...]


@dataclass(frozen=True)
class ThbLog:
    """One CO-rebreathing „Measurement Log" (English device export)."""
    did: str
    pid: str
    date: str
    leader: str
    export_no: int
    body: float
    hb: float                    # [Hb] capillary, g/dl
    hct: float                   # [Hct] capillary, %
    cohb_before: float
    cohb_after: float
    co_ml: int
    bag_l: int
    mass: int                    # haemoglobin mass, g
    blood: int                   # blood volume, ml

    def metric_values(self) -> dict[str, float]:
        return {
            "thb_mass": float(self.mass),
            "thb_mass_rel": round(self.mass / self.body, 1),
            "blood_volume": float(self.blood),
            "body_mass": self.body,
        }


@dataclass(frozen=True)
class PerfNote:
    """A perf_test visit's summary note (threshold values, no zpráva)."""
    did: str
    pid: str
    date: str
    physician: str
    protocol: str
    m: dict[str, float]
    vt1_vo2: float
    vt2_vo2: float
    assessment: tuple[str, ...]
    plan: tuple[str, ...]


ANNUALS: tuple[Annual, ...] = (
    # ---- Lucie Dvořáková ----------------------------------------------------
    Annual(
        did="d-dvorakova-zprava-2022", pid="p-dvorakova-2000", date="2022-05-10",
        physician=DR_PROCHAZKOVA, dg="Z02.5 — posouzení způsobilosti ke sportu", dg2="",
        bp="112/70 mmHg", rest_hr="49/min",
        ra="bez kardiovaskulární zátěže, náhlé úmrtí v rodině neguje.",
        oa="běžná dětská onemocnění; operace 0; alergie 0; trvalá medikace 0; "
           "menstruační cyklus pravidelný.",
        sa="běh na lyžích od 8 let, reprezentační družstvo; roční objem "
           "650 hodin, v přípravě kolečkové lyže, běh, kolo.",
        na="vitamin D v zimním období.",
        subjective="Bez obtíží. Trénink podle plánu, regenerace dostatečná, "
                   "spánek 8 hodin. Bez dušnosti, bez palpitací.",
        objective="Eupnoe, bez cyanózy. Štítná žláza nehmatná, karotidy bez "
                  "šelestu. Dýchání sklípkové, čisté. Ozvy ohraničené, akce "
                  "pravidelná, bez šelestu. Břicho měkké, nebolestivé. Dolní "
                  "končetiny bez otoků.",
        ekg_rest="sinusová bradykardie 49/min, elektrická osa 72°, PR 152 ms, "
                 "QRS 88 ms, QTc 402 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 196/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 8 km/h, +0,5 km/h po 60 s, do vyčerpání",
        mode="run",
        m={"vo2max_rel": 61.8, "vo2max_abs": 3.61, "hr_max": 196, "hr_vt1": 161,
           "hr_vt2": 181, "speed_vt1": 12.4, "speed_vt2": 15.0, "fvc": 4.58,
           "fvc_pct_norm": 107, "fev1": 3.86, "fev1_pct_norm": 109,
           "body_mass": 58.4, "spo2_max": 96},
        vt1_vo2=44.6, vt2_vo2=53.9, max_load=17.8,
        rer=("0,88", "0,98", "1,13"), vent=("74", "99", "128"), spo2=("98", "97"),
        tiff_nal=82, pef=8.4, pef_pct=104,
        conclusion=(
            "Vstupní komplexní vyšetření v CSM. VO₂max 61,8 ml/kg/min "
            "(3,61 l/min) odpovídá reprezentační úrovni v běhu na lyžích. "
            "EKG v klidu i při zátěži bez patologie, reakce krevního tlaku "
            "fyziologická, spirometrie nadprůměrná.",
            "Laboratorně bez nálezu, S_Ferritin 78 µg/l — zásoby železa "
            "v normě, výchozí hodnota pro další sledování.",
        ),
        recommendation=(
            "Sportu schopna bez omezení.",
            "Kontrolní odběr krevního obrazu a zásob železa na podzim, "
            "vzhledem k objemu tréninku dále 2× ročně.",
        ),
    ),
    Annual(
        did="d-dvorakova-zprava-2023", pid="p-dvorakova-2000", date="2023-05-16",
        physician=DR_PROCHAZKOVA, dg="Z02.5 — posouzení způsobilosti ke sportu", dg2="",
        bp="110/68 mmHg", rest_hr="48/min",
        ra="bez kardiovaskulární zátěže.",
        oa="běžná dětská onemocnění; operace 0; alergie 0; trvalá medikace 0; "
           "menstruační cyklus pravidelný.",
        sa="běh na lyžích, reprezentační družstvo; roční objem 680 hodin; "
           "sezóna dokončena bez přerušení.",
        na="vitamin D v zimním období, hořčík.",
        subjective="Bez obtíží, sezóna subjektivně vydařená. Regenerace "
                   "dostatečná, bez dušnosti, bez palpitací.",
        objective="Eupnoe, bez cyanózy. Dýchání sklípkové, čisté. Ozvy "
                  "ohraničené, akce pravidelná, bez šelestu. Břicho měkké, "
                  "nebolestivé. Dolní končetiny bez otoků.",
        ekg_rest="sinusová bradykardie 48/min, elektrická osa 70°, PR 154 ms, "
                 "QRS 88 ms, QTc 400 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 195/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 8 km/h, +0,5 km/h po 60 s, do vyčerpání",
        mode="run",
        m={"vo2max_rel": 62.5, "vo2max_abs": 3.63, "hr_max": 195, "hr_vt1": 162,
           "hr_vt2": 181, "speed_vt1": 12.6, "speed_vt2": 15.2, "fvc": 4.61,
           "fvc_pct_norm": 108, "fev1": 3.88, "fev1_pct_norm": 110,
           "body_mass": 58.1, "spo2_max": 96},
        vt1_vo2=45.2, vt2_vo2=54.6, max_load=18.0,
        rer=("0,89", "0,99", "1,14"), vent=("75", "101", "131"), spo2=("98", "97"),
        tiff_nal=82, pef=8.5, pef_pct=105,
        conclusion=(
            "VO₂max 62,5 ml/kg/min (3,63 l/min), proti loňskému vyšetření "
            "mírný vzestup. EKG i spirometrie bez patologie.",
            "S_Ferritin 65 µg/l proti 78 µg/l při vstupním vyšetření — "
            "hodnota je v referenčním rozmezí, pokles zatím odpovídá "
            "tréninkovému zatížení. Sledovat v podzimním odběru.",
        ),
        recommendation=(
            "Sportu schopna bez omezení.",
            "Kontrolní odběr na podzim; při poklesu S_Ferritin pod 35 µg/l "
            "zahájit substituci železa.",
        ),
    ),
    Annual(
        did="d-dvorakova-zprava-2024", pid="p-dvorakova-2000", date="2024-05-14",
        physician=DR_PROCHAZKOVA, dg="Z02.5 — posouzení způsobilosti ke sportu", dg2="",
        bp="112/70 mmHg", rest_hr="50/min",
        ra="bez kardiovaskulární zátěže.",
        oa="běžná dětská onemocnění; operace 0; alergie 0; trvalá medikace 0; "
           "menstruační cyklus pravidelný, krvácení v posledním roce silnější.",
        sa="běh na lyžích, reprezentační družstvo; roční objem 700 hodin.",
        na="vitamin D, hořčík.",
        subjective="Bez výraznějších obtíží, ke konci sezóny se cítila "
                   "unavenější než v minulých letech. Bez dušnosti, bez "
                   "palpitací.",
        objective="Eupnoe, kůže a spojivky normální barvy. Dýchání sklípkové, "
                  "čisté. Ozvy ohraničené, akce pravidelná, bez šelestu. "
                  "Břicho měkké, nebolestivé. Dolní končetiny bez otoků.",
        ekg_rest="sinusová bradykardie 50/min, elektrická osa 71°, PR 152 ms, "
                 "QRS 90 ms, QTc 398 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 195/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 8 km/h, +0,5 km/h po 60 s, do vyčerpání",
        mode="run",
        m={"vo2max_rel": 61.9, "vo2max_abs": 3.58, "hr_max": 195, "hr_vt1": 161,
           "hr_vt2": 180, "speed_vt1": 12.5, "speed_vt2": 15.1, "fvc": 4.60,
           "fvc_pct_norm": 108, "fev1": 3.87, "fev1_pct_norm": 110,
           "body_mass": 57.8, "spo2_max": 95},
        vt1_vo2=44.8, vt2_vo2=54.1, max_load=17.9,
        rer=("0,89", "0,99", "1,13"), vent=("75", "100", "130"), spo2=("98", "96"),
        tiff_nal=82, pef=8.5, pef_pct=105,
        conclusion=(
            "VO₂max 61,9 ml/kg/min (3,58 l/min), funkčně beze změny. EKG, "
            "krevní tlak i spirometrie bez patologie.",
            "Zásoby železa klesají druhou sezónu v řadě: S_Ferritin "
            "65 → 52 → 44 µg/l za poslední tři odběry. Hodnota je stále "
            "v referenčním rozmezí a krevní obraz v normě, jde tedy o trend, "
            "nikoli o nález — ale trend, který je při silnějším menstruačním "
            "krvácení a vysokém objemu tréninku třeba brát vážně.",
        ),
        recommendation=(
            "Sportu schopna bez omezení.",
            "Strava s dostatkem železa, vitamin C k jídlům s jeho obsahem. "
            "Kontrolní odběr už na podzim; při dalším poklesu zahájit "
            "substituci, nečekat na anémii.",
        ),
    ),
    Annual(
        did="d-dvorakova-zprava-2025", pid="p-dvorakova-2000", date="2025-05-20",
        physician=DR_PROCHAZKOVA, dg="Z02.5 — posouzení způsobilosti ke sportu",
        dg2="E61.1 — nedostatek železa (sideropenie bez anémie, 01/2025)",
        bp="110/70 mmHg", rest_hr="52/min",
        ra="bez kardiovaskulární zátěže.",
        oa="sideropenie bez anémie 01/2025, od té doby perorální substituce "
           "železa; gynekologické vyšetření 02/2025 bez patologického nálezu; "
           "operace 0; alergie 0.",
        sa="běh na lyžích, reprezentační družstvo; zimní blok redukován o "
           "čtvrtinu podle lednového doporučení.",
        na="perorální železo denně, vitamin C, vitamin D, hořčík.",
        subjective="Od března se cítí výrazně lépe, tolerance intenzivních "
                   "jednotek se vrací. V lednu a únoru těžké nohy a horší "
                   "zotavení, nyní bez obtíží.",
        objective="Eupnoe, kůže a spojivky normální barvy. Dýchání sklípkové, "
                  "čisté. Ozvy ohraničené, akce pravidelná, bez šelestu. "
                  "Břicho měkké, nebolestivé. Dolní končetiny bez otoků.",
        ekg_rest="sinusová bradykardie 52/min, elektrická osa 70°, PR 150 ms, "
                 "QRS 88 ms, QTc 404 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 194/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 8 km/h, +0,5 km/h po 60 s, do vyčerpání",
        mode="run",
        m={"vo2max_rel": 59.6, "vo2max_abs": 3.49, "hr_max": 194, "hr_vt1": 158,
           "hr_vt2": 178, "speed_vt1": 12.0, "speed_vt2": 14.6, "fvc": 4.62,
           "fvc_pct_norm": 108, "fev1": 3.90, "fev1_pct_norm": 110,
           "body_mass": 58.6, "spo2_max": 95},
        vt1_vo2=43.1, vt2_vo2=52.0, max_load=17.2,
        rer=("0,90", "1,00", "1,12"), vent=("73", "98", "125"), spo2=("97", "96"),
        tiff_nal=82, pef=8.4, pef_pct=104,
        conclusion=(
            "VO₂max 59,6 ml/kg/min (3,49 l/min) — pokles o 2,3 ml/kg/min "
            "proti loňsku, konzistentní se zimní sideropenií (S_Ferritin "
            "11 µg/l v lednu) a redukovaným tréninkem. EKG i spirometrie "
            "bez patologie.",
            "Laboratorně probíhající úprava: S_Ferritin 27 µg/l, S_Železo "
            "8,8 µmol/l, B_Hemoglobin 127 g/l. Hodnoty rostou třetí odběr "
            "v řadě, saturace transferinu se vrátila do rozmezí.",
        ),
        recommendation=(
            "Sportu schopna bez omezení, plný tréninkový objem od června.",
            "V substituci železa pokračovat přes léto, kontrolní odběr "
            "v prosinci. Cílová hodnota S_Ferritin nad 50 µg/l před zimní "
            "sezónou.",
        ),
    ),
    Annual(
        did="d-dvorakova-zprava-2026", pid="p-dvorakova-2000", date="2026-05-12",
        physician=DR_PROCHAZKOVA, dg="Z02.5 — posouzení způsobilosti ke sportu", dg2="",
        bp="112/70 mmHg", rest_hr="49/min",
        ra="bez kardiovaskulární zátěže.",
        oa="sideropenie bez anémie 01/2025, plně upravena; operace 0; "
           "alergie 0.",
        sa="běh na lyžích, reprezentační družstvo; sezóna 2025/26 dokončena "
           "v plném objemu, bez přerušení.",
        na="vitamin D, hořčík; železo v udržovacím režimu obden.",
        subjective="Bez obtíží, subjektivně nejlepší zima za poslední tři "
                   "roky. Bez dušnosti, bez palpitací.",
        objective="Eupnoe, bez cyanózy. Dýchání sklípkové, čisté. Ozvy "
                  "ohraničené, akce pravidelná, bez šelestu. Břicho měkké, "
                  "nebolestivé. Dolní končetiny bez otoků.",
        ekg_rest="sinusová bradykardie 49/min, elektrická osa 71°, PR 152 ms, "
                 "QRS 88 ms, QTc 400 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 194/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 8 km/h, +0,5 km/h po 60 s, do vyčerpání",
        mode="run",
        m={"vo2max_rel": 62.1, "vo2max_abs": 3.61, "hr_max": 194, "hr_vt1": 161,
           "hr_vt2": 181, "speed_vt1": 12.5, "speed_vt2": 15.1, "fvc": 4.63,
           "fvc_pct_norm": 108, "fev1": 3.91, "fev1_pct_norm": 110,
           "body_mass": 58.2, "spo2_max": 96},
        vt1_vo2=45.0, vt2_vo2=54.3, max_load=17.9,
        rer=("0,88", "0,99", "1,14"), vent=("75", "101", "131"), spo2=("98", "97"),
        tiff_nal=82, pef=8.6, pef_pct=106,
        conclusion=(
            "VO₂max 62,1 ml/kg/min (3,61 l/min) — návrat na úroveň let "
            "2022–2024, loňský pokles byl plně reverzibilní. EKG i "
            "spirometrie bez patologie.",
            "S_Ferritin 58 µg/l, S_Železo 13,2 µmol/l, saturace 25,6 % — "
            "zásoby železa obnoveny a stabilní přes celou zimní sezónu. "
            "Epizoda z ledna 2025 je uzavřena.",
        ),
        recommendation=(
            "Sportu schopna bez omezení.",
            "Udržovací režim substituce ponechat, odběry nadále 2× ročně — "
            "riziková kombinace vysokého objemu a menstruačních ztrát trvá.",
        ),
    ),
    # ---- Jakub Svoboda ------------------------------------------------------
    Annual(
        did="d-svoboda-zprava-2023", pid="p-svoboda-2002", date="2023-06-13",
        physician=DR_PROCHAZKOVA, dg="Z02.5 — posouzení způsobilosti ke sportu", dg2="",
        bp="118/72 mmHg", rest_hr="43/min",
        ra="bez kardiovaskulární zátěže, náhlé úmrtí v rodině neguje.",
        oa="běžná dětská onemocnění; 2019 zlomenina levého zápěstí, zhojena; "
           "operace 0; alergie 0; trvalá medikace 0.",
        sa="běh na lyžích od 7 let, družstvo do 23 let; roční objem 780 "
           "hodin, v přípravě kolečkové lyže, běh, kolo, síla.",
        na="vitamin D v zimě.",
        subjective="Bez obtíží. Trénink podle plánu, bez dušnosti, bez "
                   "palpitací, bez synkop.",
        objective="Eupnoe, bez cyanózy. Štítná žláza nehmatná, karotidy bez "
                  "šelestu. Dýchání sklípkové, čisté. Ozvy ohraničené, akce "
                  "pravidelná, bez šelestu. Břicho měkké, nebolestivé. Dolní "
                  "končetiny bez otoků.",
        ekg_rest="sinusová bradykardie 43/min, elektrická osa 76°, PR 162 ms, "
                 "QRS 94 ms, QTc 392 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 196/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 10 km/h, +0,5 km/h po 60 s, do vyčerpání",
        mode="run",
        m={"vo2max_rel": 71.2, "vo2max_abs": 5.34, "hr_max": 196, "hr_vt1": 160,
           "hr_vt2": 182, "speed_vt1": 14.2, "speed_vt2": 17.2, "fvc": 6.24,
           "fvc_pct_norm": 112, "fev1": 5.05, "fev1_pct_norm": 113,
           "body_mass": 75.0, "spo2_max": 95,
           "thb_mass": 1040, "thb_mass_rel": 13.9, "blood_volume": 6890},
        vt1_vo2=50.2, vt2_vo2=62.6, max_load=20.4,
        rer=("0,87", "0,97", "1,14"), vent=("96", "132", "178"), spo2=("97", "96"),
        tiff_nal=80, pef=11.2, pef_pct=109,
        conclusion=(
            "VO₂max 71,2 ml/kg/min (5,34 l/min) — výborná hodnota pro "
            "kategorii do 23 let. EKG v klidu i při zátěži bez patologie, "
            "spirometrie nadprůměrná.",
            "Hbmass 1040 g (13,9 g/kg) odpovídá vytrvalostně trénovanému "
            "sportovci. Laboratorně bez nálezu, S_Ferritin 94 µg/l.",
        ),
        recommendation=(
            "Sportu schopen bez omezení.",
            "Kontrolní odběr na podzim, další komplexní vyšetření za rok.",
        ),
    ),
    Annual(
        did="d-svoboda-zprava-2024", pid="p-svoboda-2002", date="2024-06-11",
        physician=DR_PROCHAZKOVA, dg="Z02.5 — posouzení způsobilosti ke sportu", dg2="",
        bp="118/74 mmHg", rest_hr="42/min",
        ra="bez kardiovaskulární zátěže.",
        oa="2019 zlomenina levého zápěstí, zhojena; operace 0; alergie 0; "
           "trvalá medikace 0.",
        sa="běh na lyžích, družstvo do 23 let; roční objem 820 hodin; "
           "sezóna hodnocena jako průlomová.",
        na="vitamin D v zimě, hořčík.",
        subjective="Bez obtíží, formu hodnotí jako nejlepší v kariéře. Bez "
                   "dušnosti, bez palpitací.",
        objective="Eupnoe, bez cyanózy. Dýchání sklípkové, čisté. Ozvy "
                  "ohraničené, akce pravidelná, bez šelestu. Břicho měkké, "
                  "nebolestivé. Dolní končetiny bez otoků.",
        ekg_rest="sinusová bradykardie 42/min, elektrická osa 74°, PR 160 ms, "
                 "QRS 94 ms, QTc 390 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 195/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 10 km/h, +0,5 km/h po 60 s, do vyčerpání",
        mode="run",
        m={"vo2max_rel": 73.9, "vo2max_abs": 5.59, "hr_max": 195, "hr_vt1": 161,
           "hr_vt2": 183, "speed_vt1": 14.6, "speed_vt2": 17.8, "fvc": 6.28,
           "fvc_pct_norm": 113, "fev1": 5.10, "fev1_pct_norm": 114,
           "body_mass": 75.6, "spo2_max": 95,
           "thb_mass": 1072, "thb_mass_rel": 14.2, "blood_volume": 7050},
        vt1_vo2=52.0, vt2_vo2=64.9, max_load=20.9,
        rer=("0,88", "0,98", "1,15"), vent=("98", "136", "184"), spo2=("97", "96"),
        tiff_nal=80, pef=11.4, pef_pct=110,
        conclusion=(
            "VO₂max 73,9 ml/kg/min (5,59 l/min) — vzestup o 2,7 ml/kg/min "
            "proti loňsku, prahové rychlosti posunuty výše. EKG i "
            "spirometrie bez patologie.",
            "Hbmass 1072 g (14,2 g/kg), vzestup odpovídá tréninkové adaptaci. "
            "S_Ferritin 82 µg/l, zásoby železa v normě.",
        ),
        recommendation=(
            "Sportu schopen bez omezení.",
            "Pokračovat v nastaveném plánu, kontrolní odběr na podzim.",
        ),
    ),
    Annual(
        did="d-svoboda-zprava-2025", pid="p-svoboda-2002", date="2025-06-10",
        physician=DR_PROCHAZKOVA, dg="Z02.5 — posouzení způsobilosti ke sportu", dg2="",
        bp="120/74 mmHg", rest_hr="44/min",
        ra="bez kardiovaskulární zátěže.",
        oa="2019 zlomenina levého zápěstí, zhojena; operace 0; alergie 0; "
           "trvalá medikace 0.",
        sa="běh na lyžích, družstvo do 23 let; roční objem 860 hodin — další "
           "navýšení, k tomu nově vysokoškolské studium.",
        na="vitamin D v zimě, hořčík.",
        subjective="Bez zdravotních obtíží, připouští horší spánek v "
                   "zkouškovém období a menší chuť do nejtvrdších jednotek "
                   "ke konci sezóny.",
        objective="Eupnoe, bez cyanózy. Dýchání sklípkové, čisté. Ozvy "
                  "ohraničené, akce pravidelná, bez šelestu. Břicho měkké, "
                  "nebolestivé. Dolní končetiny bez otoků.",
        ekg_rest="sinusová bradykardie 44/min, elektrická osa 75°, PR 160 ms, "
                 "QRS 94 ms, QTc 394 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 194/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 10 km/h, +0,5 km/h po 60 s, do vyčerpání",
        mode="run",
        m={"vo2max_rel": 74.1, "vo2max_abs": 5.62, "hr_max": 194, "hr_vt1": 161,
           "hr_vt2": 183, "speed_vt1": 14.7, "speed_vt2": 17.9, "fvc": 6.30,
           "fvc_pct_norm": 113, "fev1": 5.12, "fev1_pct_norm": 114,
           "body_mass": 75.8, "spo2_max": 94,
           "thb_mass": 1080, "thb_mass_rel": 14.2, "blood_volume": 7100},
        vt1_vo2=52.3, vt2_vo2=65.2, max_load=21.0,
        rer=("0,88", "0,98", "1,15"), vent=("98", "137", "185"), spo2=("97", "95"),
        tiff_nal=80, pef=11.4, pef_pct=110,
        conclusion=(
            "VO₂max 74,1 ml/kg/min (5,62 l/min) — proti loňsku beze změny; "
            "po dvou letech růstu jde o stagnaci na vysoké úrovni. EKG i "
            "spirometrie bez patologie.",
            "S_Ferritin 55 µg/l, tedy třetí pokles v řadě (94 → 82 → 55). "
            "Hodnota je v rozmezí, ale trend spolu se stagnací výkonnosti a "
            "navyšovaným objemem stojí za pozornost.",
        ),
        recommendation=(
            "Sportu schopen bez omezení.",
            "Kontrolní odběr zásob železa na podzim spolu s kontrolním "
            "funkčním vyšetřením; zvážit, zda objem dál nenavyšovat.",
        ),
    ),
    Annual(
        did="d-svoboda-zprava-2026", pid="p-svoboda-2002", date="2026-06-09",
        physician=DR_PROCHAZKOVA, dg="Z02.5 — posouzení způsobilosti ke sportu",
        dg2="Z72.3 — riziko přetížení při vysokém tréninkovém objemu",
        bp="118/74 mmHg", rest_hr="47/min",
        ra="bez kardiovaskulární zátěže.",
        oa="2019 zlomenina levého zápěstí, zhojena; operace 0; alergie 0; "
           "trvalá medikace 0; 02/2026 dvoutýdenní respirační infekt.",
        sa="běh na lyžích, družstvo do 23 let; roční objem 880 hodin; "
           "závěr sezóny hodnotí jako nevydařený.",
        na="vitamin D, hořčík.",
        subjective="Od zimy horší tolerance intenzivních jednotek, na "
                   "prahových úsecích subjektivně těžší nohy při stejné "
                   "tepové frekvenci. Ranní tepová frekvence o 4–5 úderů "
                   "vyšší. Spánek nekvalitní. Bez dušnosti, bez palpitací.",
        objective="Eupnoe, mírně bledší spojivky. Dýchání sklípkové, čisté. "
                  "Ozvy ohraničené, akce pravidelná, bez šelestu. Břicho "
                  "měkké, nebolestivé. Dolní končetiny bez otoků.",
        ekg_rest="sinusová bradykardie 47/min, elektrická osa 75°, PR 162 ms, "
                 "QRS 96 ms, QTc 398 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 192/min, ojedinělé supraventrikulární "
                 "extrasystoly, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 10 km/h, +0,5 km/h po 60 s, do vyčerpání",
        mode="run",
        m={"vo2max_rel": 70.4, "vo2max_abs": 5.39, "hr_max": 192, "hr_vt1": 156,
           "hr_vt2": 178, "speed_vt1": 14.0, "speed_vt2": 17.0, "fvc": 6.29,
           "fvc_pct_norm": 113, "fev1": 5.11, "fev1_pct_norm": 114,
           "body_mass": 76.5, "spo2_max": 94},
        vt1_vo2=49.5, vt2_vo2=61.4, max_load=20.1,
        rer=("0,90", "0,99", "1,12"), vent=("96", "133", "176"), spo2=("97", "95"),
        tiff_nal=80, pef=11.3, pef_pct=109,
        thb_note="Měření celkové hemoglobinové masy provedeno samostatně "
                 "10. 6. 2026, viz Measurement Log.",
        conclusion=(
            "VO₂max 70,4 ml/kg/min (5,39 l/min) — pokles o 3,7 ml/kg/min "
            "proti loňsku. Poslední tři testy tvoří sekvenci 74,1 → 73,6 → "
            "70,4: po stagnaci nyní zřetelný pokles, s nižšími prahovými "
            "rychlostmi i nižší maximální tepovou frekvencí.",
            "S_Ferritin 32 µg/l těsně nad dolní mezí, čtvrtý pokles v řadě. "
            "Spirometrie i EKG bez strukturální patologie — pokles výkonnosti "
            "nemá ventilační ani kardiální vysvětlení a spolu se subjektivními "
            "obtížemi budí podezření na přetížení s vyčerpáváním zásob železa.",
        ),
        recommendation=(
            "Sportu schopen, ale doporučena redukce objemu o 20 % na "
            "6 týdnů a vypuštění jednotek nad druhým ventilačním prahem.",
            "Kontrolní odběr krevního obrazu, zásob železa a CK v srpnu — "
            "podle výsledku rozhodnout o substituci a dalším postupu.",
        ),
    ),
    # ---- Petr Beneš ---------------------------------------------------------
    Annual(
        did="d-benes-zprava-2020", pid="p-benes-1974", date="2020-09-15",
        physician=DR_KOLAR, dg="Z02.5 — posouzení způsobilosti ke sportu", dg2="",
        bp="128/82 mmHg", rest_hr="56/min",
        ra="otec ICHS od 62 let, matka diabetes mellitus 2. typu od 68 let.",
        oa="běžná dětská onemocnění; 2011 artroskopie levého kolena; "
           "operace jiné 0; alergie 0; trvalá medikace 0; nekuřák.",
        sa="běh na lyžích rekreačně-závodně (kategorie masters), dálkové "
           "běhy; 6–8 hodin tréninku týdně, kancelářské zaměstnání.",
        na="bez doplňků.",
        subjective="Bez obtíží. Přichází po delší pauze v lékařském "
                   "sledování, chce posouzení před sezónou dálkových běhů.",
        objective="Eupnoe, bez cyanózy. Habitus atletický. Dýchání sklípkové, "
                  "čisté. Ozvy ohraničené, akce pravidelná, bez šelestu. "
                  "Břicho měkké, nebolestivé. Dolní končetiny bez otoků.",
        ekg_rest="sinusový rytmus 56/min, elektrická osa 58°, PR 168 ms, "
                 "QRS 96 ms, QTc 408 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 172/min, bez arytmií, bez ischemických "
                 "změn, přiměřená reakce TK.",
        protocol="běh na pásu, sklon 1 %, start 8 km/h, +0,5 km/h po 60 s, do vyčerpání",
        mode="run",
        m={"vo2max_rel": 49.8, "vo2max_abs": 4.06, "hr_max": 172, "hr_vt1": 138,
           "hr_vt2": 158, "speed_vt1": 10.6, "speed_vt2": 12.8, "fvc": 5.58,
           "fvc_pct_norm": 104, "fev1": 4.42, "fev1_pct_norm": 99,
           "body_mass": 81.6, "spo2_max": 96},
        vt1_vo2=33.9, vt2_vo2=42.4, max_load=14.2,
        rer=("0,89", "0,99", "1,10"), vent=("64", "88", "118"), spo2=("98", "97"),
        tiff_nal=80, pef=9.6, pef_pct=101, spiro_doc=False,
        conclusion=(
            "VO₂max 49,8 ml/kg/min (4,06 l/min) — výborná hodnota pro věk "
            "46 let. EKG v klidu i při zátěži bez patologie, krevní tlak "
            "v klidu na horní hranici normy.",
            "Laboratorně bez nálezu; S_Glukóza 5,12 mmol/l a S_Cholesterol "
            "4,82 mmol/l v normě, při rodinné anamnéze vhodné sledovat.",
        ),
        recommendation=(
            "Sportu schopen bez omezení.",
            "Kontrola za 1–2 roky včetně odběru; domácí měření krevního "
            "tlaku občasně.",
        ),
    ),
    Annual(
        did="d-benes-zprava-2022", pid="p-benes-1974", date="2022-04-26",
        physician=DR_KOLAR, dg="Z02.5 — posouzení způsobilosti ke sportu", dg2="",
        bp="130/84 mmHg", rest_hr="58/min",
        ra="otec ICHS od 62 let, matka diabetes mellitus 2. typu od 68 let.",
        oa="2011 artroskopie levého kolena; operace jiné 0; alergie 0; "
           "trvalá medikace 0; nekuřák.",
        sa="běh na lyžích masters, dálkové běhy; 5–7 hodin týdně, přes zimu "
           "více, v létě méně.",
        na="vitamin D v zimě.",
        subjective="Bez obtíží, sezóna dálkových běhů dokončena. Váhový "
                   "přírůstek necelý kilogram za dva roky.",
        objective="Eupnoe, bez cyanózy. Dýchání sklípkové, čisté. Ozvy "
                  "ohraničené, akce pravidelná, bez šelestu. Břicho měkké, "
                  "nebolestivé. Dolní končetiny bez otoků.",
        ekg_rest="sinusový rytmus 58/min, elektrická osa 56°, PR 170 ms, "
                 "QRS 96 ms, QTc 410 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 170/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 8 km/h, +0,5 km/h po 60 s, do vyčerpání",
        mode="run",
        m={"vo2max_rel": 48.1, "vo2max_abs": 3.96, "hr_max": 170, "hr_vt1": 136,
           "hr_vt2": 156, "speed_vt1": 10.3, "speed_vt2": 12.4, "fvc": 5.52,
           "fvc_pct_norm": 103, "fev1": 4.35, "fev1_pct_norm": 98,
           "body_mass": 82.4, "spo2_max": 96},
        vt1_vo2=32.8, vt2_vo2=41.0, max_load=13.8,
        rer=("0,90", "0,99", "1,09"), vent=("63", "86", "115"), spo2=("98", "97"),
        tiff_nal=80, pef=9.5, pef_pct=100, spiro_doc=False,
        conclusion=(
            "VO₂max 48,1 ml/kg/min (3,96 l/min), mírný pokles proti roku "
            "2020 odpovídající věku. EKG bez patologie, TK v klidu na horní "
            "hranici.",
            "S_Glukóza 5,28 mmol/l a S_Cholesterol 4,96 mmol/l — obě hodnoty "
            "v horním pásmu normy a proti minulému odběru vyšší. Vzhledem "
            "k rodinné anamnéze doporučena úprava stravy.",
        ),
        recommendation=(
            "Sportu schopen bez omezení.",
            "Redukce jednoduchých cukrů a nasycených tuků, kontrolní odběr "
            "do 18 měsíců.",
        ),
    ),
    Annual(
        did="d-benes-zprava-2025", pid="p-benes-1974", date="2025-05-06",
        physician=DR_KOLAR, dg="Z02.5 — posouzení způsobilosti ke sportu",
        dg2="R73.0 — hraniční glykémie nalačno",
        bp="134/86 mmHg", rest_hr="60/min",
        ra="otec ICHS od 62 let, matka diabetes mellitus 2. typu od 68 let.",
        oa="2011 artroskopie levého kolena; 2024 opakované obtíže s pravou "
           "Achillovou šlachou, konzervativně; alergie 0; trvalá medikace 0; "
           "nekuřák.",
        sa="běh na lyžích masters; kvůli Achillově šlaše v posledním roce "
           "méně běhu, více kola; 4–6 hodin týdně.",
        na="vitamin D v zimě.",
        subjective="Bez kardiálních obtíží. Achillova šlacha při běhu do "
                   "20 minut bez bolesti, delší běh zatím nezkouší. Test "
                   "proveden na bicyklovém ergometru.",
        objective="Eupnoe, bez cyanózy. Dýchání sklípkové, čisté. Ozvy "
                  "ohraničené, akce pravidelná, bez šelestu. Břicho měkké, "
                  "nebolestivé. Pravá Achillova šlacha palpačně mírně "
                  "zesílená, nebolestivá. Dolní končetiny bez otoků.",
        ekg_rest="sinusový rytmus 60/min, elektrická osa 54°, PR 172 ms, "
                 "QRS 98 ms, QTc 412 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 166/min, bez arytmií, bez ischemických změn.",
        protocol="bicyklová ergometrie, start 60 W, +20 W po 60 s, do vyčerpání",
        mode="bike",
        m={"vo2max_rel": 45.6, "vo2max_abs": 3.78, "hr_max": 166, "hr_vt1": 132,
           "hr_vt2": 152, "power_vt1": 185, "power_vt2": 248, "fvc": 5.44,
           "fvc_pct_norm": 102, "fev1": 4.24, "fev1_pct_norm": 96,
           "body_mass": 83.0, "spo2_max": 95},
        vt1_vo2=31.2, vt2_vo2=38.9, max_load=305,
        rer=("0,91", "1,00", "1,08"), vent=("60", "82", "108"), spo2=("97", "96"),
        tiff_nal=80, pef=9.3, pef_pct=99, spiro_doc=False,
        conclusion=(
            "VO₂max 45,6 ml/kg/min (3,78 l/min) na bicyklovém ergometru, "
            "maximální výkon 305 W — nadprůměr pro věk 51 let, pokles proti "
            "předchozím testům odpovídá věku a nižšímu objemu běhu. EKG bez "
            "patologie, TK v klidu 134/86 na horní hranici.",
            "Laboratorně S_Glukóza 5,66 mmol/l nad horní mezí a "
            "S_Cholesterol 5,28 mmol/l mírně zvýšený — trend obou hodnot je "
            "za pět let setrvale vzestupný a při rodinné anamnéze diabetu "
            "vyžaduje řešení mimo sportovní ambulanci.",
        ),
        recommendation=(
            "Sportu schopen bez omezení, vytrvalostní zatížení je v jeho "
            "situaci naopak žádoucí.",
            "Předání nálezu praktickému lékaři: kontrolní glykémie nalačno, "
            "zvážit oGTT a lipidogram. Úprava stravy, kontrolní odběr u nás "
            "do roka.",
        ),
    ),
)

NOTES: tuple[Note, ...] = (
    # ---- Lucie Dvořáková: the arc, note by note -----------------------------
    Note(
        did="d-dvorakova-odber-2022-11-08", pid="p-dvorakova-2000",
        date="2022-11-08", physician=DR_PROCHAZKOVA,
        assessment=(
            "Podzimní kontrolní odběr před zimní sezónou. Krevní obraz v "
            "normě, B_Hemoglobin 137 g/l. S_Ferritin 71 µg/l, S_Železo "
            "13,9 µmol/l, saturace transferinu 25,8 % — zásoby železa "
            "dostatečné, proti květnu prakticky beze změny.",
        ),
        plan=(
            "Bez opatření. Další odběr při jarní prohlídce.",
        ),
    ),
    Note(
        did="d-dvorakova-odber-2023-11-14", pid="p-dvorakova-2000",
        date="2023-11-14", physician=DR_PROCHAZKOVA,
        assessment=(
            "Podzimní kontrolní odběr. Krevní obraz v normě, B_Hemoglobin "
            "135 g/l. S_Ferritin 52 µg/l — proti květnovým 65 µg/l další "
            "pokles, hodnota je ale v referenčním rozmezí a saturace "
            "transferinu 22,1 % rovněž.",
        ),
        plan=(
            "Zatím bez substituce. Doporučena strava bohatší na železo; "
            "kontrola při jarní prohlídce, při obtížích dříve.",
        ),
    ),
    Note(
        did="d-dvorakova-odber-2024-11-05", pid="p-dvorakova-2000",
        date="2024-11-05", physician=DR_PROCHAZKOVA,
        assessment=(
            "Podzimní kontrolní odběr. S_Ferritin 26 µg/l — pokles pokračuje "
            "druhou sezónu (65 → 52 → 44 → 26 µg/l), S_Železo 8,4 µmol/l a "
            "saturace 20,2 % při dolní hranici. B_Hemoglobin 128 g/l je "
            "v rozmezí, ale nejníže za dobu sledování.",
            "Jde o vyčerpávání zásob železa při vysokém objemu tréninku a "
            "silnějším menstruačním krvácení; anémie zatím nevznikla.",
        ),
        plan=(
            "Zahájena perorální substituce železa obden, vitamin C k dávce. "
            "Kontrolní odběr v lednu; při poklesu tolerance zátěže hlásit "
            "ihned.",
        ),
    ),
    Note(
        did="d-dvorakova-odber-2025-01-21", pid="p-dvorakova-2000",
        date="2025-01-21", physician=DR_PROCHAZKOVA,
        assessment=(
            "Kontrolní odběr uprostřed závodního bloku. S_Ferritin 11 µg/l "
            "pod dolní mezí, S_Železo 5,9 µmol/l pod dolní mezí, saturace "
            "transferinu 9,8 % výrazně snížená. B_Hemoglobin 121 g/l těsně "
            "v rozmezí — sideropenie bez anémie.",
            "Subjektivně těžké nohy a horší zotavení od prosince; nález "
            "obtíže vysvětluje. Substituce obden z listopadu nebyla "
            "dostatečná.",
        ),
        plan=(
            "Substituce železa denně, kontrola za 10–12 týdnů. Redukce "
            "tréninkového objemu o čtvrtinu a vypuštění jednotek nad druhým "
            "ventilačním prahem do kontroly. Doplněno gynekologické "
            "vyšetření k posouzení menstruačních ztrát.",
        ),
    ),
    Note(
        did="d-dvorakova-odber-2025-04-15", pid="p-dvorakova-2000",
        date="2025-04-15", physician=DR_PROCHAZKOVA,
        assessment=(
            "Kontrola po 12 týdnech denní substituce. S_Ferritin 19 µg/l — "
            "stále pod dolní mezí, ale vzestup z lednových 11 µg/l. "
            "S_Železo 7,4 µmol/l se vrátilo do rozmezí, saturace 16,8 % "
            "ještě snížená. B_Hemoglobin 124 g/l, mírný vzestup.",
            "Odpověď na substituci je zřetelná, úprava ale není dokončena. "
            "Gynekologické vyšetření z února bez patologického nálezu.",
        ),
        plan=(
            "Pokračovat v denní substituci, plný trénink zatím neuvolňovat — "
            "rozhodnutí při květnové prohlídce.",
        ),
    ),
    Note(
        did="d-dvorakova-odber-2025-12-09", pid="p-dvorakova-2000",
        date="2025-12-09", physician=DR_PROCHAZKOVA,
        assessment=(
            "Kontrolní odběr před vrcholem zimní sezóny. S_Ferritin 45 µg/l, "
            "S_Železo 11,6 µmol/l, saturace 24,0 % — vše v rozmezí, vzestup "
            "pokračuje pátý odběr v řadě. B_Hemoglobin 131 g/l.",
            "Cílová hodnota ferritinu nad 50 µg/l z květnového doporučení "
            "zatím těsně nedosažena, trend je ale správným směrem.",
        ),
        plan=(
            "Pokračovat v substituci v plné dávce přes závodní období, "
            "kontrola při jarní prohlídce.",
        ),
    ),
    # ---- Jakub Svoboda ------------------------------------------------------
    Note(
        did="d-svoboda-odber-2023-11-21", pid="p-svoboda-2002",
        date="2023-11-21", physician=DR_PROCHAZKOVA,
        assessment=(
            "Podzimní kontrolní odběr. Krevní obraz i biochemie v normě, "
            "B_Hemoglobin 151 g/l, S_Ferritin 88 µg/l, S_Kreatinkináza "
            "2,80 µkat/l při plném tréninku — bez nálezu.",
        ),
        plan=(
            "Bez opatření, další odběr při jarní prohlídce.",
        ),
    ),
    Note(
        did="d-svoboda-odber-2024-11-19", pid="p-svoboda-2002",
        date="2024-11-19", physician=DR_PROCHAZKOVA,
        assessment=(
            "Podzimní kontrolní odběr. B_Hemoglobin 150 g/l, krevní obraz "
            "v normě. S_Ferritin 70 µg/l — proti červnu nižší (82 µg/l), "
            "zatím v pásmu běžného sezónního kolísání. S_Kreatinkináza "
            "2,95 µkat/l odpovídá tréninkovému zatížení.",
        ),
        plan=(
            "Bez opatření. Sledovat trend ferritinu při jarním odběru.",
        ),
    ),
    Note(
        did="d-svoboda-odber-2026-08-11", pid="p-svoboda-2002",
        date="2026-08-11", physician=DR_PROCHAZKOVA,
        assessment=(
            "Kontrolní odběr nařízený při červnové prohlídce. S_Ferritin "
            "18 µg/l pod dolní mezí, S_Železo 9,4 µmol/l pod dolní mezí, "
            "saturace transferinu 14,8 % snížená. S_Kreatinkináza "
            "6,80 µkat/l výrazně nad horní mezí i při deklarovaných dvou "
            "dnech bez intenzivního tréninku. B_Hemoglobin 144 g/l — "
            "v rozmezí, ale nejnižší za dobu sledování.",
            "Panel potvrzuje obavy z června: vyčerpané zásoby železa a "
            "známky svalového přetížení při klesající výkonnosti. Červnová "
            "redukce objemu podle sdělení pacienta dodržena jen zčásti.",
        ),
        plan=(
            "Zahájena denní perorální substituce železa. Přerušení "
            "intenzivního tréninku na 2 týdny, poté pouze pásma pod prvním "
            "ventilačním prahem do kontroly. Kontrolní odběr a klinické "
            "vyšetření za 6 týdnů — podle výsledku zvážit rozšířené "
            "vyšetření a úpravu ročního plánu. Nutná důsledná compliance.",
        ),
    ),
    # ---- Petr Beneš ---------------------------------------------------------
    Note(
        did="d-benes-odber-2023-10-03", pid="p-benes-1974",
        date="2023-10-03", physician=DR_KOLAR,
        assessment=(
            "Kontrolní odběr bez prohlídky (pacient se na komplexní "
            "vyšetření v tomto roce nedostavil). S_Glukóza 5,44 mmol/l — "
            "horní pásmo normy, trend od roku 2020 setrvale vzestupný "
            "(5,12 → 5,28 → 5,44). S_Cholesterol 5,12 mmol/l mírně nad "
            "horní mezí, S_Triacylglyceroly 1,48 mmol/l v normě.",
        ),
        plan=(
            "Doporučena úprava stravy a redukce hmotnosti o 2–3 kg. "
            "Objednat komplexní prohlídku na jaro; odběr glykémie nalačno "
            "u praktického lékaře do půl roku.",
        ),
    ),
    Note(
        did="d-benes-odber-2026-03-10", pid="p-benes-1974",
        date="2026-03-10", physician=DR_KOLAR,
        assessment=(
            "Kontrolní odběr po loňské prohlídce. S_Glukóza 5,74 mmol/l "
            "nad horní mezí — již druhý odběr v řadě v pásmu hraniční "
            "glykémie nalačno. S_Cholesterol 5,41 mmol/l mírně zvýšený, "
            "S_Triacylglyceroly 1,68 mmol/l při horní mezi. Krevní obraz "
            "v normě.",
            "Metabolický profil se za šest let sledování plynule posouvá "
            "nesprávným směrem; při rodinné anamnéze diabetu 2. typu jde "
            "o jednoznačnou indikaci k systematickému řešení.",
        ),
        plan=(
            "Zpráva praktickému lékaři: doporučeno oGTT, HbA1c a plný "
            "lipidogram. Z naší strany trvá doporučení vytrvalostního "
            "zatížení 5+ hodin týdně a redukce hmotnosti. Kontrolní odběr "
            "u nás za rok.",
        ),
    ),
)

THB_LOGS: tuple[ThbLog, ...] = (
    ThbLog("d-dvorakova-thb-2023", "p-dvorakova-2000", "2023-05-17", DR_KOLAR,
           export_no=14, body=58.1, hb=13.6, hct=40.7, cohb_before=1.0,
           cohb_after=6.2, co_ml=58, bag_l=3, mass=742, blood=5480),
    ThbLog("d-dvorakova-thb-2024", "p-dvorakova-2000", "2024-05-15", DR_KOLAR,
           export_no=21, body=57.8, hb=13.5, hct=40.4, cohb_before=0.9,
           cohb_after=6.1, co_ml=58, bag_l=3, mass=738, blood=5450),
    ThbLog("d-dvorakova-thb-2025", "p-dvorakova-2000", "2025-05-21", DR_KOLAR,
           export_no=29, body=58.6, hb=12.7, hct=38.3, cohb_before=1.1,
           cohb_after=6.2, co_ml=56, bag_l=3, mass=700, blood=5410),
    ThbLog("d-dvorakova-thb-2026", "p-dvorakova-2000", "2026-05-13", DR_KOLAR,
           export_no=36, body=58.2, hb=13.4, hct=40.1, cohb_before=1.0,
           cohb_after=6.2, co_ml=58, bag_l=3, mass=748, blood=5520),
    ThbLog("d-svoboda-thb-2026", "p-svoboda-2002", "2026-06-10", DR_KOLAR,
           export_no=37, body=76.5, hb=15.1, hct=45.0, cohb_before=1.0,
           cohb_after=6.4, co_ml=90, bag_l=4, mass=1085, blood=7150),
)

PERF_NOTES: tuple[PerfNote, ...] = (
    PerfNote(
        did="d-svoboda-funkcni-2025", pid="p-svoboda-2002", date="2025-11-04",
        physician=DR_PROCHAZKOVA,
        protocol="běh na pásu, sklon 1 %, start 10 km/h, +0,5 km/h po 60 s, do vyčerpání",
        m={"vo2max_rel": 73.6, "vo2max_abs": 5.59, "hr_max": 194, "hr_vt1": 160,
           "hr_vt2": 182, "body_mass": 75.9, "spo2_max": 94},
        vt1_vo2=51.8, vt2_vo2=64.6,
        assessment=(
            "Kontrolní funkční vyšetření nařízené při červnové prohlídce. "
            "VO₂max 73,6 ml/kg/min (5,59 l/min) — proti červnovým 74,1 "
            "ml/kg/min beze změny v mezích chyby měření; stagnace na vysoké "
            "úrovni trvá i po letní přípravě, což při dále navýšeném objemu "
            "není očekávaný obraz.",
            "Subjektivně udává větší únavu než v minulých letech touto "
            "dobou. Doporučeno nezvyšovat objem a hlídat regeneraci.",
        ),
        plan=(
            "Jarní prohlídka v obvyklém termínu; při zhoršení tolerance "
            "zátěže v zimě přijít dříve i s odběrem.",
        ),
    ),
)


# --- formatting helpers ------------------------------------------------------
def cz(v: float, decimals: int) -> str:
    return cz_number(v, decimals)


def fmt_int(v: float) -> str:
    return str(int(round(v)))


def zone_rows(hr_vt2: int) -> tuple[tuple[str, str, str], ...]:
    """The I0–I4 zones, derived from VT2 — the zpráva's closing table."""
    v = int(hr_vt2)
    return (
        ("I0 — regenerace", f"do {v - 38}", "2–3"),
        ("I1 — základní vytrvalost", f"{v - 38}–{v - 26}", "3–4"),
        ("I2 — vytrvalost", f"{v - 26}–{v - 14}", "5–6"),
        ("I3 — tempo", f"{v - 14}–{v}", "6–7"),
        ("I4 — rozvoj VO₂max", f"nad {v}", "8–10"),
    )


def tiff(a: Annual) -> tuple[int, int]:
    """(Tiffeneau index, % náležité) — derived, so every table agrees."""
    t = round(a.m["fev1"] / a.m["fvc"] * 100)
    return t, round(t / a.tiff_nal * 100)


def annual_blocks(a: Annual, report: dict, lab: str) -> tuple:
    m = a.m
    body = m["body_mass"]
    t, t_pct = tiff(a)
    spiro_rows = (
        ("FVC (l)", cz(m["fvc"], 2), fmt_int(m["fvc_pct_norm"])),
        ("FEV1 (l)", cz(m["fev1"], 2), fmt_int(m["fev1_pct_norm"])),
        ("FEV1/FVC — Tiffeneaův index (%)", str(t), str(t_pct)),
    )
    if a.mode == "run":
        load_row = ("Rychlost (km/h)", cz(m["speed_vt1"], 1),
                    cz(m["speed_vt2"], 1), cz(a.max_load, 1))
    else:
        load_row = ("Výkon (W)", fmt_int(m["power_vt1"]),
                    fmt_int(m["power_vt2"]), fmt_int(a.max_load))
    ergo_rows = (
        load_row,
        ("Tepová frekvence (/min)", fmt_int(m["hr_vt1"]), fmt_int(m["hr_vt2"]),
         fmt_int(m["hr_max"])),
        ("VO₂ (ml/kg/min)", cz(a.vt1_vo2, 1), cz(a.vt2_vo2, 1),
         cz(m["vo2max_rel"], 1)),
        ("VO₂ (l/min)", cz(round(a.vt1_vo2 * body / 1000, 2), 2),
         cz(round(a.vt2_vo2 * body / 1000, 2), 2), cz(m["vo2max_abs"], 2)),
        ("RER", *a.rer),
        ("Ventilace (l/min)", *a.vent),
        ("SpO2 (%)", a.spo2[0], a.spo2[1], fmt_int(m["spo2_max"])),
    )
    bio, hema = panel_units(report)
    height = HEIGHT_CM[a.pid]

    thb_blocks: tuple = ()
    if "thb_mass" in m:
        thb_blocks = (
            H("Total hemoglobin mass a další parametry"),
            TBL(("Parametr", "absolutní", "relativní"), (0, 220, 360), (
                ("Hbmass", f"{fmt_int(m['thb_mass'])} g",
                 f"{cz(m['thb_mass_rel'], 1)} g/kg"),
                ("Objem krve", f"{fmt_int(m['blood_volume'])} ml",
                 f"{cz(round(m['blood_volume'] / body, 1), 1)} ml/kg"),
            )),
        )
    elif a.thb_note:
        thb_blocks = (
            H("Total hemoglobin mass a další parametry"),
            P(a.thb_note),
        )

    dg2 = (KV("Vedlejší dg.:", a.dg2),) if a.dg2 else ()
    return (
        KV("Základní dg.:", a.dg),
        *dg2,
        H("Anamnéza"),
        KV("RA:", a.ra),
        KV("OA:", a.oa),
        KV("SA:", a.sa),
        KV("NA:", a.na),
        H("Subjektivně"),
        P(a.subjective),
        H("Objektivně"),
        P(a.objective),
        KV("Výška / hmotnost:", f"{height} cm / {cz(body, 1)} kg"),
        KV("TK:", a.bp),
        KV("Klidová TF:", a.rest_hr),
        H("EKG"),
        KV("EKG v klidu:", a.ekg_rest),
        KV("EKG při zátěži:", a.ekg_load),
        H("Spirometrie"),
        TBL(("Parametr", "Hodnota", "% normy"), (0, 220, 320), spiro_rows),
        H("Spiroergometrické parametry"),
        KV("Zátěžový protokol:", a.protocol),
        GAP(4),
        TBL(("Parametr", "VT1 / LT", "VT2 / MLSS", "Max / Peak"),
            (0, 220, 320, 420), ergo_rows),
        H("Krevní obraz a biochemie"),
        KV("Odběr:", f"{cz_date(a.date)}, {lab}"),
        GAP(4),
        P("BIOCHEMIE"),
        PANEL(bio),
        GAP(4),
        P("HEMATOLOGIE"),
        PANEL(hema),
        *thb_blocks,
        BREAK,
        H("Závěr z vyšetření"),
        *(P(p) for p in a.conclusion),
        H("Doporučení"),
        *(P(p) for p in a.recommendation),
        GAP(6),
        P("Tréninkové intenzity:"),
        GAP(4),
        TBL(("Intenzita / zóna", "TF (/min)", "RPE"), (0, 180, 320),
            zone_rows(int(m["hr_vt2"]))),
        GAP(10),
        P(a.physician),
        P("tělovýchovný lékař"),
    )


def note_blocks(n: Note, report: dict, lab: str) -> tuple:
    return (
        KV("Odběr:", f"{cz_date(n.date)}, {lab}"),
        H("Hodnocení"),
        *(P(p) for p in n.assessment),
        H("Doporučení"),
        *(P(p) for p in n.plan),
        GAP(10),
        P(n.physician),
        P("tělovýchovný lékař"),
    )


def perf_note_blocks(pn: PerfNote) -> tuple:
    m = pn.m
    body = m["body_mass"]
    rows = (
        ("Tepová frekvence (/min)", fmt_int(m["hr_vt1"]), fmt_int(m["hr_vt2"]),
         fmt_int(m["hr_max"])),
        ("VO₂ (ml/kg/min)", cz(pn.vt1_vo2, 1), cz(pn.vt2_vo2, 1),
         cz(m["vo2max_rel"], 1)),
        ("VO₂ (l/min)", cz(round(pn.vt1_vo2 * body / 1000, 2), 2),
         cz(round(pn.vt2_vo2 * body / 1000, 2), 2), cz(m["vo2max_abs"], 2)),
        ("SpO2 (%)", "97", "95", fmt_int(m["spo2_max"])),
    )
    return (
        KV("Zátěžový protokol:", pn.protocol),
        KV("Hmotnost:", f"{cz(body, 1)} kg"),
        H("Prahové hodnoty"),
        TBL(("Parametr", "VT1", "VT2", "Max"), (0, 220, 320, 420), rows),
        H("Hodnocení"),
        *(P(p) for p in pn.assessment),
        H("Doporučení"),
        *(P(p) for p in pn.plan),
        GAP(10),
        P(pn.physician),
        P("tělovýchovný lékař"),
    )


# --- the standalone spirometry export (SPIR_FVC_CSM) -------------------------
def _page_header(page: pymupdf.Page, title: str) -> None:
    page.insert_font(fontname="dj", fontfile=FONT)
    page.insert_font(fontname="djb", fontfile=FONT_BOLD)
    page.insert_text((50, 58), CLINIC, fontname="djb", fontsize=13)
    page.insert_text((50, 73), CLINIC_LINE, fontname="dj", fontsize=8)
    page.draw_line(pymupdf.Point(50, 82), pymupdf.Point(545, 82))
    page.insert_text((50, 102), title, fontname="djb", fontsize=11)


def _page_footer(page: pymupdf.Page, left: str) -> None:
    page.draw_line(pymupdf.Point(50, 788), pymupdf.Point(545, 788))
    page.insert_text((50, 800), left, fontname="dj", fontsize=7)
    page.insert_text((50, 811), DISCLAIMER, fontname="dj", fontsize=7)
    page.insert_text((515, 811), "1 / 1", fontname="dj", fontsize=7)


def _kv_column(page: pymupdf.Page, x: float, y: float,
               pairs: list[tuple[str, str]], label_w: float = 92) -> float:
    for label, value in pairs:
        page.insert_text((x, y), label, fontname="djb", fontsize=8)
        page.insert_text((x + label_w, y), value, fontname="dj", fontsize=8)
        y += 12
    return y


def build_spiro_pdf(a: Annual, story: Story) -> pymupdf.Document:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    _page_header(page, "Spirometrie (Průtok-objem)")

    first, last = story.name.split(" ", 1)
    _kv_column(page, 50, 126, [
        ("Příjmení:", last),
        ("Křestní jméno:", first),
        ("Identifikace:", story.pid),
        ("Věk:", f"{age_at(story.birth, a.date)} let"),
        ("Datum narození:", cz_date(story.birth)),
    ])
    _kv_column(page, 310, 126, [
        ("Datum návštěvy:", cz_date(a.date)),
        ("Pohlaví:", "žena" if story.sex == "f" else "muž"),
        ("Výška:", f"{HEIGHT_CM[a.pid]} cm"),
        ("Hmotnost:", f"{cz(a.m['body_mass'], 1)} kg"),
    ])

    # The flow–volume loop, stylised: expiratory peak decaying to FVC, a
    # rounded inspiratory limb below. Purely geometric, derived from the
    # printed PEF and FVC, so it is deterministic and roughly honest.
    box = pymupdf.Rect(330, 200, 545, 330)
    page.draw_rect(box)
    page.insert_text((box.x0 + 4, box.y0 + 12), "Průtok–objem — nejlepší zkouška",
                     fontname="dj", fontsize=7)
    base_y = box.y0 + 84.0
    x0, x1 = box.x0 + 16.0, box.x1 - 16.0
    span = x1 - x0
    peak_x = x0 + span * 0.18
    peak_y = base_y - min(60.0, a.pef * 6.0)
    pts = [pymupdf.Point(x0, base_y), pymupdf.Point(peak_x, peak_y)]
    for i in range(1, 6):
        fx = 0.18 + (1.0 - 0.18) * i / 6.0
        fy = (1.0 - i / 6.0) ** 1.6
        pts.append(pymupdf.Point(x0 + span * fx, base_y - (base_y - peak_y) * fy))
    pts.append(pymupdf.Point(x1, base_y))
    page.draw_polyline(pts)
    insp = [pymupdf.Point(x1, base_y),
            pymupdf.Point(x0 + span * 0.5, base_y + 34.0),
            pymupdf.Point(x0, base_y)]
    page.draw_polyline(insp)

    # Trials 1–3: trial 3 is the best, earlier trials fall short by a seeded,
    # per-document amount — the shape a real session log has.
    rng = random.Random(f"{SEED}|{a.did}|spiro-trials")
    def trials(best: float, lo: float, hi: float, dec: int) -> tuple[float, float, float]:
        t1 = round(best - rng.uniform(hi, hi * 2), dec)
        t2 = round(best - rng.uniform(lo, hi), dec)
        return t1, t2, best

    fvc_t = trials(a.m["fvc"], 0.03, 0.09, 2)
    fev1_t = trials(a.m["fev1"], 0.03, 0.08, 2)
    pef_t = trials(a.pef, 0.1, 0.3, 1)
    t, t_pct = tiff(a)
    tiff_t = tuple(round(f1 / f2 * 100) for f1, f2 in zip(fev1_t, fvc_t))

    def zsc(pct: float) -> str:
        return cz(round((pct - 100) / 10, 1), 1)

    nal_fvc = round(a.m["fvc"] / (a.m["fvc_pct_norm"] / 100), 2)
    nal_fev1 = round(a.m["fev1"] / (a.m["fev1_pct_norm"] / 100), 2)
    nal_pef = round(a.pef / (a.pef_pct / 100), 1)

    rows = [
        ("FVC (l)", cz(nal_fvc, 2), cz(a.m["fvc"], 2), fmt_int(a.m["fvc_pct_norm"]),
         cz(fvc_t[0], 2), cz(fvc_t[1], 2), cz(fvc_t[2], 2), zsc(a.m["fvc_pct_norm"])),
        ("FEV1 (l)", cz(nal_fev1, 2), cz(a.m["fev1"], 2), fmt_int(a.m["fev1_pct_norm"]),
         cz(fev1_t[0], 2), cz(fev1_t[1], 2), cz(fev1_t[2], 2), zsc(a.m["fev1_pct_norm"])),
        ("FEV1%F (%)", str(a.tiff_nal), str(t), str(t_pct),
         str(tiff_t[0]), str(tiff_t[1]), str(tiff_t[2]), zsc(t_pct)),
        ("PEF (l/s)", cz(nal_pef, 1), cz(a.pef, 1), str(a.pef_pct),
         cz(pef_t[0], 1), cz(pef_t[1], 1), cz(pef_t[2], 1), zsc(a.pef_pct)),
    ]
    xs = (50, 150, 210, 265, 325, 375, 425, 480)
    headers = ("Parametr", "Nál.", "Best", "%(B/N)", "1", "2", "3", "Z-skóre")
    y = 366.0
    for text, x in zip(headers, xs):
        page.insert_text((x, y), text, fontname="djb", fontsize=8)
    page.draw_line(pymupdf.Point(50, y + 4), pymupdf.Point(545, y + 4))
    y += 16
    for row in rows:
        for text, x in zip(row, xs):
            page.insert_text((x, y), text, fontname="dj", fontsize=8)
        y += 13

    rng2 = random.Random(f"{SEED}|{a.did}|spiro-ambient")
    temp = cz(round(20 + rng2.uniform(0, 4), 1), 1)
    pres = str(975 + rng2.randint(0, 30))
    humi = str(35 + rng2.randint(0, 15))
    clock = f"{8 + rng2.randint(0, 2)}:{rng2.randint(10, 59):02d}"
    y += 14
    page.insert_text((50, y), "Podmínky měření", fontname="djb", fontsize=8)
    y += 13
    _kv_column(page, 50, y, [
        ("Datum:", cz_date(a.date)),
        ("Čas:", clock),
        ("Teplota:", f"{temp} °C"),
        ("Tlak:", f"{pres} hPa"),
        ("Vlhkost:", f"{humi} %"),
    ], label_w=70)

    _page_footer(page, f"SPIR_FVC_CSM · {CLINIC}")
    return doc


# --- the tHb Measurement Log (CO-rebreathing, English) -----------------------
def build_thb_pdf(log: ThbLog, story: Story) -> pymupdf.Document:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="dj", fontfile=FONT)
    page.insert_font(fontname="djb", fontfile=FONT_BOLD)
    # No CSM letterhead on this shape — provenance lives in the Project block.
    page.insert_text((50, 64), "Measurement Log", fontname="djb", fontsize=14)
    page.insert_text((50, 80), "CO-rebreathing — total haemoglobin mass",
                     fontname="dj", fontsize=9)
    page.draw_line(pymupdf.Point(50, 90), pymupdf.Point(545, 90))

    height_m = HEIGHT_CM[log.pid] / 100
    bmi = round(log.body / (height_m * height_m), 1)
    hct_frac = log.hct / 100
    ery = round(log.blood * hct_frac)
    plasma = log.blood - ery
    mchc = round(log.mass / ery * 100, 1)

    def rel(v: float) -> float:
        return round(v / log.body, 1)

    y = 114.0
    def section(title: str, pairs: list[tuple[str, str]]) -> None:
        nonlocal y
        page.insert_text((50, y), title, fontname="djb", fontsize=9)
        y += 14
        y = _kv_column(page, 50, y, pairs, label_w=150)
        y += 8

    section("Project", [
        ("IdentNo:", story.pid),
        ("Name:", story.name),
        ("Test leader:", log.leader),
        ("Date:", cz_date(log.date)),
    ])
    section("Personal data", [
        ("Date of birth:", cz_date(story.birth)),
        ("Sex:", "female" if story.sex == "f" else "male"),
        ("Height:", f"{HEIGHT_CM[log.pid]} cm"),
        ("Body mass:", f"{cz(log.body, 1)} kg"),
    ])
    section("Characteristics", [
        ("Sport:", "cross-country skiing"),
    ])
    section("Test data", [
        ("[Hb] capillary:", f"{cz(log.hb, 1)} g/dl"),
        ("[Hct] capillary:", f"{cz(log.hct, 1)} %"),
        ("CO-Hb before:", f"{cz(log.cohb_before, 1)} %"),
        ("CO-Hb after:", f"{cz(log.cohb_after, 1)} %"),
        ("CO application:", f"{log.co_ml} ml"),
        ("Bag volume:", f"{log.bag_l} l"),
    ])

    page.insert_text((50, y), "Results", fontname="djb", fontsize=9)
    y += 16
    xs = (50, 260, 400)
    for text, x in zip(("Parameter", "absolute", "relative"), xs):
        page.insert_text((x, y), text, fontname="djb", fontsize=8)
    page.draw_line(pymupdf.Point(50, y + 4), pymupdf.Point(545, y + 4))
    y += 16
    result_rows = (
        ("Body mass index", f"{cz(bmi, 1)} kg/m²", "—"),
        ("MCHC", f"{cz(mchc, 1)} g/dl", "—"),
        ("Haemoglobin mass", f"{log.mass} g", f"{cz(rel(log.mass), 1)} g/kg"),
        ("Erythrocyte volume", f"{ery} ml", f"{cz(rel(ery), 1)} ml/kg"),
        ("Plasma volume", f"{plasma} ml", f"{cz(rel(plasma), 1)} ml/kg"),
        ("Blood volume", f"{log.blood} ml", f"{cz(rel(log.blood), 1)} ml/kg"),
    )
    for row in result_rows:
        for text, x in zip(row, xs):
            page.insert_text((x, y), text, fontname="dj", fontsize=8)
        y += 13

    _page_footer(page, f"export measurement #{log.export_no} | {log.date}")
    return doc


# --- assembling the document corpus ------------------------------------------
def csm_documents(reports: list[dict], stories: dict[str, Story]) -> list[dict]:
    """(meta, builder) for every CSM document, in a stable order."""
    entries: list[tuple[Document, object]] = []

    for a in ANNUALS:
        report = nearest_report(reports, a.pid, a.date)
        lab = report["labName"]
        entries.append((Document(
            did=a.did, pid=a.pid, date=a.date, kind="perf_eval",
            title="Zpráva z vyšetření", clinic=CLINIC, dept=CLINIC_LINE,
            date_label="Datum vyšetření", author_label="Vyšetřil",
            author=a.physician, blocks=annual_blocks(a, report, lab),
        ), None))
        if a.spiro_doc:
            year = a.date[:4]
            slug = a.did.split("-")[1]
            meta = Document(
                did=f"d-{slug}-spirometrie-{year}", pid=a.pid, date=a.date,
                kind="perf_eval", title="Spirometrie (Průtok-objem)",
                clinic=CLINIC, dept=CLINIC_LINE, date_label="Datum návštěvy",
                author_label="Vyšetřil", author=a.physician, blocks=(),
            )
            entries.append((meta, lambda a=a: build_spiro_pdf(a, stories[a.pid])))

    for n in NOTES:
        report = nearest_report(reports, n.pid, n.date)
        entries.append((Document(
            did=n.did, pid=n.pid, date=n.date, kind="perf_eval",
            title="Záznam z kontroly — krevní odběr", clinic=CLINIC,
            dept=CLINIC_LINE, date_label="Datum kontroly", author_label="Zapsal",
            author=n.physician, blocks=note_blocks(n, report, report["labName"]),
        ), None))

    for pn in PERF_NOTES:
        entries.append((Document(
            did=pn.did, pid=pn.pid, date=pn.date, kind="perf_eval",
            title="Funkční vyšetření — souhrn", clinic=CLINIC, dept=CLINIC_LINE,
            date_label="Datum vyšetření", author_label="Vyšetřil",
            author=pn.physician, blocks=perf_note_blocks(pn),
        ), None))

    for log in THB_LOGS:
        meta = Document(
            did=log.did, pid=log.pid, date=log.date, kind="perf_eval",
            title="Measurement Log (tHb)", clinic=CLINIC, dept=CLINIC_LINE,
            date_label="Date", author_label="Test leader", author=log.leader,
            blocks=(),
        )
        entries.append((meta, lambda log=log: build_thb_pdf(log, stories[log.pid])))

    entries.sort(key=lambda e: (e[0].pid, e[0].date, e[0].did))
    assert len({m.did for m, _ in entries}) == len(entries), "duplicate doc id"

    # Render: Sheet for prose documents, the dedicated builders for the two
    # device-export shapes. body_text is read back out of the produced PDF —
    # the database can only quote what the page actually says.
    pages_dir = OUT / TENANT / "pages"
    assert pages_dir.is_dir(), "run order: build_practice creates the tenant dir"
    for stale in sorted(pages_dir.glob("d-*_p*.png")):
        stale.unlink()

    tmp = OUT / TENANT / "_tmpdocs"
    tmp.mkdir(parents=True, exist_ok=True)
    zoom = RENDER_DPI / 72.0
    out: list[dict] = []
    for meta, builder in entries:
        story = stories[meta.pid]
        if builder is None:
            sheet = Sheet(meta, story)
            sheet.render()
            pdf_doc = sheet.pdf
        else:
            pdf_doc = builder()
        pdf_path = tmp / f"{meta.did}.pdf"
        pdf_doc.save(pdf_path)
        pdf_doc.close()

        pdf = pymupdf.open(pdf_path)
        pages, texts = [], []
        for i, pg in enumerate(pdf):
            pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
            name = f"{meta.did}_p{i + 1}.png"
            pix.save(pages_dir / name)
            pages.append({
                "pageNum": i + 1,
                "imageUrl": f"/demo/{TENANT}/pages/{name}",
                "width": pix.width,
                "height": pix.height,
            })
            texts.append(pg.get_text().strip())
        out.append({
            "id": meta.did,
            "patientRef": meta.pid,
            "docDate": meta.date,
            "kind": meta.kind,
            "title": meta.title,
            "bodyText": "\n".join(texts),
            "pages": pages,
        })
        pdf.close()

    for f in sorted(tmp.glob("*.pdf")):
        f.unlink()
    tmp.rmdir()

    (OUT / TENANT / "documents.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


# --- visits and perf metrics -------------------------------------------------
VISIT_TITLES = {
    "annual": "Roční prohlídka",
    "blood": "Kontrolní odběr",
    "perf_test": "Funkční vyšetření",
    "thb": "Měření tHb (CO-rebreathing)",
}


def build_visits() -> tuple[list[dict], list[dict]]:
    """The visit spine and the perf_metrics rows, derived from the specs.

    A visit is (patient, date, kind); every document and every lab draw lands
    on exactly one. Ghosts get a note for every visit — the honest-gaps rule
    is reserved for the real record.
    """
    visits: list[dict] = []
    perf: list[dict] = []

    def vid(pid: str, date: str) -> str:
        return f"v-{pid[2:]}-{date}"

    def add_visit(pid: str, date: str, kind: str, note_did: str) -> None:
        visits.append({
            "id": vid(pid, date), "pid": pid, "date": date, "kind": kind,
            "title": VISIT_TITLES[kind], "note": note_did,
        })

    def add_metrics(pid: str, date: str, values: dict[str, float]) -> None:
        for mid in METRICS:
            if mid in values:
                display, unit = METRICS[mid]
                perf.append({
                    "pid": pid, "visit": vid(pid, date), "metric": mid,
                    "display": display, "unit": unit,
                    "value": float(values[mid]), "date": date,
                })

    for a in ANNUALS:
        add_visit(a.pid, a.date, "annual", a.did)
        add_metrics(a.pid, a.date, a.m)
    for n in NOTES:
        add_visit(n.pid, n.date, "blood", n.did)
    for pn in PERF_NOTES:
        add_visit(pn.pid, pn.date, "perf_test", pn.did)
        add_metrics(pn.pid, pn.date, pn.m)
    for log in THB_LOGS:
        add_visit(log.pid, log.date, "thb", log.did)
        add_metrics(log.pid, log.date, log.metric_values())

    visits.sort(key=lambda v: (v["pid"], v["date"]))
    perf.sort(key=lambda r: (r["pid"], r["date"], list(METRICS).index(r["metric"])))
    assert len({v["id"] for v in visits}) == len(visits), "duplicate visit"
    return visits, perf


def check_integrity(stories: list[Story], reports: list[dict],
                    docs: list[dict], visits: list[dict],
                    perf: list[dict]) -> None:
    by_key = {(v["pid"], v["date"]): v for v in visits}
    for r in reports:
        key = (r["patientRef"], r["reportDate"])
        assert key in by_key, f"lab report without a visit: {key}"
        assert by_key[key]["kind"] in ("annual", "blood"), key
    for d in docs:
        key = (d["patientRef"], d["docDate"])
        assert key in by_key, f"document without a visit: {key}"
    doc_ids = {d["id"] for d in docs}
    visit_ids = {v["id"] for v in visits}
    for v in visits:
        assert v["note"] in doc_ids, f"visit note missing: {v['id']}"
    for row in perf:
        assert row["visit"] in visit_ids, row
        assert row["metric"] in METRICS, row
    # The inline panel is quoted verbatim: every printed panel item of every
    # zpráva must appear, character for character, in the read-back body text.
    docs_by_id = {d["id"]: d for d in docs}
    for a in ANNUALS:
        report = nearest_report(reports, a.pid, a.date)
        bio, hema = panel_units(report)
        body = docs_by_id[a.did]["bodyText"]
        for item in bio + hema:
            assert item in body, f"{a.did}: panel item not verbatim: {item}"


# --- the seed SQL ------------------------------------------------------------
def build_seed_sql(stories: list[Story], reports: list[dict],
                   docs: list[dict], visits: list[dict], perf: list[dict],
                   registry: Registry) -> str:
    base = mcd.build_sql(TENANT, stories, reports, registry)
    # The base builder's header names its own script; this file is written by
    # this one, and the CSM tenant's extra tables need their DELETEs first
    # (visits references documents, perf_metrics references visits).
    marker = "tools/pipeline/scripts/make_chat_demo.py."
    assert marker in base, "make_chat_demo.build_sql header changed"
    base = base.replace(
        marker, "tools/pipeline/scripts/make_csm_demo.py.", 1)
    wipe = "DELETE FROM patient_analyte_summary;"
    assert wipe in base, "make_chat_demo.build_sql wipe block changed"
    base = base.replace(wipe, "DELETE FROM perf_metrics;\nDELETE FROM visits;\n" + wipe, 1)

    lines = [base.rstrip("\n"), ""]

    lines.append("-- documents: body_text read back from the generated PDFs")
    for d in docs:
        lines.append(
            "INSERT INTO documents (id, patient_id, doc_date, kind, title, "
            "body_text, body_norm) VALUES ("
            f"{sql_str(d['id'])}, {sql_str(d['patientRef'])}, "
            f"{sql_str(d['docDate'])}, {sql_str(d['kind'])}, "
            f"{sql_str(d['title'])}, {sql_str(d['bodyText'])}, "
            f"{sql_str(body_norm(d['bodyText']))});"
        )
    lines.append("")
    for d in docs:
        for p in d["pages"]:
            lines.append(
                "INSERT INTO document_pages (document_id, page_num, image_url, "
                "width, height) VALUES ("
                f"{sql_str(d['id'])}, {p['pageNum']}, {sql_str(p['imageUrl'])}, "
                f"{p['width']}, {p['height']});"
            )
    lines.append("")

    lines.append("-- visits: the derived spine — every report and document date")
    lines.append("-- belongs to exactly one of these rows")
    for v in visits:
        lines.append(
            "INSERT INTO visits (id, patient_id, visit_date, kind, title, "
            "note_document_id) VALUES ("
            f"{sql_str(v['id'])}, {sql_str(v['pid'])}, {sql_str(v['date'])}, "
            f"{sql_str(v['kind'])}, {sql_str(v['title'])}, {sql_str(v['note'])});"
        )
    lines.append("")

    lines.append("-- perf_metrics: only metric_ids from docs/csm-protocol.md's")
    lines.append("-- charted table; no CSM protocol prints bounds, so refs are NULL")
    for r in perf:
        lines.append(
            "INSERT INTO perf_metrics (patient_id, visit_id, metric_id, "
            "display_name, unit, value, ref_low, ref_high, test_date) VALUES ("
            f"{sql_str(r['pid'])}, {sql_str(r['visit'])}, {sql_str(r['metric'])}, "
            f"{sql_str(r['display'])}, {sql_str(r['unit'])}, "
            f"{sql_num(r['value'])}, NULL, NULL, {sql_str(r['date'])});"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    register_csm()
    registry = Registry([AnalyteDef.from_dict(d) for d in
                         json.loads((ROOT / "data" / "registry.json").read_text("utf-8"))])
    SQL_OUT.mkdir(parents=True, exist_ok=True)

    stories = {s.pid: s for s in SKIERS}
    reports = mcd.build_practice(TENANT, SKIERS, registry)
    docs = csm_documents(reports, stories)
    visits, perf = build_visits()
    check_integrity(SKIERS, reports, docs, visits, perf)

    sql = build_seed_sql(SKIERS, reports, docs, visits, perf, registry)
    (SQL_OUT / "seed_csm.sql").write_text(sql, encoding="utf-8")

    rows = sum(len(r["measurements"]) for r in reports)
    pages = sum(len(d["pages"]) for d in docs)
    print(f"csm: {len(SKIERS)} patients, {len(reports)} draws, {rows} measurements")
    print(f"csm: {len(docs)} documents, {pages} pages, "
          f"{len(visits)} visits, {len(perf)} perf metrics → {OUT / TENANT}")
    print(f"csm: seed → {SQL_OUT / 'seed_csm.sql'}")


if __name__ == "__main__":
    main()
