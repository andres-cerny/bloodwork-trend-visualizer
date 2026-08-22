/**
 * Verification: the extracted table beside the source page, with the selected
 * row highlighted where it actually sits on the page.
 *
 * The highlight is drawn from a precomputed pixel bbox (src/locate.py for the
 * demo set, pdf.js text coordinates for uploads), positioned as a percentage
 * of the image's own dimensions so it cannot go stale when the pane relayouts.
 *
 * Correcting a value re-runs normalizeMeasurement, which re-derives the flag,
 * the trend and the summary. That live re-derivation is the point: it shows a
 * misread decimal cannot survive review.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Flag from "./Flag";
import type { LabReport, Measurement } from "../lib/models";
import { normalizeMeasurement } from "../lib/normalize";
import { needsReview, reviewOf } from "../lib/review";
import { checkCorrection } from "../lib/correction";
import { czDate, prettyUnit } from "../lib/czech";

interface Props {
  reports: LabReport[];
  onCorrect: (reportId: string, index: number, next: Measurement) => void;
  /**
   * Arriving from another tab: open this report with this row selected. `seq`
   * distinguishes two jumps to the same row, so asking for it twice works.
   */
  focus?: { reportId: string; rawName: string; seq?: number } | null;
  /** Resolves a canonical id to its readable Czech name. */
  displayName: (canonicalId: string) => string;
  /**
   * Curated interval for an analyte, used only to spot a misread value.
   * Falls back to the interval printed on the report when absent.
   */
  curatedRange: (canonicalId: string | null) => { low: number; high: number } | null;
}

/** Padding around the magnified row crop, in rendered pixels. */
const ROW_BLEED_X = 26;
const ROW_BLEED_Y = 3;

export default function VerifyTab({ reports, onCorrect, focus, displayName, curatedRange }: Props) {
  const [reportId, setReportId] = useState(focus?.reportId ?? reports[0]?.id ?? "");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>("");
  const imgRef = useRef<HTMLImageElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const [imgW, setImgW] = useState(0);
  // The image carried cursor:zoom-in and did nothing when clicked. Toggling to
  // native width (inside a scroll container) is what that cursor promises, and
  // it keeps the highlight, which opening the raw file did not.
  const [zoomed, setZoomed] = useState(false);

  const report = reports.find((r) => r.id === reportId) ?? reports[0];
  const sel = picked !== null ? report?.measurements[picked] ?? null : null;
  const check = checkCorrection(draft, sel?.unitRaw ?? "");

  // Single authority for "can this row be trusted, and why". The table chips,
  // the filter and its counter all read it, so the count can never disagree
  // with the chips on screen — which it did when they were computed separately.
  const review = (m: Measurement) => reviewOf(m, curatedRange);

  // The magnified row strip still needs a rendered width; the highlight no
  // longer does. Tracked continuously rather than read once, because this
  // pane relayouts on selection and on enlarging the image.
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
    const token = `${focus.reportId}:${focus.rawName}:${focus.seq ?? 0}`;
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
      .filter(({ m }) => (onlyFlagged ? needsReview(review(m)) : true));
  }, [report, onlyFlagged]);

  if (!report) return <p className="sub">Nejsou načtena žádná data.</p>;

  // The page the selected row is printed on — not always the first. A
  // multi-page report would otherwise draw the highlight on page 1 for a row
  // printed on page 2.
  const page =
    (sel && report.pages.find((pg) => pg.pageNum === sel.sourcePage)) ?? report.pages[0];

  // Show the whole printed row, as large as that allows.
  //
  // Name, value, unit and interval have to be readable together — verifying a
  // number against the wrong column is the failure this pane exists to
  // prevent, so none of them may be scrolled out of sight. Fitting the row's
  // own width gives roughly 2.5x the scale of the full-page view, where 22
  // rows share the same width, and the tight vertical crop means no
  // neighbouring line is in frame to be mistaken for this one.
  const rowH = sel?.bbox ? Math.max(1, sel.bbox[3] - sel.bbox[1]) : 1;
  // Fit the crop *including* its bleed inside the pane. Scaling to the bare
  // row width made the strip wider than the pane, so the reference-range
  // column — the thing being checked — sat outside the visible area behind a
  // scrollbar nobody notices.
  const rowZoom =
    sel?.bbox && imgW
      ? Math.min(1, Math.max(80, imgW - ROW_BLEED_X * 2) / Math.max(1, sel.bbox[2] - sel.bbox[0]))
      : 0;
  const flaggedCount = report.measurements.filter((m) => needsReview(review(m))).length;

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
        <div className="toolbar">
          <label htmlFor="report" className="muted">Report</label>
          <select
            id="report"
            value={report.id}
            onChange={(e) => { setReportId(e.target.value); setPicked(null); }}
          >
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {czDate(r.reportDate)} — {r.labName ?? r.sourceFile}
              </option>
            ))}
          </select>
          <label className="switch">
            <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
            jen řádky k ověření ({flaggedCount})
          </label>
          <span className="spacer" />
          <span className="muted">
            Klepněte na řádek — ukáže se, kde přesně stojí na zdrojové stránce.
          </span>
        </div>
      </div>

      <div className={`grid2 verify${sel ? " source-first" : ""}`}>
        <div className="card table-pane">
          <h3>Přepsané řádky</h3>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Parametr</th>
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
                          const r = review(m);
                          if (!r.chip) return null;
                          return (
                            <span className={r.level === "ok" ? "chip" : "chip alert"}>{r.chip}</span>
                          );
                        })()}
                        {m.corrected && <span className="chip">ručně opraveno</span>}
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
            <div className="correction">
              <p className="snippet">{sel.sourceSnippet || sel.rawAnalyteName}</p>
              {(() => {
                const r = review(sel);
                return r.reason ? <p className="err" style={{ margin: "0 0 8px" }}>⚠ {r.reason}</p> : null;
              })()}
              <div className="row">
                <input
                  type="text" value={draft} onChange={(e) => setDraft(e.target.value)}
                  aria-label="Opravit hodnotu"
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
                  // Tight vertically — bleeding into the line above or below
                  // invites verifying against the wrong one — but generous
                  // sideways: the bbox ends at the last glyph the text
                  // layer reported, which on a split reference range cuts the
                  // number in half — the crop then shows "(0,17-0,7".
                  backgroundPosition:
                    `-${sel.bbox[0] * rowZoom - ROW_BLEED_X}px -${sel.bbox[1] * rowZoom - ROW_BLEED_Y}px`,
                  width: (sel.bbox[2] - sel.bbox[0]) * rowZoom + ROW_BLEED_X * 2,
                  height: rowH * rowZoom + ROW_BLEED_Y * 2,
                }}
              />
            </div>
          )}

          {page ? (
            <>
            <div className={`srcimg${zoomed ? " zoomed" : ""}`}>
              {/* The highlight is positioned in percentages, so its containing
                  block must be the image's own box. When enlarged the image
                  grows past the pane, which scrolls — so the scrolling element
                  and the positioning context have to be different elements, or
                  the percentages resolve against the wrong width. */}
              <div className="srcimg-inner">
              <img
                ref={imgRef} src={page.imageUrl} alt={`Stránka ${page.pageNum}`}
                onLoad={(e) => setImgW((e.target as HTMLImageElement).clientWidth)}
                style={{ cursor: zoomed ? "zoom-out" : "zoom-in" }}
                onClick={() => setZoomed((z) => !z)}
              />
              {sel?.bbox && page && (
                // Positioned in percentages of the image's own dimensions
                // rather than from a measured pixel width.
                //
                // A measured width is only correct once layout has settled,
                // and this pane relayouts constantly — the source panel
                // reorders above the table on a phone when a row is picked,
                // and the image can be enlarged to native size. Any read taken
                // before the observer catches up misplaces the box
                // proportionally, so the error grows down the page and the
                // highlight frames the wrong row. Percentages are resolved by
                // the browser at paint time and cannot be stale.
                <div
                  ref={hlRef}
                  className="hl"
                  style={{
                    left: `${(sel.bbox[0] / page.imageWidth) * 100}%`,
                    top: `${(sel.bbox[1] / page.imageHeight) * 100}%`,
                    width: `${((sel.bbox[2] - sel.bbox[0]) / page.imageWidth) * 100}%`,
                    height: `${((sel.bbox[3] - sel.bbox[1]) / page.imageHeight) * 100}%`,
                  }}
                />
              )}
              </div>
            </div>
            <p className="zoom-hint">
              {zoomed ? "Klepnutím na stránku zmenšíte zpět." : "Klepnutím na stránku přiblížíte."}
            </p>
            </>
          ) : (
            <p className="muted">Zdrojový obrázek není k dispozici.</p>
          )}
        </div>
      </div>
    </>
  );
}
