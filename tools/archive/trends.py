"""Assemble per-analyte time series across all stored reports."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .models import LabReport, Measurement


@dataclass
class TrendPoint:
    date: str                       # ISO date of the report
    value: Optional[float]
    unit: Optional[str]
    flag: str
    ref_low: Optional[float]
    ref_high: Optional[float]
    value_raw: str
    report_id: str


@dataclass
class Trend:
    canonical_id: str
    display_name: str
    unit: str
    points: list[TrendPoint] = field(default_factory=list)

    @property
    def numeric_points(self) -> list[TrendPoint]:
        return [p for p in self.points if p.value is not None]


def build_trends(
    reports: list[LabReport], display_name_fn=lambda cid: cid
) -> dict[str, Trend]:
    """Group measurements by canonical_id, sorted by report date.

    Only dated reports contribute to trends. Unmapped measurements
    (canonical_id is None) are excluded — they surface in the review flow.
    """
    trends: dict[str, Trend] = {}
    for report in reports:
        if not report.report_date:
            continue
        for m in report.measurements:
            if m.canonical_id is None:
                continue
            t = trends.get(m.canonical_id)
            if t is None:
                t = Trend(
                    canonical_id=m.canonical_id,
                    display_name=display_name_fn(m.canonical_id),
                    unit=m.unit or "",
                )
                trends[m.canonical_id] = t
            if not t.unit and m.unit:
                t.unit = m.unit
            t.points.append(TrendPoint(
                date=report.report_date,
                value=m.value,
                unit=m.unit,
                flag=m.flag,
                ref_low=m.ref_range_low,
                ref_high=m.ref_range_high,
                value_raw=m.value_raw,
                report_id=report.id,
            ))
    for t in trends.values():
        t.points.sort(key=lambda p: p.date)
    return trends


def latest_two(trend: Trend) -> tuple[Optional[TrendPoint], Optional[TrendPoint]]:
    """The two most recent points that carry a numeric value (older, newer)."""
    pts = trend.numeric_points
    if len(pts) >= 2:
        return pts[-2], pts[-1]
    if len(pts) == 1:
        return None, pts[-1]
    return None, None
