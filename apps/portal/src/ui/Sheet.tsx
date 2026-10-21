/**
 * A dialog that is a sheet from the bottom edge on a phone and a centred card
 * above 480 px — the shell BuySheet draws, for any content.
 *
 * It keeps the promises `aria-modal` makes, as BuySheet does: focus lands on
 * Zavřít when it opens, Tab and Shift+Tab wrap inside it, and whatever closes
 * it — Escape, Zavřít, a tap on the scrim — hands focus back to whatever had
 * it before.
 */
import { type ReactNode, useEffect, useId, useRef } from "react";

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export default function Sheet({ title, onClose, children, className }: { title: ReactNode; onClose: () => void; children: ReactNode; className?: string }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
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
  }, []);

  return (
    <div className="sheet-back" onClick={onClose}>
      <div ref={sheetRef} className={`sheet${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button ref={closeRef} type="button" className="btn small" onClick={onClose} aria-label="Zavřít">
            Zavřít
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
