"""Rule-based, strictly descriptive Czech summary of what changed.

Deterministic templates only — no LLM, so no interpretive or diagnostic
language can slip in. Describes direction, magnitude and any in/out-of-range
transition between an analyte's two most recent numeric results. Never says
what a change *means*.
"""
from __future__ import annotations

from typing import Optional

from .trends import Trend, TrendPoint, latest_two


def cz_num(x: Optional[float]) -> str:
    """Format a number Czech-style (decimal comma), trimming noise."""
    if x is None:
        return "—"
    if abs(x) >= 100:
        s = f"{x:.1f}"
    elif abs(x) >= 1:
        s = f"{x:.2f}"
    else:
        s = f"{x:.3f}"
    s = s.rstrip("0").rstrip(".") if "." in s else s
    return s.replace(".", ",")


def _range_str(low: Optional[float], high: Optional[float]) -> str:
    if low is not None and high is not None:
        return f"{cz_num(low)}–{cz_num(high)}"
    if high is not None:
        return f"< {cz_num(high)}"
    if low is not None:
        return f"> {cz_num(low)}"
    return "—"


def _direction(delta: float, eps: float) -> str:
    if delta > eps:
        return "vzrostlo"
    if delta < -eps:
        return "kleslo"
    return "beze změny"


def _range_transition(old_flag: str, new_flag: str) -> str:
    """Descriptive clause about crossing the reference range (or not)."""
    if new_flag == "high":
        return "a je nad referenčním rozmezím" if old_flag != "high" \
            else "a zůstává nad referenčním rozmezím"
    if new_flag == "low":
        return "a je pod referenčním rozmezím" if old_flag != "low" \
            else "a zůstává pod referenčním rozmezím"
    if new_flag == "normal":
        if old_flag in ("high", "low"):
            return "a je nyní v referenčním rozmezí"
        return "a je v referenčním rozmezí"
    return ""


def summarize_trend(trend: Trend) -> Optional[dict]:
    """One descriptive record for a trend's two most recent numeric results.

    Returns None when there aren't two numeric points to compare.
    """
    older, newer = latest_two(trend)
    if older is None or newer is None:
        return None

    unit = (trend.unit or "").strip()
    unit_sfx = f" {unit}" if unit else ""
    delta = newer.value - older.value
    # magnitude threshold: 1% of the older value (or tiny absolute) counts as change
    eps = max(abs(older.value) * 0.01, 1e-9)
    direction = _direction(delta, eps)

    if direction == "beze změny":
        text = (f"{trend.display_name} beze změny "
                f"({cz_num(older.value)} → {cz_num(newer.value)}{unit_sfx})")
    else:
        pct = (delta / older.value * 100) if older.value else None
        pct_part = f", {'+' if delta > 0 else '−'}{cz_num(abs(pct))} %" if pct is not None else ""
        text = (f"{trend.display_name} {direction} z {cz_num(older.value)} "
                f"na {cz_num(newer.value)}{unit_sfx} "
                f"({'+' if delta > 0 else '−'}{cz_num(abs(delta))}{pct_part})")

    transition = _range_transition(older.flag, newer.flag)
    if transition:
        rng = _range_str(newer.ref_low, newer.ref_high)
        rng_part = f" ({rng})" if rng != "—" else ""
        text += f" {transition}{rng_part}"
    text += "."

    # rank: out-of-range first, then bigger relative moves
    out_of_range = newer.flag in ("high", "low")
    rel = abs(delta) / abs(older.value) if older.value else 0.0
    return {
        "canonical_id": trend.canonical_id,
        "display_name": trend.display_name,
        "text": text,
        "out_of_range": out_of_range,
        "changed": direction != "beze změny",
        "new_flag": newer.flag,
        "older": older,
        "newer": newer,
        "rank": (0 if out_of_range else 1, -rel),
    }


def summarize_changes(trends: dict[str, Trend]) -> list[dict]:
    """Descriptive records for all comparable trends, most notable first."""
    records = [r for t in trends.values() if (r := summarize_trend(t)) is not None]
    records.sort(key=lambda r: r["rank"])
    return records
