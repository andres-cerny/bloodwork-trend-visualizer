"""Build packages/lab-core/codes/lab-codes.json — the lab code table.

Every row is one NČLP item (Národní číselník laboratorních položek, MZ ČR /
DASTA) in its method-independent form (procedure `*`), for the blood and
urine systems a Czech report prints, with:

- the NČLP key (`id`) and the method-specific keys that share its system,
  component, kind-of-property and unit (`methods`),
- LOINC code(s) where curated (`loinc`, from codes/curation.json, each one
  checked against tx.fhir.org when it was added — see docs/plans/lab-codes.md),
- the specimen as the app's material prefix code (`mat`: s, p, b, u, du),
- the kind-of-property (`prop`, NČLP code, e.g. SUBSTC = látková koncentrace)
  and the NČLP unit,
- names per language (`names.cs`, `names.en`): the full NČLP item name, the
  component's short (n32) and long (n55) name, and the printed key a Czech
  LIS derives from them (`S_Na`, `B_Neutrofily`),
- the catalog ids (apps/portal/public/registry.json) the row is linked to.

The raw NČLP XML is downloaded into the git-ignored data/codes-src/nclp/:

    cd tools/pipeline && python3 -m scripts.build_lab_codes --fetch   # download, then build
    cd tools/pipeline && python3 -m scripts.build_lab_codes           # build from the download

The output is deterministic for a given download + curation.json, so a
re-run that changes nothing leaves no diff.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "data" / "codes-src" / "nclp"
CODES = ROOT / "packages" / "lab-core" / "codes"
OUT = CODES / "lab-codes.json"
CURATION = CODES / "curation.json"
REGISTRY = ROOT / "apps" / "portal" / "public" / "registry.json"

NCLP_URL = "https://ciselniky.dasta.mzcr.cz/CD/nclp_data/ds_NCLP/aktual/"
NCLP_FILES = ["_nclpver.xml", "nclppol.xml", "nclpkomp.xml", "nclpsyst.xml", "nclpdrvl.xml"]

# Component classes left out: allergen-specific IgE (1,500 rows of single
# allergens), drug levels, and nucleic-acid / genetic findings. None of them is
# a trendable blood-panel value, and together they are two thirds of the rows.
EXCLUDE_KATEG = {"SIGE", "DRUG", "NUCL"}

# Serology against an infectious agent is kept only for the agents a general
# Czech panel or a check-up orders (hepatitis, HIV, syphilis, the herpes
# family, borrelia, TBE, H. pylori, rubella, toxoplasma, SARS-CoV-2). The
# other ~70 agents (parainfluenza, coxsackie, salmonella…) are hospital
# microbiology, not a trend. Autoantibodies carry no agent and all stay.
COMMON_AGENTS = {
    "Hepatitis A virus", "Hepatitis B virus", "Hepatitis C virus", "Hepatitis D virus",
    "Hepatitis E virus", "Human immunodeficiency virus", "Treponema pallidum",
    "Epstein-Baarové virus (EBV)", "Cytomegalovirus (CMV)", "Toxoplasma gondii",
    "Borrelia burgdorferi sensu lato", "Borrelia burgdorferi", "Tick-born encephalitis virus",
    "Helicobacter pylori", "Rubella virus", "SARS-CoV-2", "Varicella-zoster virus (VZV)",
    "Human herpes virus 1,2 (HSV)", "Mycoplasma pneumoniae", "Chlamydia pneumoniae",
    "Morbilli virus", "Mumps virus", "Parvovirus B19", "Clostridium tetani",
}

# Systems whose material is blood or urine but which no patient report prints
# as a result line (mixtures for coagulation tests, dried spots, cell DNA…).
EXCLUDE_SYSTEMS = {
    "P+P", "P+PUFR", "DBS", "DNALEUB", "RNA (P)", "RNA(S)", "ERC+NACL", "PRP",
    "GRC", "UNSFCVVH", "P(C,RRT)", "EFP(P)", "P(FC)", "ERC(ICF)",
}

# Kind-of-property → a language-neutral short form close to LOINC's PROPERTY
# axis, so the two code systems can be compared without a lookup. Anything
# not listed keeps its NČLP code.
PROP_SHORT = {
    "SUBSTC": "SCnc", "MASSC": "MCnc", "CATC": "CCnc", "NUMC": "NCnc",
    "ARBSC": "ACnc", "ARBC": "ACnc", "ARBCT": "Titr", "NUMFR": "NFr", "SUBSTFR": "SFr",
    "MASSFR": "MFr", "VOLFR": "VFr", "CATFR": "CFr", "ENTVOL": "EntVol",
    "ENTMASS": "EntMass", "ENCATACT": "EntCAct", "SUBSTRTE": "SRat",
    "MASSRATE": "MRat", "NUMRATE": "NRat", "TIME": "Time", "PH": "pH",
    "RELTIME": "RelTime", "RSUBSTC": "RelSCnc", "RELARBC": "RelACnc",
    "PARTPR": "PPres", "PRESENCE": "PrThr", "PRESLIST": "PrThr",
    "DESCR": "Prid", "ARBNUM": "ANum", "NUM": "Num", "MOLAL": "SCnt",
}

SPECIMEN = {"s": "serum", "p": "plasma", "b": "blood", "u": "urine", "du": "urine/24h"}


def material(syst_key: str, mater: str | None) -> str | None:
    """System → the app's material prefix code (normalize.ts MATERIAL_CODES)."""
    k = syst_key.upper()
    # Calculated items: kidney function from serum creatinine/cystatin (eGFR,
    # printed S_eGFR or xxx_eGF), transferrin saturation over total transferrin.
    if k in ("PT(KIDN)", "TRF"):
        return "s"
    if k == "TRFP":
        return "p"
    if k == "S" or k.endswith("(S)") or k.startswith("S("):
        return "s"
    if k == "P" or k.endswith("(P)") or k.startswith("P("):
        return "p"
    if k == "DU" or k in ("SU", "MU", "TU", "MU(OVN)"):
        return "du"
    if k == "U" or k.endswith("(U)") or k.startswith("U("):
        return "u"
    if mater == "B" or k.startswith("B(") or k.endswith("(B)"):
        return "b"
    if mater == "U":
        return "u"
    return None


def norm_key(s: str) -> str:
    """The registry's normKey minus the prefix rule: lowercase, no diacritics."""
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


MATERIAL_CODES = {"s", "p", "b", "u", "du", "pk", "pe", "fw", "sp", "s,p", "k", "l"}


def strip_prefix(name: str) -> str:
    """normalize.ts stripMaterialPrefix: `X_` always, `S-`/`S/` only for known codes."""
    s = name.strip()
    m = re.match(r"^[a-z]{1,4}_", s, re.I)
    if m:
        return s[m.end():]
    m = re.match(r"^([a-z]{1,4}(?:,[a-z]{1,4})?)[-/](?=[^\W\d_])", s, re.I)
    if m and m.group(1).lower() in MATERIAL_CODES:
        return s[m.end():]
    return s


def read(name: str) -> list[dict]:
    rows = []
    for _, el in ET.iterparse(SRC / name):
        if el.tag == "VETA":
            rows.append(dict(el.attrib))
            el.clear()
    return rows


def fetch() -> None:
    SRC.mkdir(parents=True, exist_ok=True)
    for f in NCLP_FILES:
        req = urllib.request.Request(NCLP_URL + f, headers={"User-Agent": "moje-krev-build"})
        (SRC / f).write_bytes(urllib.request.urlopen(req, timeout=300).read())
        print("fetched", f)


def dedupe(names: list[str]) -> list[str]:
    seen, out = set(), []
    for n in names:
        k = norm_key(n or "")
        if n and k and k not in seen:
            seen.add(k)
            out.append(n)
    return out


def build() -> dict:
    ver = read("_nclpver.xml")[0]
    syst = {r["klic"]: r for r in read("nclpsyst.xml")}
    komp = {r["klic"]: r for r in read("nclpkomp.xml")}
    drvl = {r["klic"]: r for r in read("nclpdrvl.xml")}
    curation = json.loads(CURATION.read_text(encoding="utf-8")) if CURATION.exists() else {}
    loinc = curation.get("loinc", {})
    extra_syn = curation.get("synonyms", {})
    registry = {a["canonicalId"]: a for a in json.loads(REGISTRY.read_text(encoding="utf-8"))}
    catalog_links: dict[str, list[str]] = defaultdict(list)
    for cid, link in curation.get("catalog", {}).items():
        for code in link.get("nclp", []):
            catalog_links[code].append(cid)

    generic: dict[str, dict] = {}
    methods: dict[str, list[str]] = defaultdict(list)
    specific: dict[str, tuple] = {}
    for r in read("nclppol.xml"):
        if r.get("aktual") != "1":
            continue
        skdj = (r["klicsyst"], r["klickomp"], r["klicdrvl"], r["klicjedn"])
        if r["klicproc"] == "*":
            generic[skdj] = r
        else:
            methods["|".join(skdj)].append(r["klic"])
            specific[r["klic"]] = (skdj, r)
    # A calculated quantity (eGFR, LDL by Friedewald, INR, anion gap…) has no
    # `*` form: NČLP lists it only under its formula (CALC, EQ1, EQ2…). The
    # lowest-keyed formula item stands for it; the others are its methods.
    calc_only: dict[tuple, str] = {}
    for code, (skdj, r) in specific.items():
        if skdj not in generic and re.fullmatch(r"CALC|EQ\d*", r["klicproc"]):
            if skdj not in calc_only or code < calc_only[skdj]:
                calc_only[skdj] = code
    for skdj, code in calc_only.items():
        generic[skdj] = specific[code][1]
        methods["|".join(skdj)].remove(code)
    # A curated link may name another method-specific item when NČLP has no
    # `*` form of it: it becomes a row too.
    for code in catalog_links:
        if code in specific and specific[code][0] not in generic:
            skdj, r = specific[code]
            generic[skdj] = r
            methods["|".join(skdj)].remove(code)

    # The names Czech labs actually print ("Sodík", "Močovina", "GMT") are not
    # NČLP's (Na, Urea, GGT). The catalog holds them, collected from real
    # reports, so every catalog entry lends its synonyms — material prefix
    # off — to the *component* of the rows it links: "Sodík" then also finds
    # U_Na and dU_Na, which the catalog itself never covers.
    comp_of = {r["klic"]: skdj[1] for skdj, r in generic.items()}
    for code, (skdj, _) in specific.items():
        comp_of.setdefault(code, skdj[1])
    common: dict[str, list[str]] = defaultdict(list)
    for cid, link in curation.get("catalog", {}).items():
        entry = registry.get(cid)
        if not entry:
            continue
        names = [strip_prefix(s) for s in [entry["displayNameCs"], *entry["synonyms"]]]
        for comp in {comp_of[c] for c in link.get("nclp", []) if c in comp_of}:
            common[comp].extend(names)

    rows = []
    for skdj, r in generic.items():
        s = syst.get(r["klicsyst"], {})
        k = komp.get(r["klickomp"], {})
        mat = material(r["klicsyst"], s.get("mater"))
        m = sorted(methods.get("|".join(skdj), []))
        keys = [r["klic"], *m]  # a link or a LOINC may name any of them
        linked = any(c in catalog_links for c in keys)  # a curated link always keeps its row
        if mat is None:
            continue
        if not linked and (r["klicsyst"] in EXCLUDE_SYSTEMS or k.get("kateg") in EXCLUDE_KATEG):
            continue
        if not linked and k.get("agens") and k["agens"] not in COMMON_AGENTS:
            continue
        # A system other than the plain S/P/B/U names its cell or fraction
        # (Leukocyty(B), Erytrocyty(B)); the printed prefix is still the
        # material, which is what a lab puts before the underscore.
        prefix = {"s": "S", "p": "P", "b": "B", "u": "U", "du": "dU"}[mat]
        short = k.get("n32") or r["nkomp"]
        printed = [f"{prefix}_{short}"]
        if (k.get("n55r") or "") not in ("", short):
            printed.append(f"{prefix}_{k['n55r']}")
        cs_syn = dedupe([short, k.get("n55r", ""), k.get("n55", ""), r["nkomp"]]
                        + extra_syn.get(r["klickomp"], []))
        own = {norm_key(x) for x in cs_syn}
        cs_common = [x for x in dedupe(common.get(r["klickomp"], [])) if norm_key(x) not in own]
        en = k.get("an55") or ""
        en_syn = dedupe([en, k.get("npukod", "")])
        prop = r["klicdrvl"]
        row = {
            "id": r["klic"],
            "sys": r["klicsyst"],
            "comp": r["klickomp"],
            "prop": PROP_SHORT.get(prop, prop),
            "unit": r["njedn"],
            "mat": mat,
            "spec": SPECIMEN[mat],
            "kind": k.get("kateg", ""),
            "names": {
                "cs": {
                    "name": r["nazev"].replace(" *)", ")"),
                    **({"method": r["nproc"]} if r["klicproc"] != "*" else {}),
                    "printed": printed,
                    "syn": cs_syn,
                    **({"common": cs_common} if cs_common else {}),
                    "prop": drvl.get(prop, {}).get("n32", r["ndrvl"]),
                },
                "en": {"name": (r.get("nazeven") or "").replace(" *)", ")"), "syn": en_syn},
            },
        }
        if r.get("npucode"):
            row["npu"] = r["npucode"]
        lo = list(dict.fromkeys(x for c in keys for x in loinc.get(c, [])))
        if lo:
            row["loinc"] = lo
        cat = sorted({x for c in keys for x in catalog_links.get(c, [])})
        if cat:
            row["catalog"] = cat
        if m:
            row["methods"] = m
        rows.append(row)

    rows.sort(key=lambda x: x["id"])
    present = {c for r in rows for c in [r["id"], *r.get("methods", [])]}
    missing = [c for c in catalog_links if c not in present]
    if missing:
        sys.exit(f"curation.json links NČLP codes not in the table: {missing}")
    return {
        "schema": 1,
        "source": {
            "nclp": {
                "version": ver.get("ver_nclp"),
                "generated": ver.get("dat_gen"),
                "url": NCLP_URL,
                "publisher": "Ministerstvo zdravotnictví ČR, Datový standard DASTA (NČLP)",
            },
            "loinc": {
                "version": curation.get("loincVersion"),
                "notice": curation.get("loincNotice"),
            },
        },
        "rows": rows,
    }


def write(table: dict) -> None:
    # One row per line: a NČLP upgrade then reads as a diff of the rows it touched.
    head = {k: v for k, v in table.items() if k != "rows"}
    lines = ["{"]
    for k, v in head.items():
        lines.append(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},")
    lines.append('  "rows": [')
    body = [json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in table["rows"]]
    lines.append(",\n".join("    " + b for b in body))
    lines.append("  ]")
    lines.append("}")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true", help="download the NČLP XML first")
    a = ap.parse_args()
    if a.fetch or not (SRC / "nclppol.xml").exists():
        fetch()
    table = build()
    write(table)
    rows = table["rows"]
    print(f"{len(rows)} rows · {sum(1 for r in rows if 'loinc' in r)} with LOINC · "
          f"{sum(1 for r in rows if 'catalog' in r)} linked to the catalog → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
