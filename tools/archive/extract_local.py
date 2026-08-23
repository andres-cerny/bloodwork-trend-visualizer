"""Local/self-hosted extraction backends (Ollama and OpenAI-compatible).

Same contract as extract.extract_page — verbatim transcription of one page
image into a PageExtraction — but served by a local VLM instead of the Claude
API. The model string carries a backend prefix:

    ollama:qwen2.5vl:7b                   → Ollama /api/chat (structured outputs)
    openai:Qwen/Qwen2.5-VL-7B-Instruct    → any OpenAI-compatible server
                                            (vLLM, llama.cpp server, …)

Both backends constrain generation with the *same* JSON schema the Claude tool
uses, and reuse the same Czech system prompt, so the downstream reconcile /
normalize pipeline is identical regardless of who did the reading.

Server URL comes from BLOODWORK_LOCAL_URL (config.LOCAL_LLM_URL); without it
the backend's conventional default is used (Ollama http://localhost:11434,
OpenAI-compatible http://localhost:8000).

Quick local test (laptop, CPU — expect minutes per page):
    ollama pull qwen2.5vl:7b
    set BLOODWORK_MODEL_PRIMARY=ollama:qwen2.5vl:7b
    set BLOODWORK_MODEL_ESCALATION=none
    python -m src.pipeline samples/2025_08.pdf
"""
from __future__ import annotations

import base64
import json
import time
from pathlib import Path

import httpx

from .config import LOCAL_LLM_URL
from .extract import _SYSTEM, _TEXT_LAYER_HINT, _TOOL, PageExtraction, extraction_from_data
from .models import Page

_DEFAULT_URLS = {"ollama": "http://localhost:11434", "openai": "http://localhost:8000"}

# CPU inference of a dense lab page can legitimately take many minutes.
_TIMEOUT = httpx.Timeout(connect=10.0, read=1800.0, write=120.0, pool=30.0)

_MAX_OUTPUT_TOKENS = 12000  # matches the Claude path's max_tokens
_NUM_CTX = 16384  # Ollama only: a 220-DPI page yields thousands of vision tokens


class LocalLLMError(RuntimeError):
    """Failure talking to the local server; ``retryable`` guides the retry loop."""

    def __init__(self, msg: str, retryable: bool = True):
        super().__init__(msg)
        self.retryable = retryable


def _split(model: str) -> tuple[str, str]:
    """"ollama:qwen2.5vl:7b" → ("ollama", "qwen2.5vl:7b")."""
    backend, _, name = model.partition(":")
    if backend not in _DEFAULT_URLS or not name:
        raise LocalLLMError(f"Neznámý lokální model '{model}'.", retryable=False)
    return backend, name


def _base_url(backend: str) -> str:
    return (LOCAL_LLM_URL or _DEFAULT_URLS[backend]).rstrip("/")


def _user_text(page: Page) -> str:
    parts = []
    if page.text_layer:
        parts.append(_TEXT_LAYER_HINT + page.text_layer)
    # Smaller local models follow the schema but skimp on secondary columns —
    # first probe run (qwen2.5vl:7b): 34/34 values correct, 0/34 units filled.
    parts.append(
        "Přepiš všechny měřené řádky z této stránky ve formátu record_lab_results. "
        "U KAŽDÉHO řádku vyplň i 'unit_raw' (jednotka ze sloupce vedle hodnoty, "
        "např. 'mmol/l', 'µkat/l', '%') a 'ref_range_raw' (referenční meze). "
        "Do 'value_raw' patří jen hodnota bez značky '!' nebo '*'. "
        "'report_date' uveď ve formátu YYYY-MM-DD."
    )
    return "\n\n".join(parts)


def _post(url: str, payload: dict) -> dict:
    try:
        resp = httpx.post(url, json=payload, timeout=_TIMEOUT)
    except httpx.ConnectError as e:
        raise LocalLLMError(
            f"Lokální server neodpovídá na {url} — běží (ollama serve / vllm serve)? ({e})",
            retryable=False,
        ) from e
    except httpx.TimeoutException as e:
        raise LocalLLMError(f"Časový limit požadavku na {url} ({e}).") from e
    if resp.status_code == 404:
        raise LocalLLMError(
            f"HTTP 404 z {url} — je model stažený (ollama pull …)?", retryable=False
        )
    if resp.status_code >= 400:
        # 429/5xx are transient; other 4xx (bad payload) won't fix themselves
        raise LocalLLMError(
            f"HTTP {resp.status_code} z {url}: {resp.text[:300]}",
            retryable=resp.status_code == 429 or resp.status_code >= 500,
        )
    return resp.json()


def _parse_payload(content: str, page: Page) -> dict:
    if not (content or "").strip():
        raise LocalLLMError(f"Model vrátil prázdnou odpověď pro stránku {page.page_num}.")
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise LocalLLMError(
            f"Model nevrátil platný JSON pro stránku {page.page_num}: {e}"
        ) from e
    if not isinstance(data, dict):
        raise LocalLLMError(f"Model vrátil {type(data).__name__} místo objektu.")
    return data


def _call_ollama(page: Page, name: str, img_b64: str) -> tuple[dict, list[int]]:
    j = _post(f"{_base_url('ollama')}/api/chat", {
        "model": name,
        "stream": False,
        "format": _TOOL["input_schema"],  # schema-constrained decoding
        "options": {
            "temperature": 0,
            "num_ctx": _NUM_CTX,
            "num_predict": _MAX_OUTPUT_TOKENS,
        },
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": _user_text(page), "images": [img_b64]},
        ],
    })
    data = _parse_payload(j.get("message", {}).get("content", ""), page)
    return data, [j.get("prompt_eval_count", 0), j.get("eval_count", 0)]


def _call_openai(page: Page, name: str, img_b64: str) -> tuple[dict, list[int]]:
    j = _post(f"{_base_url('openai')}/v1/chat/completions", {
        "model": name,
        "temperature": 0,
        "max_tokens": _MAX_OUTPUT_TOKENS,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": _TOOL["name"],
                "strict": True,
                "schema": _TOOL["input_schema"],
            },
        },
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": [
                {"type": "image_url",
                 "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
                {"type": "text", "text": _user_text(page)},
            ]},
        ],
    })
    choices = j.get("choices") or []
    if not choices:
        raise LocalLLMError(f"Server nevrátil žádnou odpověď pro stránku {page.page_num}.")
    data = _parse_payload(choices[0].get("message", {}).get("content", ""), page)
    usage = j.get("usage") or {}
    return data, [usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)]


def extract_page_local(page: Page, model: str, attempts: int = 3) -> PageExtraction:
    """Transcribe a single page with a local model, retrying transient failures."""
    backend, name = _split(model)
    img_b64 = base64.standard_b64encode(Path(page.image_path).read_bytes()).decode()
    call = _call_ollama if backend == "ollama" else _call_openai

    for i in range(attempts):
        try:
            data, tokens = call(page, name, img_b64)
            return extraction_from_data(data, page, model, {model: tokens})
        except LocalLLMError as e:
            if i == attempts - 1 or not e.retryable:
                raise
            time.sleep(2 * (i + 1))
    raise RuntimeError("unreachable")
