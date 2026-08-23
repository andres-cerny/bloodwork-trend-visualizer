"""Unit tests for the deterministic parsing — the highest-value tests in the
project, since a misread decimal is the cardinal bug. Run with:

    python3 -m pytest tests/ -q
    (or plain: python3 tests/test_normalize.py)
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.models import Measurement
from src.normalize import (
    canonicalize_unit,
    compute_flag,
    normalize_measurement,
    parse_czech_number,
    parse_range,
    parse_value,
)


# --- numbers ----------------------------------------------------------------
def test_decimal_comma():
    assert parse_czech_number("5,4") == 5.4
    assert parse_czech_number("0,443") == 0.443
    assert parse_czech_number("1,97") == 1.97


def test_integer():
    assert parse_czech_number("114") == 114.0
    assert parse_czech_number("140") == 140.0


def test_thousands_separator_space():
    assert parse_czech_number("1 234,5") == 1234.5
    assert parse_czech_number("2131") == 2131.0
    assert parse_czech_number("1 187") == 1187.0


def test_thousands_separator_nbsp():
    assert parse_czech_number("1 234,5") == 1234.5   # NBSP
    assert parse_czech_number("1 234,5") == 1234.5   # narrow NBSP


def test_dot_thousands_comma_decimal():
    assert parse_czech_number("1.234,5") == 1234.5


def test_non_number_is_none():
    assert parse_czech_number("neprovedeno") is None
    assert parse_czech_number("") is None
    assert parse_czech_number(None) is None
    assert parse_czech_number("negativní") is None


# --- values (censored / qualitative return None) ----------------------------
def test_value_plain():
    assert parse_value("5,4") == 5.4
    assert parse_value("114") == 114.0


def test_value_censored_is_none():
    assert parse_value("<1,0") is None
    assert parse_value(">10") is None
    assert parse_value("< 0,1") is None


def test_value_qualitative_is_none():
    assert parse_value("neprovedeno") is None
    assert parse_value("negativní") is None


def test_value_strips_out_of_range_marker():
    # SPADIA prints "!" next to out-of-range values; it must not break parsing.
    assert parse_value("1,97 !") == 1.97
    assert parse_value("114 !") == 114.0
    assert parse_value("13,80 !") == 13.80
    assert parse_value("29,30 *") == 29.30


# --- units ------------------------------------------------------------------
def test_unit_micro_variants():
    assert canonicalize_unit("µmol/l") == canonicalize_unit("μmol/l")  # µ vs μ
    assert canonicalize_unit("µkat/l") == "µkat/l"


def test_unit_litre_case():
    assert canonicalize_unit("mmol/L") == "mmol/l"
    assert canonicalize_unit("mmol/l") == "mmol/l"
    assert canonicalize_unit("U/l") == "U/l"          # keep the units 'U' uppercase


def test_unit_exponent_glyph():
    # CASRI uses the modifier caret ˄; SPADIA uses ^
    assert canonicalize_unit("10˄9/l") == canonicalize_unit("10^9/l")


def test_unit_dimensionless():
    assert canonicalize_unit("-") == ""
    assert canonicalize_unit("") == ""


# --- reference ranges -------------------------------------------------------
def test_range_inline():
    assert parse_range("(4,11-5,60)") == (4.11, 5.60, None)
    assert parse_range("4,11-5,60") == (4.11, 5.60, None)


def test_range_spaced_column():
    assert parse_range("62,00 - 110") == (62.0, 110.0, None)
    assert parse_range("137-145") == (137.0, 145.0, None)


def test_range_open_ended():
    assert parse_range("< 5,00") == (None, 5.0, None)
    assert parse_range("<2,85") == (None, 2.85, None)
    assert parse_range("> 0,5") == (0.5, None, None)


def test_range_en_dash():
    assert parse_range("0,400–0,500") == (0.400, 0.500, None)  # en dash


def test_range_non_numeric():
    low, high, text = parse_range("negativní")
    assert low is None and high is None and text == "negativní"


# --- flag -------------------------------------------------------------------
def test_flag_normal_low_high():
    assert compute_flag(5.0, 4.11, 5.60) == "normal"
    assert compute_flag(1.97, 4.11, 5.60) == "low"
    assert compute_flag(6.0, 4.11, 5.60) == "high"


def test_flag_open_ended():
    assert compute_flag(3.0, None, 2.85) == "high"     # "< 2,85"
    assert compute_flag(2.0, None, 2.85) == "normal"
    assert compute_flag(0.2, 0.5, None) == "low"       # "> 0,5"


def test_flag_unknown_when_no_value_or_range():
    assert compute_flag(None, 1.0, 2.0) == "unknown"
    assert compute_flag(5.0, None, None) == "unknown"


# --- end-to-end on a Measurement -------------------------------------------
def test_normalize_measurement_spadia_row():
    m = Measurement(
        raw_analyte_name="S_Glukóza",
        value_raw="1,97",
        unit_raw="mmol/l",
        ref_range_raw="(4,11-5,60)",
        source_page=1,
    )
    normalize_measurement(m)
    assert m.value == 1.97
    assert m.unit == "mmol/l"
    assert (m.ref_range_low, m.ref_range_high) == (4.11, 5.60)
    assert m.flag == "low"


def test_normalize_measurement_censored_crp():
    m = Measurement(
        raw_analyte_name="S_CRP",
        value_raw="<1,0",
        unit_raw="mg/l",
        ref_range_raw="(1,0-5,0)",
    )
    normalize_measurement(m)
    assert m.value is None            # censored, no invented number
    assert m.flag == "unknown"
    assert m.confidence == "high"     # censored is expected, not a parse failure


def test_normalize_measurement_parse_failure_downgrades_confidence():
    m = Measurement(raw_analyte_name="X", value_raw="5..4", unit_raw="mmol/l")
    normalize_measurement(m)
    assert m.value is None
    assert m.confidence == "low"      # numeric-looking but unparseable -> flagged


if __name__ == "__main__":
    import traceback

    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
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
