"""Seed data/registry.json from the analytes actually seen in the samples
(SPADIA/medivis 2023 & 2025, CASRI Praha 2019). Cross-lab synonyms are grouped
under one canonical id so the same analyte lines up across reports.

Run from tools/pipeline: python3 -m scripts.seed_registry
The registry then grows at runtime as the user maps unmatched names in the UI.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import REGISTRY_PATH, ensure_dirs

# fraction ("-"/"") reported by SPADIA vs. percent by CASRI → ×100 to canonical %
FRAC_TO_PCT = {"": 100.0}

# (canonical_id, display_name_cs, [synonyms], canonical_unit, unit_conversions)
ANALYTES: list[tuple] = [
    # --- biochemistry ---
    ("glukoza", "Glukóza", ["S_Glukóza", "Glukóza"], "mmol/l", {}),
    ("urea", "Urea", ["S_Urea", "Urea"], "mmol/l", {}),
    ("kreatinin", "Kreatinin", ["S_Kreatinin", "Kreatinin"], "µmol/l", {}),
    ("egfr", "eGFR (CKD-EPI)", ["xxx_eGF (CKD-EPI)", "eGF (CKD-EPI)", "eGFR"], "ml/s/1,73 m2", {}),
    ("kyselina_mocova", "Kyselina močová", ["S_Kyselina močová", "Kyselina močová"], "µmol/l", {}),
    ("bilirubin_celkovy", "Bilirubin celkový", ["S_Bilirubin celkový", "Celkový bilirubin", "Bilirubin celkový"], "µmol/l", {}),
    ("bilirubin_konjugovany", "Bilirubin konjugovaný", ["S_Bilirubin konjugovaný"], "µmol/l", {}),
    ("ast", "AST", ["S_AST", "AST"], "µkat/l", {}),
    ("alt", "ALT", ["S_ALT", "ALT"], "µkat/l", {}),
    ("alp", "ALP", ["S_ALP", "ALP"], "µkat/l", {}),
    ("alp_kostni", "ALP kostní", ["S_kostní ALP"], "µg/l", {}),
    ("ggt", "GGT", ["S_GGT", "gGT", "GGT"], "µkat/l", {}),
    ("ldh", "LDH", ["S_LDH", "LDH"], "µkat/l", {}),
    ("ck", "Kreatinkináza (CK)", ["S_Kreatinkináza", "CK", "Kreatinkináza"], "µkat/l", {}),
    ("acp", "ACP celková", ["S_ACP celková"], "nkat/l", {}),
    ("piiinp", "PIIINP", ["S_PIIINP"], "ng/ml", {}),
    # --- hormones ---
    ("erytropoetin", "Erytropoetin", ["S_Erytropoetin"], "U/l", {}),
    ("fsh", "FSH", ["S_FSH"], "U/l", {}),
    ("lh", "LH", ["S_LH"], "U/l", {}),
    ("dhea_s", "DHEA-S", ["S_DHEA-S"], "µmol/l", {}),
    ("kortizol", "Kortizol", ["S_Kortizol"], "nmol/l", {}),
    ("testosteron_volny", "Testosteron volný", ["S_Testosteron volný"], "pmol/l", {}),
    ("testosteron", "Testosteron", ["S_Testosteron"], "nmol/l", {}),
    ("shbg", "SHBG", ["S_SHBG"], "nmol/l", {}),
    ("fai", "FAI (výpočet)", ["S_výpočet FAI"], "%", {}),
    ("igf1", "IGF-1", ["S_IGF 1", "IGF 1"], "µg/l", {}),
    # --- ions / metals ---
    ("sodik", "Sodík", ["S_Sodík", "Sodík"], "mmol/l", {}),
    ("draslik", "Draslík", ["S_Draslík", "Draslík"], "mmol/l", {}),
    ("chloridy", "Chloridy", ["S_Chloridy", "Chloridy"], "mmol/l", {}),
    ("vapnik", "Vápník (Ca)", ["S_Ca celkový", "Vápník", "Ca celkový"], "mmol/l", {}),
    ("horcik", "Hořčík", ["S_Hořčík", "Hořčík"], "mmol/l", {}),
    ("horcik_ery", "Hořčík v erytrocytech", ["PE_Hořčík v ery"], "mmol/l", {}),
    ("fosfor", "Fosfor (P)", ["S_P anorganický", "Fosfor", "P anorganický"], "mmol/l", {}),
    ("zinek", "Zinek", ["S_Zinek"], "µmol/l", {}),
    # --- lipids ---
    ("cholesterol", "Cholesterol celkový", ["S_Cholesterol", "Cholesterol celkový", "Cholesterol"], "mmol/l", {}),
    ("triacylglyceroly", "Triacylglyceroly", ["S_Triacylglyceroly", "Triacylglyceroly"], "mmol/l", {}),
    ("hdl", "HDL cholesterol", ["S_HDL cholesterol", "HDL-cholesterol"], "mmol/l", {}),
    ("ldl", "LDL cholesterol", ["S_LDL cholesterol", "LDL-cholesterol"], "mmol/l", {}),
    ("non_hdl", "non-HDL cholesterol", ["S_Výpočet non-HDL"], "mmol/l", {}),
    # --- iron metabolism ---
    ("zelezo", "Železo", ["S_Železo", "Železo"], "µmol/l", {}),
    ("vk_fe_volna", "Volná vazebná kapacita Fe", ["S_Vol.VK Fe"], "µmol/l", {}),
    ("vk_fe_celkova", "Celková vazebná kapacita Fe", ["S_Celk.VK Fe"], "µmol/l", {}),
    ("saturace_trf", "Saturace transferrinu", ["S_Saturace Trf"], "%", {}),
    ("ferritin", "Ferritin", ["S_Ferritin", "Ferritin"], "µg/l", {}),
    ("transferrin", "Transferrin", ["S_Transferrin", "Transferin"], "g/l", {}),
    ("str", "Solubilní transferrinový receptor", ["S_Sol.tr.receptor"], "mg/l", {}),
    # --- vitamins / methylation ---
    ("vitamin_b12", "Vitamin B12", ["S_Vitamin B12"], "pmol/l", {}),
    ("aktivni_b12", "Aktivní B12 (holoTC)", ["S_Aktivní B12"], "pmol/l", {}),
    ("kyselina_listova_ery", "Kyselina listová v ery", ["B_Kyselina listová-ery"], "nmol/l", {}),
    ("kyselina_listova", "Kyselina listová", ["S_Kyselina listová"], "nmol/l", {}),
    ("vitamin_d", "Vitamin D celkový", ["S_Vitamin D celkový"], "nmol/l", {}),
    ("homocystein", "Homocystein", ["S_Homocystein"], "µmol/l", {}),
    ("mma", "Metylmalonová kyselina", ["PK_Metymalonová kyselina"], "nmol/l", {}),
    # --- cardiac / proteins / complement ---
    ("myoglobin", "Myoglobin", ["S_Myoglobin"], "µg/l", {}),
    ("crp", "CRP", ["S_CRP", "CRP"], "mg/l", {}),
    ("celkova_bilkovina", "Celková bílkovina", ["S_Celk.bílkovina", "Bílkovina celková"], "g/l", {}),
    ("albumin", "Albumin", ["S_Albumin", "Albumin"], "g/l", {}),
    ("c3", "C3 komplement", ["S_C3 komplement"], "g/l", {}),
    ("c4", "C4 komplement", ["S_C4 komplement"], "g/l", {}),
    # --- thyroid ---
    ("tsh", "TSH", ["S_TSH"], "mU/l", {}),
    ("ft4", "T4 volný (fT4)", ["S_T4 volný"], "pmol/l", {}),
    ("ft3", "T3 volný (fT3)", ["S_T3 volný"], "pmol/l", {}),
    # --- bone / diabetes ---
    ("osteokalcin", "Osteokalcin", ["S_Osteokalcin"], "µg/l", {}),
    ("c_peptid", "C-peptid", ["S_C-peptid"], "pmol/l", {}),
    ("inzulin", "Inzulin", ["S_Inzulin"], "mU/l", {}),
    # --- allergy / immunology ---
    ("ige", "IgE celkové", ["S_IgE celkové"], "kU/l", {}),
    ("ecp", "ECP", ["S_ECP"], "µg/l", {}),
    # --- CBC (blood count) ---
    ("leukocyty", "Leukocyty", ["B_Leukocyty", "WBS leukocyty", "Leukocyty", "WBC"], "10^9/l", {}),
    ("erytrocyty", "Erytrocyty", ["B_Erytrocyty", "RBC erytrocyty", "Erytrocyty", "RBC"], "10^12/l", {}),
    ("hemoglobin", "Hemoglobin", ["B_Hemoglobin", "HGB hemoglobin", "Hemoglobin", "HGB"], "g/l", {}),
    ("hematokrit", "Hematokrit", ["B_Hematokrit", "HCT hematokrit", "Hematokrit", "HCT"], "", {}),
    ("mcv", "MCV", ["B_MCV", "MCV stř. obj. ery.", "MCV"], "fl", {}),
    ("mch", "MCH", ["B_MCH", "MCH ob. HB v ery.", "MCH"], "pg", {}),
    ("mchc", "MCHC", ["B_MCHC", "MCHC konc. HB v ery.", "MCHC"], "g/l", {}),
    ("rdw", "RDW", ["B_RDW-CV", "RDW distr. křivka ery.", "RDW-CV", "RDW"], "%", {}),
    ("trombocyty", "Trombocyty", ["B_Trombocyty", "PLT trombocyty", "Trombocyty", "PLT"], "10^9/l", {}),
    ("trombokrit", "Trombokrit", ["B_Trombokrit", "PCT hematokrit trombo", "PCT"], "", {}),
    ("pdw", "PDW", ["B_PDW", "PDW distr. křivka trombo", "PDW"], "fl", {}),
    ("mpv", "MPV", ["B_MPV", "MPV stř. obj. trombo", "MPV"], "fl", {}),
    ("retikulocyty", "Retikulocyty", ["B_Retikulocyty"], "1", {}),
    ("retikulocyty_abs", "Retikulocyty (absolutní)", ["B_Retikulocyty #"], "10^12/l", {}),
    ("retik_index", "Retikulocytární index", ["B_Retik. index"], "", {}),
    # --- differential (relative %; SPADIA fractions ×100 → %) ---
    ("neutrofily", "Neutrofily", ["B_Neutrofily", "Granulocyty"], "%", FRAC_TO_PCT),
    ("lymfocyty", "Lymfocyty", ["B_Lymfocyty", "Lymfocyty"], "%", FRAC_TO_PCT),
    ("monocyty", "Monocyty", ["B_Monocyty", "Monocyty"], "%", FRAC_TO_PCT),
    ("eosinofily", "Eosinofily", ["B_Eosinofily"], "%", FRAC_TO_PCT),
    ("basofily", "Basofily", ["B_Basofily"], "%", FRAC_TO_PCT),
    # --- differential (absolute counts) ---
    ("neutrofily_abs", "Neutrofily (absolutní)", ["B_Neutrofily #", "Gra granulocyty"], "10^9/l", {}),
    ("lymfocyty_abs", "Lymfocyty (absolutní)", ["B_Lymfocyty #", "Lym lymfocyty"], "10^9/l", {}),
    ("monocyty_abs", "Monocyty (absolutní)", ["B_Monocyty #", "Mon monocyty"], "10^9/l", {}),
    ("eosinofily_abs", "Eosinofily (absolutní)", ["B_Eosinofily #"], "10^9/l", {}),
    ("basofily_abs", "Basofily (absolutní)", ["B_Basofily #"], "10^9/l", {}),
]


# Extra cross-lab synonyms for EXISTING analytes, learned from PREVEDIG / AGILAB
# / CASRI-long-form layouts (added after seeing all 15 sample reports).
EXTRA_SYNONYMS: dict[str, list[str]] = {
    "vitamin_d": ["#S_25-OH vitamin D celkový", "25-OH vitamin D", "25-hydroxyvitamin D"],
    "mch": ["B_Barvivo ery [MCH]"],
    "basofily": ["B_Bazofily", "B_Bazofily.", "Bazofily"],
    "rdw": ["B_Distr. křivka ery [RDW]"],
    "eosinofily": ["B_Eozinofily", "B_Eozinofily.", "Eozinofily"],
    "erytrocyty": ["B_Erytrocyty [RBC]"],
    "hematokrit": ["B_Hematokrit [HCT]"],
    "hemoglobin": ["B_Hemoglobin [HGB]"],
    "leukocyty": ["B_Leukocyty [WBC]"],
    "mchc": ["B_Stř.bar.koncentrace [MCHC]"],
    "mcv": ["B_Střední objem ery [MCV]"],
    "trombocyty": ["B_Trombocyty [PLT]"],
    "basofily_abs": ["Bazofily-abs"],
    "eosinofily_abs": ["Eozinofily-abs"],
    "neutrofily_abs": ["Neutrofily-abs"],
    "lymfocyty_abs": ["Lymfocyty-abs"],
    "monocyty_abs": ["Monocyty-abs"],
    # NOTE: deliberately NOT adding bare "Bilirubin" / "Bílkovina" — in AGILAB
    # those bare names are the *urine* dipstick items ("negat."), while serum
    # uses "Bilirubin celkový" / "Bílkovina celková" (already matched). Mapping
    # the bare names would attach urine rows to the serum analyte.
    "alp": ["ALP - alkalická fosfatasa"],
    "alt": ["ALT - alaninaminotransferasa"],
    "ast": ["AST - aspartátaminotransferasa"],
    "ck": ["CK - kreatinkinasa"],
    "ldh": ["LDH - laktátdehydrogenasa", "LD"],
    "ggt": ["gGT - gamaglutamyltransferasa"],
    "fosfor": ["Fosfor anorganický"],
    "hdl": ["Cholesterol HDL"],
    "ldl": ["Cholesterol LDL"],
    "kyselina_listova": ["Kys.listová"],
    "ferritin": ["S_Feritin"],
    "crp": ["S_C-reaktivní protein"],
    "saturace_trf": ["S_Sat.transferinu (Fe,Trf)", "Saturace transf.-výp",
                     "Saturace transferinu železem"],
    "vk_fe_celkova": ["Vazebná kapacita", "Vazebná kapacita F", "Vazebná kapacita Fe"],
    "egfr": ["odhad GF (CKD-EPI)"],
    "non_hdl": ["S_Non-HDL cholesterol-výp."],
}

# Genuinely new analytes present only in the other labs' panels.
NEW_ANALYTES: list[tuple] = [
    ("egfr_mdrd", "eGFR (MDRD)", ["odhad GF (MDRD)"], "ml/s/1,73 m2", {}),
    ("iga", "IgA", ["IgA"], "g/l", {}),
    ("igg", "IgG", ["IgG"], "g/l", {}),
    ("igm", "IgM", ["IgM"], "g/l", {}),
    ("estradiol", "Estradiol", ["S_Estradiol"], "pmol/l", {}),
    ("progesteron", "Progesteron", ["S_Progesteron"], "nmol/l", {}),
    ("nt_probnp", "NT-proBNP", ["NT-proBNP"], "ng/l", {}),
    ("troponin_i", "Troponin I", ["Troponin I"], "µg/l", {}),
    ("ck_mb", "CK-MB mass", ["CK-MB mass"], "µg/l", {}),
    ("index_aterogenity", "Index aterogenity", ["Index aterogenity", "Index aterogenity-výp."], "", {}),
    ("osmolalita", "Osmolalita", ["S_Osmolalita-výpočet"], "mmol/kg", {}),
    ("vapnik_ionizovany", "Vápník ionizovaný", ["S_Vápník ioniz.-výpočet"], "mmol/l", {}),
    ("vapnik_korigovany", "Vápník korigovaný", ["S_Vápník korig.-výpočet"], "mmol/l", {}),
    ("fw", "Sedimentace (FW)", ["Sedimentace"], "mm/h", {}),
    ("hemolyza_index", "Index hemolýzy", ["Hemolýza-index"], "", {}),
    ("ikterita_index", "Index ikterity", ["Ikterita-index"], "", {}),
    ("chyloza_index", "Index chylozity", ["Chylóza-index"], "", {}),
]


def build() -> list[dict]:
    out = []
    for cid, disp, syns, unit, conv in ANALYTES + NEW_ANALYTES:
        extra = EXTRA_SYNONYMS.get(cid, [])
        merged = list(dict.fromkeys([*syns, *extra]))  # de-dupe, keep order
        out.append({
            "canonical_id": cid,
            "display_name_cs": disp,
            "synonyms": merged,
            "canonical_unit": unit,
            "unit_conversions": conv,
        })
    return out


if __name__ == "__main__":
    ensure_dirs()
    data = build()
    REGISTRY_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(data)} analytes to {REGISTRY_PATH}")
