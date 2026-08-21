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

interface Props {
  reports: LabReport[];
  onCorrect: (reportId: string, index: number, next: Measurement) => void;
  /** Arriving from the mapping tab: open this report with this row selected. */
  focus?: { reportId: string; rawName: string } | null;
}

export default function VerifyTab({ reports, onCorrect, focus }: Props) {
  const [reportId, setReportId] = useState(focus?.reportId ?? reports[0]?.id ?? "");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>("");
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgW, setImgW] = useState(0);

  const report = reports.find((r) => r.id === reportId) ?? reports[0];

  // Follow a "show me in the document" jump: switch report and select the row.
  useEffect(() => {
    if (!focus) return;
    setReportId(focus.reportId);
    const r = reports.find((x) => x.id === focus.reportId);
    const i = r?.measurements.findIndex((m) => m.rawAnalyteName === focus.rawName) ?? -1;
    if (i >= 0) {
      setPicked(i);
      setDraft(r!.measurements[i].valueRaw);
    }
  }, [focus, reports]);
  const rows = useMemo(() => {
    if (!report) return [];
    return report.measurements
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => (onlyFlagged ? isFlagged(m) : true));
  }, [report, onlyFlagged]);

  if (!report) return <p className="sub">Nejsou načtena žádná data.</p>;

  const page = report.pages[0];
  const scale = page && imgW ? imgW / page.imageWidth : 0;
  const sel = picked !== null ? report.measurements[picked] : null;
  const flaggedCount = report.measurements.filter(isFlagged).length;

  function pick(i: number) {
    setPicked(i);
    setDraft(report.measurements[i].valueRaw);
  }

  function save() {
    if (picked === null) return;
    const base = report.measurements[picked];
    const next = normalizeMeasurement({ ...base, valueRaw: draft, corrected: true, disagreement: null });
    onCorrect(report.id, picked, next);
  }

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select value={report.id} onChange={(e) => { setReportId(e.target.value); setPicked(null); }}>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.reportDate ?? "bez data"} — {r.labName ?? r.sourceFile}
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

      <div className="grid2">
        <div className="card">
          <h3>Přepsané řádky</h3>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Analyt</th>
                  <th style={{ textAlign: "right" }}>Hodnota</th>
                  <th>Stav</th>
                  <th>QA</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ m, i }) => (
                  <tr key={i} className="row-pick" aria-selected={picked === i} onClick={() => pick(i)}>
                    <td>{m.rawAnalyteName}</td>
                    <td className="num">
                      {m.valueRaw} <span className="muted">{m.unitRaw}</span>
                    </td>
                    <td><Flag flag={m.flag} /></td>
                    <td>
                      {m.disagreement && <span className="chip alert">neshoda</span>}
                      {m.confidence === "low" && <span className="chip alert">nízká jistota</span>}
                      {m.corrected && <span className="chip">opraveno</span>}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={4} className="muted">Žádné sporné řádky — vše prošlo.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
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
                <button className="btn primary" onClick={save} disabled={draft === sel.valueRaw}>
                  Opravit
                </button>
              </div>
            </div>
          )}
          {page ? (
            <div className="srcimg">
              <img
                ref={imgRef} src={page.imageUrl} alt={`Stránka ${page.pageNum}`}
                onLoad={(e) => setImgW((e.target as HTMLImageElement).clientWidth)}
              />
              {sel?.bbox && scale > 0 && (
                <div
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
