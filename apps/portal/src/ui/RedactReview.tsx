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
 * Boxes live in image pixels (like every Box in lab-core) and are drawn in
 * percentages of the image, so they stay put when the pane relayouts —
 * the same lesson the verification highlight learned.
 */
import { useState } from "react";
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
  const [drawing, setDrawing] = useState(false);

  const blocked = prepared.unreadable.length > 0;
  const found = hits.filter((h) => h.kind !== "manual");
  const summary =
    found.length === 0
      ? "Nic jsme nenašli. Zkontrolujte hlavičku a patičku obzvlášť pečlivě — jméno a rodné číslo mohou být vytištěné jinak, než umíme přečíst."
      : `Nalezeno: ${[...new Set(found.map((h) => KIND_CS[h.kind]))].join(", ")} — ${count(found.length, "místo", "místa", "míst")}.`;

  return (
    <section className="card review">
      <div className="card-head">
        <div>
          <h2>Kontrola anonymizace</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            {prepared.name} · {count(prepared.pages.length, "strana", "strany", "stran")}
          </p>
        </div>
      </div>

      {blocked ? (
        <div className="banner warn">
          Naskenované PDF zatím neumíme bezpečně anonymizovat — strana{" "}
          {prepared.unreadable.join(", ")} nemá textovou vrstvu, takže jméno na ní nelze najít ani
          zkontrolovat. Nahrajte prosím PDF přímo z laboratoře.
        </div>
      ) : (
        <>
          <p className="sub">
            Černá pole se z obrázků i z textu odstraní ještě ve vašem prohlížeči. Nic z toho neuvidí
            server ani model. Klepnutím pole odeberete; režim „Začernit“ dovolí tažením přidat další.
          </p>
          <p className={found.length === 0 ? "err" : "muted"}>{summary}</p>
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <button
              className={`btn${drawing ? " primary" : ""}`}
              aria-pressed={drawing}
              onClick={() => setDrawing((d) => !d)}
            >
              {drawing ? "Hotovo — konec začerňování" : "Začernit další místo"}
            </button>
          </div>
        </>
      )}

      {prepared.pages.map((page) => (
        <ReviewPage
          key={page.pageNum}
          pageNum={page.pageNum}
          imageUrl={page.imageUrl}
          width={page.imageWidth}
          height={page.imageHeight}
          drawing={drawing && !blocked}
          hits={hits.filter((h) => h.pageNum === page.pageNum)}
          onAdd={(box) => setHits((hs) => [...hs, { pageNum: page.pageNum, box, kind: "manual", text: "" }])}
          onRemove={(hit) => setHits((hs) => hs.filter((h) => h !== hit))}
        />
      ))}

      <div className="review-actions">
        <button className="btn" onClick={onCancel}>
          {blocked ? "Zavřít" : "Zrušit"}
        </button>
        {!blocked && (
          <button className="btn primary" onClick={() => onConfirm(hits)}>
            Zkontrolováno, nahrát
          </button>
        )}
      </div>
    </section>
  );
}

function ReviewPage({
  pageNum,
  imageUrl,
  width,
  height,
  drawing,
  hits,
  onAdd,
  onRemove,
}: {
  pageNum: number;
  imageUrl: string;
  width: number;
  height: number;
  drawing: boolean;
  hits: IdentityHit[];
  onAdd: (box: Box) => void;
  onRemove: (hit: IdentityHit) => void;
}) {
  const [draft, setDraft] = useState<{ start: [number, number]; box: Box } | null>(null);

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
    <figure className="review-page">
      <figcaption className="muted">Strana {pageNum}</figcaption>
      <div
        className={`review-canvas${drawing ? " drawing" : ""}`}
        onPointerDown={(e) => {
          if (!drawing) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = toImage(e);
          setDraft({ start: p, box: [p[0], p[1], p[0], p[1]] });
        }}
        onPointerMove={(e) => {
          if (!draft) return;
          const p = toImage(e);
          const [sx, sy] = draft.start;
          setDraft({ ...draft, box: [Math.min(sx, p[0]), Math.min(sy, p[1]), Math.max(sx, p[0]), Math.max(sy, p[1])] });
        }}
        onPointerUp={() => {
          if (!draft) return;
          const b = draft.box;
          setDraft(null);
          if (b[2] - b[0] >= MIN_DRAG && b[3] - b[1] >= MIN_DRAG) onAdd(b);
        }}
        onPointerCancel={() => setDraft(null)}
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
        {draft && <div className="review-box draft" style={pct(draft.box)} />}
      </div>
    </figure>
  );
}
