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
 * nothing is claimed: the page says so, drawing is the only way to redact
 * it, and the reader confirms each such page separately before the upload
 * can go on. That confirmation is the whole guard for a scan.
 *
 * Boxes live in image pixels (like every Box in lab-core) and are drawn in
 * percentages of the image, so they stay put when the pane relayouts —
 * the same lesson the verification highlight learned.
 */
import { useRef, useState } from "react";
import { type Box, type IdentityHit, type IdentityKind, count, plural } from "@bw/lab-core";
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
  const [drawing, setDrawing] = useState(prepared.scanPages.length > 0);
  /** Scan pages the reader has explicitly confirmed. */
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const scans = prepared.scanPages;
  const found = hits.filter((h) => h.kind !== "manual");
  const textPages = prepared.pages.length - scans.length;
  const allScansChecked = scans.every((p) => checked.has(p));

  const summary =
    textPages === 0
      ? null
      : found.length === 0
        ? "Na stranách s textem jsme nic nenašli. Zkontrolujte hlavičku a patičku obzvlášť pečlivě — jméno a rodné číslo mohou být vytištěné jinak, než umíme přečíst."
        : `Nalezeno: ${[...new Set(found.map((h) => KIND_CS[h.kind]))].join(", ")} — ${count(found.length, "místo", "místa", "míst")}.`;

  return (
    <section className="card review">
      <div className="card-head">
        <div>
          <h2>Kontrola anonymizace</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            {prepared.name} · {count(prepared.pages.length, "strana", "strany", "stran")}
            {scans.length > 0 && ` · ${count(scans.length, "sken", "skeny", "skenů")}`}
          </p>
        </div>
      </div>

      <p className="sub">
        Černá pole se z obrázků i z textu odstraní ještě ve vašem prohlížeči. Nic z toho neuvidí
        server ani model. Klepnutím pole odeberete; režim „Začernit“ dovolí tažením přidat další.
      </p>
      {summary && <p className={found.length === 0 ? "err" : "muted"}>{summary}</p>}
      {scans.length > 0 && (
        <div className="banner warn">
          {plural(scans.length, "Strana", "Strany", "Strany")} {scans.join(", ")}{" "}
          {scans.length === 1 ? "je sken bez textové vrstvy" : "jsou skeny bez textové vrstvy"} — jméno, rodné
          číslo, datum narození ani adresu na {scans.length === 1 ? "ní" : "nich"} neumíme najít.
          Začerněte je prosím tažením sami a každou takovou stranu potvrďte. Hodnoty z ní se přečtou
          z obrázku.
        </div>
      )}
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <button className={`btn${drawing ? " primary" : ""}`} aria-pressed={drawing} onClick={() => setDrawing((d) => !d)}>
          {drawing ? "Hotovo — konec začerňování" : "Začernit další místo"}
        </button>
      </div>

      {prepared.pages.map((page) => {
        const isScan = scans.includes(page.pageNum);
        return (
          <ReviewPage
            key={page.pageNum}
            pageNum={page.pageNum}
            imageUrl={page.imageUrl}
            width={page.imageWidth}
            height={page.imageHeight}
            scan={isScan}
            checked={checked.has(page.pageNum)}
            onChecked={(on) =>
              setChecked((prev) => {
                const next = new Set(prev);
                if (on) next.add(page.pageNum);
                else next.delete(page.pageNum);
                return next;
              })
            }
            drawing={drawing}
            hits={hits.filter((h) => h.pageNum === page.pageNum)}
            onAdd={(box) => setHits((hs) => [...hs, { pageNum: page.pageNum, box, kind: "manual", text: "" }])}
            onRemove={(hit) => setHits((hs) => hs.filter((h) => h !== hit))}
          />
        );
      })}

      <div className="review-actions">
        <button className="btn" onClick={onCancel}>
          Zrušit
        </button>
        <button
          className="btn primary"
          disabled={!allScansChecked}
          title={allScansChecked ? undefined : "Nejdřív potvrďte každou naskenovanou stranu."}
          onClick={() => onConfirm(hits)}
        >
          Zkontrolováno, nahrát
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
  checked,
  onChecked,
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
  checked: boolean;
  onChecked: (on: boolean) => void;
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
        {scan && " · sken — nic nenalezeno automaticky"}
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
          <button
            key={i}
            type="button"
            className="review-box"
            style={pct(h.box)}
            title={`${KIND_CS[h.kind]}${h.text ? `: ${h.text}` : ""} — klepnutím odebrat`}
            aria-label={`Odebrat pole: ${KIND_CS[h.kind]}`}
            onClick={() => {
              if (!drawing) onRemove(h);
            }}
          />
        ))}
        {draft && <div className="review-box draft" style={pct(draft)} />}
      </div>
      {scan && (
        <label className="switch review-check">
          <input type="checkbox" checked={checked} onChange={(e) => onChecked(e.target.checked)} />
          Strana {pageNum} zkontrolována — jméno, rodné číslo, datum narození i adresa jsou začerněné
          (nebo na ní nejsou).
        </label>
      )}
    </figure>
  );
}
