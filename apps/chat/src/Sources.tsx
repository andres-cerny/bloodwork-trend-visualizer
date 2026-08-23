/**
 * The turn's evidence, numbered — mounted, not attached.
 *
 * A lab source is not a link. It is the actual row of the printed report,
 * cropped from the page image by the bbox the pipeline located; a document
 * source is the excerpt the tool read. This panel renders the registry exactly
 * as the server sent it: a [n] in the answer with no entry here points at
 * nothing, and that absence is information.
 *
 * The crop semantics are unchanged from the first pass — bbox band, full page
 * width, expand to the page image. What changed is where the panel lives: the
 * right rail on a desktop, a per-answer disclosure on a phone. Both render this
 * component; only the width differs.
 *
 * All rendering, no reasoning: the bbox, the image URL and the excerpt all
 * arrived in a `sources` event.
 */
import { useState } from "react";

export interface Source {
  n: number;
  kind: "lab" | "document";
  label: string;
  date: string;
  lab?: string;
  reportId?: string;
  page?: number;
  imageUrl?: string | null;
  bbox?: [number, number, number, number] | null;
  documentId?: string;
  title?: string;
  excerpt?: string;
  pageW?: number | null;
  pageH?: number | null;
}

/** Vertical breathing room around the located row, in page pixels. */
const BLEED_Y = 10;

/** 2026-02-24 → 24. 2. 2026. The registry is read by a Czech reader. */
const czDate = (iso: string): string =>
  (iso ?? "").replace(
    /(\d{4})-(\d{2})-(\d{2})/g,
    (_, y, m, d) => `${Number(d)}. ${Number(m)}. ${y}`,
  );

/**
 * The whole printed row, full page width: the located bbox gives the row's
 * vertical band, and the crop shows that band across the entire page — the
 * value, unit and reference range are what a reader wants, and the bbox often
 * covers only the words the locator searched for.
 *
 * Pure CSS: the wrapper's aspect-ratio reserves the band's height at any
 * panel width, and the image is shifted up by the band's start as a fraction
 * of its own height. No measurement, no layout thrash.
 */
function RowCrop({
  src,
  bbox,
  pageW,
  pageH,
}: {
  src: string;
  bbox: [number, number, number, number];
  pageW: number;
  pageH: number;
}) {
  const y0 = Math.max(0, bbox[1] - BLEED_Y);
  const y1 = Math.min(pageH, bbox[3] + BLEED_Y);
  return (
    <span className="src-crop" style={{ aspectRatio: `${pageW} / ${Math.max(1, y1 - y0)}` }}>
      <img src={src} alt="" style={{ transform: `translateY(${-(100 * y0) / pageH}%)` }} />
    </span>
  );
}

function Entry({
  s,
  focused,
}: {
  s: Source;
  focused: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasCrop = s.kind === "lab" && s.imageUrl && s.bbox && s.pageW && s.pageH;

  return (
    <div className={`src${focused ? " on" : ""}${open ? " open" : ""}`} data-src-n={s.n}>
      <button
        type="button"
        className="src-btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        disabled={!s.imageUrl}
      >
        <span className="src-n" aria-hidden="true">
          {s.n}
        </span>
        <span className="src-text">
          {/* Server labels carry ISO dates („Odběr 2024-10-02"); the panel is
              read in Czech, so they are written out the way a date is here. */}
          <span className="src-label">{czDate(s.label)}</span>
          <span className="src-meta">
            {s.kind === "lab" && s.lab ? `${s.lab} · ` : ""}
            {czDate(s.date)}
          </span>
          {s.imageUrl && (
            <span className="src-open">
              {open ? "Skrýt stranu" : "Celá strana"}
              <span className="chev" aria-hidden="true">
                ▾
              </span>
            </span>
          )}
        </span>
        {/* No located row on this source — the page itself is the specimen, so
            it is shown as one: a small print of the report the value came from. */}
        {!hasCrop && s.imageUrl && (
          <span className="src-thumb" aria-hidden="true">
            <img src={s.imageUrl} alt="" />
          </span>
        )}
      </button>

      {hasCrop && (
        <span className="src-mount">
          <RowCrop
            src={s.imageUrl as string}
            bbox={s.bbox as [number, number, number, number]}
            pageW={s.pageW as number}
            pageH={s.pageH as number}
          />
        </span>
      )}

      {s.kind === "document" && s.excerpt && (
        <blockquote className={`src-quote${open ? " full" : ""}`}>{s.excerpt}</blockquote>
      )}

      {open && s.imageUrl && (
        <span className="src-page">
          <img src={s.imageUrl} alt={`Strana ${s.page ?? 1}`} />
        </span>
      )}
    </div>
  );
}

export default function Sources({
  sources,
  focusedN = null,
}: {
  sources: Source[];
  /** The entry whose `[n]` was clicked, if any. */
  focusedN?: number | null;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="src-list">
      {sources.map((s) => (
        <Entry key={s.n} s={s} focused={focusedN === s.n} />
      ))}
    </div>
  );
}
