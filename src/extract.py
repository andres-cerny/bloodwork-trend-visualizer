"""Claude vision extraction of one lab report.

The model's ONLY job is verbatim transcription of what is printed — raw analyte
name, value string (decimal comma kept), unit, reference-interval string, plus
a self-reported confidence. It never computes or normalizes numbers; that is
done deterministically in normalize.py afterwards.

Strategy: transcribe each page with Sonnet 5 (cheap, strong). Any page with a
low/medium-confidence row or a numeric-looking value that fails to parse is
re-transcribed with Opus 4.8 and the two are reconciled — a built-in accuracy
cross-check exactly where it matters.
"""
from __future__ import annotations

import base64
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import anthropic
from dotenv import load_dotenv

from .config import MODEL_ESCALATION, MODEL_PRIMARY
from .matching import norm_key
from .models import Measurement, Page

load_dotenv()  # pick up ANTHROPIC_API_KEY from a local .env if present

_SYSTEM = (
    "Jsi přesný přepisovač českých laboratorních výsledků z obrázku. "
    "Tvým jediným úkolem je VĚRNĚ PŘEPSAT to, co je vytištěno — nic nepočítej, "
    "nepřeváděj jednotky, needituj čísla. Zachovej desetinnou čárku přesně tak, "
    "jak je (např. '5,4', '<1,0'). Přepiš každý měřený řádek zvlášť; řádky "
    "neslučuj ani nerozděluj. U každého řádku uveď název analytu přesně jak je "
    "vytištěn (včetně předpony jako 'S_' nebo 'B_'), hodnotu, jednotku a "
    "referenční interval. Pokud je jednotka nebo interval ve zvláštním sloupci, "
    "přiřaď je ke správnému řádku. Confidence nastav 'low' u čehokoli, co je "
    "špatně čitelné nebo nejednoznačné."
)

_TEXT_LAYER_HINT = (
    "Nápověda — textová vrstva PDF (pořadí může být zpřeházené, "
    "obrázek je závazný pro přiřazení sloupců; text použij jen k "
    "ověření číslic):\n\n"
)

_TOOL = {
    "name": "record_lab_results",
    "description": "Zaznamenej přepsané laboratorní výsledky z jedné stránky.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "report_date": {
                "type": ["string", "null"],
                "description": "Datum odběru v ISO formátu YYYY-MM-DD (z 'Datum odběru' / 'Datum a čas odběru'), jinak null.",
            },
            "report_date_raw": {
                "type": ["string", "null"],
                "description": "Datum odběru přesně jak je vytištěno, jinak null.",
            },
            "lab_name": {"type": ["string", "null"]},
            "patient_name": {"type": ["string", "null"]},
            "patient_id": {
                "type": ["string", "null"],
                "description": "Rodné číslo / ID pacienta jak je vytištěno, jinak null.",
            },
            "measurements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "raw_analyte_name": {"type": "string"},
                        "value_raw": {"type": "string"},
                        "unit_raw": {"type": "string"},
                        "ref_range_raw": {"type": "string"},
                        "source_snippet": {
                            "type": "string",
                            "description": "Celý řádek tak, jak je vytištěn (pro ověření).",
                        },
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    },
                    "required": [
                        "raw_analyte_name", "value_raw", "unit_raw",
                        "ref_range_raw", "source_snippet", "confidence",
                    ],
                },
            },
        },
        "required": [
            "report_date", "report_date_raw", "lab_name",
            "patient_name", "patient_id", "measurements",
        ],
    },
}


@dataclass
class PageExtraction:
    report_date: Optional[str] = None
    report_date_raw: Optional[str] = None
    lab_name: Optional[str] = None
    patient_name: Optional[str] = None
    patient_id: Optional[str] = None
    measurements: list[Measurement] = field(default_factory=list)
    # tokens spent producing this extraction: {model: [input, output]}
    usage: dict[str, list[int]] = field(default_factory=dict)


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


def _merge_usage(total: dict[str, list[int]], part: dict[str, list[int]]) -> None:
    for model, (inp, out) in part.items():
        t = total.setdefault(model, [0, 0])
        t[0] += inp
        t[1] += out


def _retryable(e: anthropic.APIError) -> bool:
    status = getattr(e, "status_code", None)
    return status is None or status == 429 or status >= 500


def _is_local(model: str) -> bool:
    """True for backend-prefixed local/self-hosted models ("ollama:…", "openai:…")."""
    return model.partition(":")[0] in ("ollama", "openai")


def _extract_page_retry(page, model, client, attempts: int = 3) -> PageExtraction:
    """extract_page with backoff on transient API errors (on top of SDK retries)."""
    if _is_local(model):
        # local backends own their retry policy (different failure modes)
        from .extract_local import extract_page_local
        return extract_page_local(page, model, attempts=attempts)
    for i in range(attempts):
        try:
            return extract_page(page, model, client)
        except anthropic.APIError as e:
            if i == attempts - 1 or not _retryable(e):
                raise
            time.sleep(2 * (i + 1))
    raise RuntimeError("unreachable")


def _val_key(value_raw: str) -> str:
    """Compare-key for two model reads of the same value: ignore the lab's
    out-of-range markers ("!", "*") and whitespace so '1,97' and '1,97 !' match."""
    return (value_raw or "").replace("!", "").replace("*", "").replace(" ", "").strip()


def extract_page(
    page: Page, model: str, client: Optional[anthropic.Anthropic] = None
) -> PageExtraction:
    """Transcribe a single page image with the given model."""
    client = client or _client()
    img_b64 = base64.standard_b64encode(Path(page.image_path).read_bytes()).decode()

    content: list[dict] = [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": img_b64},
        }
    ]
    if page.text_layer:
        content.append({"type": "text", "text": _TEXT_LAYER_HINT + page.text_layer})
    content.append({
        "type": "text",
        "text": "Přepiš všechny měřené řádky z této stránky pomocí nástroje record_lab_results.",
    })

    resp = client.messages.create(
        model=model,
        max_tokens=12000,
        thinking={"type": "disabled"},
        system=_SYSTEM,
        tools=[_TOOL],
        tool_choice={"type": "tool", "name": "record_lab_results"},
        messages=[{"role": "user", "content": content}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError(f"Model odmítl přepis stránky {page.page_num}.")

    tool_use = next((b for b in resp.content if b.type == "tool_use"), None)
    if tool_use is None:
        raise RuntimeError(f"Model nevrátil strukturovaný výstup pro stránku {page.page_num}.")

    usage = {model: [resp.usage.input_tokens, resp.usage.output_tokens]} if resp.usage else {}
    return extraction_from_data(tool_use.input, page, model, usage)


def extraction_from_data(
    data: dict, page: Page, model: str, usage: dict[str, list[int]]
) -> PageExtraction:
    """Build a PageExtraction from one record_lab_results payload (any backend)."""
    rows = [
        Measurement(
            raw_analyte_name=r["raw_analyte_name"],
            value_raw=r.get("value_raw", ""),
            unit_raw=r.get("unit_raw", ""),
            ref_range_raw=r.get("ref_range_raw", ""),
            source_snippet=r.get("source_snippet", ""),
            confidence=r.get("confidence", "high"),
            source_page=page.page_num,
            extracted_by=model,
        )
        for r in data.get("measurements", [])
        if r.get("raw_analyte_name", "").strip()  # drop empty/garbage rows
    ]
    return PageExtraction(
        report_date=data.get("report_date"),
        report_date_raw=data.get("report_date_raw"),
        lab_name=data.get("lab_name"),
        patient_name=data.get("patient_name"),
        patient_id=data.get("patient_id"),
        measurements=rows,
        usage=usage,
    )


def _reconcile(
    primary: list[Measurement],
    escalated: list[Measurement],
    primary_label: str,
    escalation_label: str,
) -> list[Measurement]:
    """Union the two independent reads, row-by-row on the analyte name.

    Agreement → high confidence. Disagreement → keep the escalation value,
    flagged low with a note. A row only one model saw is included but flagged
    low — this is what catches silent *under*-extraction (a model dropping
    rows), the failure the confidence signal alone misses.
    """
    esc_by_key = {norm_key(e.raw_analyte_name): e for e in escalated}
    prim_keys = {norm_key(p.raw_analyte_name) for p in primary}
    used: set[str] = set()
    out: list[Measurement] = []

    for p in primary:
        k = norm_key(p.raw_analyte_name)
        e = esc_by_key.get(k)
        p.escalated = True
        if e is None:
            p.disagreement = f"Řádek našel jen {primary_label} — zkontroluj proti obrázku."
            p.confidence = "low"
            out.append(p)
            continue
        used.add(k)
        same = (_val_key(p.value_raw) == _val_key(e.value_raw)
                and p.unit_raw.strip() == e.unit_raw.strip())
        if same:
            # Keep the cleaner value_raw (without the "!" out-of-range marker).
            if "!" in p.value_raw and "!" not in e.value_raw:
                p.value_raw = e.value_raw
            p.confidence = "high"  # two independent reads agree
        else:
            p.disagreement = (
                f"Neshoda čtení — {primary_label}: '{p.value_raw} {p.unit_raw}' | "
                f"{escalation_label}: '{e.value_raw} {e.unit_raw}'. "
                f"Zvolena hodnota {escalation_label}."
            )
            p.value_raw = e.value_raw
            p.unit_raw = e.unit_raw
            p.ref_range_raw = e.ref_range_raw or p.ref_range_raw
            p.confidence = "low"  # keep flagged for the human check
            p.extracted_by = f"{primary_label}+{escalation_label}"
        out.append(p)

    for e in escalated:
        if norm_key(e.raw_analyte_name) not in prim_keys:
            e.escalated = True
            e.disagreement = f"Řádek našel jen {escalation_label} — zkontroluj proti obrázku."
            e.confidence = "low"
            out.append(e)
    return out


def _extract_page_pair(
    page: Page,
    primary_model: str,
    escalation_model: Optional[str],
    client: anthropic.Anthropic,
) -> tuple[list[Measurement], PageExtraction, list[str], dict[str, list[int]]]:
    """Extract one page with both models (concurrently), balance + reconcile.

    Runs in a worker thread, so no Streamlit/progress calls here — human-readable
    notes are returned for the main thread to display. Returns
    (rows, primary_extraction_for_meta, notes, usage).
    """
    notes: list[str] = []
    usage: dict[str, list[int]] = {}
    prim_label = _short(primary_model)
    esc_label = _short(escalation_model) if escalation_model else ""

    if not escalation_model:
        prim = _extract_page_retry(page, primary_model, client)
        _merge_usage(usage, prim.usage)
        return prim.measurements, prim, notes, usage

    # The two independent reads run concurrently — this halves page wall time.
    with ThreadPoolExecutor(max_workers=2) as ex:
        prim_f = ex.submit(_extract_page_retry, page, primary_model, client)
        esc_f = ex.submit(_extract_page_retry, page, escalation_model, client)
        prim, esc = prim_f.result(), esc_f.result()
    _merge_usage(usage, prim.usage)
    _merge_usage(usage, esc.usage)

    prim, esc = _balance_reads(page, primary_model, escalation_model,
                               prim, esc, client, notes, usage)
    # In hybrid mode (local primary + Claude escalation) trust the Claude read
    # for report meta — local models return e.g. non-ISO dates ('03.09.25').
    meta_src = esc if (_is_local(primary_model)
                       and not _is_local(escalation_model)) else prim
    lp, le = len(prim.measurements), len(esc.measurements)
    hi, lo = max(lp, le), min(lp, le)
    if hi >= 5 and lo < 0.5 * hi:
        # One model failed this page even after retries — no real
        # cross-check is possible. Trust the complete read at face value
        # instead of flagging every row as a false "found only by…".
        winner = prim if lp >= le else esc
        w_label = prim_label if lp >= le else esc_label
        notes.append(f"Strana {page.page_num}: druhý model selhal, beru "
                     f"kompletní čtení ({w_label}, {len(winner.measurements)} řádků).")
        rows = winner.measurements
        for r in rows:
            r.extracted_by = w_label
    else:
        rows = _reconcile(prim.measurements, esc.measurements, prim_label, esc_label)
    return rows, meta_src, notes, usage


def extract_report(
    pages: list[Page],
    *,
    primary_model: str = MODEL_PRIMARY,
    escalation_model: Optional[str] = MODEL_ESCALATION,
    client: Optional[anthropic.Anthropic] = None,
    progress=None,
    max_page_workers: int = 2,
) -> dict:
    """Extract all pages (concurrently), cross-checking each with both models.

    Returns raw (unprocessed) rows plus merged report metadata, token usage per
    model, and per-page errors (pages that failed even after retries are skipped
    rather than failing the whole report). Deterministic processing downstream.
    """
    # An Anthropic client (and API key) is only needed if a Claude model is in play.
    needs_api = not _is_local(primary_model) or (
        escalation_model is not None and not _is_local(escalation_model)
    )
    client = client or (_client() if needs_api else None)
    meta = {"report_date": None, "report_date_raw": None, "lab_name": None,
            "patient_name": None, "patient_id": None}
    n = len(pages)
    prim_label = _short(primary_model)
    esc_label = _short(escalation_model) if escalation_model else ""

    if progress:
        both = f" + {esc_label} křížová kontrola" if escalation_model else ""
        progress(f"Čtu {n} stran ({prim_label}{both}, souběžně)…")

    results: dict[int, tuple[list[Measurement], PageExtraction]] = {}
    errors: dict[int, str] = {}
    usage: dict[str, list[int]] = {}
    with ThreadPoolExecutor(max_workers=max_page_workers) as ex:
        futs = {ex.submit(_extract_page_pair, page, primary_model,
                          escalation_model, client): page for page in pages}
        for fut in as_completed(futs):
            page = futs[fut]
            try:
                rows, prim, notes, page_usage = fut.result()
            except Exception as e:
                errors[page.page_num] = str(e)
                if progress:
                    progress(f"⚠️ Strana {page.page_num}/{n} selhala: {e}")
                continue
            results[page.page_num] = (rows, prim)
            _merge_usage(usage, page_usage)
            if progress:
                for note in notes:
                    progress(note)
                progress(f"Strana {page.page_num}/{n}: {len(rows)} řádků.")

    if errors and not results:
        raise RuntimeError("Žádnou stránku se nepodařilo přečíst: "
                           + "; ".join(f"str. {p}: {e}" for p, e in sorted(errors.items())))

    all_rows: list[Measurement] = []
    for page_num in sorted(results):
        rows, prim = results[page_num]
        all_rows.extend(rows)
        for k in meta:
            if meta[k] is None and getattr(prim, k) is not None:
                meta[k] = getattr(prim, k)

    return {"meta": meta, "measurements": all_rows, "usage": usage, "errors": errors}


def _balance_reads(page, primary_model, escalation_model, prim, esc, client,
                   notes: list[str], usage: dict[str, list[int]],
                   max_retries: int = 2):
    """Re-run whichever model returned far fewer rows than the other.

    The two independent reads act as each other's completeness expectation. A
    model that intermittently drops most of a page (returns ≪ the other) is
    retried, keeping its most complete attempt — this fixes silent
    under-extraction without a lab-specific row-count heuristic.
    """
    for _ in range(max_retries):
        lp, le = len(prim.measurements), len(esc.measurements)
        hi, lo = max(lp, le), min(lp, le)
        if hi == 0 or lo >= 0.6 * hi or (hi - lo) < 5:
            break  # counts are close enough — no obvious flake
        if lp < le:
            notes.append(f"Strana {page.page_num}: {_short(primary_model)} vrátil "
                         f"{lp} vs {le} řádků — čtení opakováno.")
            again = _extract_page_retry(page, primary_model, client)
            _merge_usage(usage, again.usage)
            if len(again.measurements) > lp:
                prim = again
        else:
            notes.append(f"Strana {page.page_num}: {_short(escalation_model)} vrátil "
                         f"{le} vs {lp} řádků — čtení opakováno.")
            again = _extract_page_retry(page, escalation_model, client)
            _merge_usage(usage, again.usage)
            if len(again.measurements) > le:
                esc = again
    return prim, esc


def _short(model: str) -> str:
    """Human-friendly short model label for notes ('Sonnet', 'Opus', 'qwen2.5vl')."""
    if _is_local(model):
        # "ollama:qwen2.5vl:7b" → "qwen2.5vl"; "openai:Qwen/…-Instruct" → "…-Instruct"
        name = model.split(":", 1)[1].split("/")[-1]
        return name.split(":")[0] or model
    if "sonnet" in model:
        return "Sonnet"
    if "opus" in model:
        return "Opus"
    if "haiku" in model:
        return "Haiku"
    return model
