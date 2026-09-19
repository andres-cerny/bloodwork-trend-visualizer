/**
 * „Dokumenty: 3 z 5" — the allowance as the person sees it, with the way to
 * buy more and the page that says why buying is a thing.
 *
 * The line replaces the month's USD figure that used to sit under the report
 * list: what the account is charged in is documents, and dollars were never
 * a number a reader could act on. The USD ledger still exists behind this as
 * a fuse (workers/portal/src/ledger.ts), and its frozen sentence still shows
 * on the upload card if it trips — that is the one place dollars survive.
 *
 * The copy functions are exported and pure so a node test can pin every
 * state without a DOM; the component is the thin thing that renders them.
 *
 * Coming back from Stripe: Checkout returns the browser to `/?koupeno=1`.
 * The parameter proves nothing — the credit arrives through the webhook,
 * which may land a moment after the redirect — so this asks the worker for
 * the allowance a few times over ten seconds and says thank you meanwhile,
 * then drops the parameter from the address so a reload does not ask again.
 */
import { useEffect, useRef, useState } from "react";
import { count } from "@bw/lab-core";
import { type Allowance, getAllowance } from "../lib/api";

interface Props {
  /** Null until /api/status has answered; nothing is drawn then. */
  allowance: Allowance | null;
  onAllowance: (a: Allowance) => void;
  onBuy: () => void;
}

/** The line: used of total — „3 z 5", „7 z 20". */
export const allowanceNumbers = (a: Allowance) => `${a.used} z ${a.free + a.purchased}`;

/** The whole label as read out: „Dokumenty: 3 z 5". */
export const allowanceLabel = (a: Allowance) => `Dokumenty: ${allowanceNumbers(a)}`;

/**
 * What the upload card says at zero. The free number and the bought total
 * are different sentences: „5 dokumentů zdarma" is true only while nothing
 * was bought.
 */
export function exhaustedCopy(a: Allowance): string {
  const total = a.free + a.purchased;
  const spent =
    a.purchased > 0
      ? `Máte vyčerpáno všech ${count(total, "dokument", "dokumenty", "dokumentů")}.`
      : `Máte vyčerpáno ${count(a.free, "dokument", "dokumenty", "dokumentů")} zdarma.`;
  return `${spent} Přikupte další, nebo pokračujte s tím, co už máte uložené — trendy, souhrn i ověření fungují dál.`;
}

/** The thank-you while the webhook lands, and after. */
export const PURCHASE_PENDING = "Děkujeme. Dokumenty se připíší během chvíle.";
export const PURCHASE_LANDED = "Děkujeme. Dokumenty jsou připsané.";

/** How the return from Checkout is recognised in the address. */
export const RETURN_PARAM = "koupeno";

export default function AllowanceChip({ allowance, onAllowance, onBuy }: Props) {
  const [thanks, setThanks] = useState<string | null>(null);
  const before = useRef<number | null>(null);

  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.get(RETURN_PARAM) !== "1") return;
    url.searchParams.delete(RETURN_PARAM);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setThanks(PURCHASE_PENDING);
    // Five looks over ten seconds: Stripe's webhook usually lands within
    // one or two. What was there before the first look is the baseline; a
    // higher total is the credit arriving.
    let tries = 0;
    let stopped = false;
    const look = async () => {
      if (stopped) return;
      tries += 1;
      try {
        const a = await getAllowance();
        onAllowance(a);
        const total = a.free + a.purchased;
        before.current ??= total;
        if (total > before.current) {
          setThanks(PURCHASE_LANDED);
          return;
        }
      } catch {
        // The next look asks again; five misses leave the pending sentence.
      }
      if (tries < 5) timer = setTimeout(look, 2000);
    };
    let timer = setTimeout(look, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // Once, on mount: the parameter is read from the address, not from props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!allowance) return null;
  return (
    <div className="allow">
      <p className="sub allow-line">
        <span className="allow-text">
          Dokumenty: <strong className="allow-n">{allowanceNumbers(allowance)}</strong>
        </span>
        <button type="button" className={`btn small${allowance.remaining === 0 ? " primary" : ""}`} onClick={onBuy}>
          Přikoupit
        </button>
        <a href="/proc-prikoupit">Proč přikoupit?</a>
      </p>
      {thanks && (
        <p className="sub allow-thanks" role="status">
          {thanks}
        </p>
      )}
    </div>
  );
}
