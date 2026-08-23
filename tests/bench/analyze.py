"""
Shared analysis for the benchmark notebook.

Kept out of the notebook itself so the loading and derivation logic can be
unit-read and reused, and so the notebook stays about the findings rather than
about pandas plumbing.

The one modelling claim in here is `predict_ms`. Stage 1b showed latency is
very close to linear in output tokens for a given model — Sonnet 5 sustains
~150 output tok/s and Opus 4.8 ~116, with a small fixed overhead — which is
what makes it legitimate to *compose* an arm's latency from measured component
behaviour instead of running every arm end to end. The fit is reported with its
residuals in the notebook so the claim can be checked rather than trusted.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

RESULTS = Path(__file__).resolve().parent / "results"


def _load(name: str) -> pd.DataFrame:
    path = RESULTS / name
    if not path.exists():
        return pd.DataFrame()
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    return pd.DataFrame(rows)


def load_stage0() -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Parse floor, per-arm input tokens, and the cache probe."""
    df = _load("stage0.jsonl")
    if df.empty:
        return df, df, {}
    floor = df[df["stage"] == "0.1"].copy()
    # JSON booleans arrive as object dtype, where `~series` is a *bitwise* not
    # over Python ints (True -> -2) rather than a logical one, and indexing with
    # the result raises rather than filtering. Cast once, here, so no notebook
    # cell has to know that.
    if "allPagesHaveText" in floor:
        floor["allPagesHaveText"] = floor["allPagesHaveText"].astype(bool)
    for col in ("pages", "rowCount", "chars", "loadMs", "parseMs", "totalMs"):
        if col in floor:
            floor[col] = pd.to_numeric(floor[col])
    tokens = df[df["stage"] == "0.2"].copy()
    cache = df[df["stage"] == "0.3"]
    probe = cache.iloc[0].to_dict() if len(cache) else {}
    return floor, tokens, probe


def load_latency() -> pd.DataFrame:
    df = _load("latency.jsonl")
    if df.empty:
        return df
    df = df[df["ok"]].copy()
    # Output tokens per second — the quantity the whole speed story turns on.
    df["tok_per_s"] = df["outputTokens"] / (df["ms"] / 1000.0)
    return df


def load_accuracy() -> pd.DataFrame:
    df = _load("accuracy.jsonl")
    if df.empty:
        return df
    df = df[df["ok"]].copy()
    for col in ("missing", "extra", "valueMismatch", "unitMismatch",
                "rangeMismatch", "fabrications", "collapsedRanges", "decensored"):
        if col in df:
            df[f"n_{col}"] = df[col].apply(len)
    return df


def throughput(latency: pd.DataFrame) -> pd.DataFrame:
    """Per-model output tokens/second and fixed overhead, by least squares.

    ms = outputTokens / rate + overhead
    """
    out = []
    for model, g in latency.groupby("model"):
        if len(g) < 2:
            continue
        # Fit ms against output tokens; slope is ms per token.
        slope, intercept = _fit(g)
        out.append({
            "model": model,
            "tok_per_s": 1000.0 / slope if slope else float("nan"),
            "overhead_ms": intercept,
            "n": len(g),
            "r2": _r2(g["outputTokens"], g["ms"], slope, intercept),
        })
    return pd.DataFrame(out)


def _fit(g: pd.DataFrame) -> tuple[float, float]:
    import numpy as np

    slope, intercept = np.polyfit(g["outputTokens"].to_numpy(float), g["ms"].to_numpy(float), 1)
    return float(slope), float(intercept)


def _r2(x, y, slope, intercept) -> float:
    import numpy as np

    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    pred = slope * x + intercept
    ss_res = float(((y - pred) ** 2).sum())
    ss_tot = float(((y - y.mean()) ** 2).sum())
    return 1.0 - ss_res / ss_tot if ss_tot else float("nan")


def predict_ms(output_tokens: float, model: str, fits: pd.DataFrame) -> float:
    """Latency of one call, from the fitted per-model throughput."""
    row = fits[fits["model"] == model]
    if row.empty:
        return float("nan")
    r = row.iloc[0]
    return output_tokens / r["tok_per_s"] * 1000.0 + r["overhead_ms"]


def batch_seconds(page_ms: float, pages: int, concurrency: int) -> float:
    """Wall-clock for a batch of pages at a given concurrency.

    Deliberately simple — ceil(pages / concurrency) waves of one page each.
    It ignores rate limiting, which is measured separately; where the two
    disagree, the measurement wins.
    """
    import math

    return math.ceil(pages / max(1, concurrency)) * page_ms / 1000.0
