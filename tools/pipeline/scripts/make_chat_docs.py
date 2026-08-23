"""Generate the chat demo's synthetic *prose* corpus — the documents half.

``make_chat_demo.py`` builds the measured half: lab reports, rendered, located,
normalised. This script builds what a doctor actually reads around those
numbers — sports-medicine examination reports, a training-zones protocol,
operation protocols, imaging descriptions and physiotherapy session notes — and
renders them through the same discipline, for the same reasons:

* fonts come from ``scripts/_fonts.py``, never the system (see that module);
* pages are rendered at 220 DPI by PyMuPDF, so every citation the chat UI shows
  is a crop of a page that was actually printed;
* ``body_text`` is read back out of the generated PDF with ``get_text()`` rather
  than kept alongside it, so what the database can quote is exactly what the
  page says — a document store that disagrees with its own evidence image is
  worse than no citation at all;
* nothing is drawn at random, so two runs are byte-identical.

**The inline blood panel is the point.** Each sports-medicine report prints its
blood work as running text, the way the real ones do, and the values are read
out of ``apps/chat/public/demo/<tenant>/reports.json`` for the draw nearest that
examination. The same ferritin is therefore quotable from a document excerpt
*and* plottable from a structured trend — one analyte, two kinds of memory,
which is the moment the demo exists to show.

Structure was surveyed from the real evaluations in the git-ignored
``samples/performance/`` — sections, table shapes, metric names. **No value,
name, birth date, insurance number, clinic, physician or address from those
files appears here**, and no sentence is copied from them: the prose is written
for these fictional patients. Practices, physicians and therapists are invented,
and carry no address, IČ or IČZ, because a plausible-looking identifier outlives
the demo it was invented for.

Run it **after** ``make_chat_demo``, which owns ``reports.json`` and clears the
tenant directory. This script only ever removes its own pages (``d-*_p*.png``).

    cd tools/pipeline && python3 -m scripts.make_chat_demo
    cd tools/pipeline && python3 -m scripts.make_chat_docs

Outputs:
    apps/chat/public/demo/{sport,orto}/pages/d-*_p*.png     committed page images
    apps/chat/public/demo/{sport,orto}/documents.json       committed corpus
    tools/pipeline/out/seed_docs_{sport,orto}.sql           committed seed SQL

The seed files are applied *after* ``seed_{tenant}.sql`` — that one deletes the
document tables along with everything else it owns, so documents must land last.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from scripts._fonts import czech_fonts  # noqa: E402

FONT, FONT_BOLD = czech_fonts()
MEASURE = pymupdf.Font(fontfile=FONT)
MEASURE_BOLD = pymupdf.Font(fontfile=FONT_BOLD)

# The patient table lives in one place. Importing it rather than restating it is
# what keeps a document's letterhead patient identical to the lab report's — the
# demo's whole claim is that these are the same person.
from scripts.make_chat_demo import PRACTICES, Story, cz_date  # noqa: E402

OUT = ROOT / "apps" / "chat" / "public" / "demo"
SQL_OUT = ROOT / "tools" / "pipeline" / "out"
RENDER_DPI = 220

PAGE_W, PAGE_H = 595.0, 842.0   # A4 points
LEFT, RIGHT = 50.0, 545.0
BOTTOM = 776.0                  # content stops here; the footer owns what follows
WIDTH = RIGHT - LEFT

# Type sizes. Small, like the reports these are modelled on: a sports-medicine
# examination is two dense pages, and at 220 DPI 8 pt renders to a legible 24
# pixels — the citation crop the chat UI shows is read at that resolution, not
# at 100 %.
BODY, LEAD = 8.0, 11.0
HEADING, HEADING_LEAD, HEADING_GAP = 9.0, 13.0, 5.0
CELL, CELL_ROW = 7.8, 11.5

DISCLAIMER = ("Ukázková data — smyšlený pacient i pracoviště, "
              "negenerováno z reálného vyšetření.")

# Fictional practices. Same naming family as the fictional laboratories in
# make_chat_demo (a mineral, a place that is not on a map), and deliberately not
# the name of any real Czech sports-medicine centre, hospital or imaging
# department. No address, no telephone, no IČ, no IČZ: the letterhead says who
# wrote the document and nothing that could be dialled.
SPORT_CLINIC = "Sportovní ambulance Vltavín s.r.o."
SPORT_DEPT = "Oddělení funkční diagnostiky"
SPORT_LAB_DEPT = "Laboratoř zátěžové fyziologie"
ORTO_CLINIC = "Ortopedie a fyzioterapie Podhájí s.r.o."
ORTO_SURG_DEPT = "Ortopedické oddělení — operační sál"
ORTO_RTG_DEPT = "Radiodiagnostické pracoviště"
ORTO_PHYSIO_DEPT = "Pracoviště fyzioterapie"


# --- the document model ------------------------------------------------------
# A document is a letterhead plus a list of blocks. Every kind — examination
# report, zones protocol, operation protocol, session note — renders through the
# same flow, so page breaks, wrapping and footers behave identically and a
# citation crop means the same thing wherever it was cut from.

def H(text: str) -> tuple:
    """A section heading."""
    return ("h", text)


def P(text: str) -> tuple:
    """A wrapped paragraph."""
    return ("p", text)


def KV(label: str, value: str) -> tuple:
    """A label/value line — the shape half a clinical document is written in."""
    return ("kv", label, value)


def TBL(headers: tuple[str, ...], xs: tuple[float, ...],
        rows: tuple[tuple[str, ...], ...]) -> tuple:
    return ("tbl", headers, xs, rows)


def PANEL(units: tuple[str, ...]) -> tuple:
    """The inline blood panel: analyte items wrapped at ``; `` boundaries.

    Wrapping on the separator rather than on spaces is not cosmetic. A line
    break between ``S_Ferritin:`` and ``21`` would put a newline into the
    extracted body text in the middle of the one phrase the demo asks the agent
    to quote. Each analyte therefore stays whole on its line.
    """
    return ("panel", units)


def GAP(h: float) -> tuple:
    return ("gap", h)


BREAK = ("break",)


@dataclass(frozen=True)
class Document:
    did: str
    pid: str
    date: str            # ISO
    kind: str            # perf_eval | physio_note | imaging | op_report
    title: str
    clinic: str
    dept: str
    date_label: str      # "Datum vyšetření", "Datum výkonu", "Datum terapie"
    author_label: str    # "Vyšetřil", "Operatér", "Terapeut"
    author: str
    blocks: tuple = field(default_factory=tuple)


# --- rendering ---------------------------------------------------------------
def wrap(text: str, size: float, width: float, bold: bool = False,
         sep: str = " ") -> list[str]:
    """Greedy wrap, measured with the bundled font.

    Measured, not estimated: the same font file that draws the glyph decides
    where the line ends, which is why the output does not depend on the machine.
    """
    font = MEASURE_BOLD if bold else MEASURE
    parts = [p for p in text.split(sep) if p != ""]
    lines: list[str] = []
    cur = ""
    for part in parts:
        cand = part if not cur else cur + sep + part
        if font.text_length(cand, size) <= width or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = part
    if cur:
        lines.append(cur)
    return lines or [""]


def wrap_units(units: tuple[str, ...], size: float, width: float) -> list[str]:
    """Wrap the inline blood panel without ever splitting one analyte.

    A line break between ``S_Ferritin:`` and ``21`` would put a newline into the
    extracted body text in the middle of the one phrase the demo asks the agent
    to quote, so the item — value, unit and reference range together — is the
    unbreakable unit, and every line ends on a semicolon the way the printed
    reports do.
    """
    lines: list[str] = []
    cur = ""
    for unit in units:
        item = unit + ";"
        cand = item if not cur else cur + " " + item
        if MEASURE.text_length(cand, size) <= width or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = item
    if cur:
        lines.append(cur)
    return lines


class Sheet:
    """One document, rendered onto as many A4 pages as it needs."""

    def __init__(self, doc: Document, story: Story) -> None:
        self.d = doc
        self.s = story
        self.pdf = pymupdf.open()
        self.page: pymupdf.Page | None = None
        self.y = 0.0
        self.count = 0

    # -- page furniture --
    def _header(self) -> None:
        p = self.page
        assert p is not None
        p.insert_text((LEFT, 58), self.d.clinic, fontname="djb", fontsize=13)
        p.insert_text((LEFT, 73), self.d.dept, fontname="dj", fontsize=8.5)
        p.draw_line(pymupdf.Point(LEFT, 82), pymupdf.Point(RIGHT, 82))
        if self.count == 1:
            p.insert_text((LEFT, 102), self.d.title, fontname="djb", fontsize=11)
            y = 122.0
            head = (
                ("Pacient:", self.s.name),
                ("Datum narození:", cz_date(self.s.birth)),
                (f"{self.d.date_label}:", cz_date(self.d.date)),
                (f"{self.d.author_label}:", self.d.author),
            )
            for label, value in head:
                p.insert_text((LEFT, y), label, fontname="djb", fontsize=BODY)
                p.insert_text((LEFT + 100, y), value, fontname="dj", fontsize=BODY)
                y += 12
            self.y = y + 8
        else:
            # Every continuation page names the patient and the document. A
            # citation crop is often taken from page 2, and a page that cannot
            # say whose it is cannot be checked.
            p.insert_text((LEFT, 100), f"{self.d.title} — pokračování",
                          fontname="dj", fontsize=BODY)
            p.insert_text((LEFT, 112), f"{self.s.name}, nar. {cz_date(self.s.birth)}",
                          fontname="dj", fontsize=BODY)
            self.y = 132.0

    def _footers(self) -> None:
        total = len(self.pdf)
        for i, p in enumerate(self.pdf):
            p.draw_line(pymupdf.Point(LEFT, 788), pymupdf.Point(RIGHT, 788))
            p.insert_text((LEFT, 800), self.d.clinic, fontname="dj", fontsize=7)
            p.insert_text((LEFT, 811), DISCLAIMER, fontname="dj", fontsize=7)
            num = f"{i + 1} / {total}"
            p.insert_text((RIGHT - MEASURE.text_length(num, 7), 811), num,
                          fontname="dj", fontsize=7)

    def new_page(self) -> None:
        p = self.pdf.new_page(width=PAGE_W, height=PAGE_H)
        p.insert_font(fontname="dj", fontfile=FONT)
        p.insert_font(fontname="djb", fontfile=FONT_BOLD)
        self.page = p
        self.count += 1
        self._header()

    def _room(self, height: float) -> None:
        if self.page is None or self.y + height > BOTTOM:
            self.new_page()

    # -- content --
    def line(self, text: str, size: float = BODY, bold: bool = False,
             x: float = LEFT, lead: float = LEAD) -> None:
        self._room(lead)
        assert self.page is not None
        self.page.insert_text((x, self.y), text,
                              fontname="djb" if bold else "dj", fontsize=size)
        self.y += lead

    def para(self, text: str, size: float = BODY, sep: str = " ",
             lead: float = LEAD) -> None:
        for ln in wrap(text, size, WIDTH, sep=sep):
            self.line(ln, size=size, lead=lead)

    def render(self) -> None:
        self.new_page()
        for block in self.d.blocks:
            kind = block[0]
            if kind == "h":
                self._room(28)
                self.y += HEADING_GAP
                self.line(block[1], size=HEADING, bold=True, lead=HEADING_LEAD)
            elif kind == "p":
                self.para(block[1])
            elif kind == "kv":
                self._room(LEAD)
                assert self.page is not None
                label = block[1]
                self.page.insert_text((LEFT, self.y), label, fontname="djb", fontsize=BODY)
                indent = LEFT + MEASURE_BOLD.text_length(label, BODY) + 4
                first = True
                for ln in wrap(block[2], BODY, RIGHT - indent):
                    if first:
                        self.page.insert_text((indent, self.y), ln, fontname="dj",
                                              fontsize=BODY)
                        first = False
                    else:
                        self.y += LEAD
                        self._room(0)
                        assert self.page is not None
                        self.page.insert_text((indent, self.y), ln, fontname="dj",
                                              fontsize=BODY)
                self.y += LEAD
            elif kind == "tbl":
                _, headers, xs, rows = block
                self._room(CELL_ROW * (len(rows) + 2))
                assert self.page is not None
                for text, x in zip(headers, xs):
                    self.page.insert_text((LEFT + x, self.y), text,
                                          fontname="djb", fontsize=CELL)
                self.page.draw_line(pymupdf.Point(LEFT, self.y + 3.5),
                                    pymupdf.Point(RIGHT, self.y + 3.5))
                self.y += CELL_ROW + 3
                for row in rows:
                    self._room(CELL_ROW)
                    assert self.page is not None
                    for text, x in zip(row, xs):
                        self.page.insert_text((LEFT + x, self.y), text,
                                              fontname="dj", fontsize=CELL)
                    self.y += CELL_ROW
                self.y += 3
            elif kind == "panel":
                for ln in wrap_units(block[1], BODY, WIDTH):
                    self.line(ln)
            elif kind == "gap":
                self.y += block[1]
            elif kind == "break":
                self.new_page()
            else:  # pragma: no cover - a typo in a block tag, caught at build
                raise AssertionError(f"unknown block: {kind}")
        self._footers()


# --- the sports-medicine examination report ----------------------------------
@dataclass(frozen=True)
class Eval:
    """One "Zpráva ze sportovní prohlídky".

    Fields follow the section order of the real annual examination report:
    anamnesis, subjective, objective, resting and exercise ECG, spirometry,
    the spiroergometry table, the inline blood panel, the narrative conclusion
    and the recommendation with its training-intensity zones.
    """
    did: str
    pid: str
    date: str
    physician: str
    height: str
    weight: str
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
    spiro: tuple[tuple[str, str, str], ...]
    ergo: tuple[tuple[str, str, str, str], ...]
    conclusion: tuple[str, ...]
    recommendation: tuple[str, ...]
    zones: tuple[tuple[str, str, str], ...]
    quotes: str                                    # report_date the panel quotes


def eval_blocks(e: Eval, units: tuple[tuple[str, ...], tuple[str, ...]],
                quoted_date: str, lab: str) -> tuple:
    bio, hema = units
    return (
        H("Anamnéza"),
        KV("RA:", e.ra),
        KV("OA:", e.oa),
        KV("SA:", e.sa),
        KV("NA:", e.na),
        H("Subjektivně"),
        P(e.subjective),
        H("Objektivně"),
        P(e.objective),
        KV("Výška / hmotnost:", f"{e.height} / {e.weight}"),
        KV("TK:", e.bp),
        KV("Klidová TF:", e.rest_hr),
        H("EKG"),
        KV("EKG v klidu:", e.ekg_rest),
        KV("EKG při zátěži:", e.ekg_load),
        H("Spirometrie"),
        TBL(("Parametr", "Hodnota", "% normy"), (0, 200, 300), e.spiro),
        H("Spiroergometrie"),
        KV("Zátěžový protokol:", e.protocol),
        GAP(4),
        TBL(("Parametr", "VT1 / LT", "VT2 / MLSS", "Max / Peak"),
            (0, 220, 320, 420), e.ergo),
        H("Krevní obraz a biochemie"),
        KV("Odběr:", f"{cz_date(quoted_date)}, {lab}"),
        GAP(4),
        P("BIOCHEMIE"),
        PANEL(bio),
        GAP(4),
        P("HEMATOLOGIE"),
        PANEL(hema),
        BREAK,
        H("Závěr z vyšetření"),
        *(P(p) for p in e.conclusion),
        H("Doporučení"),
        *(P(p) for p in e.recommendation),
        GAP(6),
        P("Tréninkové intenzity:"),
        GAP(4),
        TBL(("Intenzita / zóna", "TF (/min)", "RPE"), (0, 160, 300), e.zones),
    )


# --- the training-zones protocol ---------------------------------------------
@dataclass(frozen=True)
class ZonesDoc:
    did: str
    pid: str
    date: str
    physician: str
    height: str
    weight: str
    test_dt: str
    duration: str
    protocol: str
    sport: str
    rows: tuple[tuple[str, str, str, str, str], ...]   # zóna, TF, v, V'O2, %VO2max
    narratives: tuple[tuple[str, str], ...]            # zóna, text
    offsets: str


def zones_blocks(z: ZonesDoc, story: Story) -> tuple:
    return (
        H("Identifikace"),
        KV("ID:", z.pid),
        KV("Věk:", f"{age_at(story.birth, z.date)} let"),
        KV("Pohlaví:", "muž" if story.sex == "m" else "žena"),
        KV("Výška / hmotnost:", f"{z.height} / {z.weight}"),
        KV("Datum testu:", z.test_dt),
        KV("Doba trvání zátěže:", z.duration),
        KV("Zátěžový protokol:", z.protocol),
        KV("Sport:", z.sport),
        H("Pásma tepové frekvence"),
        TBL(("Pásmo", "TF (/min)", "v (km/h)", "V'O₂ (l/min)", "% VO₂max"),
            (0, 170, 260, 350, 440), z.rows),
        GAP(6),
        P("Uvedené hodnoty tepové frekvence upravte podle sportovní aktivity, "
          "kterou budete provádět, přičtením nebo odečtením uvedeného počtu "
          "úderů za minutu:"),
        P(z.offsets),
        BREAK,
        H("Charakteristika pásem"),
        *[b for zone, text in z.narratives
          for b in (H(zone), P(text))],
    )


# --- sport: the athletes -----------------------------------------------------
# VO₂max, ventilatory thresholds and spirometry are invented, but invented
# consistently: a value belongs to one athlete's physiology and follows the arc
# their lab work already tells. Hrubý's aerobic capacity falls as his iron
# stores empty; Šebestová's rises as hers refill.

EVALS: tuple[Eval, ...] = (
    Eval(
        did="d-hruby-prohlidka-2024", pid="p-hruby-1994", date="2024-03-09",
        physician="MUDr. Pavla Hejduková",
        height="178 cm", weight="66 kg", bp="118/72 mmHg", rest_hr="44/min",
        ra="bez kardiovaskulární zátěže, náhlé úmrtí v rodině neguje.",
        oa="běžná dětská onemocnění; 2019 stresová fraktura II. metatarzu vpravo, "
           "zhojena bez následků; operace 0; alergie 0; trvalá medikace 0.",
        sa="atletika od 12 let, od 2018 maraton; roční objem 5 500 km, "
           "v přípravě 110–140 km týdně, 2 intenzivní jednotky týdně.",
        na="hořčík, vitamin D v zimním období.",
        subjective="Bez obtíží. Trénink podle plánu, regenerace subjektivně "
                   "dostatečná, spánek 7–8 hodin. Bez dušnosti, bez palpitací, "
                   "bez stenokardií při zátěži.",
        objective="Eupnoe, klidně, bez cyanózy. Štítná žláza nehmatná, na "
                  "karotidách bez šelestu. Dýchání sklípkové, čisté. Ozvy "
                  "ohraničené, akce pravidelná, bez šelestu. Břicho měkké, "
                  "nebolestivé, játra nezvětšena. Periferní pulzace hmatné, "
                  "dolní končetiny bez otoků.",
        ekg_rest="sinusová bradykardie 44/min, elektrická osa 75°, PR 168 ms, "
                 "QRS 96 ms, QTc 396 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 189/min, bez arytmií, bez ischemických "
                 "změn ST-T, přiměřená reakce TK.",
        protocol="běh na pásu, sklon 1 %, start 10 km/h, +0,5 km/h po 60 s, do vyčerpání",
        spiro=(("FVC (l)", "6,10", "112"),
               ("FEV1 (l)", "5,02", "114"),
               ("FEV1/FVC — Tiffeneaův index (%)", "82", "101"),
               ("PEF (l/s)", "11,4", "108")),
        ergo=(("Rychlost (km/h)", "14,5", "16,8", "19,6"),
              ("Tepová frekvence (/min)", "156", "176", "189"),
              ("VO₂ (ml/kg/min)", "48,2", "58,1", "68,4"),
              ("VO₂ (l/min)", "3,18", "3,83", "4,51"),
              ("RER", "0,91", "0,99", "1,12"),
              ("Ventilace (l/min)", "96", "128", "172"),
              ("Dechová frekvence (/min)", "38", "46", "58"),
              ("Laktát (mmol/l)", "1,6", "3,9", "11,8")),
        conclusion=(
            "Zátěžové vyšetření bez patologického nálezu na EKG i v reakci "
            "krevního tlaku. VO₂max 68,4 ml/kg/min (4,51 l/min) odpovídá "
            "trénovanému vytrvalci, proti loňskému vyšetření beze změny.",
            "Spirometrie nadprůměrná, bez známek obstrukce. Ventilační prahy "
            "leží vysoko, VT2 při 176/min, což při aktuálním objemu tréninku "
            "odpovídá dobře rozvinuté aerobní základně.",
            "Za pozornost stojí sestupný trend zásobního železa: S_Ferritin "
            "126 → 104 → 88 µg/l za tři odběry. Hodnota je zatím v referenčním "
            "rozmezí a krevní obraz je v normě, jde tedy o trend, nikoli o "
            "nález. Při současném objemu tréninku je vhodné jej sledovat.",
        ),
        recommendation=(
            "Sportu schopen bez omezení.",
            "Kontrolní odběr zásob železa za 6 měsíců, ideálně mimo období "
            "závodního zatížení a nejméně 48 hodin po intenzivní jednotce — "
            "S_Kreatinkináza po tvrdém tréninku sama o sobě nález netvoří.",
            "Objem v pásmech I1–I2 ponechat, počet jednotek v I4 nezvyšovat "
            "nad dvě týdně.",
        ),
        zones=(("I0 — regenerace", "do 138", "2–3"),
               ("I1 — základní vytrvalost", "138–150", "3–4"),
               ("I2 — vytrvalost", "150–162", "5–6"),
               ("I3 — tempo", "162–176", "6–7"),
               ("I4 — rozvoj VO₂max", "nad 176", "8–10")),
        quotes="2024-03-05",
    ),
    Eval(
        did="d-hruby-prohlidka-2026", pid="p-hruby-1994", date="2026-02-27",
        physician="MUDr. Pavla Hejduková",
        height="178 cm", weight="64 kg", bp="114/70 mmHg", rest_hr="46/min",
        ra="bez kardiovaskulární zátěže, náhlé úmrtí v rodině neguje.",
        oa="2019 stresová fraktura II. metatarzu vpravo, zhojena; operace 0; "
           "alergie 0; od 04/2025 přerušovaně perorální substituce železa, "
           "adherence podle pacienta kolísavá.",
        sa="maraton, roční objem 6 200 km, v přípravě 130–150 km týdně; "
           "podzimní závodní sezóna 2025 dokončena bez přerušení.",
        na="hořčík, vitamin D, perorální železo obden.",
        subjective="Poslední tři měsíce pociťuje horší toleranci intenzivních "
                   "jednotek, tempo v prahových úsecích subjektivně těžší při "
                   "stejné tepové frekvenci. Ranní tepová frekvence o 4–6 úderů "
                   "vyšší než obvykle. Bez dušnosti v klidu, bez palpitací.",
        objective="Eupnoe, kůže a spojivky bez výrazné bledosti. Štítná žláza "
                  "nehmatná. Dýchání sklípkové, čisté. Ozvy ohraničené, "
                  "pravidelné, bez šelestu. Břicho měkké, nebolestivé. "
                  "Dolní končetiny bez otoků.",
        ekg_rest="sinusová bradykardie 46/min, elektrická osa 78°, PR 172 ms, "
                 "QRS 98 ms, QTc 402 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 186/min, ojedinělé supraventrikulární "
                 "extrasystoly, bez ischemických změn ST-T.",
        protocol="běh na pásu, sklon 1 %, start 10 km/h, +0,5 km/h po 60 s, do vyčerpání",
        spiro=(("FVC (l)", "6,05", "111"),
               ("FEV1 (l)", "4,96", "113"),
               ("FEV1/FVC — Tiffeneaův index (%)", "82", "101"),
               ("PEF (l/s)", "11,1", "105")),
        ergo=(("Rychlost (km/h)", "13,9", "16,1", "18,9"),
              ("Tepová frekvence (/min)", "152", "172", "186"),
              ("VO₂ (ml/kg/min)", "45,1", "55,3", "64,8"),
              ("VO₂ (l/min)", "2,89", "3,54", "4,15"),
              ("RER", "0,93", "1,00", "1,14"),
              ("Ventilace (l/min)", "94", "126", "168"),
              ("Dechová frekvence (/min)", "39", "47", "60"),
              ("Laktát (mmol/l)", "1,8", "4,2", "9,4")),
        conclusion=(
            "VO₂max 64,8 ml/kg/min (4,15 l/min), tedy pokles o 3,6 "
            "ml/kg/min proti vyšetření z března 2024. EKG i reakce krevního "
            "tlaku zůstávají bez patologie, spirometrie beze změny — pokles "
            "tedy nemá ventilační ani kardiální vysvětlení.",
            "S_Ferritin 21 µg/l je pod dolní mezí referenčního rozmezí, "
            "S_Železo 8,1 µmol/l a S_Saturace Trf 13,9 % rovněž. "
            "B_Hemoglobin 136 g/l je zatím v rozmezí: jde o sideropenii bez "
            "anémie, čtvrtý sestupný odběr v řadě od roku 2023.",
            "Nález odpovídá vyčerpání zásob železa při dlouhodobě vysokém "
            "objemu tréninku. Subjektivně horší tolerance intenzity, vyšší "
            "ranní tepová frekvence a nižší maximální laktát tomu odpovídají.",
        ),
        recommendation=(
            "Substituce železa denně, kontrola S_Ferritin, S_Železo a krevního "
            "obrazu za 8 týdnů. Při nedostatečné odpovědi zvážit vyšetření "
            "vstřebávání a zdroje ztrát.",
            "Do kontroly redukovat týdenní objem o 25 % a vypustit jednotky v "
            "pásmu I4; ponechat jednu tempovou jednotku týdně.",
            "Tréninková pásma přepočítána podle dnešního testu, viz samostatný "
            "protokol.",
        ),
        zones=(("I0 — regenerace", "do 136", "2–3"),
               ("I1 — základní vytrvalost", "136–148", "3–4"),
               ("I2 — vytrvalost", "148–158", "5–6"),
               ("I3 — tempo", "158–172", "6–7"),
               ("I4 — rozvoj VO₂max", "nad 172", "8–10")),
        quotes="2026-02-24",
    ),
    Eval(
        did="d-palan-prohlidka-2024", pid="p-palan-1997", date="2024-07-12",
        physician="MUDr. Radek Šimáně",
        height="182 cm", weight="73 kg", bp="122/76 mmHg", rest_hr="46/min",
        ra="otec hypertenze od 55 let, jinak bez kardiovaskulární zátěže.",
        oa="2017 fraktura klíční kosti vlevo po pádu, zhojena konzervativně; "
           "operace 0; alergie na pyl břízy; trvalá medikace 0.",
        sa="silniční cyklistika, 12. sezóna; roční objem 18 000 km; "
           "3 týdny soustředění ve výšce 2 100 m ukončeno 6. 7. 2024.",
        na="hořčík, sacharidové nápoje v tréninku.",
        subjective="Dva dny po návratu z výškového soustředění. Subjektivně bez "
                   "obtíží, spánek na horách zpočátku horší, poslední týden "
                   "dobrý. Bez dušnosti, bez palpitací.",
        objective="Eupnoe, bez cyanózy. Štítná žláza nehmatná, karotidy bez "
                  "šelestu. Dýchání sklípkové. Ozvy ohraničené, akce "
                  "pravidelná. Břicho měkké, nebolestivé. Dolní končetiny bez "
                  "otoků, bez známek žilní trombózy.",
        ekg_rest="sinusová bradykardie 46/min, elektrická osa 62°, PR 158 ms, "
                 "QRS 94 ms, QTc 388 ms, vysoké voltáže QRS v hrudních svodech.",
        ekg_load="sinusový rytmus do 191/min, bez arytmií, bez ischemických změn.",
        protocol="bicyklová ergometrie, start 100 W, +25 W po 60 s, do vyčerpání",
        spiro=(("FVC (l)", "6,42", "115"),
               ("FEV1 (l)", "5,28", "117"),
               ("FEV1/FVC — Tiffeneaův index (%)", "82", "102"),
               ("PEF (l/s)", "11,8", "110")),
        ergo=(("Výkon (W)", "258", "352", "445"),
              ("Tepová frekvence (/min)", "154", "174", "191"),
              ("VO₂ (ml/kg/min)", "50,3", "62,4", "71,5"),
              ("VO₂ (l/min)", "3,67", "4,56", "5,22"),
              ("RER", "0,90", "0,99", "1,15"),
              ("Ventilace (l/min)", "104", "141", "186"),
              ("Dechová frekvence (/min)", "36", "44", "56"),
              ("Laktát (mmol/l)", "1,5", "4,1", "13,2")),
        conclusion=(
            "VO₂max 71,5 ml/kg/min (5,22 l/min) při maximálním výkonu "
            "445 W, tedy nejvyšší hodnota od začátku sledování. EKG i reakce "
            "krevního tlaku fyziologické.",
            "Krevní obraz odpovídá dvěma dnům po sestupu z výšky: "
            "B_Hemoglobin 166 g/l, B_Hematokrit 0,492 a B_Erytrocyty "
            "5,44 10^12/l jsou nad horní mezí, vzestup proti květnovému "
            "odběru je konzistentní s hematologickou odpovědí na hypoxii, "
            "nikoli s patologií.",
            "S_Ferritin 52 µg/l proti 88 µg/l v květnu — zásoby byly z části "
            "spotřebovány na tvorbu erytrocytů. Hodnota zůstává v rozmezí.",
        ),
        recommendation=(
            "Sportu schopen bez omezení. Očekávaný návrat hematokritu k "
            "výchozím hodnotám během 3–4 týdnů.",
            "Perorální substituce železa po dobu 8 týdnů, kontrolní odběr "
            "S_Ferritin na podzim.",
            "Dbát na hydrataci v prvním týdnu po sestupu.",
        ),
        zones=(("I0 — regenerace", "do 132", "2–3"),
               ("I1 — základní vytrvalost", "132–146", "3–4"),
               ("I2 — vytrvalost", "146–158", "5–6"),
               ("I3 — tempo", "158–174", "6–7"),
               ("I4 — rozvoj VO₂max", "nad 174", "8–10")),
        quotes="2024-07-09",
    ),
    Eval(
        did="d-palan-prohlidka-2025", pid="p-palan-1997", date="2025-05-22",
        physician="MUDr. Radek Šimáně",
        height="182 cm", weight="72 kg", bp="120/74 mmHg", rest_hr="48/min",
        ra="otec hypertenze od 55 let, jinak bez kardiovaskulární zátěže.",
        oa="2017 fraktura klíční kosti vlevo, zhojena; operace 0; alergie na "
           "pyl břízy; trvalá medikace 0.",
        sa="silniční cyklistika; roční objem 17 000 km, letos bez výškového "
           "soustředění.",
        na="hořčík, sacharidové nápoje v tréninku.",
        subjective="Bez obtíží, příprava podle plánu. Sezónní alergická rýma "
                   "v dubnu, nyní odezněla.",
        objective="Eupnoe, bez cyanózy. Dýchání sklípkové, čisté. Ozvy "
                  "ohraničené, akce pravidelná, bez šelestu. Břicho měkké. "
                  "Dolní končetiny bez otoků.",
        ekg_rest="sinusová bradykardie 48/min, elektrická osa 64°, PR 156 ms, "
                 "QRS 96 ms, QTc 390 ms.",
        ekg_load="sinusový rytmus do 189/min, bez arytmií, bez ischemických změn.",
        protocol="bicyklová ergometrie, start 100 W, +25 W po 60 s, do vyčerpání",
        spiro=(("FVC (l)", "6,38", "114"),
               ("FEV1 (l)", "5,21", "116"),
               ("FEV1/FVC — Tiffeneaův index (%)", "82", "102"),
               ("PEF (l/s)", "11,6", "108")),
        ergo=(("Výkon (W)", "252", "344", "432"),
              ("Tepová frekvence (/min)", "152", "172", "189"),
              ("VO₂ (ml/kg/min)", "49,1", "60,8", "69,8"),
              ("VO₂ (l/min)", "3,54", "4,38", "5,03"),
              ("RER", "0,91", "0,98", "1,14"),
              ("Ventilace (l/min)", "101", "138", "181"),
              ("Dechová frekvence (/min)", "35", "43", "55"),
              ("Laktát (mmol/l)", "1,4", "3,8", "12,4")),
        conclusion=(
            "VO₂max 69,8 ml/kg/min (5,03 l/min), maximální výkon 432 W — "
            "proti loňskému vyšetření po výškovém soustředění o 1,7 ml/kg/min "
            "níže, což odpovídá letošní přípravě bez pobytu ve výšce.",
            "Krevní obraz se vrátil k výchozím hodnotám: B_Hemoglobin 150 g/l, "
            "B_Hematokrit 0,446. S_Ferritin 79 µg/l po loňské substituci.",
            "EKG bez patologie, spirometrie beze změny.",
        ),
        recommendation=(
            "Sportu schopen bez omezení.",
            "Kontrola za 12 měsíců, při plánovaném výškovém soustředění odběr "
            "před odjezdem a do tří dnů po návratu.",
        ),
        zones=(("I0 — regenerace", "do 130", "2–3"),
               ("I1 — základní vytrvalost", "130–144", "3–4"),
               ("I2 — vytrvalost", "144–156", "5–6"),
               ("I3 — tempo", "156–172", "6–7"),
               ("I4 — rozvoj VO₂max", "nad 172", "8–10")),
        quotes="2025-05-19",
    ),
    Eval(
        did="d-sebestova-prohlidka-2024", pid="p-sebestova-1999",
        date="2024-03-01", physician="MUDr. Pavla Hejduková",
        height="170 cm", weight="57 kg", bp="108/68 mmHg", rest_hr="62/min",
        ra="matka anémie v graviditě, jinak bez zátěže.",
        oa="běžná dětská onemocnění; operace 0; alergie 0; menstruační cyklus "
           "pravidelný, krvácení silnější.",
        sa="triatlon, 6. sezóna, 14–18 hodin tréninku týdně ve třech "
           "disciplínách.",
        na="v posledním roce bez doplňků.",
        subjective="Od podzimu narůstající únava, zhoršená tolerance zátěže, "
                   "v běžeckých jednotkách nedosahuje obvyklých temp. "
                   "Občasné bušení srdce při rychlejším rozběhnutí, "
                   "bez dušnosti v klidu.",
        objective="Bledší kůže a spojivky. Eupnoe. Štítná žláza nehmatná. "
                  "Dýchání sklípkové, čisté. Ozvy ohraničené, akce pravidelná, "
                  "nad hrotem tichý systolický šelest charakteru akcidentálního. "
                  "Břicho měkké, nebolestivé. Dolní končetiny bez otoků.",
        ekg_rest="sinusový rytmus 62/min, elektrická osa 68°, PR 148 ms, "
                 "QRS 88 ms, QTc 408 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 192/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 8 km/h, +0,5 km/h po 60 s, do vyčerpání",
        spiro=(("FVC (l)", "4,42", "108"),
               ("FEV1 (l)", "3,71", "110"),
               ("FEV1/FVC — Tiffeneaův index (%)", "84", "102"),
               ("PEF (l/s)", "8,2", "104")),
        ergo=(("Rychlost (km/h)", "11,2", "13,0", "15,4"),
              ("Tepová frekvence (/min)", "158", "178", "192"),
              ("VO₂ (ml/kg/min)", "36,8", "45,9", "52,1"),
              ("VO₂ (l/min)", "2,10", "2,62", "2,97"),
              ("RER", "0,95", "1,02", "1,16"),
              ("Ventilace (l/min)", "68", "92", "118"),
              ("Dechová frekvence (/min)", "40", "48", "62"),
              ("Laktát (mmol/l)", "2,1", "4,4", "9,8")),
        conclusion=(
            "VO₂max 52,1 ml/kg/min (2,97 l/min) je pro trénovanou "
            "triatlonistku hodnota výrazně pod očekáváním. Zátěž ukončena pro "
            "vyčerpání při relativně nízkém maximálním laktátu.",
            "Laboratorně sideropenická anémie: B_Hemoglobin 106 g/l, "
            "B_Hematokrit 0,322, B_Erytrocyty 3,62 10^12/l, S_Ferritin 6 µg/l, "
            "S_Železo 4,8 µmol/l, S_Saturace Trf 8,4 %. Nález plně vysvětluje "
            "jak subjektivní obtíže, tak omezenou aerobní kapacitu.",
            "EKG v klidu i při zátěži bez patologie, šelest odpovídá "
            "hyperkinetické cirkulaci při anémii.",
        ),
        recommendation=(
            "Dočasné omezení tréninku: vypustit všechny jednotky v pásmech "
            "I3 a I4, ponechat objem v I1 podle tolerance.",
            "Perorální substituce železa, doplnit vyšetření zdroje ztrát a "
            "gynekologické vyšetření.",
            "Kontrolní krevní obraz a zásoby železa za 10 týdnů, kontrolní "
            "zátěžové vyšetření po normalizaci hemoglobinu.",
        ),
        zones=(("I0 — regenerace", "do 138", "2–3"),
               ("I1 — základní vytrvalost", "138–152", "3–4"),
               ("I2 — vytrvalost", "152–164", "5–6"),
               ("I3 — tempo (nyní vynechat)", "164–178", "6–7"),
               ("I4 — rozvoj VO₂max (nyní vynechat)", "nad 178", "8–10")),
        quotes="2024-02-27",
    ),
    Eval(
        did="d-sebestova-prohlidka-2025", pid="p-sebestova-1999",
        date="2025-06-13", physician="MUDr. Pavla Hejduková",
        height="170 cm", weight="58 kg", bp="112/70 mmHg", rest_hr="54/min",
        ra="matka anémie v graviditě, jinak bez zátěže.",
        oa="sideropenická anémie 02/2024, od té doby substituce železa; "
           "gynekologické vyšetření 2024 bez patologického nálezu; operace 0.",
        sa="triatlon, plný tréninkový objem od 01/2025, 16 hodin týdně.",
        na="perorální železo, vitamin C, hořčík.",
        subjective="Bez obtíží. Od jara subjektivně výrazné zlepšení tolerance "
                   "zátěže, běžecká tempa na úrovni sezóny 2023. Bez palpitací.",
        objective="Kůže a spojivky normální barvy. Eupnoe. Dýchání sklípkové. "
                  "Ozvy ohraničené, akce pravidelná, dříve popsaný systolický "
                  "šelest neslyšný. Břicho měkké. Dolní končetiny bez otoků.",
        ekg_rest="sinusový rytmus 54/min, elektrická osa 66°, PR 152 ms, "
                 "QRS 90 ms, QTc 400 ms.",
        ekg_load="sinusový rytmus do 190/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 8 km/h, +0,5 km/h po 60 s, do vyčerpání",
        spiro=(("FVC (l)", "4,48", "109"),
               ("FEV1 (l)", "3,76", "111"),
               ("FEV1/FVC — Tiffeneaův index (%)", "84", "102"),
               ("PEF (l/s)", "8,4", "106")),
        ergo=(("Rychlost (km/h)", "12,6", "14,4", "16,8"),
              ("Tepová frekvence (/min)", "156", "176", "190"),
              ("VO₂ (ml/kg/min)", "41,4", "51,8", "58,6"),
              ("VO₂ (l/min)", "2,40", "3,00", "3,40"),
              ("RER", "0,92", "1,00", "1,17"),
              ("Ventilace (l/min)", "74", "101", "132"),
              ("Dechová frekvence (/min)", "38", "46", "60"),
              ("Laktát (mmol/l)", "1,7", "4,0", "11,6")),
        conclusion=(
            "VO₂max 58,6 ml/kg/min (3,40 l/min), tedy vzestup o 6,5 "
            "ml/kg/min proti vyšetření z března 2024. Maximální laktát 11,6 "
            "mmol/l svědčí pro plnou schopnost dosáhnout maximální zátěže.",
            "Laboratorně úprava: B_Hemoglobin 131 g/l, S_Ferritin 44 µg/l, "
            "S_Saturace Trf 27,3 % — všechny v referenčním rozmezí. Vzestup je "
            "plynulý přes všech pět odběrů od února 2024.",
            "Klinicky i funkčně stav odpovídá doléčené sideropenické anémii.",
        ),
        recommendation=(
            "Sportu schopna bez omezení, plná tréninková zátěž včetně pásem "
            "I3 a I4.",
            "V substituci železa pokračovat do konce sezóny, poté kontrola "
            "S_Ferritin a rozhodnutí o vysazení.",
            "Kontrolní odběr 2× ročně, vzhledem k anamnéze trvale.",
        ),
        zones=(("I0 — regenerace", "do 136", "2–3"),
               ("I1 — základní vytrvalost", "136–150", "3–4"),
               ("I2 — vytrvalost", "150–162", "5–6"),
               ("I3 — tempo", "162–176", "6–7"),
               ("I4 — rozvoj VO₂max", "nad 176", "8–10")),
        quotes="2025-06-10",
    ),
    Eval(
        did="d-krizak-prohlidka-2025", pid="p-krizak-1991", date="2025-05-30",
        physician="MUDr. Tereza Malíková",
        height="180 cm", weight="75 kg", bp="124/78 mmHg", rest_hr="48/min",
        ra="bez kardiovaskulární zátěže.",
        oa="běžná dětská onemocnění; 2016 artroskopie pravého kolena pro lézi "
           "menisku, bez následků; alergie 0; trvalá medikace 0.",
        sa="běh na lyžích, závodně od 14 let; letní příprava kolo, běh, "
           "kolečkové lyže, 12–16 hodin týdně.",
        na="vitamin D v zimním období.",
        subjective="Bez obtíží, sezóna dokončena bez přerušení, bez úrazu.",
        objective="Eupnoe. Štítná žláza nehmatná, karotidy bez šelestu. "
                  "Dýchání sklípkové, čisté. Ozvy ohraničené, akce pravidelná, "
                  "bez šelestu. Břicho měkké, nebolestivé. Dolní končetiny bez "
                  "otoků, jizva po artroskopii klidná.",
        ekg_rest="sinusová bradykardie 48/min, elektrická osa 70°, PR 160 ms, "
                 "QRS 94 ms, QTc 394 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 187/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 10 km/h, +0,5 km/h po 60 s, do vyčerpání",
        spiro=(("FVC (l)", "6,24", "113"),
               ("FEV1 (l)", "5,10", "115"),
               ("FEV1/FVC — Tiffeneaův index (%)", "82", "101"),
               ("PEF (l/s)", "11,2", "107")),
        ergo=(("Rychlost (km/h)", "14,0", "16,2", "19,0"),
              ("Tepová frekvence (/min)", "154", "173", "187"),
              ("VO₂ (ml/kg/min)", "46,8", "57,0", "66,2"),
              ("VO₂ (l/min)", "3,51", "4,28", "4,97"),
              ("RER", "0,92", "0,99", "1,13"),
              ("Ventilace (l/min)", "99", "133", "176"),
              ("Dechová frekvence (/min)", "37", "45", "57"),
              ("Laktát (mmol/l)", "1,5", "4,0", "12,1")),
        conclusion=(
            "VO₂max 66,2 ml/kg/min (4,97 l/min), proti loňskému vyšetření "
            "beze změny. EKG v klidu i při zátěži bez patologického nálezu, "
            "reakce krevního tlaku fyziologická.",
            "Krevní obraz i biochemie v referenčním rozmezí, S_Ferritin "
            "120 µg/l, zásoby železa stabilní ve všech čtyřech odběrech.",
            "Bez klinického i laboratorního nálezu.",
        ),
        recommendation=(
            "Sportu schopen bez omezení, bez zvláštních doporučení.",
            "Kontrola za 12 měsíců.",
        ),
        zones=(("I0 — regenerace", "do 134", "2–3"),
               ("I1 — základní vytrvalost", "134–148", "3–4"),
               ("I2 — vytrvalost", "148–160", "5–6"),
               ("I3 — tempo", "160–173", "6–7"),
               ("I4 — rozvoj VO₂max", "nad 173", "8–10")),
        quotes="2025-05-27",
    ),
    Eval(
        did="d-bartonova-prohlidka-2026", pid="p-bartonova-2001",
        date="2026-01-16", physician="MUDr. Radek Šimáně",
        height="174 cm", weight="65 kg", bp="112/70 mmHg", rest_hr="56/min",
        ra="bez kardiovaskulární zátěže.",
        oa="běžná dětská onemocnění; 2019 tonzilektomie; alergie 0; "
           "trvalá medikace 0.",
        sa="plavání, závodně od 9 let, kraul střední tratě; 8 tréninkových "
           "jednotek ve vodě týdně, 3 jednotky suché přípravy.",
        na="vitamin D.",
        subjective="Vstupní sportovní prohlídka, bez obtíží. Bez dušnosti, "
                   "bez palpitací, bez synkop v anamnéze.",
        objective="Eupnoe. Štítná žláza nehmatná. Dýchání sklípkové, čisté. "
                  "Ozvy ohraničené, akce pravidelná, bez šelestu. Břicho "
                  "měkké, nebolestivé. Dolní končetiny bez otoků. "
                  "Ramenní pletence bez omezení hybnosti.",
        ekg_rest="sinusový rytmus 56/min, elektrická osa 74°, PR 146 ms, "
                 "QRS 88 ms, QTc 404 ms, bez repolarizačních změn.",
        ekg_load="sinusový rytmus do 194/min, bez arytmií, bez ischemických změn.",
        protocol="běh na pásu, sklon 1 %, start 8 km/h, +0,5 km/h po 60 s, do vyčerpání",
        spiro=(("FVC (l)", "4,85", "118"),
               ("FEV1 (l)", "4,02", "119"),
               ("FEV1/FVC — Tiffeneaův index (%)", "83", "101"),
               ("PEF (l/s)", "8,9", "110")),
        ergo=(("Rychlost (km/h)", "11,8", "13,6", "16,0"),
              ("Tepová frekvence (/min)", "160", "180", "194"),
              ("VO₂ (ml/kg/min)", "39,2", "48,6", "55,4"),
              ("VO₂ (l/min)", "2,55", "3,16", "3,60"),
              ("RER", "0,94", "1,01", "1,15"),
              ("Ventilace (l/min)", "76", "104", "136"),
              ("Dechová frekvence (/min)", "39", "47", "61"),
              ("Laktát (mmol/l)", "1,9", "4,3", "11,2")),
        conclusion=(
            "Vstupní vyšetření bez patologického nálezu. VO₂max 55,4 "
            "ml/kg/min (3,60 l/min) na běžeckém pásu; u plavkyně jde o hodnotu "
            "podhodnocenou proti specifické zátěži ve vodě a slouží jako "
            "výchozí bod pro další sledování.",
            "Spirometrie nadprůměrná, FVC 4,85 l odpovídá 118 % normy. "
            "Krevní obraz i zásoby železa v referenčním rozmezí, "
            "S_Ferritin 52 µg/l.",
            "Jde o první odběr, trend zatím nelze hodnotit.",
        ),
        recommendation=(
            "Sportu schopna bez omezení.",
            "Pro plavání odečíst od uvedených hodnot tepové frekvence "
            "20 úderů za minutu.",
            "Kontrolní odběr a zátěžové vyšetření za 12 měsíců.",
        ),
        zones=(("I0 — regenerace", "do 140", "2–3"),
               ("I1 — základní vytrvalost", "140–154", "3–4"),
               ("I2 — vytrvalost", "154–166", "5–6"),
               ("I3 — tempo", "166–180", "6–7"),
               ("I4 — rozvoj VO₂max", "nad 180", "8–10")),
        quotes="2026-01-13",
    ),
)

ZONES: tuple[ZonesDoc, ...] = (
    ZonesDoc(
        did="d-hruby-pasma-2026", pid="p-hruby-1994", date="2026-03-03",
        physician="MUDr. Pavla Hejduková",
        height="178 cm", weight="64 kg",
        test_dt="27. 2. 2026, 9:40", duration="0:14:20",
        protocol="běh na pásu, sklon 1 %, start 10 km/h, +0,5 km/h po 60 s",
        sport="běh",
        rows=(
            ("E — maximální intenzita", "nad 178", "nad 17,6", "nad 3,95", "nad 97 %"),
            ("D — rozvojová oblast", "169–178", "15,6–17,6", "3,60–3,95", "89–97 %"),
            ("C — krátkodobá vytrvalost", "158–169", "13,9–15,6", "3,15–3,60", "78–89 %"),
            ("B — dlouhodobá vytrvalost", "148–158", "12,4–13,9", "2,70–3,15", "67–78 %"),
            ("A — kompenzace", "pod 148", "pod 12,4", "pod 2,70", "pod 67 %"),
        ),
        narratives=(
            ("E — maximální intenzita",
             "Krátké úseky na hranici maximální spotřeby kyslíku. Rozvíjí "
             "rychlostní vytrvalost a schopnost pracovat v kyslíkovém dluhu. "
             "Vzhledem k aktuálnímu nálezu vyčerpaných zásob železa doporučuji "
             "toto pásmo do kontrolního odběru zcela vynechat."),
            ("D — rozvojová oblast",
             "Intenzita nad druhým ventilačním prahem. Typicky intervalové "
             "jednotky v délce 3–8 minut. Energie je hrazena převážně "
             "sacharidy, nároky na regeneraci jsou vysoké — nejvýše jedna "
             "jednotka týdně."),
            ("C — krátkodobá vytrvalost",
             "Pásmo mezi prvním a druhým ventilačním prahem, tempové běhy a "
             "delší intervaly. Rozvíjí schopnost udržet vysoký podíl "
             "maximální spotřeby kyslíku po dlouhou dobu."),
            ("B — dlouhodobá vytrvalost",
             "Základní vytrvalostní pásmo kolem prvního ventilačního prahu. "
             "Subjektivně mírná až středně namáhavá zátěž, souvislé běhy "
             "v délce 60–120 minut. Spolu s pásmem A tvoří většinu týdenního "
             "objemu."),
            ("A — kompenzace",
             "Velmi nízká intenzita pro rozklusání, vyklusání a regeneraci po "
             "závodě nebo intenzivní jednotce. Zátěž má být uvolněná; lze ji "
             "nahradit jiným sportem, například volným plaváním nebo kolem."),
        ),
        offsets="−10 pro cyklistiku, −5 pro chůzi, −20 pro plavání.",
    ),
)


# --- orto: narrative documents -----------------------------------------------
ORTO_DOCS: tuple[Document, ...] = (
    Document(
        did="d-novak63-rtg-2025", pid="p-novak-1963", date="2025-01-09",
        kind="imaging", title="RTG kyčelních kloubů — popis",
        clinic=ORTO_CLINIC, dept=ORTO_RTG_DEPT,
        date_label="Datum vyšetření", author_label="Popsal",
        author="MUDr. Eva Puchmertlová",
        blocks=(
            H("Provedené vyšetření"),
            KV("Technika:", "RTG pánve předozadně ve stoje, doplněn axiální "
                            "snímek levého kyčelního kloubu."),
            KV("Indikace:", "bolesti levé kyčle s propagací do třísla a stehna, "
                            "klaudikační interval pod 300 m, konzervativní "
                            "terapie bez efektu."),
            H("Popis"),
            P("Vlevo je kloubní štěrbina zúžená na 1 mm v horní zátěžové zóně, "
              "se subchondrální sklerózou stropu acetabula i hlavice. Na okraji "
              "hlavice a při okraji acetabula jsou patrné osteofyty, "
              "největší laterálně, velikosti 6 mm. V hlavici je cystické "
              "projasnění průměru 8 mm. Tvar hlavice je oploštělý, "
              "centrace zachována."),
            P("Vpravo je kloubní štěrbina zachovalá, výšky 3,5 mm, "
              "s naznačenou subchondrální sklerózou stropu acetabula, "
              "bez osteofytů a bez cyst."),
            P("Kostní struktura přiměřená věku, bez ložiskových změn. "
              "Symfýza a sakroiliakální skloubení bez patologie. "
              "Měkké tkáně bez kalcifikací."),
            H("Závěr"),
            P("Pokročilá koxartróza vlevo (odpovídá stupni III–IV), "
              "počínající degenerativní změny vpravo. Nález na levé straně "
              "koreluje s klinickými obtížemi a je indikací k totální "
              "endoprotéze."),
        ),
    ),
    Document(
        did="d-novak63-operace-2025", pid="p-novak-1963", date="2025-02-03",
        kind="op_report",
        title="Operační protokol — TEP levého kyčelního kloubu",
        clinic=ORTO_CLINIC, dept=ORTO_SURG_DEPT,
        date_label="Datum výkonu", author_label="Operatér",
        author="MUDr. Kamil Brandejs",
        blocks=(
            H("Základní údaje"),
            KV("Diagnóza:", "primární koxartróza vlevo, pokročilý stupeň."),
            KV("Výkon:", "totální endoprotéza levého kyčelního kloubu, "
                         "necementovaná."),
            KV("Anestezie:", "spinální, sedace."),
            KV("Asistence:", "MUDr. Vít Pospíchal"),
            KV("Poloha:", "na pravém boku, standardní fixace pánve."),
            KV("Antibiotická profylaxe:", "podána 30 minut před incizí, "
                                          "jedna dávka."),
            H("Popis výkonu"),
            P("Anterolaterální přístup v délce 12 cm. Protětí podkoží a fascie, "
              "šetrné odtažení gluteální muskulatury. Kloubní pouzdro T-tvarem "
              "protnuto, hlavice luxována. Kloubní chrupavka acetabula "
              "prakticky vymizelá, na hlavici mnohočetné osteofyty odpovídající "
              "předoperačnímu snímku."),
            P("Osteotomie krčku podle předoperačního plánování, "
              "1 cm nad malým trochanterem. Postupné frézování acetabula do "
              "velikosti 52 mm, zachována subchondrální kost. Zavedena "
              "necementovaná jamka 52 mm v inklinaci 42° a anteverzi 15°, "
              "primární stabilita dobrá, bez nutnosti doplňkové fixace šroubem. "
              "Vložka polyetylenová."),
            P("Femorální kanál postupně rozšířen rašplemi do velikosti 5. "
              "Zkušební repozice s krčkem střední délky — rozsah pohybu volný, "
              "bez impingementu, délka končetin vyrovnaná, stabilita v addukci "
              "i zevní rotaci dobrá. Zaveden definitivní necementovaný dřík "
              "velikosti 5, nasazena keramická hlavice 32 mm, repozice."),
            P("Výplach, kontrola hemostázy, Redonův drén do rány. "
              "Sutura pouzdra, fascie a podkoží po vrstvách, "
              "intradermální sutura kůže, krytí."),
            H("Průběh a bezprostřední pooperační období"),
            KV("Doba výkonu:", "68 minut."),
            KV("Krevní ztráta:", "cca 350 ml, bez podání krevního převodu."),
            KV("Komplikace:", "v průběhu výkonu žádné."),
            KV("Pooperační plán:", "nízkomolekulární heparin 35 dní, "
                                   "drén ex 1. pooperační den, vertikalizace "
                                   "1. pooperační den, chůze o dvou "
                                   "francouzských holích s částečnou zátěží "
                                   "operované končetiny, ambulantní "
                                   "rehabilitace od 3. týdne, "
                                   "kontrola za 6 týdnů."),
            H("Kontrolní laboratoř 3. pooperační den"),
            P("Odběr 6. 2. 2025: B_Hemoglobin 104 g/l, B_Hematokrit 0,311, "
              "B_Leukocyty 11,80 10^9/l, B_Trombocyty 402 10^9/l, "
              "S_CRP 78,4 mg/l. Pokles hemoglobinu i vzestup zánětlivých "
              "parametrů odpovídají rozsahu výkonu a třetímu pooperačnímu dni, "
              "rána je klidná, bez sekrece. Bez indikace k transfuzi, "
              "doporučena perorální substituce železa a kontrolní odběr "
              "při ambulantní kontrole."),
        ),
    ),
    Document(
        did="d-novak63-fyzio-2025a", pid="p-novak-1963", date="2025-02-17",
        kind="physio_note", title="Záznam z fyzioterapie",
        clinic=ORTO_CLINIC, dept=ORTO_PHYSIO_DEPT,
        date_label="Datum terapie", author_label="Terapeut",
        author="Bc. Lenka Zemanová",
        blocks=(
            KV("Diagnóza:", "stav po TEP levého kyčelního kloubu 3. 2. 2025, "
                            "14. pooperační den."),
            KV("Návštěva:", "1. ze série 10."),
            H("Subjektivně"),
            P("Bolest v okolí jizvy při chůzi, v noci klid. Chůze o dvou "
              "francouzských holích zvládá po bytě, schody zatím s dopomocí "
              "manželky. Obává se plné zátěže operované končetiny."),
            KV("Bolest (VAS):", "4/10 při zátěži, 1/10 v klidu."),
            H("Objektivně"),
            P("Jizva klidná, bez sekrece, mírně oteklé okolí. Flexe levé kyčle "
              "aktivně 75°, pasivně 85°. Abdukce 20°. Zevní rotace omezena "
              "bolestí. Trendelenburgův příznak vlevo pozitivní. "
              "Obvod stehna 15 cm nad patellou vlevo o 2,5 cm menší než vpravo."),
            H("Terapie"),
            P("Měkké techniky v okolí jizvy, lymfatické techniky na stehno. "
              "Izometrická aktivace gluteálních svalů a kvadricepsu, "
              "3 série po 10 opakováních. Nácvik chůze o dvou holích "
              "s částečnou zátěží 30 kg, kontrola na váze. Nácvik chůze do "
              "schodů a ze schodů."),
            H("Plán"),
            P("Domácí cvičební jednotka 2× denně, izometrie a aktivní pohyb do "
              "flexe do hranice bolesti. Dodržovat zákaz flexe nad 90°, "
              "addukce přes střední čáru a vnitřní rotace do 6 týdnů od "
              "operace. Kontrola za týden."),
        ),
    ),
    Document(
        did="d-novak63-fyzio-2025b", pid="p-novak-1963", date="2025-03-11",
        kind="physio_note", title="Záznam z fyzioterapie",
        clinic=ORTO_CLINIC, dept=ORTO_PHYSIO_DEPT,
        date_label="Datum terapie", author_label="Terapeut",
        author="Bc. Lenka Zemanová",
        blocks=(
            KV("Diagnóza:", "stav po TEP levého kyčelního kloubu 3. 2. 2025, "
                            "5. pooperační týden."),
            KV("Návštěva:", "5. ze série 10."),
            H("Subjektivně"),
            P("Zlepšení proti minulé návštěvě. Chůze o jedné holi venku "
              "do 20 minut, bez nutnosti odpočinku. Bolest jen po delší chůzi. "
              "Domácí cvičení provádí pravidelně."),
            KV("Bolest (VAS):", "2/10 po zátěži, 0/10 v klidu."),
            H("Objektivně"),
            P("Jizva zhojena, posunlivá. Otok stehna ustoupil. Flexe levé kyčle "
              "aktivně 95°, abdukce 30°. Trendelenburgův příznak vlevo jen "
              "naznačený. Obvod stehna vlevo o 1,5 cm menší než vpravo. "
              "Chůze o jedné holi se symetrickým krokem."),
            H("Terapie"),
            P("Posilování abduktorů v odlehčení a proti gravitaci, "
              "3 série po 12 opakováních. Aktivace hlubokého stabilizačního "
              "systému. Nácvik stoje na operované končetině s oporou, "
              "výdrž 3× 20 sekund. Rotoped 10 minut bez odporu."),
            H("Plán"),
            P("Odložit druhou hůl v průběhu příštího týdne, chůzi prodlužovat "
              "postupně. Rotoped denně 15 minut. Nadále bez flexe nad 90° při "
              "sedu na nízké židli. Kontrola za dva týdny."),
        ),
    ),
    Document(
        did="d-novak63-fyzio-2025c", pid="p-novak-1963", date="2025-04-15",
        kind="physio_note", title="Záznam z fyzioterapie — závěr série",
        clinic=ORTO_CLINIC, dept=ORTO_PHYSIO_DEPT,
        date_label="Datum terapie", author_label="Terapeut",
        author="Bc. Lenka Zemanová",
        blocks=(
            KV("Diagnóza:", "stav po TEP levého kyčelního kloubu 3. 2. 2025, "
                            "10. pooperační týden."),
            KV("Návštěva:", "10. ze série 10, závěrečná."),
            H("Subjektivně"),
            P("Bez bolestí při běžných denních činnostech. Chůze bez opory, "
              "venku i hodinu. Schody střídavým krokem. Vrátil se k práci "
              "na zahradě, delší práci v předklonu zatím nezkoušel."),
            KV("Bolest (VAS):", "1/10 po delší chůzi, jinak 0/10."),
            H("Objektivně"),
            P("Flexe levé kyčle aktivně 110°, abdukce 40°, zevní rotace volná. "
              "Trendelenburgův příznak negativní. Obvod stehna vlevo o 0,5 cm "
              "menší než vpravo. Stoj na jedné noze 20 sekund bez opory. "
              "Chůze bez antalgického vzorce."),
            H("Terapie"),
            P("Posilování abduktorů a extenzorů s odporovou gumou, "
              "senzomotorická cvičení na labilní ploše, korekce stereotypu "
              "chůze. Instruktáž autoterapie."),
            H("Plán"),
            P("Série ukončena, cíle dosaženy. Doporučeno pokračovat v domácím "
              "cvičení denně, plavání a rotoped bez omezení, chůze bez "
              "limitu. Doživotně se vyhnout nárazovým sportům a zvedání "
              "těžkých břemen v předklonu. Ortopedická kontrola za 6 měsíců."),
        ),
    ),
    Document(
        did="d-novak88-mr-2024", pid="p-novak-1988", date="2024-09-20",
        kind="imaging", title="MR pravého kolenního kloubu — popis",
        clinic=ORTO_CLINIC, dept=ORTO_RTG_DEPT,
        date_label="Datum vyšetření", author_label="Popsal",
        author="MUDr. Eva Puchmertlová",
        blocks=(
            H("Provedené vyšetření"),
            KV("Technika:", "MR pravého kolena 1,5 T, sekvence PD FS v rovině "
                            "sagitální, koronární a transverzální, T1 sagitálně, "
                            "bez podání kontrastní látky."),
            KV("Indikace:", "distorze kolena při fotbale 14. 9. 2024, "
                            "pocit nestability, výpotek."),
            H("Popis"),
            P("Přední zkřížený vaz není ve svém průběhu zobrazen v kontinuitě, "
              "v oblasti proximální třetiny je patrné přerušení vláken "
              "s edémem v okolí. Zbylá vlákna jsou horizontalizovaná. "
              "Nález odpovídá kompletní ruptuře."),
            P("Zadní zkřížený vaz intaktní, s fyziologickým signálem. "
              "Vnitřní i zevní postranní vaz bez známek léze."),
            P("Mediální meniskus: v zadním rohu horizontální linie zvýšeného "
              "signálu dosahující spodní kloubní plochy, odpovídá parciální "
              "lézi. Laterální meniskus bez léze."),
            P("Kostní kontuze laterálního femorálního kondylu a "
              "dorzolaterální části tibiálního plató — typická lokalizace pro "
              "mechanismus poranění předního zkříženého vazu. "
              "Chrupavka bez ložiskového defektu. V kloubu je výpotek "
              "středního rozsahu. Bakerova cysta se nezobrazuje."),
            H("Závěr"),
            P("Kompletní ruptura předního zkříženého vazu (LCA) pravého kolena, "
              "parciální léze zadního rohu mediálního menisku, kostní kontuze "
              "laterálního kondylu femuru, výpotek. Nález je indikací k "
              "plastice předního zkříženého vazu po odeznění otoku a obnovení "
              "rozsahu pohybu."),
        ),
    ),
    Document(
        did="d-novak88-operace-2024", pid="p-novak-1988", date="2024-10-08",
        kind="op_report",
        title="Operační protokol — artroskopická plastika LCA pravého kolena",
        clinic=ORTO_CLINIC, dept=ORTO_SURG_DEPT,
        date_label="Datum výkonu", author_label="Operatér",
        author="MUDr. Kamil Brandejs",
        blocks=(
            H("Základní údaje"),
            KV("Diagnóza:", "kompletní ruptura předního zkříženého vazu "
                            "pravého kolena, parciální léze mediálního menisku."),
            KV("Výkon:", "artroskopická plastika předního zkříženého vazu "
                         "štěpem ze šlach hamstringů, parciální meniscektomie."),
            KV("Anestezie:", "spinální, turniket na stehně 250 mmHg."),
            KV("Asistence:", "MUDr. Vít Pospíchal"),
            H("Popis výkonu"),
            P("Standardní anterolaterální a anteromediální porty. "
              "Diagnostická artroskopie: v kloubu mírný výpotek, "
              "synovie klidná. Přední zkřížený vaz zcela přerušen, "
              "pahýl resekován. Zadní zkřížený vaz intaktní. Chrupavka "
              "femuru i tibie bez defektu."),
            P("Zadní roh mediálního menisku s horizontální lézí "
              "nedosahující stabilní zóny — provedena šetrná parciální "
              "resekce nestabilní části, zbylý meniskus stabilní při palpaci "
              "háčkem. Laterální meniskus intaktní."),
            P("Odběr šlach musculus semitendinosus a gracilis z mediální "
              "incize, štěp složen na čtyři pruhy, průměr 8,5 mm, "
              "délka 90 mm, armován. Tibiální tunel vrtán pod úhlem 55°, "
              "femorální tunel technikou přes anteromediální port, "
              "délka 40 mm. Štěp protažen, femorálně fixován závěsným "
              "systémem, tibiálně interferenčním šroubem 9 mm při "
              "20° flexe a plné extenzi bez impingementu."),
            P("Kontrola rozsahu pohybu — plná extenze, flexe 130°, "
              "přední zásuvka negativní, Lachmanův test negativní. "
              "Výplach, drén nezaveden, sutura portů a odběrové incize."),
            H("Průběh a pooperační plán"),
            KV("Doba výkonu:", "82 minut."),
            KV("Komplikace:", "žádné."),
            KV("Pooperační plán:", "ortéza s limitem 0–90° na 4 týdny, "
                                   "poté volná; chůze o dvou francouzských "
                                   "holích s odlehčením 2 týdny; "
                                   "nízkomolekulární heparin 14 dní; "
                                   "ambulantní rehabilitace od 10. dne; "
                                   "kontrola za 3 týdny."),
            KV("Doporučení k zátěži:", "rotoped od 3. týdne, plavání od "
                                       "6. týdne, běh v přímém směru nejdříve "
                                       "od 4. měsíce, kontaktní sport nejdříve "
                                       "za 9 měsíců a po funkčním testování."),
        ),
    ),
    Document(
        did="d-novak88-fyzio-2024a", pid="p-novak-1988", date="2024-11-05",
        kind="physio_note", title="Záznam z fyzioterapie",
        clinic=ORTO_CLINIC, dept=ORTO_PHYSIO_DEPT,
        date_label="Datum terapie", author_label="Terapeut",
        author="Mgr. Petr Hlaváček",
        blocks=(
            KV("Diagnóza:", "stav po plastice předního zkříženého vazu (LCA) "
                            "pravého kolena 8. 10. 2024, 4. pooperační týden."),
            KV("Návštěva:", "4. ze série 12."),
            H("Subjektivně"),
            P("Bolest minimální, spíše pocit napětí v podkolení po cvičení. "
              "Ortézu odložil podle instrukcí tento týden. Chůze bez holí "
              "po rovině, mírné kulhání při delší chůzi."),
            KV("Bolest (VAS):", "2/10 po cvičení, 0/10 v klidu."),
            H("Objektivně"),
            P("Otok kolena mírný, obvod přes patellu vpravo o 1 cm větší. "
              "Extenze plná, aktivně 0°, flexe 105°. Jizvy klidné. "
              "Obvod stehna 10 cm nad patellou vpravo o 2 cm menší než vlevo. "
              "Aktivace kvadricepsu oslabená, patella pohyblivá."),
            H("Terapie"),
            P("Mobilizace patelly, měkké techniky na jizvy a hamstringy. "
              "Aktivace kvadricepsu s elektrostimulací, "
              "3 série po 15 opakováních. Uzavřené kinetické řetězce: "
              "dřep do 60° s oporou, výpony. Rotoped 12 minut bez odporu."),
            H("Plán"),
            P("Zvyšovat rozsah flexe na 120° do konce měsíce, "
              "pokračovat v posilování kvadricepsu, přidat leg press "
              "v rozsahu 0–60°. Bez rotačních pohybů a bez běhu. "
              "Kontrola za týden."),
        ),
    ),
    Document(
        did="d-novak88-fyzio-2024b", pid="p-novak-1988", date="2024-12-16",
        kind="physio_note", title="Záznam z fyzioterapie",
        clinic=ORTO_CLINIC, dept=ORTO_PHYSIO_DEPT,
        date_label="Datum terapie", author_label="Terapeut",
        author="Mgr. Petr Hlaváček",
        blocks=(
            KV("Diagnóza:", "stav po plastice předního zkříženého vazu (LCA) "
                            "pravého kolena 8. 10. 2024, 10. pooperační týden."),
            KV("Návštěva:", "10. ze série 12."),
            H("Subjektivně"),
            P("Bez bolestí. Chůze bez omezení, zvládá schody střídavým krokem "
              "i sestup. Subjektivně se cítí připraven na běh a ptá se, "
              "kdy může začít."),
            KV("Bolest (VAS):", "1/10 po delším zatížení, jinak 0/10."),
            H("Objektivně"),
            P("Koleno bez otoku, obvody symetrické. Extenze plná, flexe 130°, "
              "shodně s druhou stranou. Obvod stehna vpravo o 1,5 cm menší "
              "než vlevo — přetrvává deficit kvadricepsu. "
              "Stoj na jedné noze 30 sekund, mírná stranová oscilace. "
              "Skok na jedné noze zatím netestován."),
            H("Terapie"),
            P("Posilování s odporem: leg press, dřepy do 90°, výpady. "
              "Senzomotorická cvičení na balanční podložce, "
              "nácvik změn směru v pomalém tempu. Protažení hamstringů "
              "a lýtka."),
            H("Plán"),
            P("Běh v přímém směru nejdříve od 4. měsíce po operaci, "
              "tedy nejdříve v únoru, a pouze při deficitu síly kvadricepsu "
              "pod 15 % proti druhé straně. Pacient poučen, že subjektivní "
              "pocit připravenosti předbíhá hojení štěpu. "
              "Funkční testování na konci série."),
        ),
    ),
    Document(
        did="d-bezdickova-mr-2024", pid="p-bezdickova-1971", date="2024-05-06",
        kind="imaging", title="MR bederní páteře — popis",
        clinic=ORTO_CLINIC, dept=ORTO_RTG_DEPT,
        date_label="Datum vyšetření", author_label="Popsal",
        author="MUDr. Eva Puchmertlová",
        blocks=(
            H("Provedené vyšetření"),
            KV("Technika:", "MR bederní páteře 1,5 T, T2 sagitálně a "
                            "transverzálně, T1 sagitálně, STIR sagitálně, "
                            "bez kontrastní látky."),
            KV("Indikace:", "chronické bolesti bederní páteře trvající "
                            "18 měsíců, občasná propagace do levé hýždě, "
                            "bez neurologického deficitu."),
            H("Popis"),
            P("Fyziologická lordóza je oploštělá. Obratlová těla mají "
              "přiměřenou výšku a signál, bez známek úrazových či "
              "ložiskových změn. Konus medullaris končí na úrovni L1."),
            P("L3/4: mírná dehydratace disku, bez protruze, "
              "páteřní kanál i foramina volná."),
            P("L4/5: snížená výška a signál disku, cirkulární protruze "
              "3 mm, mírná hypertrofie žlutých vazů a facetových kloubů, "
              "durální vak lehce oploštělý, kořeny volné."),
            P("L5/S1: snížený signál disku, mediolaterální protruze vlevo "
              "velikosti 5 mm, která se dotýká levého kořene S1 v recesu, "
              "bez jeho jasné komprese a bez edému kořene. "
              "V krycích ploténkách přilehlých obratlů jsou změny typu "
              "Modic I v malém rozsahu."),
            P("Sakroiliakální skloubení bez zánětlivých změn. "
              "Paravertebrální měkké tkáně bez patologie."),
            H("Závěr"),
            P("Degenerativní změny bederní páteře, nejvýrazněji L5/S1 s "
              "mediolaterální protruzí vlevo v kontaktu s kořenem S1, "
              "a L4/5 s cirkulární protruzí. Nález nevysvětluje úplně "
              "rozsah a trvání obtíží; není přítomna komprese kořene ani "
              "stenóza kanálu, které by měnily terapeutický postup. "
              "Doporučen konzervativní postup a fyzioterapie."),
        ),
    ),
    Document(
        did="d-bezdickova-fyzio-2025a", pid="p-bezdickova-1971",
        date="2025-02-11", kind="physio_note",
        title="Záznam z fyzioterapie", clinic=ORTO_CLINIC,
        dept=ORTO_PHYSIO_DEPT, date_label="Datum terapie",
        author_label="Terapeut", author="Mgr. Petr Hlaváček",
        blocks=(
            KV("Diagnóza:", "chronický vertebrogenní algický syndrom bederní "
                            "páteře, degenerativní změny L4/5 a L5/S1."),
            KV("Návštěva:", "6. ze série 10."),
            H("Subjektivně"),
            P("Od zahájení série udává zlepšení. Ranní ztuhlost kratší, "
              "zvládne stát v kuchyni bez přerušení, což před terapií "
              "nešlo. Propagace do levé hýždě jen občas a slabší. "
              "Domácí cvičení provádí obden."),
            KV("Bolest (VAS):", "3/10 průměrně za poslední týden, "
                                "maximum 5/10 po delším sedu."),
            H("Objektivně"),
            P("Schoberova distance 4,5 cm (vstupně 3,5 cm). "
              "Lateroflexe symetrická. Lasègueův manévr negativní "
              "oboustranně. Palpačně hypertonus paravertebrálních svalů "
              "vlevo v úrovni L4–S1, mírnější než vstupně. "
              "Bez čitelného neurologického deficitu, reflexy symetrické."),
            H("Terapie"),
            P("Měkké techniky a postizometrická relaxace paravertebrálních "
              "svalů a musculus quadratus lumborum. Aktivace hlubokého "
              "stabilizačního systému v poloze na zádech a v kleku, "
              "3 série po 10 opakováních. Nácvik nastavení pánve při stoji "
              "a při zvedání břemene."),
            H("Plán"),
            P("Pokračovat v sérii, domácí cvičení denně, "
              "nikoli obden. Přidat chůzi 30 minut denně. "
              "Kontrola za dva týdny."),
        ),
    ),
    Document(
        did="d-bezdickova-fyzio-2025b", pid="p-bezdickova-1971",
        date="2025-10-14", kind="physio_note",
        title="Záznam z fyzioterapie — nová série", clinic=ORTO_CLINIC,
        dept=ORTO_PHYSIO_DEPT, date_label="Datum terapie",
        author_label="Terapeut", author="Mgr. Petr Hlaváček",
        blocks=(
            KV("Diagnóza:", "chronický vertebrogenní algický syndrom bederní "
                            "páteře, degenerativní změny L4/5 a L5/S1."),
            KV("Návštěva:", "2. z nové série 10, po osmiměsíční pauze."),
            H("Subjektivně"),
            P("Udává, že bolesti jsou stejné jako na začátku loňské terapie a "
              "že jí předchozí série nakonec nepomohla. Poslední týden po "
              "víkendovém stěhování zhoršení. Přiznává, že domácí cvičení "
              "přestala provádět zhruba měsíc po skončení minulé série."),
            KV("Bolest (VAS):", "6/10 po víkendu, 3–4/10 v běžném týdnu."),
            H("Objektivně"),
            P("Schoberova distance 4,5 cm, tedy shodně s únorovým měřením a "
              "lépe než vstupně v roce 2024. Lateroflexe symetrická, "
              "Lasègueův manévr negativní. Hypertonus paravertebrálních svalů "
              "vlevo výraznější než v únoru. Stereotyp zvedání břemene "
              "z předklonu bez zapojení dolních končetin — návrat k "
              "původnímu vzorci."),
            P("Objektivní nález tedy zůstává lepší než při vstupním vyšetření, "
              "zatímco subjektivní hodnocení je horší. Rozdíl odpovídá "
              "akutnímu zhoršení po zátěži a přerušení autoterapie, "
              "nikoli progresi strukturálního nálezu; kontrolní zobrazovací "
              "vyšetření není indikováno."),
            H("Terapie"),
            P("Měkké techniky, mobilizace bederní páteře, "
              "postizometrická relaxace. Opakovaná instruktáž hlubokého "
              "stabilizačního systému, korekce stereotypu zvedání."),
            H("Plán"),
            P("Domácí cvičení denně, krátká jednotka 10 minut ráno a večer — "
              "kratší a pravidelná je pro udržení efektu podstatnější než "
              "delší a občasná. Vysvětlen rozdíl mezi bolestí a poškozením. "
              "Kontrola za týden."),
        ),
    ),
    Document(
        did="d-vondrusak-fyzio-2025", pid="p-vondrusak-1985", date="2025-06-24",
        kind="physio_note", title="Záznam z fyzioterapie — vstupní vyšetření",
        clinic=ORTO_CLINIC, dept=ORTO_PHYSIO_DEPT,
        date_label="Datum terapie", author_label="Terapeut",
        author="Bc. Lenka Zemanová",
        blocks=(
            KV("Diagnóza:", "subakromiální impingement pravého ramene, "
                            "konzervativní postup."),
            KV("Návštěva:", "1. ze série 6, vstupní kineziologický rozbor."),
            H("Subjektivně"),
            P("Bolest pravého ramene při pohybu nad horizontálu, zejména "
              "při práci nad hlavou a při plavání kraulem. Trvá 4 měsíce, "
              "začátek plíživý, bez úrazu. V noci ho budí při ležení na "
              "pravém boku."),
            KV("Bolest (VAS):", "4/10 při elevaci nad horizontálu, "
                                "1/10 v klidu, 5/10 v noci na boku."),
            H("Objektivně"),
            P("Aktivní abdukce do 160°, bolestivý oblouk mezi 70° a 120°. "
              "Pasivní rozsah plný. Hawkinsův test vpravo pozitivní, "
              "Neerův test pozitivní, test supraspinatu mírně bolestivý, "
              "síla zachována. Protrakce ramen, oslabení dolních fixátorů "
              "lopatky, scapula alata naznačena vpravo."),
            H("Terapie"),
            P("Měkké techniky na musculus trapezius pars descendens a "
              "musculus pectoralis minor. Centrace ramenního kloubu, "
              "aktivace dolních fixátorů lopatky, "
              "posilování zevních rotátorů s gumou v neutrální pozici, "
              "3 série po 12 opakováních."),
            H("Plán"),
            P("Šest terapií po týdnu. Domácí cvičení denně, "
              "dočasně vyloučit plavání kraulem a práci nad hlavou, "
              "nahradit plaváním na zádech. Při nedostatečném efektu "
              "po šesti týdnech zvážit doplnění ultrazvukového vyšetření "
              "rotátorové manžety."),
        ),
    ),
    Document(
        did="d-trefilova-rtg-2026", pid="p-trefilova-1958", date="2026-02-05",
        kind="imaging", title="RTG kolenních kloubů ve stoji — popis",
        clinic=ORTO_CLINIC, dept=ORTO_RTG_DEPT,
        date_label="Datum vyšetření", author_label="Popsal",
        author="MUDr. Eva Puchmertlová",
        blocks=(
            H("Provedené vyšetření"),
            KV("Technika:", "RTG obou kolenních kloubů předozadně ve stoji "
                            "se zátěží, bočné snímky vleže."),
            KV("Indikace:", "bolesti levého kolena při chůzi a po zátěži, "
                            "trvající tři roky, postupné zhoršování."),
            H("Popis"),
            P("Vlevo je kloubní štěrbina mediálního kompartmentu zúžená na "
              "1,5 mm, se subchondrální sklerózou a osteofyty na okraji "
              "mediálního kondylu femuru i tibiálního plató. "
              "Laterální kompartment se štěrbinou 4 mm. "
              "Femoropatelární skloubení s osteofyty na horním pólu patelly. "
              "Osa končetiny mírně varózní."),
            P("Vpravo je kloubní štěrbina zachovalá v obou kompartmentech, "
              "s naznačenými osteofyty mediálně. Femoropatelární skloubení "
              "bez výraznějších změn."),
            P("Kostní struktura odpovídá věku. Bez ložiskových změn, "
              "bez známek zánětu, bez volných kloubních tělísek. "
              "Měkké tkáně bez kalcifikací a bez výpotku."),
            H("Závěr"),
            P("Gonartróza vlevo, pokročilá v mediálním kompartmentu "
              "(odpovídá stupni III podle Kellgrena a Lawrence), "
              "s varózní osou. Vpravo počínající degenerativní změny. "
              "Nález odpovídá klinickým obtížím; v tuto chvíli je namístě "
              "konzervativní postup, o náhradě kloubu rozhodnout podle "
              "vývoje obtíží a funkčního omezení."),
        ),
    ),
    Document(
        did="d-skaloud-fyzio-2025", pid="p-skaloud-1993", date="2025-04-02",
        kind="physio_note", title="Záznam z fyzioterapie",
        clinic=ORTO_CLINIC, dept=ORTO_PHYSIO_DEPT,
        date_label="Datum terapie", author_label="Terapeut",
        author="Mgr. Petr Hlaváček",
        blocks=(
            KV("Diagnóza:", "stav po distorzi pravého hlezenního kloubu "
                            "12. 3. 2025, léze zevního postranního vazu "
                            "I.–II. stupně."),
            KV("Návštěva:", "3. ze série 5."),
            H("Subjektivně"),
            P("Bolest jen při došlapu na nerovný terén. Chůze bez opory, "
              "ortézu nosí při delší chůzi venku. Chce vědět, kdy může "
              "začít znovu běhat."),
            KV("Bolest (VAS):", "2/10 na nerovném terénu, 0/10 v klidu."),
            H("Objektivně"),
            P("Reziduální otok pod zevním kotníkem, obvod přes kotníky vpravo "
              "o 0,5 cm větší. Palpační citlivost při úponu předního "
              "talofibulárního vazu. Dorzální flexe 15°, plantární flexe "
              "plná. Přední zásuvka hlezna negativní, kloub stabilní. "
              "Stoj na jedné noze 25 sekund se zvýšenou oscilací."),
            H("Terapie"),
            P("Lymfatické techniky, mobilizace hlezna a nohy. "
              "Senzomotorický trénink: stoj na labilní ploše, "
              "výpady, poskoky na místě. Posilování peroneálních svalů "
              "s odporovou gumou."),
            H("Plán"),
            P("Návrat k běhu na rovném povrchu od příštího týdne, "
              "zpočátku střídat běh a chůzi. Terén a změny směru nejdříve "
              "za tři týdny. Ortéza při sportu ještě dva měsíce. "
              "Senzomotorické cvičení denně."),
        ),
    ),
)


# --- normalisation and SQL ---------------------------------------------------
COMBINING = re.compile("[̀-ͯ]")


def body_norm(text: str) -> str:
    """What ``documents.body_norm`` holds.

    Mirrors ``normWithMap`` in ``packages/agent/datasource/src/documents.ts``:
    NFKD, drop combining marks, lowercase. NFKD rather than NFD is the reason
    a doctor can type "vo2max" and hit a page that prints VO₂max.

    Whitespace is collapsed on top of that, because the query is folded with
    ``\\s+`` collapsed too and this column is only the SQL prefilter — a
    prefilter that is slightly too generous costs a discarded row, one that is
    too strict costs a document nobody can find. The authoritative match runs
    offset-mapped in TypeScript over ``body_text``.
    """
    stripped = COMBINING.sub("", unicodedata.normalize("NFKD", text))
    return " ".join(stripped.lower().split())


def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def build_sql(tenant: str, docs: list[dict]) -> str:
    lines = [
        f"-- Documents for the '{tenant}' practice — generated by",
        "-- tools/pipeline/scripts/make_chat_docs.py. Do not edit by hand:",
        "-- regenerate it, or the committed page images and the database",
        "-- disagree about what the evidence says.",
        "--",
        "-- Apply AFTER seed_{tenant}.sql: that file deletes the document",
        "-- tables along with the patients they reference.",
        "--",
        "-- body_text is what the generated PDF actually says, read back out of",
        "-- it with get_text(); body_norm is the folded prefilter column.",
        "-- Every patient, physician, therapist and practice here is fictional.",
        "",
        "DELETE FROM document_pages;",
        "DELETE FROM documents;",
        "",
    ]
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
    return "\n".join(lines)


# --- assembling --------------------------------------------------------------
def panel_units(report: dict) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """The inline blood panel, split the way the printed reports split it.

    The values are the patient's own, read from the corpus ``make_chat_demo``
    produced — not invented here and not copied by hand. A reference range is
    printed only where the value left it, which is how a panel earns being read
    as prose: the eye stops at the line that carries one.
    """
    bio: list[str] = []
    hema: list[str] = []
    for m in report["measurements"]:
        item = f"{m['rawAnalyteName']}: {m['valueRaw']} {m['unitRaw']}"
        if m["flag"] != "normal" and m["refRangeRaw"]:
            item += f" {m['refRangeRaw']}"
        (hema if m["rawAnalyteName"].startswith("B_") else bio).append(item)
    return tuple(bio), tuple(hema)


def nearest_report(reports: list[dict], pid: str, date_iso: str) -> dict:
    """The draw a document quotes: the patient's report on that exact date.

    Exact, not nearest-by-search: a document that quotes 'a nearby' panel would
    silently start quoting a different one the moment a draw date moved. The
    date is written down in the Eval, and if the corpus no longer has it the
    generator stops.
    """
    for r in reports:
        if r["patientRef"] == pid and r["reportDate"] == date_iso:
            return r
    raise SystemExit(
        f"no report for {pid} on {date_iso} in the committed corpus — "
        "run scripts.make_chat_demo first, or fix the date in this file."
    )


def age_at(birth: str, when: str) -> int:
    by, bm, bd = (int(x) for x in birth.split("-"))
    wy, wm, wd = (int(x) for x in when.split("-"))
    return wy - by - ((wm, wd) < (bm, bd))


def sport_documents(reports: list[dict], stories: dict[str, Story]) -> list[Document]:
    docs: list[Document] = []
    for e in EVALS:
        report = nearest_report(reports, e.pid, e.quotes)
        docs.append(Document(
            did=e.did, pid=e.pid, date=e.date, kind="perf_eval",
            title="Zpráva ze sportovní prohlídky",
            clinic=SPORT_CLINIC, dept=SPORT_DEPT,
            date_label="Datum vyšetření", author_label="Vyšetřil",
            author=e.physician,
            blocks=eval_blocks(e, panel_units(report), e.quotes, report["labName"]),
        ))
    for z in ZONES:
        docs.append(Document(
            did=z.did, pid=z.pid, date=z.date, kind="perf_eval",
            title="Tréninková pásma", clinic=SPORT_CLINIC, dept=SPORT_LAB_DEPT,
            date_label="Datum protokolu", author_label="Vyhodnotil",
            author=z.physician,
            blocks=zones_blocks(z, stories[z.pid]),
        ))
    return docs


def render(tenant: str, docs: list[Document], stories: dict[str, Story]) -> list[dict]:
    pages_dir = OUT / tenant / "pages"
    if not pages_dir.is_dir():
        raise SystemExit(
            f"{pages_dir} does not exist — run scripts.make_chat_demo first; "
            "it owns the tenant directory."
        )
    # Only ever this script's own pages. make_chat_demo's report images live
    # alongside them under p-*, and clearing the directory would delete a corpus
    # this script cannot rebuild.
    for stale in sorted(pages_dir.glob("d-*_p*.png")):
        stale.unlink()

    tmp = OUT / tenant / "_tmpdocs"
    tmp.mkdir(parents=True, exist_ok=True)
    zoom = RENDER_DPI / 72.0
    out: list[dict] = []

    for d in docs:
        story = stories[d.pid]
        sheet = Sheet(d, story)
        sheet.render()
        pdf_path = tmp / f"{d.did}.pdf"
        sheet.pdf.save(pdf_path)
        sheet.pdf.close()

        pdf = pymupdf.open(pdf_path)
        pages = []
        texts = []
        for i, pg in enumerate(pdf):
            pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
            name = f"{d.did}_p{i + 1}.png"
            pix.save(pages_dir / name)
            pages.append({
                "pageNum": i + 1,
                "imageUrl": f"/demo/{tenant}/pages/{name}",
                "width": pix.width,
                "height": pix.height,
            })
            texts.append(pg.get_text().strip())
        # Read back, never kept alongside: body_text is what the page says.
        out.append({
            "id": d.did,
            "patientRef": d.pid,
            "docDate": d.date,
            "kind": d.kind,
            "title": d.title,
            "bodyText": "\n".join(texts),
            "pages": pages,
        })
        pdf.close()

    for f in sorted(tmp.glob("*.pdf")):
        f.unlink()
    tmp.rmdir()

    (OUT / tenant / "documents.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


def main() -> None:
    SQL_OUT.mkdir(parents=True, exist_ok=True)
    for tenant in ("sport", "orto"):
        stories = {s.pid: s for s in PRACTICES[tenant]}
        reports = json.loads(
            (OUT / tenant / "reports.json").read_text(encoding="utf-8"))
        if tenant == "sport":
            docs = sport_documents(reports, stories)
        else:
            docs = list(ORTO_DOCS)
        for d in docs:
            assert d.pid in stories, f"{d.did}: no such patient in {tenant}"
        assert len({d.did for d in docs}) == len(docs), f"{tenant}: duplicate doc id"

        built = render(tenant, docs, stories)
        (SQL_OUT / f"seed_docs_{tenant}.sql").write_text(
            build_sql(tenant, built), encoding="utf-8")
        pages = sum(len(d["pages"]) for d in built)
        print(f"{tenant}: {len(built)} documents, {pages} pages → {OUT / tenant}")
        print(f"{tenant}: seed → {SQL_OUT / f'seed_docs_{tenant}.sql'}")


if __name__ == "__main__":
    main()
