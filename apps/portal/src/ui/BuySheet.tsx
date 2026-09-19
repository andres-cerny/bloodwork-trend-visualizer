/**
 * Přikoupit: the two packages, and the one button each that leaves for
 * Stripe Checkout.
 *
 * A sheet from the bottom edge on a phone, a centred card above 480 px —
 * the same split the „i" popover makes. Nothing about payment happens here:
 * the worker mints a Checkout Session and answers its URL, the browser goes
 * there, and Stripe's page takes the card (or Apple Pay, or Google Pay). The
 * account is credited by Stripe's webhook, not by coming back.
 *
 * While the deployment has no Stripe account behind it the worker answers
 * 503 `shop_closed`; the sheet then keeps showing both packages with their
 * prices and says the shop is not open yet, so the offer is readable before
 * it can be taken up.
 */
import { useEffect, useRef, useState } from "react";
import { ApiError, buyDocuments } from "../lib/api";

export interface Package {
  id: "5" | "15";
  documents: number;
  czk: number;
  /** One light line under the price about what people pay that much for. */
  compare: string;
}

/** What is for sale — the worker's PACKAGES, restated for the screen. */
export const PACKAGES: readonly Package[] = [
  { id: "5", documents: 5, czk: 49, compare: "Méně než jedno kafe ve Starbucks. To se vyplatí, ne?" },
  { id: "15", documents: 15, czk: 99, compare: "Levnější než trdelník na Václaváku. A vydrží déle." },
];

export const SHOP_CLOSED = "Obchod zatím není otevřený.";
export const BUY_FAILED = "Platbu se nepodařilo zahájit. Zkuste to prosím znovu.";

/** „5 dokumentů za 49 Kč" — the package as one phrase. */
export const packageLabel = (p: Package) => `${p.documents} dokumentů za ${p.czk} Kč`;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function BuySheet({ open, onClose }: Props) {
  const [busy, setBusy] = useState<Package["id"] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setNotice(null);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function buy(p: Package) {
    setBusy(p.id);
    setNotice(null);
    try {
      const { url } = await buyDocuments(p.id);
      location.assign(url);
    } catch (e) {
      setNotice(e instanceof ApiError && e.code === "shop_closed" ? SHOP_CLOSED : BUY_FAILED);
      setBusy(null);
    }
  }

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="buy-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id="buy-title">Přikoupit dokumenty</h2>
          <button ref={closeRef} type="button" className="btn small" onClick={onClose} aria-label="Zavřít">
            Zavřít
          </button>
        </div>
        <p className="sub" style={{ margin: "0 0 4px" }}>
          Bez předplatného, dokumenty nepropadají. Platí se kartou, přes Apple Pay nebo Google Pay.
        </p>
        <ul className="packs">
          {PACKAGES.map((p) => (
            <li key={p.id} className="pack">
              <span className="pack-name">{p.documents} dokumentů</span>
              <span className="pack-price">{p.czk} Kč</span>
              <span className="pack-cmp">{p.compare}</span>
              <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => void buy(p)}>
                {busy === p.id ? "Přesměrování…" : `Koupit za ${p.czk} Kč`}
              </button>
            </li>
          ))}
        </ul>
        {notice && (
          <p className="notice" role="alert">
            {notice}
          </p>
        )}
        <p className="sub" style={{ margin: "8px 0 0" }}>
          <a href="/proc-prikoupit">Proč přikoupit?</a>
        </p>
      </div>
    </div>
  );
}
