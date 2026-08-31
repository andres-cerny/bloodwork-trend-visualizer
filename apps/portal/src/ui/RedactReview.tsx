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
 * Boxes live in image pixels (like every Box in lab-core) and are drawn in
 * percentages of the image, so they stay put when the pane relayouts —
 * the same lesson the verification highlight learned.
 */
import { useRef, useState } from "react";
import { type Box, type IdentityHit, type IdentityKind, count } from "@bw/lab-core";
import type { PreparedFile } from "../lib/upload";

interface Props {
  prepared: PreparedFile;
  onConfirm: (hits: IdentityHit[]) => void;
  onCancel: () => void;
}

const KIND_CS: Record<IdentityKind, string> = {
  "rodne-cislo": "rodné číslo",
  "birth-date": "datum narození",
  name: "jméno",
  address: "adresa",
  repeat: "opakování",
  manual: "ručně",
};

/** Smaller than this in either direction is a tap, not a box. */
const MIN_DRAG = 6;

export default function RedactReview({ prepared, onConfirm, onCancel }: Props) {
  const [hits, setHits] = useState<IdentityHit[]>(prepared.hits);
  // Drawing starts on when nothing was found on some page — on a scan that is
  // always — because drawing is then the only way to redact it.
  const [drawing, setDrawing] = useState(prepared.scanPages.length > 0 || prepared.hits.length === 0);
  const scans = prepared.scanPages;

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
          onAdd={(box) => setHits((hs) => [...hs, { pageNum: page.pageNum, box, kind: "manual", text: "" }])}
          onRemove={(hit) => setHits((hs) => hs.filter((h) => h !== hit))}
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

function ReviewPage({
  pageNum,
  imageUrl,
  width,
  height,
  scan,
  drawing,
  hits,
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

  /** Pointer position → image pixels, however wide the image is drawn. */
  const toImage = (e: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * width, ((e.clientY - r.top) / r.height) * height];
  };
  const pct = (b: Box) => ({
    left: `${(b[0] / width) * 100}%`,
    top: `${(b[1] / height) * 100}%`,
    width: `${((b[2] - b[0]) / width) * 100}%`,
    height: `${((b[3] - b[1]) / height) * 100}%`,
  });

  return (
    <figure className={`review-page${scan ? " scan" : ""}`}>
      <figcaption className="muted">
        Strana {pageNum}
        {scan && " · sken — nic nenalezeno, začerněte ručně"}
      </figcaption>
      <div
        className={`review-canvas${drawing ? " drawing" : ""}`}
        onPointerDown={(e) => {
          if (!drawing) return;
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
        {hits.map((h, i) => (
          <span key={i} className="review-box" style={pct(h.box)} aria-hidden="true" />
        ))}
        {draft && <span className="review-box draft" style={pct(draft)} />}
      </div>
      {hits.length > 0 && (
        <ul className="review-hits">
          {/* Removal lives here, not on the boxes: a box over one printed
              line is a few pixels tall on a phone — no finger hits it, and
              growing it would preview more black than gets painted. A chip
              also names what its box covers, which a black rectangle cannot. */}
          {hits.map((h, i) => (
            <li key={i}>
              <button type="button" className="chip review-hit" onClick={() => onRemove(h)} aria-label={`Odebrat pole ${i + 1}: ${KIND_CS[h.kind]}${h.text ? ` ${h.text}` : ""}`}>
                {KIND_CS[h.kind]}
                {h.text ? ` · ${h.text}` : ""} <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
