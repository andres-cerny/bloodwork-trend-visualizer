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
 * phone. The crop mechanics below did not change.
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
    <span
      className="src-crop"
      style={{ aspectRatio: `${pageW} / ${Math.max(1, y1 - y0)}` }}
    >
      <img src={src} alt="" style={{ transform: `translateY(${-(100 * y0) / pageH}%)` }} />
    </span>
  );
}

/**
 * A report cited as a whole has no located row — `bbox` is null, because
 * nothing on the page was searched for. The same crop is still the right
 * picture: the top of the sheet is the letterhead, the patient line and the
 * results table, and the bottom half of a generated report is blank paper.
 * Cropping to a fixed fraction of the page WIDTH keeps the card a predictable
 * shape whatever the page geometry is.
 */
function PageHead({ src, pageW, pageH }: { src: string; pageW: number; pageH: number }) {
  const band = Math.min(pageH, pageW * 0.82);
  return (
    <span className="src-crop" style={{ aspectRatio: `${pageW} / ${band}` }}>
      <img src={src} alt="" />
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
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  const meta =
    s.kind === "lab" ? [s.lab, czDate(s.date)].filter(Boolean).join(" · ") : czDate(s.date);

  return (
    <div className={`src${active ? " is-active" : ""}`} ref={ref} id={`src-${s.n}`}>
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

      {s.kind === "lab" &&
        s.imageUrl &&
        s.pageW &&
        s.pageH &&
        (s.bbox ? (
          <RowCrop src={s.imageUrl} bbox={s.bbox} pageW={s.pageW} pageH={s.pageH} />
        ) : (
          <PageHead src={s.imageUrl} pageW={s.pageW} pageH={s.pageH} />
        ))}
      {s.kind === "document" && s.excerpt && (
        <blockquote className="src-quote">{s.excerpt}</blockquote>
      )}
      {open && s.imageUrl && (
        <img className="src-page" src={s.imageUrl} alt={`Strana ${s.page ?? 1}`} />
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
