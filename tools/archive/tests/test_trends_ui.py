"""Regression tests for the Trends tab UI (the graphs page), driven through
Streamlit's AppTest so they exercise the real script end-to-end. Run with:

    python3 -m pytest tests/test_trends_ui.py -q
    (or plain: python3 tests/test_trends_ui.py)

These need processed reports in data/reports/ (which is gitignored). When none
are present the data-dependent tests skip instead of failing.
"""
from __future__ import annotations

import datetime
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
from streamlit.testing.v1 import AppTest

from src.matching import load_registry
from src.storage import list_reports
from src.trends import build_trends

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app.py")


# --- helpers ----------------------------------------------------------------
def _app() -> AppTest:
    return AppTest.from_file(APP, default_timeout=60).run()


def _trend_sels(at):
    """The per-slot analyte selectboxes (keys trend_pick_*)."""
    return [s for s in at.selectbox if str(s.key).startswith("trend_pick_")]


def _require_trends(at):
    sels = _trend_sels(at)
    if not sels:
        raise unittest.SkipTest(
            "no processed reports in data/reports/ — Trends UI needs data")
    return sels


def _n_graphs(at):
    """A rendered trend graph == one 'Poslední hodnota' metric."""
    return sum(1 for m in at.metric if m.label == "Poslední hodnota")


def _date_picker(at):
    return [d for d in at.date_input if d.label == "Zobrazené období"][0]


def _real_trends():
    reg = load_registry()
    return build_trends(list_reports(), display_name_fn=reg.display_name)


# --- first load -------------------------------------------------------------
def test_app_runs_without_exception():
    at = _app()
    assert not at.exception, str(at.exception)


def test_single_slot_defaults_to_empty_placeholder():
    at = _app()
    sels = _require_trends(at)
    assert len(sels) == 1
    # search-first: no analyte preselected alphabetically
    assert sels[0].value is None
    assert len(sels[0].options) > 1


def test_no_graph_before_selection():
    at = _app()
    _require_trends(at)
    assert _n_graphs(at) == 0


def test_date_range_picker_defaults_to_full_span():
    at = _app()
    _require_trends(at)
    di = _date_picker(at)
    assert isinstance(di.value, (tuple, list)) and len(di.value) == 2
    # default matches the actual span of the data
    dates = [pd.to_datetime(p.date) for t in _real_trends().values() for p in t.points]
    assert di.value[0] == min(dates).date()
    assert di.value[1] == max(dates).date()


# --- selecting an analyte ---------------------------------------------------
def test_selecting_analyte_renders_graph_and_header():
    at = _app()
    sels = _require_trends(at)
    opts = list(sels[0].options)
    at = sels[0].set_value(opts[0]).run()
    assert not at.exception, str(at.exception)
    assert _n_graphs(at) == 1
    mds = [m.value for m in at.markdown]
    assert any("Referenční rozmezí" in m or "jednotka" in m for m in mds)
    assert any(b in m for m in mds for b in ("vysoká", "nízká", "v normě"))


# --- add / remove slots (the core interaction) ------------------------------
def test_add_slot_keeps_existing_selection_and_new_slot_empty():
    at = _app()
    sels = _require_trends(at)
    opts = list(sels[0].options)
    at = sels[0].set_value(opts[0]).run()
    at = [b for b in at.button if "Přidat" in b.label][0].click().run()
    sels = _trend_sels(at)
    assert len(sels) == 2
    assert sels[0].value == opts[0]      # kept
    assert sels[1].value is None         # new one empty


def test_remove_middle_slot_preserves_other_selections():
    """Regression: an in-loop st.rerun() used to discard the selections of
    slots rendered after the removed one. Removal now runs in an on_click
    callback, so every remaining slot keeps its value."""
    at = _app()
    sels = _require_trends(at)
    opts = list(sels[0].options)
    if len(opts) < 3:
        raise unittest.SkipTest("need >=3 analytes")
    a, b, c = opts[0], opts[1], opts[2]

    at = _trend_sels(at)[0].set_value(a).run()
    at = [x for x in at.button if "Přidat" in x.label][0].click().run()
    at = _trend_sels(at)[1].set_value(b).run()
    at = [x for x in at.button if "Přidat" in x.label][0].click().run()
    at = _trend_sels(at)[2].set_value(c).run()
    assert len(_trend_sels(at)) == 3

    # remove the middle slot
    rm = [x for x in at.button if x.label == "✕"]
    assert len(rm) == 3
    at = rm[1].click().run()

    vals = [s.value for s in _trend_sels(at)]
    assert vals == [a, c], vals          # middle gone, others intact


def test_single_slot_has_no_remove_button():
    at = _app()
    sels = _require_trends(at)
    at = sels[0].set_value(list(sels[0].options)[0]).run()
    assert not [b for b in at.button if b.label == "✕"]


def test_selected_analyte_hidden_from_other_slots():
    at = _app()
    sels = _require_trends(at)
    opts = list(sels[0].options)
    at = sels[0].set_value(opts[0]).run()
    at = [b for b in at.button if "Přidat" in b.label][0].click().run()
    sels = _trend_sels(at)
    assert opts[0] not in sels[1].options          # hidden in the other slot
    assert opts[0] in sels[0].options              # still selectable where chosen


# --- date-range filter behaviour --------------------------------------------
def test_narrow_range_notes_latest_outside_window():
    """With a window that excludes an analyte's (older) latest point, the graph
    reports 'no values in period' while the header keeps the overall latest and
    adds an explanatory note."""
    trends = _real_trends()
    dates = [pd.to_datetime(p.date) for t in trends.values() for p in t.points]
    max_d = max(dates).date()
    # an analyte whose latest numeric point predates the last report date
    target = None
    for t in trends.values():
        if t.numeric_points and pd.to_datetime(t.numeric_points[-1].date).date() < max_d:
            target = t.display_name
            break
    if target is None:
        raise unittest.SkipTest("no analyte with a latest point before the last report")

    at = _app()
    _require_trends(at)
    at = _trend_sels(at)[0].set_value(target).run()
    # narrow window = only the very last report day
    at = _date_picker(at).set_value((max_d, max_d)).run()
    assert not at.exception, str(at.exception)
    assert any("mimo zvolené období" in c.value for c in at.caption)
    assert any("Ve zvoleném období" in i.value for i in at.info)
    gm = [m for m in at.metric if m.label == "Poslední hodnota"]
    assert gm and gm[0].value != "—"     # metric still shows overall latest


def test_full_span_renders_graph_without_outside_note():
    at = _app()
    sels = _require_trends(at)
    at = sels[0].set_value(list(sels[0].options)[0]).run()
    assert _n_graphs(at) == 1
    assert not any("mimo zvolené období" in c.value for c in at.caption)


# --- chart rendering: units, y-range, x-axis format -------------------------
def _app_mod():
    """The app module, for testing its pure chart helpers directly."""
    try:
        import app
        return app
    except BaseException as e:      # e.g. st.stop() when no reports exist
        raise unittest.SkipTest(f"cannot import app module: {e}")


def test_unit_key_separates_and_unifies():
    app = _app_mod()
    # genuinely different units stay distinct (% vs absolute count)
    assert app._unit_key("%") != app._unit_key("10^9/l")
    # cosmetic eGFR spellings collapse to one key
    assert (app._unit_key("ml/s/1.73m2")
            == app._unit_key("ml/s/1,73 m2")
            == app._unit_key("ml/s/1,73m^2"))


def test_y_domain_tight_around_ref_band():
    app = _app_mod()
    df = pd.DataFrame({"hodnota": [0.45, 0.47, 0.44]})
    y0, y1 = app._y_domain(df, 0.4, 0.5)
    assert 0.35 < y0 < 0.4 and 0.5 < y1 < 0.55        # hugs the band
    assert (y1 - y0) < 3 * (0.5 - 0.4)                # not blown up


def test_y_domain_includes_far_outlier_without_negative_pad():
    app = _app_mod()
    df = pd.DataFrame({"hodnota": [0.02, 0.03, 0.219]})
    y0, y1 = app._y_domain(df, 0.012, 0.035)
    assert y1 >= 0.219        # the out-of-range spike stays visible
    assert y0 >= 0            # no nonsensical negative axis


def test_x_axis_format_scales_with_span():
    app = _app_mod()

    def fmt(days):
        base = pd.Timestamp("2020-01-01")
        df = pd.DataFrame({"datum": [base, base + pd.Timedelta(days=days)]})
        return app._x_axis(df).to_dict()["axis"]["format"]

    assert fmt(2000) == "%Y"          # multi-year → year only
    assert fmt(400) == "%m/%Y"        # ~1 year → month/year
    assert fmt(30) == "%d.%m.%y"      # weeks → day.month.year
    single = pd.DataFrame({"datum": [pd.Timestamp("2020-01-01")]})
    assert app._x_axis(single).to_dict()["axis"]["format"] == "%d.%m.%Y"


def test_chart_yscale_on_all_layers_not_pulled_to_zero():
    """Regression: rect band layers default to zero=True and used to drag the
    shared y-axis down to 0 (Hematokrit showed 0–0.5). Every layer must carry
    the same tight domain."""
    app = _app_mod()
    df = pd.DataFrame({
        "datum": pd.to_datetime(["2019-06-12", "2020-06-08", "2025-08-15"]),
        "hodnota": [0.468, 0.48, 0.443],
        "flag": ["normal", "normal", "normal"],
        "value_raw": ["0,468", "0,48", "0,443"],
    })
    spec = app._build_trend_chart(df, 0.4, 0.5).to_dict()
    doms = [layer.get("encoding", {}).get("y", {}).get("scale", {}).get("domain")
            for layer in spec["layer"]]
    assert len(doms) == 5                         # 3 bands + line + points
    assert all(d == [0.38, 0.52] for d in doms), doms
    assert not any(d and min(d) <= 0 for d in doms)   # 0 never dragged in


def test_mixed_unit_series_hides_other_unit_and_notes_it():
    app = _app_mod()
    trends = _real_trends()
    target = None
    for t in trends.values():
        keys = {app._unit_key(p.unit) for p in t.numeric_points if p.unit}
        keys.discard("")
        if len(keys) > 1:
            target = t.display_name
            break
    if target is None:
        raise unittest.SkipTest("no analyte with conflicting units in the data")
    at = _app()
    _require_trends(at)
    at = _trend_sels(at)[0].set_value(target).run()
    assert not at.exception, str(at.exception)
    assert any("jiné jednotce" in c.value for c in at.caption)


def test_table_has_unit_column():
    at = _app()
    sels = _require_trends(at)
    at = sels[0].set_value(list(sels[0].options)[0]).run()
    for d in at.dataframe:
        try:
            cols = list(d.value.columns)
        except Exception:
            continue
        if "jednotka" in cols and "vytištěná hodnota" in cols:
            return
    raise AssertionError("no trend table exposing a 'jednotka' column")


# --- smoke: a spread of analytes all render without error -------------------
def test_sample_of_analytes_render_without_exception():
    at = _app()
    sels = _require_trends(at)
    opts = list(sels[0].options)
    step = max(1, len(opts) // 12)
    sample = opts[::step]
    failures = []
    for name in sample:
        a = _app()
        a = _trend_sels(a)[0].set_value(name).run()
        if a.exception:
            failures.append((name, str(a.exception)))
    assert not failures, failures


# --- standalone runner (project has no pytest installed) --------------------
if __name__ == "__main__":
    import traceback

    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    passed = failed = skipped = 0
    for fn in fns:
        try:
            fn()
            passed += 1
            print(f"PASS {fn.__name__}")
        except unittest.SkipTest as e:
            skipped += 1
            print(f"SKIP {fn.__name__} — {e}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{passed} passed, {failed} failed, {skipped} skipped")
    sys.exit(1 if failed else 0)
