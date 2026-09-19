/**
 * The "i" after a parameter's name, and what it opens.
 *
 * Wherever Trendy or Souhrn names a parameter as the subject of a row or a
 * card, this small round button follows the name. It opens the catalog's two
 * sentences about the parameter — what it is, what it is usually used for —
 * under the parameter's name, and nothing else: not the person's value, not
 * their flag, not a range, not a disclaimer. The texts are about the analyte
 * in general and come from `AnalyteDef.about`; a parameter without them (one
 * the reader founded, or one the texts have not reached) gets no button at
 * all, because a disabled "i" is a promise the app cannot keep.
 *
 * The popover is portaled to <body> and positioned `fixed` from the button's
 * box, not dropped into the row. Two of the render sites sit inside a
 * horizontal scroll box (`.scroll-x` around Souhrn's tables), and an
 * absolutely positioned box inside one is clipped at the box's edge — on a
 * phone that is the whole popover gone. From <body> it is clipped by nothing,
 * stacks above the chart and its hover readout, and can be kept inside the
 * viewport by arithmetic: 16px in from either side, below the button when
 * there is room, above it when there is not. Under 480px the same element is
 * a bottom sheet (styles.css decides; here it only stops setting coordinates).
 *
 * Only one is ever open: opening one closes whatever the last one was, in
 * either tab. It closes on a tap outside, on Escape, on the button again,
 * and when focus leaves it. Focus moves into it on open, so a screen reader
 * lands on the name and then the two paragraphs, and returns to the button
 * on close — except after a tap outside that landed on something focusable,
 * whose focus is not the popover's to take back.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** React warns about a layout effect under renderToString; on the server there is nothing to lay out. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
import { createPortal } from "react-dom";

export interface About {
  what: string;
  usedFor: string;
}

/** The width at which the popover becomes a sheet — the same number as in styles.css. */
const SHEET = "(max-width: 479.98px)";
const WIDTH = 320;
const GUTTER = 16;
const GAP = 6;

/** The popover open right now, so opening another closes it. */
let current: (() => void) | null = null;

export default function AboutParam({ name, about }: { name: string; about?: About | null }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  const headId = `${popId}-h`;

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  const toggle = () => {
    if (open) return close(true);
    current?.();
    setOpen(true);
  };

  // Registered as the open one for as long as it is open; unregistered on
  // close and on unmount, so a stale closer never fires into a gone tab.
  useEffect(() => {
    if (!open) return;
    const me = () => setOpen(false);
    current = me;
    return () => {
      if (current === me) current = null;
    };
  }, [open]);

  // Where it goes, and again whenever the page moves under it. Set on the
  // element directly rather than through state: a layout effect runs before
  // paint, so the first frame is already in place.
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = btnRef.current;
      const pop = popRef.current;
      if (!btn || !pop) return;
      if (window.matchMedia(SHEET).matches) {
        pop.style.top = pop.style.left = pop.style.width = "";
        return;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const r = btn.getBoundingClientRect();
      const w = Math.min(WIDTH, vw - 2 * GUTTER);
      const left = Math.min(Math.max(r.left, GUTTER), vw - GUTTER - w);
      pop.style.width = `${w}px`;
      pop.style.left = `${left}px`;
      const h = pop.offsetHeight;
      let top = r.bottom + GAP;
      if (top + h > vh - GUTTER / 2 && r.top - GAP - h >= GUTTER / 2) top = r.top - GAP - h;
      pop.style.top = `${top}px`;
    };
    place();
    popRef.current?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (btnRef.current?.contains(t) || popRef.current?.contains(t));
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    // Tabbing out is leaving. The tap-outside case arrives here too, as a
    // focus change to whatever was tapped, or to <body>; both are outside.
    const onFocus = (e: FocusEvent) => {
      if (!inside(e.target)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open, close]);

  if (!about) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="about-btn"
        aria-label={`O parametru ${name}`}
        title={`O parametru ${name}`}
        aria-expanded={open}
        aria-controls={popId}
        onClick={toggle}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open &&
        createPortal(
          <div ref={popRef} className="about-pop" id={popId} role="dialog" aria-labelledby={headId} tabIndex={-1}>
            <div className="about-head">
              <h4 id={headId}>{name}</h4>
              <button type="button" className="rl-x" aria-label="Zavřít" title="Zavřít" onClick={() => close(true)}>
                ✕
              </button>
            </div>
            <p>{about.what}</p>
            <p>{about.usedFor}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
