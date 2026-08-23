"""Tests for the deterministic, zero-API mapping suggester and its evidence
gathering. This is what makes the „Namapování" review usable — a wrong
suggestion wastes a click, so the ranking rules are worth pinning.

    .venv/Scripts/python.exe tests/test_matching.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.matching import (Registry, observed_stats, suggest_mappings)
from src.models import AnalyteDef, LabReport, Measurement


def _registry() -> Registry:
    return Registry([
        AnalyteDef("glukoza", "Glukóza", ["S_Glukóza"], "mmol/l", {}),
        AnalyteDef("bilirubin_celkovy", "Bilirubin celkový",
                   ["S_Bilirubin celkový", "Celkový bilirubin"], "µmol/l", {}),
        AnalyteDef("bilirubin_konjugovany", "Bilirubin konjugovaný",
                   ["S_Bilirubin konjugovaný"], "µmol/l", {}),
        AnalyteDef("bilkovina_celkova", "Celková bílkovina",
                   ["S_Celková bílkovina"], "g/l", {}),
        AnalyteDef("hemoglobin", "Hemoglobin", ["B_Hemoglobin"], "g/l", {}),
    ])


def _report_with(measurements) -> LabReport:
    return LabReport(id="r1", source_file="x.pdf", measurements=measurements)


# --- name similarity --------------------------------------------------------
def test_close_name_is_top_suggestion():
    reg = _registry()
    suggs = suggest_mappings("Bilirubin", "", [], reg)
    assert suggs, "expected at least one suggestion"
    assert suggs[0].canonical_id == "bilirubin_celkovy"


def test_substring_bonus_orders_exact_stub_first():
    reg = _registry()
    suggs = suggest_mappings("Bělkovina", "g/l", [], reg)
    assert suggs[0].canonical_id == "bilkovina_celkova"


def test_unrelated_name_returns_nothing():
    reg = _registry()
    assert suggest_mappings("Zcela jiný analyt xyz", "", [], reg) == []


# --- unit compatibility -----------------------------------------------------
def test_matching_unit_boosts_and_is_flagged():
    reg = _registry()
    suggs = suggest_mappings("Celková bílkovina", "g/l", [], reg)
    top = suggs[0]
    assert top.canonical_id == "bilkovina_celkova"
    assert top.unit_match is True


def test_wrong_unit_penalizes_candidate():
    reg = _registry()
    # Same name, but a wildly wrong unit should mark the unit as mismatched.
    with_bad_unit = suggest_mappings("Glukóza", "g/l", [], reg)
    match = next((s for s in with_bad_unit if s.canonical_id == "glukoza"), None)
    assert match is not None and match.unit_match is False


# --- value plausibility from already-mapped data ----------------------------
def test_observed_stats_collects_values_and_units():
    reg = _registry()
    rep = _report_with([
        Measurement("S_Glukóza", "5,4", "mmol/l", canonical_id="glukoza",
                    value=5.4, unit="mmol/l"),
        Measurement("S_Glukóza", "6,0", "mmol/l", canonical_id="glukoza",
                    value=6.0, unit="mmol/l"),
    ])
    stats = observed_stats([rep])
    assert stats["glukoza"]["unit"] == "mmol/l"
    assert sorted(stats["glukoza"]["values"]) == [5.4, 6.0]


def test_value_in_observed_range_is_flagged_ok():
    reg = _registry()
    rep = _report_with([
        Measurement("S_Glukóza", "5,4", "mmol/l", canonical_id="glukoza",
                    value=5.4, unit="mmol/l"),
        Measurement("S_Glukóza", "6,0", "mmol/l", canonical_id="glukoza",
                    value=6.0, unit="mmol/l"),
    ])
    stats = observed_stats([rep])
    suggs = suggest_mappings("Glukoza", "mmol/l", [5.5], reg, stats)
    top = next(s for s in suggs if s.canonical_id == "glukoza")
    assert top.value_ok is True
    assert top.observed_mean is not None


def test_empty_name_returns_nothing():
    reg = _registry()
    assert suggest_mappings("", "mmol/l", [1.0], reg) == []


if __name__ == "__main__":
    import traceback

    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    passed = failed = 0
    for fn in fns:
        try:
            fn()
            passed += 1
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
