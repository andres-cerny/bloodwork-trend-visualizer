"""End-to-end ingest → extract → deterministic-process → store for one PDF."""
from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

from .config import MODEL_PRICING, USD_TO_CZK
from .extract import extract_report
from .ingest import ingest_pdf, report_id_for
from .matching import Registry, load_registry, save_registry
from .models import LabReport
from .process import process_measurements
from .storage import save_report


def _cost_usd(usage: dict[str, list[int]]) -> float:
    """USD cost of a run from per-model token usage (prices per MTok)."""
    total = 0.0
    for model, (inp, out) in usage.items():
        in_price, out_price = MODEL_PRICING.get(model, (0.0, 0.0))
        total += inp / 1e6 * in_price + out / 1e6 * out_price
    return total


def format_cost(stats: Optional[dict]) -> Optional[str]:
    """Human-readable '~$0.21 (≈ 5 Kč) · 48 s' line, or None without stats."""
    if not stats:
        return None
    parts = []
    cost = stats.get("cost_usd")
    if cost is not None:
        parts.append(f"~${cost:.2f} (≈ {cost * USD_TO_CZK:.0f} Kč)")
    dur = stats.get("duration_s")
    if dur is not None:
        parts.append(f"{dur:.0f} s")
    return " · ".join(parts) or None


def ingest_and_extract(
    pdf_path: Path,
    registry: Optional[Registry] = None,
    *,
    progress=None,
    save: bool = True,
) -> tuple[LabReport, list[str]]:
    """Process one PDF into a stored LabReport.

    Returns (report, unmatched_analyte_names). The registry is loaded if not
    supplied; unmatched names are the one-time UI review queue. Pages that fail
    even after retries are skipped and noted via progress rather than failing
    the whole report (unless every page fails).
    """
    pdf_path = Path(pdf_path)
    registry = registry or load_registry()

    rid = report_id_for(pdf_path)
    if progress:
        progress(f"Vykresluji stránky {pdf_path.name}…")
    pages = ingest_pdf(pdf_path, rid)

    t0 = time.monotonic()
    result = extract_report(pages, progress=progress, client=None)
    duration = time.monotonic() - t0
    measurements = result["measurements"]
    unmatched = process_measurements(measurements, registry)

    usage = result.get("usage", {})
    stats = {
        "duration_s": round(duration, 1),
        "input_tokens": sum(u[0] for u in usage.values()),
        "output_tokens": sum(u[1] for u in usage.values()),
        "cost_usd": round(_cost_usd(usage), 4),
    }
    if result.get("errors"):
        stats["failed_pages"] = sorted(result["errors"])
        if progress:
            progress(f"⚠️ Nepřečtené strany: {stats['failed_pages']} — "
                     f"report je uložen bez nich.")

    meta = result["meta"]
    report = LabReport(
        id=rid,
        source_file=pdf_path.name,
        report_date=meta.get("report_date"),
        lab_name=meta.get("lab_name"),
        patient_name=meta.get("patient_name"),
        patient_id=meta.get("patient_id"),
        pages=pages,
        measurements=measurements,
        stats=stats,
    )
    if save:
        save_report(report)
    return report, unmatched


if __name__ == "__main__":
    import sys

    from .config import SAMPLES_DIR

    registry = load_registry()
    args = sys.argv[1:]
    if args and args[0] == "all":
        targets = sorted(SAMPLES_DIR.glob("*.pdf"))
    elif args:
        targets = [Path(a) for a in args]
    else:
        targets = [next(SAMPLES_DIR.glob("*.pdf"))]

    for pdf in targets:
        print(f"\n=== {pdf.name} ===")
        report, unmatched = ingest_and_extract(pdf, registry, progress=lambda m: print("  ·", m))
        n = len(report.measurements)
        low = sum(1 for m in report.measurements if m.confidence == "low")
        disagr = sum(1 for m in report.measurements if m.disagreement)
        print(f"  datum={report.report_date} laboratoř={report.lab_name} "
              f"pacient={report.patient_name}")
        print(f"  {n} hodnot, {low} s nízkou jistotou, {disagr} neshod, "
              f"{len(unmatched)} nenamapovaných")
        cost_line = format_cost(report.stats)
        if cost_line:
            print(f"  náklady: {cost_line}")
        if unmatched:
            print("  nenamapované:", ", ".join(unmatched))
    # persist any registry growth (none here unless UI added synonyms)
    save_registry(registry)
