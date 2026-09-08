/**
 * The mandatory look before upload: every page, with what will be painted
 * black drawn over it, and the means to add a box or take one away.
 *
 * Not polish. Detection reads the text layer, so it cannot see a stamp, a
 * signature or a handwritten note — and "found nothing" is only reassuring
 * if it could have found something. A page the reader has looked at and
 * confirmed is the strongest check available, which is why this screen has
 * no skip.
 *
 * A scanned page has no text layer at all, so on it nothing is found and
 * nothing is claimed: its caption says so and drawing is the only way to
 * redact it. The screen asks one question and explains nothing else — the
 * first version explained itself in three paragraphs and a per-page tick,
 * and the reader had to click past them to see the page.
 *
 * The screen never says what a box covers. An earlier version listed the
 * boxes as chips under the page — "jméno · Jan Novák" — which told the
 * reader we had read the name, on the one screen whose job is to look like
 * we cannot. A box is "Začerněné pole 3" and nothing more, here and in the
 * accessibility tree; the detector's strings stay in `hits` for painting and
 * are never rendered. A test pins it.
 *
 * Boxes live in image pixels (like every Box in lab-core) and are drawn in
 * percentages of the image, so they stay put when the pane relayouts —
 * the same lesson the verification highlight learned.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Box, type IdentityHit, count } from "@bw/lab-core";
import type { PreparedFile } from "../lib/upload";

interface Props {
  prepared: PreparedFile;
  onConfirm: (hits: IdentityHit[]) => void;
  onCancel: () => void;
}

/** Smaller than this in either direction is a tap, not a box. */
const MIN_DRAG = 6;
/** The ✕ control's side, in CSS px — matches `.review-x` in styles.css. */
const X_SIZE = 32;
/** How far past its ink a box can be tapped, in CSS px. */
const HIT_PAD = 16;

const useMeasureEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function RedactReview({ prepared, onConfirm, onCancel }: Props) {
  const [hits, setHits] = useState<IdentityHit[]>(prepared.hits);
  // Drawing starts on when nothing was found on some page — on a scan that is
  // always — because drawing is then the only way to redact it.
  const [drawing, setDrawing] = useState(prepared.scanPages.length > 0 || prepared.hits.length === 0);
  // One box selected at a time, across all pages.
  const [selected, setSelected] = useState<IdentityHit | null>(null);
  const scans = prepared.scanPages;

  // A tap anywhere that is not a box, or Escape, deselects.
  useEffect(() => {
    if (!selected) return;
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(".review-hit, .review-x")) setSelected(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [selected]);

  const remove = (hit: IdentityHit) => {
    setHits((hs) => hs.filter((h) => h !== hit));
    setSelected((s) => (s === hit ? null : s));
  };

  return (
    <section className="card review">
      <div className="card-head">
        <div>
          <h2>Je vše osobní začerněné?</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            {prepared.name} · {count(prepared.pages.length, "strana", "strany", "stran")}
            {scans.length > 0 && ` · ${count(scans.length, "sken", "skeny", "skenů")} — začerněte ručně`}
          </p>
        </div>
        <button className={`btn small${drawing ? " primary" : ""}`} aria-pressed={drawing} onClick={() => setDrawing((d) => !d)}>
          {drawing ? "Hotovo" : "Začernit"}
        </button>
      </div>

      {prepared.pages.map((page) => (
        <ReviewPage
          key={page.pageNum}
          pageNum={page.pageNum}
          imageUrl={page.imageUrl}
          width={page.imageWidth}
          height={page.imageHeight}
          scan={scans.includes(page.pageNum)}
          drawing={drawing}
          hits={hits.filter((h) => h.pageNum === page.pageNum)}
          selected={selected}
          onSelect={setSelected}
          onAdd={(box) => setHits((hs) => [...hs, { pageNum: page.pageNum, box, kind: "manual", text: "" }])}
          onRemove={remove}
        />
      ))}

      <div className="review-actions">
        <button className="btn" onClick={onCancel}>
          Zrušit
        </button>
        <button className="btn primary" onClick={() => onConfirm(hits)}>
          Ano, nahrát
        </button>
      </div>
    </section>
  );
}

/**
 * The tap zone of a box: the box, padded by PAD screen pixels on every side
 * and widened to at least the ✕ control, then cut at the midpoint to any
 * box above or below that shares its columns. So a box over one printed
 * line is tappable on a phone, and four such boxes stacked six pixels
 * apart still each own their own band — the nearest box answers, rather
 * than whichever was drawn last. Image pixels in, image pixels out.
 */
export function hitZone(boxes: Box[], i: number, scale: number): Box {
  const pad = HIT_PAD / scale;
  const minSide = X_SIZE / scale;
  const [x0, y0, x1, y1] = boxes[i];
  const ex = Math.max(pad, (minSide - (x1 - x0)) / 2);
  let left = x0 - ex;
  let top = y0 - pad;
  let right = x1 + ex;
  let bottom = y1 + pad;
  for (let j = 0; j < boxes.length; j++) {
    if (j === i) continue;
    const b = boxes[j];
    const sharesColumns = b[2] > x0 && b[0] < x1;
    const sharesRows = b[3] > y0 && b[1] < y1;
    if (sharesColumns) {
      if (b[3] <= y0) top = Math.max(top, (b[3] + y0) / 2);
      else if (b[1] >= y1) bottom = Math.min(bottom, (y1 + b[1]) / 2);
    } else if (sharesRows) {
      // Side by side on one line — name and rodné číslo, typically.
      if (b[2] <= x0) left = Math.max(left, (b[2] + x0) / 2);
      else if (b[0] >= x1) right = Math.min(right, (x1 + b[0]) / 2);
    }
  }
  return [left, top, right, bottom];
}

function ReviewPage({
  pageNum,
  imageUrl,
  width,
  height,
  scan,
  drawing,
  hits,
  selected,
  onSelect,
  onAdd,
  onRemove,
}: {
  pageNum: number;
  imageUrl: string;
  width: number;
  height: number;
  scan: boolean;
  drawing: boolean;
  hits: IdentityHit[];
  selected: IdentityHit | null;
  onSelect: (hit: IdentityHit | null) => void;
  onAdd: (box: Box) => void;
  onRemove: (hit: IdentityHit) => void;
}) {
  // The drag in progress lives in a ref and is mirrored into state for
  // drawing: pointer events can arrive faster than a render, and a move
  // handler reading a stale `null` from its closure would drop the box.
  const dragRef = useRef<{ start: [number, number]; box: Box } | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const setDrag = (d: { start: [number, number]; box: Box } | null) => {
    dragRef.current = d;
    setDraft(d ? d.box : null);
  };

  // Screen pixels per image pixel, so the tap zones and the ✕ placement
  // can be reasoned about in the units a finger has.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useMeasureEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setScale(w / width);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  /** Pointer position → image pixels, however wide the image is drawn,
   *  clamped to the page: a box past its edge redacts nothing. */
  const toImage = (e: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
    return [clamp(((e.clientX - r.left) / r.width) * width, width), clamp(((e.clientY - r.top) / r.height) * height, height)];
  };
  const pct = (b: Box) => ({
    left: `${(b[0] / width) * 100}%`,
    top: `${(b[1] / height) * 100}%`,
    width: `${((b[2] - b[0]) / width) * 100}%`,
    height: `${((b[3] - b[1]) / height) * 100}%`,
  });
  const boxes = hits.map((h) => h.box);
  const sel = selected ? hits.indexOf(selected) : -1;
  const label = (i: number) => `Začerněné pole ${i + 1}`;

  return (
    <figure className={`review-page${scan ? " scan" : ""}`}>
      <figcaption className="muted">
        Strana {pageNum}
        {scan && " · sken — nic nenalezeno, začerněte ručně"}
      </figcaption>
      <div
        ref={canvasRef}
        className={`review-canvas${drawing ? " drawing" : ""}`}
        onPointerDown={(e) => {
          if (!drawing) return;
          // A tap on a box or its ✕ is theirs, in drawing mode too: a box
          // drawn by hand is removed the same way as a found one.
          if (e.target instanceof Element && e.target.closest(".review-hit, .review-x")) return;
          // Capture so a drag that leaves the image still ends the box. A
          // pointer the browser does not know (a synthetic event) throws here,
          // and losing capture is not worth losing the box.
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* no capture, still a drag */
          }
          const p = toImage(e);
          setDrag({ start: p, box: [p[0], p[1], p[0], p[1]] });
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          const p = toImage(e);
          const [sx, sy] = d.start;
          setDrag({ start: d.start, box: [Math.min(sx, p[0]), Math.min(sy, p[1]), Math.max(sx, p[0]), Math.max(sy, p[1])] });
        }}
        onPointerUp={() => {
          const d = dragRef.current;
          if (!d) return;
          setDrag(null);
          const b = d.box;
          if (b[2] - b[0] >= MIN_DRAG && b[3] - b[1] >= MIN_DRAG) onAdd(b);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <img src={imageUrl} alt={`Strana ${pageNum}`} draggable={false} />
        {/* The ink: exactly what will be painted, and nothing a finger can
            hit. */}
        {hits.map((h, i) => (
          <span key={i} className={`review-box${i === sel ? " selected" : ""}`} style={pct(h.box)} aria-hidden="true" />
        ))}
        {draft && <span className="review-box draft" style={pct(draft)} aria-hidden="true" />}
        {/* The targets: transparent, each over its own band of the page. */}
        {hits.map((h, i) => (
          <button
            key={i}
            type="button"
            className="review-hit"
            style={pct(hitZone(boxes, i, scale))}
            aria-label={label(i)}
            aria-pressed={i === sel}
            onClick={() => onSelect(i === sel ? null : h)}
          />
        ))}
        {sel >= 0 && (() => {
          // The ✕ at the box's top-right: inside the box when the box is at
          // least the control's height on screen, above it otherwise.
          const b = boxes[sel];
          const thin = (b[3] - b[1]) * scale < X_SIZE;
          return (
            <button
              type="button"
              className={`review-x${thin ? " above" : ""}`}
              style={{ left: `${(b[2] / width) * 100}%`, top: `${(b[1] / height) * 100}%` }}
              aria-label={`Odebrat ${label(sel).toLowerCase()}`}
              onClick={() => onRemove(hits[sel])}
            >
              <span aria-hidden="true">✕</span>
            </button>
          );
        })()}
      </div>
    </figure>
  );
}
