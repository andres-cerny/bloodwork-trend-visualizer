"""Shared paths and configuration constants."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()  # so BLOODWORK_* / ANTHROPIC_API_KEY from .env are visible here

# Project layout ------------------------------------------------------------
# tools/pipeline/src/config.py -> repo root is four levels up. The pipeline
# was demoted out of the repo root, but the data and samples it reads still
# live there.
ROOT = Path(__file__).resolve().parents[3]
SAMPLES_DIR = ROOT / "samples"
DATA_DIR = ROOT / "data"
REPORTS_DIR = DATA_DIR / "reports"
PAGE_IMAGES_DIR = DATA_DIR / "page_images"
UPLOADS_DIR = DATA_DIR / "uploads"
REGISTRY_PATH = DATA_DIR / "registry.json"

# Rendering -----------------------------------------------------------------
# 220 DPI keeps small table digits crisp for the vision model without making
# the images huge. (72 DPI is the PDF default; 220/72 ≈ 3.05x zoom.)
RENDER_DPI = 220

# Extraction models ----------------------------------------------------------
# Each slot holds either a Claude model id ("claude-sonnet-5") or a local /
# self-hosted model with a backend prefix handled by extract_local.py:
#   "ollama:qwen2.5vl:7b"                    → Ollama structured-output chat
#   "openai:Qwen/Qwen2.5-VL-7B-Instruct"     → any OpenAI-compatible server (vLLM…)
# Overridable per run via env, e.g. for a local-accuracy test:
#   BLOODWORK_MODEL_PRIMARY=ollama:qwen2.5vl:7b BLOODWORK_MODEL_ESCALATION=none
MODEL_PRIMARY = os.getenv("BLOODWORK_MODEL_PRIMARY", "claude-sonnet-5")
_esc = os.getenv("BLOODWORK_MODEL_ESCALATION", "claude-opus-4-8").strip()
MODEL_ESCALATION = None if _esc.lower() in ("", "none", "off") else _esc

# Base URL of the local/self-hosted server. When unset, extract_local.py picks
# the backend's conventional default (Ollama :11434, OpenAI-compatible :8000).
LOCAL_LLM_URL = os.getenv("BLOODWORK_LOCAL_URL") or None

# USD per million tokens (input, output) — for the per-report cost readout.
MODEL_PRICING = {
    "claude-sonnet-5": (3.00, 15.00),
    "claude-opus-4-8": (5.00, 25.00),
}
USD_TO_CZK = 23.0  # approximate, display only


def ensure_dirs() -> None:
    """Create the data directories if they do not yet exist."""
    for d in (DATA_DIR, REPORTS_DIR, PAGE_IMAGES_DIR, UPLOADS_DIR):
        d.mkdir(parents=True, exist_ok=True)
