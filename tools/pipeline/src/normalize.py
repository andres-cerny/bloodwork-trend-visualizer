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
_VALUE_MARKERS = ("!", "*", "↑", "↓")  # out-of-range decoration beside a value

# One-sided bounds, as labs print them: "< 5,00" / "≤ 5,00" / "do 5,0" cap
# the range from above; "> 0,5" / "≥ 0,5" / "nad 0,5" from below. The words
# must be followed by whitespace so "dospělí…" is not read as "do".
_UPPER_BOUND = re.compile(r"^(?:<|≤|do\s)\s*", re.IGNORECASE | re.UNICODE)
_LOWER_BOUND = re.compile(r"^(?:>|≥|nad\s)\s*", re.IGNORECASE | re.UNICODE)
# Both bounds: "a - b" or "a až b", split on the separator between digits.
_TWO_BOUNDS = re.compile(r"^\s*([0-9][0-9\s.,]*?)\s*(?:-|až)\s*([0-9][0-9\s.,]*)\s*$",
                         re.IGNORECASE | re.UNICODE)


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
    # Strip lab out-of-range markers ("!", "*", "↑", "↓") — decoration, not
    # the number. A marker alone ("( * )", "H") has no digits left -> None.
    for mark in _VALUE_MARKERS:
        s = s.replace(mark, "")
    s = s.strip()
    if not s:
        return None
    if "<" in s or ">" in s:
        return None
    if _HAS_LETTER.search(s):
        return None
    return parse_czech_number(s)


# --- material prefix --------------------------------------------------------
# Material codes Czech and Slovak labs print before an analyte name, in the
# lowercase form material_prefix() returns. "s,p" is one code: the lab
# measured serum or plasma and did not say which.
MATERIAL_CODES = frozenset({
    "s", "p", "b", "u", "du", "pk", "pe", "fw", "sp", "s,p", "k", "l",
})

# Underscore is generic — any 1-4 letters (S_, B_, dU_, xxx_). Slash and
# hyphen are allowlisted to MATERIAL_CODES, because a generic ^[a-z]{1,4}-
# strips "anti-" from anti-TPO and "c-" from C-peptid. Two further refusals,
# both from names labs really print: a digit after the separator (S-100
# protein, 25-OH vitamin D) is part of the name, and a *spaced* hyphen is the
# abbreviation convention (ALP - alkalická fosfatasa, K - draslík), where the
# letters are the analyte, not the material.
_PREFIX_UNDERSCORE = re.compile(r"^([a-z]{1,4})_", re.IGNORECASE)
_PREFIX_SEPARATED = re.compile(r"^([a-z]{1,4}(?:,[a-z]{1,4})?)[-/](?=[^\W\d_])",
                               re.IGNORECASE | re.UNICODE)


def _match_material_prefix(name: str) -> Optional[tuple[str, int]]:
    u = _PREFIX_UNDERSCORE.match(name)
    if u:
        return u.group(1).lower(), u.end()
    m = _PREFIX_SEPARATED.match(name)
    if m and m.group(1).lower() in MATERIAL_CODES:
        return m.group(1).lower(), m.end()
    return None


def material_prefix(raw_name: Optional[str]) -> Optional[str]:
    """The material a lab prints before the analyte name, lowercased, or None.

    S_ (sérum), B_ (plná krev), P_ (plazma), U_ (moč), dU_ (sbíraná moč), or
    the same codes before "/" or "-" (S/Sodík, S-Na, S,P-glukóza).
    """
    m = _match_material_prefix((raw_name or "").strip())
    return m[0] if m else None


def strip_material_prefix(name: str) -> str:
    """The name with its material prefix removed; unchanged when there is none."""
    m = _match_material_prefix(name)
    return name[m[1]:] if m else name


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

    Handles "4,11-5,60", "62,00 - 110", "0,5 až 1,5", "< 5,00", "≤ 5,00",
    "do 5,0", "> 0,5", "≥ 0,5", "nad 0,5" and non-numeric ranges
    ("negativní"). The raw string is always preserved by the caller, so an
    unparseable range degrades to text rather than being dropped.
    """
    if ref_raw is None:
        return None, None, None
    s = ref_raw.strip().strip("()").strip()
    if not s:
        return None, None, None
    for d in _DASHES:
        s = s.replace(d, "-")

    # A bound whose remainder is not a number ("<1,0 negatívne") stays text:
    # that is a criterion, not an interval, and we never invent a number.
    up = _UPPER_BOUND.match(s)
    if up:
        high = parse_czech_number(s[up.end():])
        return (None, high, None) if high is not None else (None, None, s)
    lo = _LOWER_BOUND.match(s)
    if lo:
        low = parse_czech_number(s[lo.end():])
        return (low, None, None) if low is not None else (None, None, s)

    m = _TWO_BOUNDS.match(s)
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
