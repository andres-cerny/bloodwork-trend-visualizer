"""Tests for the local-backend adapter (Ollama / OpenAI-compatible) — request
shape, response parsing into PageExtraction, retry policy, and the dispatch
from extract.py. All HTTP is stubbed; no server or model needed.

    python3 tests/test_extract_local.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx

from src import extract, extract_local
from src.extract_local import LocalLLMError, extract_page_local
from src.models import Page

OLLAMA_MODEL = "ollama:qwen2.5vl:7b"
OPENAI_MODEL = "openai:Qwen/Qwen2.5-VL-7B-Instruct"

_PAYLOAD = {
    "report_date": "2025-08-01",
    "report_date_raw": "1.8.2025",
    "lab_name": "Lab s.r.o.",
    "patient_name": None,
    "patient_id": None,
    "measurements": [
        {"raw_analyte_name": "S_Glukóza", "value_raw": "5,4", "unit_raw": "mmol/l",
         "ref_range_raw": "3,9 - 5,6", "source_snippet": "S_Glukóza 5,4 mmol/l",
         "confidence": "high"},
        {"raw_analyte_name": "  ", "value_raw": "x", "unit_raw": "",
         "ref_range_raw": "", "source_snippet": "", "confidence": "low"},  # dropped
    ],
}


class _Resp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class _StubHTTPX:
    """Stands in for the httpx *module* inside extract_local; keeps real classes."""
    ConnectError = httpx.ConnectError
    TimeoutException = httpx.TimeoutException
    Timeout = httpx.Timeout

    def __init__(self, handler):
        self.handler = handler
        self.calls = []

    def post(self, url, json=None, timeout=None):
        self.calls.append((url, json))
        return self.handler(url, json)


def _page() -> Page:
    fd, path = tempfile.mkstemp(suffix=".png")
    os.write(fd, b"\x89PNG fake image bytes")
    os.close(fd)
    return Page(page_num=1, image_path=path, text_layer="S_Glukóza 5,4 mmol/l")


def _with_stub(handler, fn):
    """Run fn() with extract_local's httpx (and sleep) replaced; restore after."""
    stub = _StubHTTPX(handler)
    orig_httpx, orig_time = extract_local.httpx, extract_local.time
    extract_local.httpx = stub

    class _NoSleep:
        @staticmethod
        def sleep(_):
            pass

    extract_local.time = _NoSleep
    try:
        return fn(), stub
    finally:
        extract_local.httpx, extract_local.time = orig_httpx, orig_time


# --- Ollama backend ----------------------------------------------------------
def test_ollama_request_and_parsing():
    def handler(url, payload):
        assert url.endswith("/api/chat")
        assert payload["model"] == "qwen2.5vl:7b"
        assert payload["format"] == extract._TOOL["input_schema"]
        assert payload["options"]["temperature"] == 0
        assert payload["messages"][0]["content"] == extract._SYSTEM
        user = payload["messages"][1]
        assert user["images"], "page image must be attached"
        assert "textová vrstva" in user["content"], "text-layer hint missing"
        return _Resp({"message": {"content": json.dumps(_PAYLOAD)},
                      "prompt_eval_count": 12, "eval_count": 34})

    result, stub = _with_stub(handler, lambda: extract_page_local(_page(), OLLAMA_MODEL))
    assert len(stub.calls) == 1
    assert result.report_date == "2025-08-01"
    assert result.lab_name == "Lab s.r.o."
    assert len(result.measurements) == 1, "blank-name row must be dropped"
    m = result.measurements[0]
    assert (m.raw_analyte_name, m.value_raw, m.unit_raw) == ("S_Glukóza", "5,4", "mmol/l")
    assert m.extracted_by == OLLAMA_MODEL
    assert result.usage == {OLLAMA_MODEL: [12, 34]}


# --- OpenAI-compatible backend ------------------------------------------------
def test_openai_request_and_parsing():
    def handler(url, payload):
        assert url.endswith("/v1/chat/completions")
        assert payload["model"] == "Qwen/Qwen2.5-VL-7B-Instruct"
        rf = payload["response_format"]
        assert rf["type"] == "json_schema"
        assert rf["json_schema"]["schema"] == extract._TOOL["input_schema"]
        image_part = payload["messages"][1]["content"][0]
        assert image_part["image_url"]["url"].startswith("data:image/png;base64,")
        return _Resp({"choices": [{"message": {"content": json.dumps(_PAYLOAD)}}],
                      "usage": {"prompt_tokens": 100, "completion_tokens": 200}})

    result, _ = _with_stub(handler, lambda: extract_page_local(_page(), OPENAI_MODEL))
    assert len(result.measurements) == 1
    assert result.usage == {OPENAI_MODEL: [100, 200]}


# --- retry policy --------------------------------------------------------------
def test_transient_500_is_retried():
    state = {"n": 0}

    def handler(url, payload):
        state["n"] += 1
        if state["n"] == 1:
            return _Resp({"error": "boom"}, status=500)
        return _Resp({"message": {"content": json.dumps(_PAYLOAD)}})

    result, stub = _with_stub(handler, lambda: extract_page_local(_page(), OLLAMA_MODEL))
    assert len(stub.calls) == 2
    assert len(result.measurements) == 1


def test_connect_error_fails_fast():
    def handler(url, payload):
        raise httpx.ConnectError("no server")

    try:
        _with_stub(handler, lambda: extract_page_local(_page(), OLLAMA_MODEL))
        raise AssertionError("expected LocalLLMError")
    except LocalLLMError as e:
        assert not e.retryable
        assert "neodpovídá" in str(e)


def test_invalid_json_is_retried_then_raises():
    state = {"n": 0}

    def handler(url, payload):
        state["n"] += 1
        return _Resp({"message": {"content": "not json {"}})

    try:
        _with_stub(handler, lambda: extract_page_local(_page(), OLLAMA_MODEL))
        raise AssertionError("expected LocalLLMError")
    except LocalLLMError as e:
        assert "JSON" in str(e)
    assert state["n"] == 3, "invalid JSON should be retried up to `attempts` times"


# --- dispatch + labels ----------------------------------------------------------
def test_extract_dispatches_local_models_without_client():
    def handler(url, payload):
        return _Resp({"message": {"content": json.dumps(_PAYLOAD)}})

    result, _ = _with_stub(
        handler, lambda: extract._extract_page_retry(_page(), OLLAMA_MODEL, client=None))
    assert len(result.measurements) == 1


def test_is_local_and_short_labels():
    assert extract._is_local(OLLAMA_MODEL)
    assert extract._is_local(OPENAI_MODEL)
    assert not extract._is_local("claude-sonnet-5")
    assert extract._short(OLLAMA_MODEL) == "qwen2.5vl"
    assert extract._short(OPENAI_MODEL) == "Qwen2.5-VL-7B-Instruct"
    assert extract._short("claude-sonnet-5") == "Sonnet"


def test_unknown_prefix_rejected():
    try:
        extract_page_local(_page(), "mistral:foo")
        raise AssertionError("expected LocalLLMError")
    except LocalLLMError as e:
        assert not e.retryable


if __name__ == "__main__":
    import traceback

    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    passed = failed = 0
    for fn in fns:
        try:
            fn()
            passed += 1
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
