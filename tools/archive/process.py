"""Tie normalization + analyte matching + unit conversion together.

This is the deterministic post-processing seam applied to every raw
Measurement the model transcribes. It fills numeric fields, resolves the
canonical analyte, converts units for trend continuity, and reports which
names couldn't be matched (for the one-time UI review).
"""
from __future__ import annotations

from .matching import Registry, convert_to_canonical
from .models import Measurement
from .normalize import normalize_measurement


def process_measurements(
    measurements: list[Measurement], registry: Registry
) -> list[str]:
    """Normalize + match + convert each measurement in place.

    Returns the sorted list of distinct raw analyte names that did not match
    the registry (the "needs review" queue).
    """
    unmatched: set[str] = set()
    for m in measurements:
        normalize_measurement(m)
        m.canonical_id = registry.match(m.raw_analyte_name)
        if m.canonical_id is None:
            unmatched.add(m.raw_analyte_name)
        else:
            analyte = registry.get(m.canonical_id)
            if analyte is not None:
                convert_to_canonical(m, analyte)
    return sorted(unmatched)
