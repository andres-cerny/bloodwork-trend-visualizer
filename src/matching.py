"""Map a raw (Czech, cross-lab) analyte name to a canonical analyte id.

Matching is deterministic: normalize the printed name (strip the material
prefix like ``S_`` / ``B_``, fold diacritics, drop punctuation) and look it up
in the synonym index built from registry.json. Unmatched names are returned as
None and surfaced in the UI as a one-time "needs review" mapping.
"""
from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Optional

from .config import REGISTRY_PATH
from .models import AnalyteDef

# Material prefixes used by Czech labs before the analyte name, e.g.
# S_ (sérum), B_ (plná krev), P_ (plazma), U_ (moč), PK_, PE_, FW_, xxx_.
_PREFIX = re.compile(r"^[a-z]{1,4}_")
_NONALNUM = re.compile(r"[^a-z0-9]+")


def _strip_diacritics(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )


def norm_key(name: str) -> str:
    """Normalize an analyte name to a match key.

    "S_Glukóza" -> "glukoza"; "Celkový bilirubin" -> "celkovy bilirubin";
    "B_Neutrofily #" -> "neutrofily abs"; "gGT" -> "ggt".
    """
    s = (name or "").strip().lower()
    s = re.sub(r"\s+#", " abs", s)       # standalone "#" (e.g. "Neutrofily #") = absolute count
    s = s.replace("#", " ")              # any other "#" is decoration (e.g. "#S_Cholesterol")
    s = _PREFIX.sub("", s.strip())       # drop material prefix (S_, B_, …)
    s = _strip_diacritics(s)
    s = _NONALNUM.sub(" ", s).strip()
    s = re.sub(r"\s+", " ", s)
    return s


class Registry:
    """Loaded analyte registry with a normalized synonym index."""

    def __init__(self, analytes: list[AnalyteDef]):
        self.analytes: dict[str, AnalyteDef] = {a.canonical_id: a for a in analytes}
        self._index: dict[str, str] = {}
        for a in analytes:
            names = [a.canonical_id, a.display_name_cs, *a.synonyms]
            for n in names:
                self._index[norm_key(n)] = a.canonical_id

    def match(self, raw_name: str) -> Optional[str]:
        return self._index.get(norm_key(raw_name))

    def get(self, canonical_id: str) -> Optional[AnalyteDef]:
        return self.analytes.get(canonical_id)

    def display_name(self, canonical_id: str) -> str:
        a = self.analytes.get(canonical_id)
        return a.display_name_cs if a else canonical_id

    def add_synonym(self, canonical_id: str, raw_name: str) -> None:
        """Teach the registry a new synonym (from a UI correction)."""
        a = self.analytes.get(canonical_id)
        if a is None:
            return
        if raw_name not in a.synonyms:
            a.synonyms.append(raw_name)
        self._index[norm_key(raw_name)] = canonical_id

    def add_analyte(self, analyte: AnalyteDef) -> None:
        self.analytes[analyte.canonical_id] = analyte
        for n in [analyte.canonical_id, analyte.display_name_cs, *analyte.synonyms]:
            self._index[norm_key(n)] = analyte.canonical_id

    def to_list(self) -> list[dict]:
        return [a.to_dict() for a in self.analytes.values()]


def convert_to_canonical(measurement, analyte: AnalyteDef) -> None:
    """Convert a measurement's value + range to the analyte's canonical unit.

    Only fires when the report's (canonicalized) unit differs from the
    canonical unit and a factor is declared in ``unit_conversions`` — e.g. a
    differential count printed as a fraction ("-", factor 100) vs. percent, so
    SPADIA's 0,336 lines up with CASRI's 27,9 % on the same trend. The raw
    value/unit stay untouched for the verification view.
    """
    if measurement.value is None or measurement.unit is None:
        return
    if measurement.unit == analyte.canonical_unit:
        return
    factor = analyte.unit_conversions.get(measurement.unit)
    if factor is None:
        return
    measurement.value *= factor
    if measurement.ref_range_low is not None:
        measurement.ref_range_low *= factor
    if measurement.ref_range_high is not None:
        measurement.ref_range_high *= factor
    measurement.unit = analyte.canonical_unit


# --- mapping suggestions -----------------------------------------------------
# Zero-API recommendation for the "namapování" review UI: fuzzy name match
# against the registry, boosted by unit compatibility and value plausibility
# computed from measurements that are already mapped.

@dataclass
class MappingSuggestion:
    canonical_id: str
    score: float
    name_sim: float
    unit_match: Optional[bool]      # None = one side has no unit to compare
    value_ok: Optional[bool]        # None = no observed values to compare
    observed_unit: str = ""         # unit seen on already-mapped data
    observed_mean: Optional[float] = None


def observed_stats(reports) -> dict[str, dict]:
    """Per-canonical-id evidence from already-mapped measurements:
    {"values": [floats], "unit": most common unit}. Feeds suggest_mappings."""
    values: dict[str, list[float]] = {}
    units: dict[str, Counter] = {}
    for r in reports:
        for m in r.measurements:
            if m.canonical_id is None:
                continue
            if m.value is not None:
                values.setdefault(m.canonical_id, []).append(m.value)
            if m.unit:
                units.setdefault(m.canonical_id, Counter())[m.unit] += 1
    out: dict[str, dict] = {}
    for cid in set(values) | set(units):
        unit = units[cid].most_common(1)[0][0] if cid in units else ""
        out[cid] = {"values": values.get(cid, []), "unit": unit}
    return out


def _unit_norm(u: Optional[str]) -> str:
    from .normalize import canonicalize_unit
    return (canonicalize_unit(u or "") or "").lower().replace(" ", "")


def suggest_mappings(
    raw_name: str,
    raw_unit: str,
    raw_values: list[float],
    registry: Registry,
    stats: Optional[dict[str, dict]] = None,
    *,
    top_n: int = 3,
    min_score: float = 0.45,
) -> list[MappingSuggestion]:
    """Rank registry analytes as mapping candidates for an unknown raw name.

    Deterministic and local (difflib) — no model call. Score = best fuzzy
    match over the candidate's names/synonyms, plus a unit-compatibility
    boost/penalty and a value-plausibility boost/penalty against data already
    mapped to the candidate.
    """
    stats = stats or {}
    key = norm_key(raw_name)
    if not key:
        return []
    ru = _unit_norm(raw_unit)
    mean_v = sum(raw_values) / len(raw_values) if raw_values else None

    suggestions: list[MappingSuggestion] = []
    for a in registry.analytes.values():
        cand_keys = {norm_key(n) for n in (a.canonical_id, a.display_name_cs, *a.synonyms)}
        cand_keys.discard("")
        if not cand_keys:
            continue
        name_sim = max(SequenceMatcher(None, key, ck).ratio() for ck in cand_keys)
        score = name_sim
        if len(key) >= 3 and any(
                (key in ck or ck in key) and len(ck) >= 3 for ck in cand_keys):
            score += 0.15

        obs = stats.get(a.canonical_id, {})
        cand_unit = _unit_norm(a.canonical_unit) or _unit_norm(obs.get("unit"))
        unit_match: Optional[bool] = None
        if ru and cand_unit:
            unit_match = (ru == cand_unit
                          or raw_unit in a.unit_conversions
                          or ru in {_unit_norm(u) for u in a.unit_conversions})
            score += 0.20 if unit_match else -0.25

        value_ok: Optional[bool] = None
        obs_values = obs.get("values") or []
        obs_mean = sum(obs_values) / len(obs_values) if obs_values else None
        if mean_v is not None and obs_values:
            lo, hi = min(obs_values), max(obs_values)
            slack = max(hi - lo, abs(hi), 1e-9)
            value_ok = (lo - slack) <= mean_v <= (hi + slack)
            score += 0.10 if value_ok else -0.20

        if score >= min_score:
            suggestions.append(MappingSuggestion(
                canonical_id=a.canonical_id, score=round(score, 3),
                name_sim=round(name_sim, 3), unit_match=unit_match,
                value_ok=value_ok, observed_unit=obs.get("unit", ""),
                observed_mean=obs_mean,
            ))
    suggestions.sort(key=lambda s: -s.score)
    return suggestions[:top_n]


def load_registry(path=REGISTRY_PATH) -> Registry:
    data = json.loads(path.read_text(encoding="utf-8"))
    return Registry([AnalyteDef.from_dict(d) for d in data])


def save_registry(registry: Registry, path=REGISTRY_PATH) -> None:
    path.write_text(
        json.dumps(registry.to_list(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
