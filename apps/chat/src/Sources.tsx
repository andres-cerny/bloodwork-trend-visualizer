/**
 * The turn's evidence, numbered.
 *
 * A lab source is not a link — it is the actual row of the printed report,
 * cropped from the page image by the bbox the pipeline located. A document
 * source is the excerpt the tool read, with its page beside it. This panel
 * renders the registry exactly as the server sent it: a [n] in the answer
 * with no entry here points at nothing, and that absence is information.
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

export default function Sources({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (sources.length === 0) return null;

  return (
    <div className="sources">
      <div className="sources-head">Zdroje</div>
      {sources.map((s) => (
        <div key={s.n} className="source">
          <button
            type="button"
            className="source-row"
            onClick={() => setOpen(open === s.n ? null : s.n)}
            aria-expanded={open === s.n}
          >
            <sup className="cite">{s.n}</sup>
            <span className="source-label">{s.label}</span>
            <span className="muted">
              {s.kind === "lab" ? `${s.lab ?? ""} · ${s.date}` : `${s.date}`}
            </span>
          </button>
          {s.kind === "lab" && s.imageUrl && s.bbox && s.pageW && s.pageH && (
            <RowCrop src={s.imageUrl} bbox={s.bbox} pageW={s.pageW} pageH={s.pageH} />
          )}
          {s.kind === "document" && s.excerpt && (
            <blockquote className="source-quote">{s.excerpt}</blockquote>
          )}
          {open === s.n && s.imageUrl && (
            <img className="source-page" src={s.imageUrl} alt={`Strana ${s.page ?? 1}`} />
          )}
        </div>
      ))}
    </div>
  );
}
