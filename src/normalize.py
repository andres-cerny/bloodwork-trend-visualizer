"""Deterministic parsing of the raw strings transcribed by the model.

This is where every number, unit and reference range is *computed* — the LLM
never does arithmetic. Kept small and pure so it can be unit-tested against the
tricky Czech cases (decimal commas, thousands separators, censored values,
open-ended ranges). A misread decimal is the cardinal bug this module guards.
"""
from __future__ import annotations

import re
from typing import Optional

from .models import Flag, Measurement

# Characters -----------------------------------------------------------------
_MICRO_VARIANTS = {"μ": "µ"}          # Greek mu → micro sign
_DASHES = {"‒", "–", "—", "−"}  # figure/en/em dash, minus
_THIN_SPACES = {" ", " ", " ", " "}  # NBSP, narrow NBSP, thin, figure

_NUMBER_CORE = re.compile(r"^[+]?\d[\d\s.,]*$")
_HAS_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)  # any unicode letter


# --- numbers ----------------------------------------------------------------
def parse_czech_number(raw: Optional[str]) -> Optional[float]:
    """Parse a Czech-formatted number: comma decimal, space thousands.

    "5,4" -> 5.4 ; "1 234,5" -> 1234.5 ; "0,443" -> 0.443 ; "114" -> 114.0.
    Returns None if the string is not a plain number.
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    for bad, good in _MICRO_VARIANTS.items():
        s = s.replace(bad, good)
    for sp in _THIN_SPACES:
        s = s.replace(sp, "")
    s = re.sub(r"\s+", "", s)
    if not _NUMBER_CORE.match(s):
        return None
    # Both separators present: "." is the thousands grouping, drop it.
    if "," in s and "." in s:
        s = s.replace(".", "")
    s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def parse_value(value_raw: Optional[str]) -> Optional[float]:
    """Numeric value of a result cell, or None for censored/qualitative cells.

    Censored ("<1,0", ">10") and qualitative ("neprovedeno", "negativní")
    values deliberately return None — we never invent a number for a trend.
    """
    if value_raw is None:
        return None
    s = value_raw.strip()
    # Strip lab out-of-range markers ("!", "*") — decoration, not the number.
    s = s.replace("!", "").replace("*", "").strip()
    if not s:
        return None
    if "<" in s or ">" in s:
        return None
    if _HAS_LETTER.search(s):
        return None
    return parse_czech_number(s)


# --- units ------------------------------------------------------------------
def canonicalize_unit(unit_raw: Optional[str]) -> Optional[str]:
    """Fold cosmetic unit variants to one form so the same analyte lines up.

    Unifies micro-sign codepoints, the "10^9" vs "10˄9" exponent glyphs, and
    the litre-case ("/L" vs "/l"). Dimensionless markers ("-", "") -> "".
    """
    if unit_raw is None:
        return None
    s = unit_raw.strip()
    if s in {"", "-", "–", "—"}:
        return ""
    for bad, good in _MICRO_VARIANTS.items():
        s = s.replace(bad, good)
    s = s.replace("˄", "^")            # modifier caret ˄ → ^
    s = re.sub(r"(?i)/l\b", "/l", s)         # litre symbol case
    s = re.sub(r"\s+", " ", s).strip()
    return s


# --- reference ranges -------------------------------------------------------
def parse_range(ref_raw: Optional[str]) -> tuple[Optional[float], Optional[float], Optional[str]]:
    """Parse a printed reference range into (low, high, text).

    Handles "4,11-5,60", "62,00 - 110", "< 5,00", "> 0,5" and non-numeric
    ranges ("negativní"). The raw string is always preserved by the caller, so
    an unparseable range degrades to text rather than being dropped.
    """
    if ref_raw is None:
        return None, None, None
    s = ref_raw.strip().strip("()").strip()
    if not s:
        return None, None, None
    for d in _DASHES:
        s = s.replace(d, "-")

    if s.startswith("<"):
        high = parse_czech_number(s[1:])
        return (None, high, None) if high is not None else (None, None, s)
    if s.startswith(">"):
        low = parse_czech_number(s[1:])
        return (low, None, None) if low is not None else (None, None, s)

    # a - b  (both bounds). Split on the first hyphen that sits between digits.
    m = re.match(r"^\s*([0-9][0-9\s.,]*?)\s*-\s*([0-9][0-9\s.,]*)\s*$", s)
    if m:
        low = parse_czech_number(m.group(1))
        high = parse_czech_number(m.group(2))
        if low is not None and high is not None:
            return low, high, None

    # Non-numeric (e.g. "negativní") — keep as descriptive text.
    if _HAS_LETTER.search(s):
        return None, None, s
    return None, None, s


# --- flag -------------------------------------------------------------------
def compute_flag(
    value: Optional[float],
    low: Optional[float],
    high: Optional[float],
) -> Flag:
    """Recompute normal/low/high/unknown from value vs. parsed range.

    We never trust the lab's printed flag glyph — this is lab-independent.
    """
    if value is None:
        return "unknown"
    if low is None and high is None:
        return "unknown"
    if low is not None and value < low:
        return "low"
    if high is not None and value > high:
        return "high"
    return "normal"


# --- measurement ------------------------------------------------------------
def normalize_measurement(m: Measurement) -> Measurement:
    """Fill the derived numeric fields on a Measurement in place."""
    m.value = parse_value(m.value_raw)
    m.unit = canonicalize_unit(m.unit_raw)
    m.ref_range_low, m.ref_range_high, m.ref_range_text = parse_range(m.ref_range_raw)
    m.flag = compute_flag(m.value, m.ref_range_low, m.ref_range_high)

    # QA: downgrade confidence when a numeric-looking value failed to parse or a
    # numeric-looking range failed to parse — these are exactly the rows the
    # verify UI must surface.
    if m.value is None and m.value_raw.strip() and not _HAS_LETTER.search(m.value_raw) \
            and "<" not in m.value_raw and ">" not in m.value_raw:
        m.confidence = "low"
    return m
