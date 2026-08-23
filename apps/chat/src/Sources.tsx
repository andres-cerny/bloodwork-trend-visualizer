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
}

/** Some horizontal breathing room around the located row. */
const BLEED_X = 12;
const BLEED_Y = 6;
const CROP_H = 44;

/**
 * The row, cut out of the page image with pure CSS: the image is positioned
 * so the bbox lands inside a fixed-height window, scaled to the window width.
 * The math mirrors the verify screen in the bloodwork app.
 */
function RowCrop({ src, bbox }: { src: string; bbox: [number, number, number, number] }) {
  const [x0, y0, x1, y1] = bbox;
  const w = Math.max(1, x1 - x0 + BLEED_X * 2);
  const h = Math.max(1, y1 - y0 + BLEED_Y * 2);
  const scale = CROP_H / h;
  return (
    <span className="src-crop" style={{ height: CROP_H }}>
      <img
        src={src}
        alt=""
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          translate: `${-(x0 - BLEED_X) * scale}px ${-(y0 - BLEED_Y) * scale}px`,
          maxWidth: "none",
        }}
      />
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
          {s.kind === "lab" && s.imageUrl && s.bbox && (
            <RowCrop src={s.imageUrl} bbox={s.bbox} />
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
