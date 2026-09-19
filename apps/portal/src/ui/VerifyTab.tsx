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
import SearchParam from "./SearchParam";
import type { PickerOption } from "./AnalytePicker";
import {
  type LabReport,
  type Measurement,
  normalizeMeasurement,
  needsReview,
  reviewOf,
  checkCorrection,
  count,
  czDate,
  plural,
  prettyUnit,
} from "@bw/lab-core";

/** A row of a report, replaced. */
export interface RowChange {
  index: number;
  next: Measurement;
}

interface Props {
  reports: LabReport[];
  /** One row or many, of one report, saved as one change. */
  onCorrect: (reportId: string, changes: ReadonlyArray<RowChange>) => void;
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

/**
 * The measurement as a confirmation stores it: "this exact value is what the
 * page says." A stored fact rather than a same-value correction, because the
 * implausibility chip is recomputed from the value on every render — only a
 * persistent flag can settle it. The snapshot makes the confirmation undoable
 * through the same channel as a correction. Potvrdit on one row and
 * „Potvrdit všechny řádky k ověření" both build their rows here, so a batch
 * can never store a confirmation a single click would not.
 */
export function confirmedRow(base: Measurement): Measurement {
  return {
    ...base,
    confirmed: true,
    original: base.original ?? {
      valueRaw: base.valueRaw,
      disagreement: base.disagreement,
      confidence: base.confidence,
    },
  };
}

/** „Potvrzena 1 hodnota", „Potvrzeny 3 hodnoty", „Potvrzeno 5 hodnot". */
export function confirmedSentence(n: number): string {
  return `${plural(n, "Potvrzena", "Potvrzeny", "Potvrzeno")} ${count(n, "hodnota", "hodnoty", "hodnot")}.`;
}

export default function VerifyTab({ reports, onCorrect, focus, displayName, curatedRange }: Props) {
  const [reportId, setReportId] = useState(focus?.reportId ?? reports[0]?.id ?? "");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>("");
  // The last „Potvrdit všechny řádky k ověření": the rows as they were, so
  // one Zpět restores the whole batch. Any other change to the report —
  // a single correction, confirmation or undo, or switching reports — ends
  // it, because Zpět must never overwrite a row the reader has since edited.
  const [batch, setBatch] = useState<{ reportId: string; before: RowChange[] } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  // A row picked from the search has to be seen in the table too, not only
  // on the page: on a desktop the table is its own scroll box, and the row
  // could be 600px below its fold. `rowJump` counts the searches, so the same
  // row picked twice scrolls twice.
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const [rowJump, setRowJump] = useState(0);
  useEffect(() => {
    if (rowJump === 0 || picked === null) return;
    const id = requestAnimationFrame(() =>
      rowRefs.current.get(picked)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(id);
  }, [rowJump, picked]);
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

  // The search beside "Přepsané řádky": every row of this report, by the
  // lab's code and the readable name, the doubted ones marked — so a reader
  // who knows which parameter they came to check does not scan 22 rows for
  // it. A pick selects the row; if the filter was hiding it, the filter
  // comes off, because a row the reader asked for must not stay hidden.
  const searchOptions: PickerOption[] = report.measurements.map((m, i) => {
    const r = review(m);
    const name = m.canonicalId ? displayName(m.canonicalId) : m.rawAnalyteName;
    return {
      id: String(i),
      label: name === m.rawAnalyteName ? name : `${name} · ${m.rawAnalyteName}`,
      note: r.chip || undefined,
      outOfRange: r.level !== "ok",
    };
  });
  function pickSearched(id: string) {
    const i = Number(id);
    if (!report.measurements[i]) return;
    if (onlyFlagged && !needsReview(review(report.measurements[i]))) setOnlyFlagged(false);
    pick(i);
    setRowJump((n) => n + 1);
  }

  function save() {
    if (picked === null) return;
    const base = report.measurements[picked];
    if (checkCorrection(draft, base.unitRaw).severity === "reject") return;
    const next = normalizeMeasurement({
      ...base,
      valueRaw: draft,
      corrected: true,
      // A new number is a new question — an earlier confirmation vouched for
      // the value it saw, not for whatever replaced it.
      confirmed: false,
      disagreement: null,
      // Snapshot on the first correction only, so undo always returns to what
      // the document said rather than to an earlier hand-edit.
      original: base.original ?? {
        valueRaw: base.valueRaw,
        disagreement: base.disagreement,
        confidence: base.confidence,
      },
    });
    setBatch(null);
    onCorrect(report.id, [{ index: picked, next }]);
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
      confirmed: false,
      original: null,
    });
    setDraft(orig.valueRaw);
    setBatch(null);
    onCorrect(report.id, [
      { index: picked, next: { ...next, disagreement: orig.disagreement, confidence: orig.confidence } },
    ]);
  }

  function confirmValue() {
    if (picked === null) return;
    setBatch(null);
    onCorrect(report.id, [{ index: picked, next: confirmedRow(report.measurements[picked]) }]);
  }

  // Every row still asking to be looked at — exactly the set „jen řádky k
  // ověření" lists, so the button and the checkbox count the same rows —
  // confirmed with the value the table shows, in one change and one save.
  // The rows are kept as they were, for the one Zpět beside the sentence.
  function confirmAll() {
    const pending = report.measurements
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => needsReview(review(m)));
    if (pending.length === 0) return;
    setBatch({ reportId: report.id, before: pending.map(({ m, i }) => ({ index: i, next: m })) });
    onCorrect(report.id, pending.map(({ m, i }) => ({ index: i, next: confirmedRow(m) })));
  }

  function undoBatch() {
    if (!batch) return;
    setBatch(null);
    onCorrect(batch.reportId, batch.before);
  }

  return (
    <>
      <div className="card">
        <div className="toolbar">
          <label htmlFor="report" className="muted">Report</label>
          <select
            id="report"
            value={report.id}
            onChange={(e) => { setReportId(e.target.value); setPicked(null); setBatch(null); }}
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
          {/* The same noun as the checkbox, so the button reads as acting on
              the rows the checkbox lists — not on every row of the report
              and not on other reports. Disabled, not hidden, when nothing is
              pending: the reader sees that there is nothing left to confirm. */}
          <button className="btn small" onClick={confirmAll} disabled={flaggedCount === 0}>
            Potvrdit všechny řádky k ověření
          </button>
          {batch && batch.reportId === report.id && (
            <span className="batch-done" role="status">
              {confirmedSentence(batch.before.length)}{" "}
              <button className="btn small" onClick={undoBatch}>Zpět</button>
            </span>
          )}
          <span className="spacer" />
          <span className="muted">
            Klepněte na řádek — ukáže se, kde přesně stojí na zdrojové stránce.
          </span>
        </div>
      </div>

      <div className={`grid2 verify${sel ? " source-first" : ""}`}>
        <div className="card table-pane">
          <div className="pane-head">
            <h3>Přepsané řádky</h3>
            <SearchParam options={searchOptions} onPick={pickSearched} label="Hledat parametr a vybrat řádek" />
          </div>
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
                  <tr
                    key={i}
                    className="row-pick"
                    aria-selected={picked === i}
                    onClick={() => pick(i)}
                    ref={(el) => {
                      if (el) rowRefs.current.set(i, el);
                      else rowRefs.current.delete(i);
                    }}
                  >
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
                        {m.confirmed && !m.corrected && <span className="chip">potvrzeno</span>}
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
                {/* An unchanged value on a doubted row is not a dead end: the
                    reader who checked the page and found the transcript right
                    needs a way to say so. */}
                {draft === sel.valueRaw && !sel.confirmed && needsReview(review(sel)) ? (
                  <button className="btn primary" onClick={confirmValue}>
                    Potvrdit
                  </button>
                ) : (
                  <button
                    className="btn primary"
                    onClick={save}
                    disabled={draft === sel.valueRaw || check.severity === "reject"}
                  >
                    Opravit
                  </button>
                )}
                {sel.original && (
                  <button className="btn" onClick={undo}>
                    {sel.corrected ? `Vrátit původní (${sel.original.valueRaw})` : "Zrušit potvrzení"}
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
                  style={(() => {
                    // The bbox ends at the glyph baseline the text layer
                    // reported, so a ring drawn on it exactly cuts through
                    // descenders. Bleed a fraction of the row's own height —
                    // more below, where the descenders are — still expressed
                    // in percentages of the image, so it cannot go stale.
                    const h = sel.bbox[3] - sel.bbox[1];
                    const padTop = Math.max(2, h * 0.12);
                    const padBottom = Math.max(3, h * 0.28);
                    return {
                      left: `${(sel.bbox[0] / page.imageWidth) * 100}%`,
                      top: `${((sel.bbox[1] - padTop) / page.imageHeight) * 100}%`,
                      width: `${((sel.bbox[2] - sel.bbox[0]) / page.imageWidth) * 100}%`,
                      height: `${((h + padTop + padBottom) / page.imageHeight) * 100}%`,
                    };
                  })()}
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
