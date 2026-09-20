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
 * prices, disables both buttons, and says the shop is not open yet — a
 * state line, not an alert, because a closed shop is a rule and not a
 * failure — so the offer is readable before it can be taken up.
 *
 * It is a dialog, and it keeps the promises `aria-modal` makes: focus lands
 * on Zavřít when it opens, Tab and Shift+Tab wrap inside it, and whatever
 * closes it — Escape, Zavřít, a tap on the scrim — hands focus back to the
 * button that opened it.
 */
import { useEffect, useRef, useState } from "react";
import { ApiError, buyDocuments } from "../lib/api";
import { ALLOWANCE } from "./legal";

export interface Package {
  id: "5" | "15";
  documents: number;
  czk: number;
  /** One light line under the price about what people pay that much for. */
  compare: string;
}

/**
 * What is for sale: the promise (legal.tsx ALLOWANCE, the numbers the terms
 * and the landing state) with the worker's package ids and Ondřej's
 * comparison lines. The prices are read from ALLOWANCE, not restated, so the
 * sheet cannot drift from the page a stranger read before registering.
 */
const COMPARE: Record<Package["id"], string> = {
  "5": "Méně než jedno kafe ve Starbucks. To se vyplatí, ne?",
  "15": "Levnější než trdelník na Václaváku. A vydrží déle.",
};
export const PACKAGES: readonly Package[] = ALLOWANCE.packages.map((p) => {
  const id = String(p.documents) as Package["id"];
  return { id, documents: p.documents, czk: p.czk, compare: COMPARE[id] };
});

export const SHOP_CLOSED = "Obchod zatím není otevřený.";
export const BUY_FAILED = "Platbu se nepodařilo zahájit. Zkuste to prosím znovu.";

/**
 * What the sheet says when the buy did not leave for Stripe. Two answers are
 * rules the worker states in its own words, not failures — the shop is not
 * open, the demo may not buy — and the person reads the rule; everything
 * else (Stripe refusing, the network) is the one generic line.
 */
export function buyNotice(e: unknown): string {
  if (e instanceof ApiError && e.code === "shop_closed") return SHOP_CLOSED;
  if (e instanceof ApiError && e.code === "demo_readonly" && e.message) return e.message;
  return BUY_FAILED;
}

/**
 * A rule rather than a failure: after one, both buttons stay disabled — a
 * second tap would read the same rule — and the sentence is a state line,
 * not an alert.
 */
export const isBuyRule = (e: unknown): boolean => e instanceof ApiError && (e.code === "shop_closed" || e.code === "demo_readonly");

/** „5 dokumentů za 49 Kč" — the package as one phrase. */
export const packageLabel = (p: Package) => `${p.documents} dokumentů za ${p.czk} Kč`;

interface Props {
  open: boolean;
  onClose: () => void;
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export default function BuySheet({ open, onClose }: Props) {
  const [busy, setBusy] = useState<Package["id"] | null>(null);
  const [notice, setNotice] = useState<{ text: string; rule: boolean } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The latest onClose, so the key handler below need not be re-bound — and
  // the focus effect need not re-run — when the parent re-renders.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus: in on open, back to the opener on close. The opener is whatever
  // had focus when the sheet appeared — the chip's Přikoupit, or the
  // upload card's — and the cleanup runs on the same render that removes
  // the sheet, so the return happens for every way of closing.
  useEffect(() => {
    if (!open) return;
    setNotice(null);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      // aria-modal promises Tab stays inside; the DOM does not keep that
      // promise on its own, so the ends are joined here.
      if (e.key !== "Tab" || !sheetRef.current) return;
      const controls = [...sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && sheetRef.current.contains(active);
      if (e.shiftKey ? active === first || !inside : active === last || !inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  async function buy(p: Package) {
    setBusy(p.id);
    setNotice(null);
    try {
      const { url } = await buyDocuments(p.id);
      location.assign(url);
    } catch (e) {
      const rule = isBuyRule(e);
      setNotice({ text: buyNotice(e), rule });
      setBusy(null);
      // The tapped button is about to be disabled under the reader's focus;
      // a disabled control cannot hold it, and dropping it on the body would
      // let the next Tab leave the dialog.
      if (rule) closeRef.current?.focus();
    }
  }

  const closed = notice?.rule === true;

  return (
    <div className="sheet-back" onClick={onClose}>
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-labelledby="buy-title" onClick={(e) => e.stopPropagation()}>
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
              <button type="button" className="btn primary" disabled={busy !== null || closed} onClick={() => void buy(p)}>
                {busy === p.id ? "Přesměrování…" : `Koupit za ${p.czk} Kč`}
              </button>
            </li>
          ))}
        </ul>
        {notice && closed && (
          <p className="sub sheet-state" role="status">
            {notice.text}
          </p>
        )}
        {notice && !closed && (
          <p className="notice" role="alert">
            {notice.text}
          </p>
        )}
        <p className="sub" style={{ margin: "8px 0 0" }}>
          <a href="/proc-prikoupit">Proč přikoupit?</a>
        </p>
      </div>
    </div>
  );
}
