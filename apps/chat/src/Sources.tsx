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
 * The crop mechanics did change, in the polish pass, and in one direction: a
 * crop only exists where the pipeline located a row. With a bbox the card
 * shows that row, cropped in both axes and scaled until its type is legible,
 * with the row itself marked. Without one there is nothing to point at — a
 * whole report cited as a whole — and the card is a compact row of label, lab
 * and date whose page is one click away. Six cards each showing the top of a
 * different A4 sheet at 5px type taught a reader nothing and cost the rail its
 * whole height.
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
const BLEED_Y = 10;
const BLEED_X = 16;
/** …and how far outside the located text the mark is drawn, so it rings the
    row rather than cutting through its first and last glyph. */
const MARK_PAD = 6;

/**
 * The smallest the located row's own type may render at, in CSS pixels.
 *
 * The old crop was the whole page scaled into a ~310px card: the lab table's
 * body type landed at four to six CSS pixels, so the numbers a doctor is being
 * asked to trust were a grey smudge. A crop that cannot be read is not
 * evidence, it is a picture of evidence.
 */
const MIN_ROW_PX = 12;

/**
 * The located row, cropped in BOTH axes and scaled to be readable.
 *
 * The bbox gives the row's band; the crop is that band plus a little bleed,
 * and the page image inside it is scaled so the row's own text clears
 * MIN_ROW_PX. Where the band is wider than the card at that scale the card
 * clips it — the left of the row, which carries the parameter and its value,
 * stays legible, and the whole page is one click away as it always was.
 * Scaling to fit instead would put us back at six pixels.
 *
 * Still pure CSS, still no measurement: `max(px, %)` picks fit-to-width or the
 * legibility floor, whichever is larger, and every offset is a percentage of
 * the element it applies to, so the same numbers hold at any card width.
 */
function RowCrop({
  src,
  bbox,
  pageW,
  pageH,
  marked,
}: {
  src: string;
  bbox: [number, number, number, number];
  pageW: number;
  pageH: number;
  /** The answer's [n] is pointing here right now. */
  marked: boolean;
}) {
  const x0 = Math.max(0, bbox[0] - BLEED_X);
  const x1 = Math.min(pageW, bbox[2] + BLEED_X);
  const y0 = Math.max(0, bbox[1] - BLEED_Y);
  const y1 = Math.min(pageH, bbox[3] + BLEED_Y);
  const bandW = Math.max(1, x1 - x0);
  const bandH = Math.max(1, y1 - y0);
  const rowH = Math.max(1, bbox[3] - bbox[1]);
  // Scale at which the row's text is exactly MIN_ROW_PX tall.
  const floor = MIN_ROW_PX / rowH;
  const pct = (v: number, of: number) => `${(100 * v) / of}%`;

  return (
    <span
      className={`src-crop${marked ? " is-marked" : ""}`}
      style={{
        aspectRatio: `${bandW} / ${bandH}`,
        minHeight: `${Math.round(bandH * floor)}px`,
      }}
    >
      <span className="src-band" style={{ width: `max(${Math.round(bandW * floor)}px, 100%)` }}>
        <img
          src={src}
          alt=""
          style={{
            width: `max(${Math.round(pageW * floor)}px, ${pct(pageW, bandW)})`,
            transform: `translate(-${pct(x0, pageW)}, -${pct(y0, pageH)})`,
          }}
        />
        {/* The signal marker: [6] backs four different parameters on one
            report, so the crop has to say which row it is, not which page. */}
        <span
          className="src-row"
          aria-hidden="true"
          style={{
            left: pct(bbox[0] - MARK_PAD - x0, bandW),
            width: pct(bbox[2] - bbox[0] + MARK_PAD * 2, bandW),
            top: pct(bbox[1] - MARK_PAD / 2 - y0, bandH),
            height: pct(rowH + MARK_PAD, bandH),
          }}
        />
      </span>
    </span>
  );
}

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
  // The glide is ambient; a reader who asked for stillness still gets there.
  useEffect(() => {
    if (!active) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  }, [active]);

  const meta =
    s.kind === "lab" ? [s.lab, czDate(s.date)].filter(Boolean).join(" · ") : czDate(s.date);

  const located = Boolean(s.kind === "lab" && s.imageUrl && s.pageW && s.pageH && s.bbox);

  return (
    <div
      className={`src${active ? " is-active" : ""}${located ? "" : " is-compact"}`}
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

      {located && (
        <RowCrop
          src={s.imageUrl as string}
          bbox={s.bbox as [number, number, number, number]}
          pageW={s.pageW as number}
          pageH={s.pageH as number}
          marked={active}
        />
      )}
      {s.kind === "document" && s.excerpt && (
        <blockquote className="src-quote">{s.excerpt}</blockquote>
      )}
      {open && s.imageUrl && (
        <span className="src-sheet">
          <img className="src-page" src={s.imageUrl} alt={`Strana ${s.page ?? 1}`} />
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
