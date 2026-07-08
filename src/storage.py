"""Local JSON storage — one file per ingested report. No database."""
from __future__ import annotations

import json
from pathlib import Path

from .config import REPORTS_DIR, ensure_dirs
from .models import LabReport


def report_path(report_id: str) -> Path:
    return REPORTS_DIR / f"{report_id}.json"


def save_report(report: LabReport) -> Path:
    ensure_dirs()
    path = report_path(report.id)
    path.write_text(
        json.dumps(report.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path


def load_report(report_id: str) -> LabReport:
    data = json.loads(report_path(report_id).read_text(encoding="utf-8"))
    return LabReport.from_dict(data)


def list_reports() -> list[LabReport]:
    ensure_dirs()
    reports = []
    for f in REPORTS_DIR.glob("*.json"):
        try:
            reports.append(LabReport.from_dict(json.loads(f.read_text(encoding="utf-8"))))
        except (json.JSONDecodeError, KeyError):
            continue
    # newest sample date first; undated reports sort last
    reports.sort(key=lambda r: (r.report_date or ""), reverse=True)
    return reports


def report_exists(report_id: str) -> bool:
    return report_path(report_id).exists()


def delete_report(report_id: str) -> None:
    p = report_path(report_id)
    if p.exists():
        p.unlink()
