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
 *
 * Re-homed in the second pass — the same components now render into the right
 * rail on a desktop and into a „Zdroje (n)" disclosure under the answer on a
 * phone.
 *
 * The crop semantics are the ones the spec pins — the located row's band, the
 * whole printed row, expanding to the page image — but the *window* is now two
 * dimensional. A band drawn across the full 1819px sheet spends a third of the
 * rail on the blank margins the printer left, which is a third of the rail not
 * spent on the print; cropping to the located row's own x-range as well buys
 * that back and lands the type ~1.5× larger at rest. Crucially it lands it
 * larger with the „Referenční meze" column still inside the frame: the column
 * is the bbox's own right edge, so it cannot be scaled off the card.
 */
import { useEffect, useRef, useState } from "react";

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

/** Breathing room around the located row, in page pixels. */
const BLEED_Y = 14;
const BLEED_X = 14;

/**
 * The letterhead band of a report cited as a whole, as fractions of the page.
 *
 * Fractions rather than pixels: the geometry has to survive a report printed
 * on a different sheet. The band covers the laboratory, the patient and the
 * two dates — everything that says *which* report this is — and stops before
 * the results table, which is what the `+` is for. The first pass showed the
 * top 82 % of the page WIDTH instead, ≈ 260 rail pixels of paper per source;
 * eight sources of that is a rail nobody scrolls to the end of.
 */
const HEAD = { x0: 0.05, y0: 0.055, x1: 0.95, y1: 0.2 };

/** A window onto the page, in page pixels. */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A rectangle of the printed page, scaled to whatever width it is given.
 *
 * Pure CSS, no measurement and no layout thrash: the wrapper's aspect-ratio
 * reserves the window's shape at any panel width, the image is blown up so
 * that the window fills the wrapper (`width: pageW / windowW`), and it is then
 * shifted by the window's origin — expressed as a fraction of the image's own
 * width and height, which is exactly what a percentage translate means.
 */
function Crop({
  src,
  rect,
  pageW,
  pageH,
}: {
  src: string;
  rect: Rect;
  pageW: number;
  pageH: number;
}) {
  const w = Math.max(1, rect.x1 - rect.x0);
  const h = Math.max(1, rect.y1 - rect.y0);
  return (
    <span className="src-mat">
      <span className="src-crop" style={{ aspectRatio: `${w} / ${h}` }}>
        <img
          src={src}
          alt=""
          style={{
            width: `${(100 * pageW) / w}%`,
            transform: `translate(${(-100 * rect.x0) / pageW}%, ${(-100 * rect.y0) / pageH}%)`,
          }}
        />
      </span>
    </span>
  );
}

/**
 * The whole printed row: the located bbox gives the row's band, and the crop
 * shows that band from the parameter's name to the end of its reference range
 * — the value, the unit and the range are what a reader wants, and they are
 * what the located row spans. The bleed is generous enough that the row is not
 * shaved by a locator that ended a pixel early.
 */
const rowRect = (
  bbox: [number, number, number, number],
  pageW: number,
  pageH: number,
): Rect => ({
  x0: Math.max(0, bbox[0] - BLEED_X),
  y0: Math.max(0, bbox[1] - BLEED_Y),
  x1: Math.min(pageW, bbox[2] + BLEED_X),
  y1: Math.min(pageH, bbox[3] + BLEED_Y),
});

/**
 * A report cited as a whole has no located row — `bbox` is null, because
 * nothing on the page was searched for. Its letterhead is the honest crop:
 * nothing on the sheet was singled out, so the sheet identifies itself.
 */
const headRect = (pageW: number, pageH: number): Rect => ({
  x0: pageW * HEAD.x0,
  y0: pageH * HEAD.y0,
  x1: pageW * HEAD.x1,
  y1: pageH * HEAD.y1,
});

function SourceCard({
  s,
  active,
  open,
  onToggle,
}: {
  s: Source;
  active: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // A [n] that focuses an entry the reader cannot see has focused nothing.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  const meta =
    s.kind === "lab" ? [s.lab, czDate(s.date)].filter(Boolean).join(" · ") : czDate(s.date);

  return (
    <div
      className={`src${active ? " is-active" : ""}${open ? " is-open" : ""}`}
      ref={ref}
      id={`src-${s.n}`}
    >
      <button
        type="button"
        className="src-head"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? "Skrýt stranu" : "Zobrazit celou stranu"}
      >
        <span className="src-n">{s.n}</span>
        <span className="src-title">
          <span className="src-label">{s.label}</span>
          <span className="src-meta">{meta}</span>
        </span>
        {s.imageUrl && (
          <span className="src-more" aria-hidden="true">
            {open ? "−" : "+"}
          </span>
        )}
      </button>

      {/* The collapsed card is the band, always — the whole page lives behind
          the `+`, where it costs the rail nothing until it is asked for. */}
      {s.kind === "lab" && s.imageUrl && s.pageW && s.pageH && (
        <Crop
          src={s.imageUrl}
          rect={
            s.bbox ? rowRect(s.bbox, s.pageW, s.pageH) : headRect(s.pageW, s.pageH)
          }
          pageW={s.pageW}
          pageH={s.pageH}
        />
      )}
      {/* The clamp lives on the inner span, not on the quote: `overflow` on a
          -webkit-box clips at its padding edge, so a padded clamp lets the
          first sliver of the line after the ellipsis paint anyway. */}
      {s.kind === "document" && s.excerpt && (
        <blockquote className="src-quote">
          <span>{s.excerpt}</span>
        </blockquote>
      )}
      {open && s.imageUrl && (
        <span className="src-page">
          <img src={s.imageUrl} alt={`Strana ${s.page ?? 1}`} />
        </span>
      )}
    </div>
  );
}

/** 2026-02-24 → 24. 2. 2026. The registry ships ISO; a doctor does not read it. */
function czDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : iso;
}

export default function Sources({
  sources,
  activeCite = null,
}: {
  sources: Source[];
  /** Which entry the answer's [n] pointed at, if any. */
  activeCite?: number | null;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (sources.length === 0) return null;

  return (
    <div className="src-list">
      {sources.map((s) => (
        <SourceCard
          key={s.n}
          s={s}
          active={activeCite === s.n}
          open={open === s.n}
          onToggle={() => setOpen(open === s.n ? null : s.n)}
        />
      ))}
    </div>
  );
}
