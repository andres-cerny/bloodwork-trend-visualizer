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
import { czDate } from "../lib/czech";

interface Props {
  reports: LabReport[];
  onCorrect: (reportId: string, index: number, next: Measurement) => void;
  /** Arriving from the mapping tab: open this report with this row selected. */
  focus?: { reportId: string; rawName: string } | null;
  /** Resolves a canonical id to its readable Czech name. */
  displayName: (canonicalId: string) => string;
}

export default function VerifyTab({ reports, onCorrect, focus, displayName }: Props) {
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
      .filter(({ m }) => (onlyFlagged ? isFlagged(m) : true));
  }, [report, onlyFlagged]);

  if (!report) return <p className="sub">Nejsou načtena žádná data.</p>;

  const page = report.pages[0];
  const scale = page && imgW ? imgW / page.imageWidth : 0;
  const flaggedCount = report.measurements.filter(isFlagged).length;

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
            jen sporné řádky ({flaggedCount})
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
                        {m.disagreement && <span className="chip alert">neshoda</span>}
                        {m.confidence === "low" && <span className="chip alert">nízká jistota</span>}
                        {m.corrected && <span className="chip">ručně opraveno</span>}
                      </span>
                    </td>
                    <td className="num">
                      {m.valueRaw} <span className="muted">{m.unitRaw}</span>
                    </td>
                    <td><Flag flag={m.flag} /></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={3} className="muted">Žádné sporné řádky — vše prošlo.</td></tr>
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
