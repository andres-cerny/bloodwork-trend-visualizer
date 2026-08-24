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
 * phone. The third pass rewrote the crop: it is scaled from the row's own
 * height instead of being fitted to the card's width, which is the difference
 * between a line of a printed report and a grey smear.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { scrollIntoNearest } from "./motion";
import { excerptLines, excerptStart } from "./excerpt";

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

/* ------------------------------------------------------------------ *
 * The located row
 * ------------------------------------------------------------------ */

/**
 * How tall the cited row is drawn, in CSS pixels.
 *
 * This is the number the whole crop hangs off. The reports are set in 9 pt and
 * rendered at 220 DPI, so a row's located bbox is ~32 page px tall for ~27.5 px
 * of em — 14 CSS px of band therefore renders the type at ~12 CSS px, the floor
 * at which a printed table is readable at 1× on a phone.
 *
 * The scale it implies (~0.44) makes the page far wider than any card, and that
 * is deliberate: fitting the page's full width into a 300 px rail rendered this
 * same type at 5 px, which is the "broken thumbnail" this replaced. The band
 * runs off the right edge and is clipped, with a fade that says so, and the
 * whole page is still one click away behind the `+`.
 */
const ROW_PX = 14;
/**
 * The floor the crop will not shrink below, whatever the card's width.
 *
 * 14 px of band is ~12 CSS px of type; 12 px of band is ~10.3, which is the
 * bottom of what a printed table survives at 1×. Below this the crop stops
 * shrinking and lets the fade take more of the row — a legible half-row beats
 * an illegible whole one.
 */
const MIN_ROW_PX = 12;
/**
 * How far across the row the window must reach, as a fraction of its x-extent.
 *
 * The bbox spans the whole printed row — parametr, výsledek, jednotka,
 * referenční rozmezí — and at a readable scale that is ~2.5 cards wide, so
 * something is always clipped. What must never be clipped is the number the
 * answer cited: at ROW_PX the 300 px rail cut „149" through its last digit and
 * buried the rest under the fade, which is the crop failing at the one job it
 * has. A Czech lab table sets the parametr at the left margin and the výsledek
 * just past the middle, so a window reaching 0.56 of the row's width clears the
 * value column on the narrowest card here; the unit and the reference range are
 * what the fade is allowed to take.
 */
const SHOWN = 0.56;
/**
 * Paper kept clear at the right, in CSS px — where the fade sits.
 *
 * Also the fade's own width (`.src-band-fade`), so the gradient begins exactly
 * where the crop's guaranteed content ends and covers nothing the window
 * promised to show.
 */
const GUTTER = 16;
/**
 * One printed line of context above and below, as a multiple of the row.
 *
 * Measured off the generated pages rather than guessed: a table row's ink is
 * 28 page px tall inside a 32 px bbox, and the line pitch is 58. So one line of
 * context needs at least 58/32 ≈ 1.81 row-heights, and anything below that cuts
 * the neighbouring line through its glyph tops — which is how the first draft
 * of this crop rendered „Analyt" as „Anaıyt" and looked like a broken image
 * again, only smaller. 2.2 lands the cut in the whitespace at both ends, with
 * ~7 px of page to spare above and ~12 px below.
 */
const CONTEXT = 2.2;
/** Page px kept in front of the row's first glyph, so it is not flush. */
const BLEED_X = 6;

/**
 * The band's own width, in CSS px, as the card is actually laid out.
 *
 * The crop's scale depends on it — the rail is 298 px of paper and a phone is
 * 340 — and no media query can carry that number into arithmetic. Measured in a
 * layout effect, so the corrected scale is in place before the browser paints,
 * and re-measured on resize; 0 until the first measurement, which the caller
 * reads as „unknown" and answers with the unconstrained scale.
 */
function useBandWidth() {
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

function RowCrop({
  src,
  bbox,
  pageW,
  pageH,
  label,
}: {
  src: string;
  bbox: [number, number, number, number];
  pageW: number;
  pageH: number;
  label: string;
}) {
  const { ref: bandRef, width: bandW } = useBandWidth();
  const [x0, y0, x1, y1] = bbox;
  const rowH = Math.max(1, y1 - y0);
  const left = Math.max(0, x0 - BLEED_X);
  const span = Math.max(1, x1 - left);
  // Three bounds, in the order they matter: never taller than a printed line
  // needs to be, never so small the type stops being type, and in between,
  // whatever it takes to carry the window past the value column.
  const fit = bandW > 0 ? (bandW - GUTTER) / (span * SHOWN) : ROW_PX / rowH;
  const scale = Math.min(ROW_PX / rowH, Math.max(MIN_ROW_PX / rowH, fit));
  const top = Math.max(0, y0 - rowH * CONTEXT);
  const bottom = Math.min(pageH, y1 + rowH * CONTEXT);
  const px = (v: number) => `${v.toFixed(1)}px`;

  // Where the ring may run to: the fade's own edge, less its 2px stroke, so the
  // mark that means something is never drawn under the thing that dims it.
  const ringL = (x0 - left) * scale;
  const ringMax = bandW > 0 ? bandW - GUTTER - 2 : Infinity;
  const clipped = ringL + (x1 - x0) * scale > ringMax;
  const ringW = clipped ? Math.max(0, ringMax - ringL) : (x1 - x0) * scale;

  return (
    <span className="src-paper">
      <span className="src-band" ref={bandRef} style={{ height: px((bottom - top) * scale) }}>
        <img
          src={src}
          alt={`Výřez řádku z tištěného nálezu — ${label}`}
          style={{
            width: px(pageW * scale),
            transform: `translate(${px(-left * scale)}, ${px(-top * scale)})`,
          }}
        />
        {/* Which row, not just which page. The band shows three printed lines;
            without this the reader has to guess which of them was cited.

            The row is wider than the card, so on a clipped crop this closes at
            the crop's own edge rather than at the row's — a mark that runs off
            the side rings nothing, and the reader cannot tell a cut ring from a
            ring that was never drawn. What continues past it is still faintly
            legible through the fade, which is the honest way to say so. */}
        <span
          className="src-ring"
          aria-hidden="true"
          style={{
            left: px(ringL),
            top: px((y0 - top) * scale),
            width: px(ringW),
            height: px(rowH * scale),
          }}
        />
        {/* Nothing to say when the whole row fits. */}
        {clipped && <span className="src-band-fade" aria-hidden="true" />}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * The document excerpt
 * ------------------------------------------------------------------ */

function Excerpt({ excerpt, label }: { excerpt: string; label: string }) {
  const lines = excerptLines(excerpt);
  const start = excerptStart(lines, label);
  const shown = lines.slice(start);
  // The clip held nothing but the letterhead and the patient's identification.
  // Then there is no passage to show, and a card that shows none is telling the
  // truth — the whole page is still behind the `+`.
  if (shown.length === 0) return null;
  const text = shown.join("\n");
  // The registry clips the excerpt to a fixed length, so it almost always stops
  // mid-document. An elision mark is the honest way to say so — and the same
  // mark in front, when the header was clamped away.
  const tail = /[.!?…]$/.test(text) ? "" : "…";

  return (
    <span className="src-paper">
      <blockquote className="src-quote">
        {start > 0 && (
          <span className="src-elide" aria-hidden="true">
            …{" "}
          </span>
        )}
        {text}
        {tail && (
          <span className="src-elide" aria-hidden="true">
            {" "}
            {tail}
          </span>
        )}
      </blockquote>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * One entry
 * ------------------------------------------------------------------ */

function SourceCard({
  s,
  active,
  open,
  chip,
  onToggle,
}: {
  s: Source;
  active: boolean;
  open: boolean;
  /** Cited entries carry their [n]; context sources below the divider do not. */
  chip: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // A [n] that focuses an entry the reader cannot see has focused nothing. The
  // rail moves, or the thread does on a phone — the shell never does.
  useEffect(() => {
    if (active && ref.current) scrollIntoNearest(ref.current);
  }, [active]);

  const label = czLabel(s.label);
  const meta =
    s.kind === "lab" ? [s.lab, czDate(s.date)].filter(Boolean).join(" · ") : czDate(s.date);
  // A report cited as a whole has no located row — nothing on the page was
  // searched for, so there is no band to crop and no row to ring. Rendering the
  // page anyway produced 350px of 4px type per card; the honest form is the
  // reference itself, with the page one press away.
  const cropped = s.kind === "lab" && s.imageUrl && s.pageW && s.pageH && s.bbox;

  return (
    <div
      className={`src${active ? " is-active" : ""}${chip ? "" : " is-context"}`}
      ref={ref}
      id={`src-${s.n}`}
    >
      <button
        type="button"
        className="src-head"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={s.imageUrl ? `src-page-${s.n}` : undefined}
        title={open ? "Skrýt stranu" : "Zobrazit celou stranu"}
      >
        {chip && (
          <span className="src-n" aria-hidden="true">
            {s.n}
          </span>
        )}
        <span className="src-title">
          <span className="src-label">
            {chip && <span className="sr-only">Zdroj {s.n}: </span>}
            {label}
          </span>
          <span className="src-meta">{meta}</span>
          {!cropped && s.imageUrl && (
            <span className="src-hint">
              {s.kind === "lab" ? "Celá strana nálezu" : "Celá strana dokumentu"}
              {s.page ? ` — strana ${s.page}` : ""}
            </span>
          )}
        </span>
        {s.imageUrl && (
          <span className="src-more" aria-hidden="true">
            {open ? "−" : "+"}
          </span>
        )}
      </button>

      {cropped && (
        <RowCrop
          src={s.imageUrl as string}
          bbox={s.bbox as [number, number, number, number]}
          pageW={s.pageW as number}
          pageH={s.pageH as number}
          label={label}
        />
      )}
      {s.kind === "document" && s.excerpt && <Excerpt excerpt={s.excerpt} label={label} />}
      {open && s.imageUrl && (
        <img
          className="src-page"
          id={`src-page-${s.n}`}
          src={s.imageUrl}
          alt={`Celá strana ${s.page ?? 1} — ${label}`}
        />
      )}
    </div>
  );
}

/** 2026-02-24 → 24. 2. 2026. The registry ships ISO; a doctor does not read it. */
function czDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : iso;
}

/**
 * The registry's own label carries an ISO date inside it — „Odběr 2024-10-02" —
 * and it lands two lines above the same date already rendered Czech. The label
 * is the server's string, so this rewrites only what it recognises as a date
 * and leaves everything else exactly as it arrived.
 */
function czLabel(label: string): string {
  return label.replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, y, m, d) => czDate(`${y}-${m}-${d}`));
}

export default function Sources({
  sources,
  activeCite = null,
  citeOrder = [],
}: {
  sources: Source[];
  /** Which entry the answer's [n] pointed at, if any. */
  activeCite?: number | null;
  /**
   * The `n` of every marker in the answer, in the order the reader meets them.
   *
   * The rail used to arrive in sample-date order, so the first three cards
   * beside a summary that cites [6], [7] and [8] had no anchor anywhere in the
   * visible text — every marker on screen pointed off-screen, which teaches the
   * mapping backwards. Ordering by first appearance fixes that.
   *
   * The numbers themselves are never rewritten: a chip renumbered to match its
   * new position would break the one contract the marker has, that [6] in the
   * text and 6 in the rail are the same document.
   */
  citeOrder?: number[];
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (sources.length === 0) return null;

  const byN = new Map(sources.map((s) => [s.n, s]));
  const cited = citeOrder.map((n) => byN.get(n)).filter((s): s is Source => Boolean(s));
  const seen = new Set(cited.map((s) => s.n));
  const context = sources.filter((s) => !seen.has(s.n));

  const card = (s: Source, chip: boolean) => (
    <SourceCard
      key={s.n}
      s={s}
      chip={chip}
      active={activeCite === s.n}
      open={open === s.n}
      onToggle={() => setOpen(open === s.n ? null : s.n)}
    />
  );

  return (
    <div className="src-list">
      {cited.map((s) => card(s, true))}
      {cited.length > 0 && context.length > 0 && (
        <p className="src-divider">Další podklady</p>
      )}
      {/* Nothing in the answer points here, so no chip — but the entry keeps
          its identity, and a [n] typed into a later turn still finds it. */}
      {context.map((s) => card(s, cited.length === 0))}
    </div>
  );
}
