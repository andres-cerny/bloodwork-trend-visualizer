"""Bloodwork trend visualizer — Streamlit UI (Czech).

Three views: trends per analyte (with reference band + out-of-range flags),
a descriptive summary of what changed, and a verification panel that shows the
extracted table next to the source page image with low-confidence rows flagged.
"""
from __future__ import annotations

import os
import re

import altair as alt
import pandas as pd
import streamlit as st
from dotenv import load_dotenv
from PIL import Image, ImageDraw

from src.config import SAMPLES_DIR, UPLOADS_DIR, ensure_dirs
from src.locate import find_source_pdf, row_bbox
from src.matching import (convert_to_canonical, load_registry, observed_stats,
                          save_registry, suggest_mappings)
from src.normalize import canonicalize_unit, normalize_measurement
from src.pipeline import format_cost, ingest_and_extract
from src.storage import delete_report, list_reports, load_report, report_exists, save_report
from src.summary import cz_num, summarize_changes
from src.trends import build_trends, latest_two
from src.ingest import report_id_for

load_dotenv()
ensure_dirs()

st.set_page_config(page_title="Vývoj krevních výsledků", page_icon="🩸", layout="wide")

FLAG_LABEL = {"normal": "v normě", "low": "nízká", "high": "vysoká", "unknown": "—"}
FLAG_COLOR = {"normal": "#2e7d32", "low": "#1565c0", "high": "#c62828", "unknown": "#9e9e9e"}
STATUS_BADGE = {"high": "🔴 vysoká", "low": "🔵 nízká",
                "normal": "🟢 v normě", "unknown": "⚪ —"}


def _trend_frame(t, date_from=None, date_to=None):
    """DataFrame of all points for a trend, optionally filtered by a date range."""
    rows = [{
        "datum": p.date, "hodnota": p.value, "value_raw": p.value_raw,
        "unit": p.unit or "", "flag": p.flag,
        "ref_low": p.ref_low, "ref_high": p.ref_high,
    } for p in t.points]
    df = pd.DataFrame(rows)
    if not df.empty:
        df["datum"] = pd.to_datetime(df["datum"])
        if date_from is not None:
            df = df[df["datum"] >= pd.Timestamp(date_from)]
        if date_to is not None:
            df = df[df["datum"] <= pd.Timestamp(date_to)]
    return df


def _unit_key(u):
    """Loose unit identity for grouping a series: unifies cosmetic variants
    (spaces, comma/dot, caret — e.g. the eGFR unit spellings) while still
    separating genuinely different units (% vs 10^9/l)."""
    u = canonicalize_unit(u or "")
    return u.lower().replace(" ", "").replace("^", "").replace(",", ".")


def _x_axis(df_num):
    """Date axis whose label format matches the visible span (year / month-year
    / day) so labels are always unambiguous and fit the data actually shown."""
    span = (df_num["datum"].max() - df_num["datum"].min()).days
    if span > 730:          # multi-year → year labels
        fmt, angle = "%Y", 0
    elif span > 90:         # months to ~2 years → month/year
        fmt, angle = "%m/%Y", 0
    elif span > 0:          # weeks/months → day.month.year (short)
        fmt, angle = "%d.%m.%y", -40
    else:                   # single measurement → full date
        fmt, angle = "%d.%m.%Y", 0
    return alt.X("datum:T", title="datum odběru",
                 axis=alt.Axis(format=fmt, labelAngle=angle, labelOverlap="greedy",
                               tickCount=min(len(df_num), 8) or 1))


def _y_domain(df_num, lo, hi):
    """Tight y-range: the reference band plus a small margin, extended only as
    far as needed to include the actual data points (no needless blow-up)."""
    dmin, dmax = df_num["hodnota"].min(), df_num["hodnota"].max()
    if lo is not None and hi is not None and hi > lo:
        margin = (hi - lo) * 0.20            # a little above/below the ref band
    else:
        span = dmax - dmin
        margin = span * 0.15 or max(abs(dmax) * 0.15, 1.0)
    lo_ref = lo if lo is not None else dmin
    hi_ref = hi if hi is not None else dmax
    return min(lo_ref, dmin) - margin, max(hi_ref, dmax) + margin


def _build_trend_chart(df_num, lo, hi, unit_sfx=""):
    """Build the layered Altair chart (colored zones + line + points) with a
    single fixed y-scale shared by every layer. Pure function — no Streamlit —
    so the compiled y-domain can be asserted in tests."""
    y0, y1 = _y_domain(df_num, lo, hi)
    # The scale must be applied to the rect bands too: rect marks default to
    # zero=True, which would otherwise drag the shared axis down to 0 (e.g.
    # Hematokrit showing 0–0.5 instead of the tight band around 0.38–0.52).
    yscale = alt.Scale(domain=[y0, y1], nice=False, clamp=True, zero=False)

    def band(lo_v, hi_v, color, opacity):
        return (alt.Chart(pd.DataFrame({"lo": [lo_v], "hi": [hi_v]}))
                .mark_rect(opacity=opacity, color=color)
                .encode(y=alt.Y("lo:Q", scale=yscale), y2="hi:Q"))

    # Colored zones: green in range, blue below low, red above high.
    layers = []
    if lo is not None or hi is not None:
        band_lo = lo if lo is not None else y0
        band_hi = hi if hi is not None else y1
        layers.append(band(band_lo, band_hi, FLAG_COLOR["normal"], 0.12))
        if lo is not None:
            layers.append(band(y0, lo, FLAG_COLOR["low"], 0.10))
        if hi is not None:
            layers.append(band(hi, y1, FLAG_COLOR["high"], 0.10))

    xenc = _x_axis(df_num)
    line = alt.Chart(df_num).mark_line(color="#607d8b").encode(
        x=xenc,
        y=alt.Y("hodnota:Q", title=f"hodnota{unit_sfx}", scale=yscale),
    )
    pts = alt.Chart(df_num).mark_point(size=90, filled=True).encode(
        x=xenc,
        y=alt.Y("hodnota:Q", scale=yscale),
        color=alt.Color(
            "flag:N",
            scale=alt.Scale(domain=list(FLAG_COLOR.keys()),
                            range=list(FLAG_COLOR.values())),
            legend=alt.Legend(title="stav",
                              labelExpr="{'normal':'v normě','low':'nízká',"
                                        "'high':'vysoká','unknown':'—'}[datum.label]"),
        ),
        tooltip=[
            alt.Tooltip("datum:T", title="datum", format="%d.%m.%Y"),
            alt.Tooltip("value_raw:N", title="vytištěno"),
            alt.Tooltip("hodnota:Q", title="hodnota"),
            alt.Tooltip("flag:N", title="stav"),
        ],
    )
    return alt.layer(*layers, line, pts).properties(height=380)


def render_trend_chart(t, date_from=None, date_to=None):
    """Latest-value header, status badge, reference-range line, and the chart."""
    # Latest value + delta + status badge (uses the full series, not filtered)
    older, newer = latest_two(t)
    delta = (newer.value - older.value) if (newer and older) else None
    mcol, bcol = st.columns([2, 3])
    mcol.metric(
        "Poslední hodnota",
        f"{cz_num(newer.value)} {t.unit}" if newer else "—",
        delta=f"{cz_num(delta)} {t.unit}" if delta is not None else None,
        delta_color="off",
    )
    # Badge nudged down so it lines up with the metric's value, not its label.
    bcol.markdown(
        f"<div style='padding-top:0.9rem;font-size:1.5rem'>"
        f"{STATUS_BADGE[newer.flag if newer else 'unknown']}</div>",
        unsafe_allow_html=True,
    )

    # Note when the latest value falls outside the selected window (the metric
    # above still reports the overall latest, so flag the mismatch).
    if newer is not None:
        newer_dt = pd.Timestamp(newer.date)
        outside = ((date_from is not None and newer_dt < pd.Timestamp(date_from))
                   or (date_to is not None and newer_dt > pd.Timestamp(date_to)))
        if outside:
            st.caption(f"ℹ️ Poslední hodnota ({newer.date}) je mimo zvolené období.")

    # Reference range + unit stated above the graph
    last = t.numeric_points[-1] if t.numeric_points else None
    lo = last.ref_low if last else None
    hi = last.ref_high if last else None
    if lo is not None or hi is not None:
        st.markdown(f"**Referenční rozmezí:** {cz_num(lo)}–{cz_num(hi)} {t.unit}"
                    f"  ·  **jednotka:** {t.unit or '—'}")
    else:
        st.caption(f"Referenční rozmezí není k dispozici · jednotka: {t.unit or '—'}")

    df = _trend_frame(t, date_from, date_to)
    df_num = df[df["hodnota"].notna()].copy() if not df.empty else df

    unit_sfx = f" [{t.unit}]" if t.unit else ""
    if df_num.empty:
        if t.numeric_points:
            st.info("Ve zvoleném období nejsou žádné číselné hodnoty — "
                    "rozšiř období výše.")
        else:
            st.info("Pro tento analyt nejsou číselné hodnoty "
                    "(např. jen „<1,0“ nebo „neprovedeno“).")
        return

    # Plot a single unit only. Some analytes (e.g. diferenciál — Neutrofily,
    # Lymfocyty) are reported sometimes in % and sometimes in 10^9/l; mixing
    # them on one axis is meaningless. Keep points in the latest report's unit
    # (which the reference range belongs to) and note the ones dropped.
    ref_unit = canonicalize_unit((newer.unit if newer else t.unit) or "")
    ref_key = _unit_key(newer.unit if newer else t.unit)
    if ref_key:
        keep = df_num["unit"].map(lambda u: _unit_key(u) in (ref_key, ""))
        n_hidden = int((~keep).sum())
        df_num = df_num[keep]
        if n_hidden:
            st.caption(f"ℹ️ {n_hidden} měření v jiné jednotce než „{ref_unit}“ "
                       f"není v grafu zobrazeno (viz tabulka).")
    if df_num.empty:
        st.info("Ve zvoleném období nejsou hodnoty ve stejné jednotce.")
        return

    chart = _build_trend_chart(df_num, lo, hi, unit_sfx)
    st.altair_chart(chart, use_container_width=True)


def render_trend_table(t, date_from=None, date_to=None):
    """Table of all points (incl. censored), optionally filtered by a date range."""
    df = _trend_frame(t, date_from, date_to)
    if df.empty:
        st.info("Žádné hodnoty v tomto období.")
        return
    show = df.copy()
    show["datum"] = show["datum"].dt.strftime("%d.%m.%Y")
    show["stav"] = show["flag"].map(FLAG_LABEL)
    show = show[["datum", "value_raw", "unit", "stav"]].rename(
        columns={"value_raw": "vytištěná hodnota", "unit": "jednotka"})
    st.dataframe(show, use_container_width=True, hide_index=True)
    st.download_button(
        "⬇️ Stáhnout jako CSV",
        show.to_csv(index=False).encode("utf-8-sig"),
        file_name=f"{t.display_name}.csv", mime="text/csv",
        key=f"csv_{t.canonical_id}_{date_from}_{date_to}",
    )


def _add_trend_slot():
    st.session_state.trend_slots.append(st.session_state.trend_next_uid)
    st.session_state.trend_next_uid += 1


def _remove_trend_slot(uid):
    # Remove via on_click callback (not an in-loop st.rerun): the callback runs
    # before the script re-executes, so every remaining slot re-renders normally
    # and keeps its widget state. A mid-loop st.rerun() would abort before the
    # later slots render, and Streamlit would then discard their selections.
    if uid in st.session_state.trend_slots:
        st.session_state.trend_slots.remove(uid)


@st.cache_resource
def get_registry():
    return load_registry()


def refresh_reports():
    st.session_state["reports"] = list_reports()


if "reports" not in st.session_state:
    refresh_reports()

registry = get_registry()
reports = st.session_state["reports"]


# --------------------------------------------------------------------------- #
# Sidebar: ingest
# --------------------------------------------------------------------------- #
st.sidebar.title("🩸 Krevní výsledky")

api_ok = bool(os.environ.get("ANTHROPIC_API_KEY"))
if not api_ok:
    st.sidebar.error(
        "Chybí ANTHROPIC_API_KEY. Vlož ho do souboru `.env` v kořeni projektu "
        "(`ANTHROPIC_API_KEY=sk-ant-...`) a aplikaci restartuj."
    )


def _find_duplicate(pdf_path):
    """An already-stored report with the same PDF content (id ends in the same
    content hash) but a different id — i.e. the same file under another name."""
    rid = report_id_for(pdf_path)
    h = rid.rsplit("_", 1)[-1]
    for r in reports:
        if r.id != rid and r.id.endswith("_" + h):
            return r
    return None


def _process_batch(pdf_paths, *, force=False):
    """Process PDFs one by one with a live status panel; results persist in
    session state so they survive the rerun (a failure can't vanish)."""
    results = []
    for pdf in pdf_paths:
        rid = report_id_for(pdf)
        if not force and report_exists(rid):
            results.append(("ℹ️", pdf.name, "už zpracováno — přeskočeno (načteno z disku)"))
            continue
        dup = _find_duplicate(pdf)
        if dup is not None:
            results.append(("⚠️", pdf.name,
                            f"stejný obsah jako „{dup.source_file}“ — přeskočeno"))
            continue
        with st.sidebar.status(f"Zpracovávám {pdf.name}…", expanded=True) as status:
            try:
                report, _unmatched = ingest_and_extract(
                    pdf, registry, progress=status.write)
                cost = format_cost(report.stats)
                msg = f"{len(report.measurements)} hodnot" + (f" · {cost}" if cost else "")
                status.update(label=f"✅ {pdf.name}", state="complete", expanded=False)
                results.append(("✅", pdf.name, msg))
            except Exception as e:  # surface API/parse errors plainly
                status.update(label=f"❌ {pdf.name}", state="error")
                results.append(("❌", pdf.name, str(e)))
    save_registry(registry)
    st.session_state["proc_results"] = results
    refresh_reports()
    st.rerun()


# --- drag & drop upload ------------------------------------------------------
st.sidebar.subheader("Nahrát vlastní PDF")
uploaded = st.sidebar.file_uploader(
    "Přetáhněte sem laboratorní PDF", type=["pdf"], accept_multiple_files=True)
if uploaded and st.sidebar.button(
        f"Zpracovat nahrané ({len(uploaded)})", type="primary",
        disabled=not api_ok, use_container_width=True):
    paths = []
    for uf in uploaded:
        dest = UPLOADS_DIR / os.path.basename(uf.name)
        dest.write_bytes(uf.getvalue())
        paths.append(dest)
    _process_batch(paths)

# --- samples/ folder ----------------------------------------------------------
st.sidebar.subheader("Nebo ze složky samples/")
sample_pdfs = sorted(SAMPLES_DIR.glob("*.pdf"))
labels = []
for p in sample_pdfs:
    done = "✅ " if report_exists(report_id_for(p)) else "◻️ "
    labels.append(done + p.name)
choice = st.sidebar.selectbox("Vyber PDF", options=list(range(len(sample_pdfs))),
                              format_func=lambda i: labels[i] if sample_pdfs else "—") \
    if sample_pdfs else None

col_a, col_b = st.sidebar.columns(2)
if sample_pdfs:
    sel_pdf = sample_pdfs[choice]
    sel_done = report_exists(report_id_for(sel_pdf))
    btn_label = "Znovu zpracovat" if sel_done else "Zpracovat"
    if sel_done:
        st.sidebar.caption("✅ Už zpracováno — „Znovu zpracovat“ spustí nové "
                           "(placené) čtení a přepíše uložený report.")
    if col_a.button(btn_label, disabled=not api_ok, use_container_width=True):
        _process_batch([sel_pdf], force=True)

if col_b.button("Zpracovat vše", disabled=not api_ok, use_container_width=True,
                help="Zpracuje jen dosud nezpracované PDF."):
    _process_batch(sample_pdfs)

# --- persistent results of the last batch -------------------------------------
if st.session_state.get("proc_results"):
    with st.sidebar.expander("Výsledky posledního zpracování", expanded=True):
        for icon, name, msg in st.session_state["proc_results"]:
            st.markdown(f"{icon} **{name}** — {msg}")

st.sidebar.divider()
st.sidebar.caption(f"Uloženo reportů: {len(reports)}")
if reports:
    if not st.session_state.get("confirm_del_all"):
        if st.sidebar.button("Smazat všechny uložené reporty"):
            st.session_state["confirm_del_all"] = True
            st.rerun()
    else:
        st.sidebar.warning(f"Opravdu smazat všech {len(reports)} reportů? "
                           "Zpětné zpracování stojí čas i peníze.")
        c_yes, c_no = st.sidebar.columns(2)
        if c_yes.button("Ano, smazat", use_container_width=True):
            for r in reports:
                delete_report(r.id)
            st.session_state["confirm_del_all"] = False
            refresh_reports()
            st.rerun()
        if c_no.button("Zrušit", use_container_width=True):
            st.session_state["confirm_del_all"] = False
            st.rerun()


# --------------------------------------------------------------------------- #
# Patient grouping + header
# --------------------------------------------------------------------------- #
st.title("Vývoj krevních výsledků v čase")

if not reports:
    st.info("Zatím nejsou zpracované žádné reporty. Vlevo nahraj PDF (nebo "
            "vyber ze samples/) a klikni na „Zpracovat“.")
    st.stop()


def _norm_pid(pid):
    """Digits-only rodné číslo, so '740215/1234' and '7402151234' group together."""
    return re.sub(r"\D", "", pid or "")


def _mask_pid(pid, reveal=False):
    if reveal or not pid:
        return pid or "—"
    digits = _norm_pid(pid)
    if len(digits) >= 9:                     # rodné číslo: birth date part stays
        return f"{digits[:6]}/{'•' * (len(digits) - 6)}"
    return pid


# Group reports by patient: rodné číslo first, name as fallback.
patients: dict[str, dict] = {}
for r in reports:
    key = _norm_pid(r.patient_id) or (r.patient_name or "").strip().lower() or "neznámý"
    g = patients.setdefault(key, {"name": None, "pid": None, "reports": []})
    g["reports"].append(r)
    g["name"] = g["name"] or r.patient_name
    g["pid"] = g["pid"] or r.patient_id

pat_keys = sorted(patients, key=lambda k: -len(patients[k]["reports"]))
if len(pat_keys) > 1:
    pat_labels = {k: f"{patients[k]['name'] or 'Neznámý pacient'} "
                     f"({_mask_pid(patients[k]['pid'])}) — "
                     f"{len(patients[k]['reports'])} reportů" for k in pat_keys}
    sel_pat = st.selectbox("Pacient", pat_keys, format_func=lambda k: pat_labels[k])
else:
    sel_pat = pat_keys[0]

patient = patients[sel_pat]
patient_reports = patient["reports"]

reveal_pid = st.toggle("Zobrazit celé rodné číslo", value=False)
cols = st.columns(3)
cols[0].metric("Pacient", patient["name"] or "—")
cols[1].metric("Rodné číslo / ID", _mask_pid(patient["pid"], reveal=reveal_pid))
cols[2].metric("Reportů", str(len(patient_reports)))

names_in_group = {r.patient_name for r in patient_reports if r.patient_name}
if len(names_in_group) > 1:
    st.warning("⚠️ Reporty této skupiny obsahují více různých jmen — zkontroluj, "
               f"že patří stejné osobě: {', '.join(sorted(names_in_group))}")


trends = build_trends(patient_reports, display_name_fn=registry.display_name)

tab_trend, tab_summary, tab_verify, tab_review = st.tabs(
    ["📈 Trendy", "📝 Souhrn změn", "🔍 Ověření", "🗂️ Namapování analytů"]
)


# --------------------------------------------------------------------------- #
# Trends
# --------------------------------------------------------------------------- #
with tab_trend:
    if not trends:
        st.info("Zatím není co zobrazit — reporty nemají datum odběru nebo "
                "namapované analyty.")
    else:
        # order analytes: those with an out-of-range latest point first
        def _sort_key(cid):
            t = trends[cid]
            np_ = t.numeric_points
            oor = bool(np_) and np_[-1].flag in ("high", "low")
            return (0 if oor else 1, t.display_name.lower())

        ids_sorted = sorted(trends.keys(), key=_sort_key)
        options = {registry.display_name(cid): cid for cid in ids_sorted}
        opt_names = list(options.keys())

        # One stacked section per analyte; „+ Přidat analyt“ adds another.
        if "trend_slots" not in st.session_state:
            st.session_state.trend_slots = [0]        # list of stable uids
            st.session_state.trend_next_uid = 1

        # Date-range filter (od–do), defaulting to the full span of the data.
        all_dates = [pd.to_datetime(p.date) for t in trends.values() for p in t.points]
        min_d, max_d = min(all_dates).date(), max(all_dates).date()
        picked = st.date_input(
            "Zobrazené období", value=(min_d, max_d),
            min_value=min_d, max_value=max_d, format="YYYY-MM-DD",
        )
        # date_input returns a 1-tuple mid-selection; fall back to full span.
        if isinstance(picked, (tuple, list)) and len(picked) == 2:
            date_from, date_to = picked
        else:
            date_from, date_to = min_d, max_d

        for uid in list(st.session_state.trend_slots):
            c_pick, c_rm = st.columns([12, 1])
            # Hide analytes already chosen in other slots (keep this slot's own).
            this_val = (st.session_state[f"trend_pick_{uid}"]
                        if f"trend_pick_{uid}" in st.session_state else None)
            taken = {st.session_state[f"trend_pick_{u}"]
                     for u in st.session_state.trend_slots
                     if u != uid and f"trend_pick_{u}" in st.session_state}
            slot_opts = [o for o in opt_names if o not in taken or o == this_val]
            # Start empty with a search-hint placeholder so it's clear the
            # analyte is chosen by typing, not preselected alphabetically.
            pick = c_pick.selectbox(
                "Analyt", slot_opts, index=None,
                placeholder="🔍 Vyberte analyt (můžete psát pro vyhledávání)",
                key=f"trend_pick_{uid}",
            )
            if len(st.session_state.trend_slots) > 1:
                c_rm.button("✕", key=f"trend_rm_{uid}", help="Odebrat analyt",
                            on_click=_remove_trend_slot, args=(uid,))
            if pick is None:
                st.divider()
                continue
            t = trends[options[pick]]
            render_trend_chart(t, date_from, date_to)
            with st.expander("📋 Tabulka hodnot", expanded=False):
                render_trend_table(t, date_from, date_to)
            st.divider()

        st.button("➕ Přidat analyt", on_click=_add_trend_slot)


# --------------------------------------------------------------------------- #
# Summary
# --------------------------------------------------------------------------- #
with tab_summary:
    st.subheader("Co se změnilo mezi posledními dvěma výsledky")
    st.caption("Pouze popisný přehled směru a velikosti změny. Bez interpretace "
               "a bez diagnózy.")
    records = summarize_changes(trends)
    if not records:
        st.info("Zatím není dost dat (potřebné alespoň dvě číselné hodnoty u "
                "stejného analytu).")
    else:
        oor = [r for r in records if r["out_of_range"]]
        changed = [r for r in records if not r["out_of_range"] and r["changed"]]
        stable = [r for r in records if not r["out_of_range"] and not r["changed"]]

        if oor:
            st.markdown("#### Mimo referenční rozmezí")
            for r in oor:
                icon = "🔴" if r["new_flag"] == "high" else "🔵"
                st.markdown(f"{icon} {r['text']}")
        if changed:
            st.markdown("#### Změny v rámci normy")
            for r in changed:
                st.markdown(f"• {r['text']}")
        if stable:
            with st.expander(f"Beze změny ({len(stable)})"):
                for r in stable:
                    st.markdown(f"• {r['text']}")


# --------------------------------------------------------------------------- #
# Verify — extracted table beside the source page image, row-linked
# --------------------------------------------------------------------------- #
def _reprocess(report):
    for m in report.measurements:
        normalize_measurement(m)
        m.canonical_id = registry.match(m.raw_analyte_name)
        if m.canonical_id:
            a = registry.get(m.canonical_id)
            if a:
                convert_to_canonical(m, a)


def _is_flagged(m) -> bool:
    return m.confidence == "low" or bool(m.disagreement)


def _highlight_row(image_path: str, bbox, pad: int = 45):
    """(zoomed strip around the row, full page with a red band on the row)."""
    img = Image.open(image_path)
    w, h = img.size
    x0, y0, x1, y1 = bbox
    top, bot = max(0, int(y0) - pad), min(h, int(y1) + pad)
    strip = img.crop((0, top, w, bot))
    full = img.convert("RGB")
    draw = ImageDraw.Draw(full)
    draw.rectangle([2, y0 - 6, w - 3, y1 + 6], outline=(198, 40, 40), width=6)
    return strip, full


with tab_verify:
    st.subheader("Ověření přepisu proti zdrojovému PDF")
    rep_options = {f"{r.report_date or '—'} · {r.source_file}": r.id
                   for r in patient_reports}
    sel = st.selectbox("Report", list(rep_options.keys()))
    report = load_report(rep_options[sel])

    n_low = sum(1 for m in report.measurements if m.confidence == "low")
    n_dis = sum(1 for m in report.measurements if m.disagreement)
    c1, c2, c3, c4 = st.columns([1, 1, 1, 2])
    c1.metric("Hodnot", len(report.measurements))
    c2.metric("Nízká jistota", n_low)
    c3.metric("Neshoda modelů", n_dis)
    cost = format_cost(report.stats)
    if cost:
        c4.metric("Náklady zpracování", cost)

    # per-report delete, with confirmation
    del_key = f"confirm_del_{report.id}"
    if not st.session_state.get(del_key):
        if st.button("🗑️ Smazat tento report"):
            st.session_state[del_key] = True
            st.rerun()
    else:
        st.warning(f"Opravdu smazat report „{report.source_file}“?")
        c_yes, c_no, _sp = st.columns([1, 1, 4])
        if c_yes.button("Ano, smazat", key=f"delyes_{report.id}"):
            delete_report(report.id)
            st.session_state[del_key] = False
            refresh_reports()
            st.rerun()
        if c_no.button("Zrušit", key=f"delno_{report.id}"):
            st.session_state[del_key] = False
            st.rerun()

    st.caption("Řádky se ⚠️ (nízká jistota / neshoda modelů / neúspěšné parsování) "
               "zkontroluj proti obrázku. Vyber řádek vpravo a na obrázku se "
               "zvýrazní jeho místo. Opravy se ukládají do reportu.")
    flagged_only = st.toggle("Zobrazit jen sporné řádky", value=False,
                             key=f"flagged_{report.id}")

    pdf_path = find_source_pdf(report.source_file)
    if pdf_path is None:
        st.caption("ℹ️ Zdrojové PDF nebylo nalezeno na disku — zvýraznění řádku "
                   "na obrázku není k dispozici.")

    for page in report.pages:
        st.markdown(f"### Strana {page.page_num}")
        page_rows = [m for m in report.measurements if m.source_page == page.page_num]
        shown = [(i, m) for i, m in enumerate(page_rows)
                 if not flagged_only or _is_flagged(m)]

        left, right = st.columns([3, 2])
        with left:
            if not shown:
                st.success("Na této straně nejsou žádné sporné řádky. 🎉")
            else:
                data = [{
                    "_i": i,
                    "⚠️": "⚠️" if _is_flagged(m) else "",
                    "analyt": m.raw_analyte_name,
                    "hodnota": m.value_raw,
                    "jednotka": m.unit_raw,
                    "referenční": m.ref_range_raw,
                    "num": cz_num(m.value) if m.value is not None else "",
                    "stav": FLAG_LABEL.get(m.flag, "—"),
                    "namapováno": registry.display_name(m.canonical_id)
                                  if m.canonical_id else "— (nenamapováno)",
                    "pozn.": m.disagreement or "",
                } for i, m in shown]
                edited = st.data_editor(
                    pd.DataFrame(data),
                    key=f"editor_{report.id}_{page.page_num}_{flagged_only}",
                    use_container_width=True,
                    hide_index=True,
                    disabled=["⚠️", "num", "stav", "namapováno", "pozn."],
                    column_config={
                        "_i": None,          # internal row index — hidden
                        "⚠️": st.column_config.TextColumn("⚠️", width="small"),
                        "analyt": st.column_config.TextColumn("analyt", width="medium"),
                        "hodnota": st.column_config.TextColumn("hodnota"),
                        "jednotka": st.column_config.TextColumn("jednotka"),
                        "referenční": st.column_config.TextColumn("referenční"),
                        "num": st.column_config.TextColumn("→ číslo"),
                        "namapováno": st.column_config.TextColumn("analyt (kanonicky)", width="medium"),
                        "pozn.": st.column_config.TextColumn("poznámka", width="large"),
                    },
                )
                if st.button(f"Uložit opravy strany {page.page_num}",
                             key=f"save_{report.id}_{page.page_num}"):
                    for _, erow in edited.iterrows():
                        m = page_rows[int(erow["_i"])]
                        if (m.value_raw != erow["hodnota"] or m.unit_raw != erow["jednotka"]
                                or m.ref_range_raw != erow["referenční"]):
                            m.value_raw = erow["hodnota"]
                            m.unit_raw = erow["jednotka"]
                            m.ref_range_raw = erow["referenční"]
                            m.corrected = True
                            m.confidence = "high"
                            m.disagreement = None  # cleared by the manual fix
                    _reprocess(report)
                    save_report(report)
                    refresh_reports()
                    st.success("Opravy uloženy.")
                    st.rerun()

        with right:
            bbox = None
            if shown and pdf_path is not None:
                first_flagged = next((k for k, (_, m) in enumerate(shown)
                                      if _is_flagged(m)), 0)
                # String options (not ints + format_func): the leading "k+1." keeps
                # them unique even for duplicate names, and identity options are
                # what Streamlit's own selectbox idioms + AppTest round-trip cleanly.
                row_labels = [
                    f"{k + 1}. " + ("⚠️ " if _is_flagged(m) else "")
                    + f"{m.raw_analyte_name} — {m.value_raw}"
                    for k, (_, m) in enumerate(shown)
                ]
                picked_label = st.selectbox(
                    "🔍 Ukázat řádek na obrázku", row_labels, index=first_flagged,
                    key=f"row_{report.id}_{page.page_num}_{flagged_only}",
                )
                pick = row_labels.index(picked_label)
                i, m = shown[pick]
                # n-th occurrence of the same printed name on this page
                occ = sum(1 for j in range(i)
                          if page_rows[j].raw_analyte_name == m.raw_analyte_name)
                bbox = row_bbox(pdf_path, page.page_num, m.raw_analyte_name, occ)
                if bbox is None:
                    st.caption("Řádek se na obrázku nepodařilo najít "
                               "(bez textové vrstvy / jiný zápis názvu).")
            if bbox is not None:
                strip, full = _highlight_row(page.image_path, bbox)
                st.image(strip, use_container_width=True)
                with st.container(height=520):
                    st.image(full, use_container_width=True)
            else:
                with st.container(height=620):
                    st.image(page.image_path, use_container_width=True)


# --------------------------------------------------------------------------- #
# Analyte mapping review — suggestions + evidence
# --------------------------------------------------------------------------- #
def _apply_mapping(raw_name, cid):
    """Teach the registry and re-map every stored report (all patients)."""
    registry.add_synonym(cid, raw_name)
    save_registry(registry)
    for r in reports:
        changed = False
        for m in r.measurements:
            if m.raw_analyte_name == raw_name:
                m.canonical_id = cid
                a = registry.get(cid)
                if a:
                    convert_to_canonical(m, a)
                changed = True
        if changed:
            save_report(r)
    get_registry.clear()
    refresh_reports()


def _sugg_evidence(s):
    """Short 'jedn. X · typicky Y · ✔/✘ checks' line describing a candidate."""
    bits = []
    if s.observed_unit:
        bits.append(f"jedn. {s.observed_unit}")
    if s.observed_mean is not None:
        bits.append(f"typicky ~{cz_num(s.observed_mean)}")
    marks = []
    if s.unit_match is True:
        marks.append("✔ jednotka sedí")
    elif s.unit_match is False:
        marks.append("✘ jiná jednotka")
    if s.value_ok is True:
        marks.append("✔ hodnota v rozsahu")
    elif s.value_ok is False:
        marks.append("✘ hodnota mimo")
    head, tail = ", ".join(bits), "  ·  ".join(marks)
    return f"{head}{'  ·  ' if head and tail else ''}{tail}"


with tab_review:
    st.subheader("Namapování neznámých analytů")
    st.caption("Analyty, které se nepodařilo automaticky přiřadit. U každého je "
               "návrh (podle názvu, jednotky a typických hodnot — bez volání AI); "
               "potvrď ho, nebo vyber ručně. Přiřazení se zapamatuje pro všechny "
               "další reporty.")

    # Evidence from all patients' already-mapped data drives the suggestions.
    stats = observed_stats(reports)

    # Unknowns from the selected patient's reports, with their raw values/units.
    unmatched: dict[str, dict] = {}
    for r in patient_reports:
        for m in r.measurements:
            if m.canonical_id is None:
                u = unmatched.setdefault(
                    m.raw_analyte_name, {"n": 0, "unit": "", "values": []})
                u["n"] += 1
                u["unit"] = u["unit"] or m.unit_raw
                if m.value is not None:
                    u["values"].append(m.value)

    if not unmatched:
        st.success("Všechny analyty tohoto pacienta jsou namapované. 🎉")
    else:
        display_to_id = {registry.display_name(a.canonical_id): a.canonical_id
                         for a in registry.analytes.values()}
        id_to_display = {v: k for k, v in display_to_id.items()}
        opts = ["— nemapovat —"] + sorted(display_to_id.keys())

        for raw_name in sorted(unmatched):
            info = unmatched[raw_name]
            mean = sum(info["values"]) / len(info["values"]) if info["values"] else None
            suggs = suggest_mappings(raw_name, info["unit"], info["values"],
                                     registry, stats)

            st.divider()
            ev = f"jedn. {info['unit'] or '—'}"
            if mean is not None:
                ev += f" · typicky ~{cz_num(mean)}"
            st.markdown(f"**{raw_name}** — _v {info['n']} měřeních · {ev}_")

            if suggs:
                top = suggs[0]
                top_name = id_to_display.get(top.canonical_id, top.canonical_id)
                cta, _sp = st.columns([2, 4])
                if cta.button(f"✅ Přijmout návrh: {top_name}",
                              key=f"acc_{raw_name}", type="primary"):
                    _apply_mapping(raw_name, top.canonical_id)
                    st.success(f"„{raw_name}“ → {top_name}")
                    st.rerun()
                for s in suggs:
                    name = id_to_display.get(s.canonical_id, s.canonical_id)
                    detail = _sugg_evidence(s)
                    st.caption(f"• **{name}** — shoda {int(s.score * 100)} %"
                               + (f"  ·  {detail}" if detail else ""))
            else:
                st.caption("Žádný automatický návrh — vyber ručně níže.")

            default_idx = (opts.index(id_to_display[suggs[0].canonical_id])
                           if suggs and id_to_display.get(suggs[0].canonical_id) in opts
                           else 0)
            c2, c3 = st.columns([4, 1])
            target = c2.selectbox("mapovat na", opts, index=default_idx,
                                  key=f"map_{raw_name}", label_visibility="collapsed")
            if c3.button("Uložit", key=f"mapbtn_{raw_name}"):
                if target != "— nemapovat —":
                    _apply_mapping(raw_name, display_to_id[target])
                    st.success(f"„{raw_name}“ → {target}")
                    st.rerun()
