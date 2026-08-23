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
 * It lives in two places now and is the same component in both — the right
 * rail on a workstation, the „Zdroje (n)" disclosure under the answer on a
 * phone. Only the width differs, which is why the crop is expressed as a ratio
 * and never as pixels.
 */
import { useEffect, useRef, useState } from "react";
import { czDate, czDates } from "./format";

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

export default function Sources({
  sources,
  focus = null,
}: {
  sources: Source[];
  /** The entry a `[n]` in the answer pointed at: highlighted and scrolled to. */
  focus?: number | null;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const hit = useRef<HTMLDivElement>(null);

  // A rail that silently holds the answer's eighth source is a rail the reader
  // will conclude is empty. Clicking [8] has to move it.
  useEffect(() => {
    if (focus != null && hit.current)
      hit.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  if (sources.length === 0) return null;

  return (
    <div className="sources">
      {sources.map((s) => {
        const on = focus === s.n;
        const expanded = open === s.n;
        return (
          <div
            key={s.n}
            className={`source${on ? " on" : ""}${expanded ? " open" : ""}`}
            ref={on ? hit : undefined}
          >
            <button
              type="button"
              className="source-row"
              /* Also the `[n]` handle for this entry: an answer does not always
                 cite every source it registered, and the registry must stay
                 reachable by number either way. */
              data-testid={`cite-${s.n}`}
              onClick={() => setOpen(expanded ? null : s.n)}
              aria-expanded={expanded}
            >
              <span className="src-n">{s.n}</span>
              <span className="src-text">
                <span className="src-label">
                  {czDates(s.kind === "document" ? (s.title ?? s.label) : s.label)}
                </span>
                {/* Date first: it is what a reader matches against the answer,
                    and it is the half that must never be the one truncated. */}
                <span className="src-meta">
                  {czDate(s.date)}
                  {" · "}
                  {s.kind === "lab" ? s.lab ?? "laboratoř" : "dokument"}
                  {s.page && s.page > 1 ? ` · s. ${s.page}` : ""}
                </span>
              </span>
              <span className="src-more" aria-hidden="true">
                {expanded ? "−" : "+"}
              </span>
            </button>

            {s.kind === "lab" && s.imageUrl && s.bbox && s.pageW && s.pageH && (
              <RowCrop src={s.imageUrl} bbox={s.bbox} pageW={s.pageW} pageH={s.pageH} />
            )}
            {s.kind === "document" && s.excerpt && (
              <blockquote className="source-quote">{s.excerpt}</blockquote>
            )}
            {expanded && s.imageUrl && (
              <img className="source-page" src={s.imageUrl} alt={`Strana ${s.page ?? 1}`} />
            )}
            {expanded && !s.imageUrl && (
              <p className="src-meta src-none">Náhled strany není k dispozici.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
