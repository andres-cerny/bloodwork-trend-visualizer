"""Dataclasses for the extracted data model, with JSON (de)serialization.

The LLM only ever fills the ``*_raw`` fields (verbatim transcription). Every
derived numeric field (``value``, ``ref_range_*``, ``flag``) is computed by
deterministic Python in normalize.py — never by the model.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Optional

Flag = Literal["normal", "low", "high", "unknown"]
Confidence = Literal["high", "medium", "low"]


@dataclass
class Measurement:
    raw_analyte_name: str                    # exactly as printed (Czech)
    value_raw: str                           # exactly as printed, e.g. "5,4", "<1,0"
    unit_raw: str = ""
    ref_range_raw: str = ""
    source_snippet: str = ""                 # verbatim row context for the verify UI
    source_page: int = 1
    confidence: Confidence = "high"          # model's self-reported confidence

    # --- derived by normalize.py (never by the model) ---
    canonical_id: Optional[str] = None
    value: Optional[float] = None
    unit: Optional[str] = None
    ref_range_low: Optional[float] = None
    ref_range_high: Optional[float] = None
    ref_range_text: Optional[str] = None
    flag: Flag = "unknown"

    # --- provenance / QA ---
    extracted_by: str = ""                   # model id that produced this row
    escalated: bool = False                  # re-checked by the escalation model
    disagreement: Optional[str] = None       # note when the two models differed
    corrected: bool = False                  # user edited it in the verify UI

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Measurement":
        known = {k: d[k] for k in d if k in cls.__dataclass_fields__}
        return cls(**known)


@dataclass
class Page:
    page_num: int
    image_path: str = ""                     # rendered PNG (always produced)
    text_layer: Optional[str] = None         # hint; None/empty ⇒ effectively a scan

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Page":
        known = {k: d[k] for k in d if k in cls.__dataclass_fields__}
        return cls(**known)


@dataclass
class LabReport:
    id: str
    source_file: str
    report_date: Optional[str] = None        # ISO date (YYYY-MM-DD), sample/collection date
    lab_name: Optional[str] = None
    patient_name: Optional[str] = None       # kept per user choice
    patient_id: Optional[str] = None         # rodné číslo; kept per user choice
    pages: list[Page] = field(default_factory=list)
    measurements: list[Measurement] = field(default_factory=list)
    # processing stats: {"duration_s": float, "input_tokens": int,
    #                    "output_tokens": int, "cost_usd": float}
    stats: Optional[dict[str, Any]] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source_file": self.source_file,
            "report_date": self.report_date,
            "lab_name": self.lab_name,
            "patient_name": self.patient_name,
            "patient_id": self.patient_id,
            "pages": [p.to_dict() for p in self.pages],
            "measurements": [m.to_dict() for m in self.measurements],
            "stats": self.stats,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "LabReport":
        return cls(
            id=d["id"],
            source_file=d["source_file"],
            report_date=d.get("report_date"),
            lab_name=d.get("lab_name"),
            patient_name=d.get("patient_name"),
            patient_id=d.get("patient_id"),
            pages=[Page.from_dict(p) for p in d.get("pages", [])],
            measurements=[Measurement.from_dict(m) for m in d.get("measurements", [])],
            stats=d.get("stats"),
        )


@dataclass
class AnalyteDef:
    canonical_id: str                        # e.g. "glukoza", "ggt", "leukocyty"
    display_name_cs: str
    synonyms: list[str] = field(default_factory=list)
    canonical_unit: str = ""
    unit_conversions: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "AnalyteDef":
        known = {k: d[k] for k in d if k in cls.__dataclass_fields__}
        return cls(**known)
