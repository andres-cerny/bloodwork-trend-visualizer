/**
 * Verification: the extracted table beside the source page, with the selected
 * row highlighted where it actually sits on the page.
 *
 * The highlight is drawn from a precomputed pixel bbox (src/locate.py for the
 * demo set, pdf.js text coordinates for uploads) scaled by the rendered image's
 * displayed width — so it stays aligned at any viewport size.
 *
 * Correcting a value re-runs normalizeMeasurement, which re-derives the flag,
 * the trend and the summary. That live re-derivation is the point: it shows a
 * misread decimal cannot survive review.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Flag from "./Flag";
import type { LabReport, Measurement } from "../lib/models";
import { isFlagged, normalizeMeasurement } from "../lib/normalize";
import { checkCorrection } from "../lib/correction";
import { czDate, prettyUnit } from "../lib/czech";
import { checkImplausible } from "../lib/implausible";

interface Props {
  reports: LabReport[];
  onCorrect: (reportId: string, index: number, next: Measurement) => void;
  /** Arriving from the mapping tab: open this report with this row selected. */
  focus?: { reportId: string; rawName: string } | null;
  /** Resolves a canonical id to its readable Czech name. */
  displayName: (canonicalId: string) => string;
  /**
   * Curated interval for an analyte, used only to spot a misread value.
   * Falls back to the interval printed on the report when absent.
   */
  curatedRange: (canonicalId: string | null) => { low: number; high: number } | null;
}

export default function VerifyTab({ reports, onCorrect, focus, displayName, curatedRange }: Props) {
  const [reportId, setReportId] = useState(focus?.reportId ?? reports[0]?.id ?? "");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>("");
  const imgRef = useRef<HTMLImageElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const [imgW, setImgW] = useState(0);

  const report = reports.find((r) => r.id === reportId) ?? reports[0];
  const sel = picked !== null ? report?.measurements[picked] ?? null : null;
  const check = checkCorrection(draft, sel?.unitRaw ?? "");

  /**
   * Is this number even a possible measurement? Separate from whether it is
   * abnormal — that comes from the interval printed on the report.
   */
  const implausibleOf = (m: Measurement) =>
    checkImplausible(
      m,
      curatedRange(m.canonicalId) ??
        (m.refRangeLow !== null && m.refRangeHigh !== null
          ? { low: m.refRangeLow, high: m.refRangeHigh }
          : null),
    );

  // Track the image's *rendered* width continuously rather than measuring it
  // once on load.
  //
  // The highlight is positioned by scaling a pixel bbox by this width, so a
  // stale measurement does not misplace the box slightly — it misplaces it
  // proportionally, and the error grows down the page. On a phone the source
  // pane reorders above the table once a row is selected, which relayouts the
  // image after load: the box then pointed at a different analyte's row
  // entirely, which is the verification feature telling the reader something
  // untrue.
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const measure = () => setImgW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [report?.id, sel?.sourcePage]);

  // Follow a "show me in the document" jump: switch report and select the row.
  //
  // Applied once per jump. `reports` has to be read here but must not be a
  // trigger: correcting a value replaces the reports array, which would
  // otherwise re-fire this and yank the selection back to the focused row
  // while the user is working elsewhere.
  const appliedFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    const token = `${focus.reportId}:${focus.rawName}`;
    if (appliedFocus.current === token) return;
    appliedFocus.current = token;
    setReportId(focus.reportId);
    const r = reports.find((x) => x.id === focus.reportId);
    const i = r?.measurements.findIndex((m) => m.rawAnalyteName === focus.rawName) ?? -1;
    if (i >= 0) {
      setPicked(i);
      setDraft(r!.measurements[i].valueRaw);
    }
  }, [focus, reports]);

  // A jump that lands on the right page but leaves the row 900px below the
  // fold has not arrived. Wait for the image to lay out before scrolling.
  useEffect(() => {
    if (picked === null || !hlRef.current) return;
    const id = requestAnimationFrame(() =>
      hlRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(id);
  }, [picked, imgW]);
  const rows = useMemo(() => {
    if (!report) return [];
    return report.measurements
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => (onlyFlagged ? isFlagged(m) || implausibleOf(m) !== null : true));
    // implausibleOf is stable for a given report; recomputing on filter change
    // is cheap relative to rendering the table.
  }, [report, onlyFlagged]);

  if (!report) return <p className="sub">Nejsou načtena žádná data.</p>;

  // The page the selected row is printed on — not always the first. A
  // multi-page report would otherwise draw the highlight on page 1 for a row
  // printed on page 2.
  const page =
    (sel && report.pages.find((pg) => pg.pageNum === sel.sourcePage)) ?? report.pages[0];
  const scale = page && imgW ? imgW / page.imageWidth : 0;

  // Show the whole printed row, as large as that allows.
  //
  // Name, value, unit and interval have to be readable together — verifying a
  // number against the wrong column is the failure this pane exists to
  // prevent, so none of them may be scrolled out of sight. Fitting the row's
  // own width gives roughly 2.5x the scale of the full-page view, where 22
  // rows share the same width, and the tight vertical crop means no
  // neighbouring line is in frame to be mistaken for this one.
  const rowH = sel?.bbox ? Math.max(1, sel.bbox[3] - sel.bbox[1]) : 1;
  const rowZoom =
    sel?.bbox && imgW ? Math.min(1, imgW / Math.max(1, sel.bbox[2] - sel.bbox[0])) : 0;
  const flaggedCount = report.measurements.filter(
    (m) => isFlagged(m) || implausibleOf(m) !== null,
  ).length;

  function pick(i: number) {
    setPicked(i);
    setDraft(report.measurements[i].valueRaw);
  }

  function save() {
    if (picked === null) return;
    const base = report.measurements[picked];
    if (checkCorrection(draft, base.unitRaw).severity === "reject") return;
    const next = normalizeMeasurement({
      ...base,
      valueRaw: draft,
      corrected: true,
      disagreement: null,
      // Snapshot on the first correction only, so undo always returns to what
      // the document said rather than to an earlier hand-edit.
      original: base.original ?? {
        valueRaw: base.valueRaw,
        disagreement: base.disagreement,
        confidence: base.confidence,
      },
    });
    onCorrect(report.id, picked, next);
  }

  function undo() {
    if (picked === null) return;
    const base = report.measurements[picked];
    const orig = base.original;
    if (!orig) return;
    // Restore the disagreement too. Without it the row reads as verified while
    // the two readings still conflict, and it drops out of "jen sporné řádky".
    const next = normalizeMeasurement({
      ...base,
      valueRaw: orig.valueRaw,
      corrected: false,
      original: null,
    });
    setDraft(orig.valueRaw);
    onCorrect(report.id, picked, { ...next, disagreement: orig.disagreement, confidence: orig.confidence });
  }

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select value={report.id} onChange={(e) => { setReportId(e.target.value); setPicked(null); }}>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {czDate(r.reportDate)} — {r.labName ?? r.sourceFile}
              </option>
            ))}
          </select>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.86rem" }}>
            <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
            jen řádky k ověření ({flaggedCount})
          </label>
        </div>
        <p className="sub" style={{ marginTop: 8, marginBottom: 0 }}>
          Klepněte na řádek — ukáže se, kde přesně stojí na zdrojové stránce.
          Opravená hodnota se ihned znovu vyhodnotí.
        </p>
      </div>

      <div className={`grid2${sel ? " source-first" : ""}`}>
        <div className="card table-pane">
          <h3>Přepsané řádky</h3>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Analyt</th>
                  <th style={{ textAlign: "right" }}>Hodnota</th>
                  <th>Stav</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ m, i }) => (
                  <tr key={i} className="row-pick" aria-selected={picked === i} onClick={() => pick(i)}>
                    <td>
                      {m.rawAnalyteName}
                      {/* The lab's code is what to check against the page, but
                          "S_", "B_", "U_" is LIS shorthand — show the readable
                          name beside it rather than instead of it. */}
                      {m.canonicalId && displayName(m.canonicalId) !== m.rawAnalyteName && (
                        <span className="muted"> · {displayName(m.canonicalId)}</span>
                      )}
                      {/* Review markers ride with the name rather than in a
                          fourth column: on a phone that column sat off-screen,
                          hiding exactly the rows that need attention. */}
                      <span className="marks">
                        {(() => {
                          const imp = implausibleOf(m);
                          if (!imp) return null;
                          return (
                            <span className="chip alert">
                              {imp.level === "impossible" ? "nemožná hodnota" : "ověřit desetinnou čárku"}
                            </span>
                          );
                        })()}
                        {m.disagreement && <span className="chip alert">neshoda</span>}
                        {m.confidence === "low" && <span className="chip alert">nízká jistota</span>}
                        {m.corrected && <span className="chip">ručně opraveno</span>}
                        {/* Every filtered row must show why it is listed;
                            otherwise the reader is told a row needs checking
                            and given nothing to look at. */}
                        {m.value === null && m.valueRaw.trim() !== "" && !m.disagreement &&
                          m.confidence !== "low" && !implausibleOf(m) && (
                            <span className="chip">nečíselný výsledek</span>
                          )}
                      </span>
                    </td>
                    <td className="num">
                      {m.valueRaw}{" "}
                      <span className="muted">{prettyUnit(m.unitRaw)}</span>
                    </td>
                    <td><Flag flag={m.flag} /></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={3} className="muted">Žádné řádky k ověření — vše prošlo.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card source-pane">
          <h3>Zdrojová stránka</h3>
          {sel && (
            <div style={{ marginBottom: 10 }}>
              <p className="muted" style={{ margin: "0 0 6px" }}>{sel.sourceSnippet || sel.rawAnalyteName}</p>
              {(() => {
                const imp = implausibleOf(sel);
                return imp ? <p className="err" style={{ margin: "0 0 6px" }}>⚠ {imp.reason}</p> : null;
              })()}
              {sel.disagreement && <p className="err" style={{ margin: "0 0 6px" }}>⚠ {sel.disagreement}</p>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <input
                  type="text" value={draft} onChange={(e) => setDraft(e.target.value)}
                  aria-label="Opravit hodnotu" style={{ flex: "1 1 120px", minWidth: 0 }}
                />
                <button
                  className="btn primary"
                  onClick={save}
                  disabled={draft === sel.valueRaw || check.severity === "reject"}
                >
                  Opravit
                </button>
                {sel.original && (
                  <button className="btn" onClick={undo}>
                    Vrátit původní ({sel.original.valueRaw})
                  </button>
                )}
              </div>
              {check.message && (
                <p className={check.severity === "reject" ? "err" : "muted"} style={{ margin: "6px 0 0" }}>
                  {check.message}
                </p>
              )}
            </div>
          )}
          {/* A magnified strip of the selected row.
              On a phone the full page renders about 330px wide for a 1819px
              scan, so the printed rows are ~5px tall — the highlight lands on
              the right row but the number inside it cannot be read, and the
              whole point is reading that number. Opening the raw image loses
              the highlight, because it is an overlay rather than part of the
              picture. This crops the page around the row instead, at a scale
              that stays legible. */}
          {page && sel?.bbox && rowZoom > 0 && (
            <div className="rowzoom" aria-label="Přiblížený řádek">
              <div
                className="rowzoom-img"
                style={{
                  backgroundImage: `url(${page.imageUrl})`,
                  backgroundSize: `${page.imageWidth * rowZoom}px auto`,
                  // Crop tight to the row. Bleeding into the line above or
                  // below invites verifying against the wrong one.
                  backgroundPosition:
                    `-${sel.bbox[0] * rowZoom - 8}px -${sel.bbox[1] * rowZoom - 3}px`,
                  width: (sel.bbox[2] - sel.bbox[0]) * rowZoom + 16,
                  height: rowH * rowZoom + 6,
                }}
              />
            </div>
          )}

          {page ? (
            <div className="srcimg">
              <img
                ref={imgRef} src={page.imageUrl} alt={`Stránka ${page.pageNum}`}
                onLoad={(e) => setImgW((e.target as HTMLImageElement).clientWidth)}
                style={{ cursor: "zoom-in" }}
                onClick={() => window.open(page.imageUrl, "_blank", "noopener")}
              />
              {sel?.bbox && scale > 0 && (
                <div
                  ref={hlRef}
                  className="hl"
                  style={{
                    left: sel.bbox[0] * scale - 4,
                    top: sel.bbox[1] * scale - 4,
                    width: (sel.bbox[2] - sel.bbox[0]) * scale + 8,
                    height: (sel.bbox[3] - sel.bbox[1]) * scale + 8,
                  }}
                />
              )}
            </div>
          ) : (
            <p className="muted">Zdrojový obrázek není k dispozici.</p>
          )}
        </div>
      </div>
    </>
  );
}
