/**
 * The history rail.
 *
 * The rail exists to answer "what can this thing do?" before the doctor has
 * typed anything — so the entries under „Nedávné" are not labels, they are
 * conversations. Clicking one replays a committed fixture into the thread with
 * no API call and no session, and the composer stays live underneath it, so a
 * canned thread can be continued with a real question. A sidebar item that does
 * nothing reads as a broken app; this one reads as work already done.
 *
 * On a phone the same element is a drawer behind the toggle in the top bar —
 * and a drawer that is only slid off-screen is still in the tab order and still
 * read out by a screen reader, which is how a keyboard user ends up typing into
 * a menu they cannot see. Closed, on a phone, it is `inert`.
 */
import { useEffect, useRef } from "react";
import { ThemeSwitch } from "@bw/ui-kit";
import type { Budget } from "@bw/api-client";
import type { Fixture } from "./fixtures";

/** „9,61 $" — the reader is Czech, and so is the decimal separator. */
const USD = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function Sidebar({
  practice,
  fixtures,
  activeSlug,
  budget,
  drawer,
  open,
  onPick,
  onNew,
  onClose,
  closeRef,
}: {
  practice: string;
  fixtures: Fixture[];
  activeSlug: string | null;
  budget: Budget | null;
  /** This viewport shows the rail as a drawer, so „closed" means „gone". */
  drawer: boolean;
  /** Drawer state; ignored by the desktop layout, which is always open. */
  open: boolean;
  onPick: (slug: string) => void;
  onNew: () => void;
  onClose: () => void;
  closeRef?: React.RefObject<HTMLButtonElement>;
}) {
  const navRef = useRef<HTMLElement>(null);

  // `inert` is set from an effect rather than rendered as a prop: React 18's
  // JSX types have no such attribute, and the DOM one is what matters. It takes
  // the element and everything under it out of the tab order and the
  // accessibility tree, which `transform: translateX(-102%)` does not.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    if (drawer && !open) {
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    } else {
      el.removeAttribute("inert");
      el.removeAttribute("aria-hidden");
    }
  }, [drawer, open]);

  return (
    <nav
      ref={navRef}
      id="sidebar-nav"
      className={`rail-left${open ? " is-open" : ""}`}
      data-testid="sidebar"
      aria-label="Vlákna"
    >
      <div className="rail-left-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-text">
            <strong>Klinický asistent</strong>
            <span className="muted">{practice}</span>
          </span>
        </div>
        <button
          type="button"
          className="drawer-close"
          ref={closeRef}
          onClick={onClose}
          aria-label="Zavřít nabídku"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <button type="button" className="new-thread" onClick={onNew}>
        <span aria-hidden="true">＋</span> Nové vlákno
      </button>

      <h2 className="rail-section" id="rail-recent">
        Nedávné
      </h2>
      <ul className="threads" aria-labelledby="rail-recent">
        {fixtures.map((f) => (
          <li key={f.slug}>
            <button
              type="button"
              className={`thread-item${activeSlug === f.slug ? " is-active" : ""}`}
              onClick={() => onPick(f.slug)}
              title={f.title}
              aria-current={activeSlug === f.slug ? "true" : undefined}
            >
              {f.title}
            </button>
          </li>
        ))}
      </ul>

      <div className="rail-left-foot">
        <ThemeSwitch />
        {budget && (
          <p className="muted budget">
            {budget.frozen
              ? "Rozpočet ukázky vyčerpán"
              : `Rozpočet ukázky: zbývá ${USD.format(budget.remainingUsd)} $`}
          </p>
        )}
        <p className="muted disclaimer">
          Popisuje, nediagnostikuje. Čísla pocházejí z ověřených hodnot. Ukázka —
          nezadávejte údaje skutečných pacientů.
        </p>
      </div>
    </nav>
  );
}
