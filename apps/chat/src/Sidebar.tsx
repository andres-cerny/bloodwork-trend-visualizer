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
 * On a phone the same element is a drawer behind the toggle in the top bar.
 */
import { ThemeSwitch } from "@bw/ui-kit";
import type { Budget } from "@bw/api-client";
import type { Fixture } from "./fixtures";

export default function Sidebar({
  practice,
  fixtures,
  activeSlug,
  budget,
  open,
  onPick,
  onNew,
  onClose,
}: {
  practice: string;
  fixtures: Fixture[];
  activeSlug: string | null;
  budget: Budget | null;
  /** Drawer state; ignored by the desktop layout, which is always open. */
  open: boolean;
  onPick: (slug: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <nav
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
          onClick={onClose}
          aria-label="Zavřít nabídku"
        >
          ✕
        </button>
      </div>

      <button type="button" className="new-thread" onClick={onNew}>
        <span aria-hidden="true">＋</span> Nové vlákno
      </button>

      <div className="rail-section">Nedávné</div>
      <ul className="threads">
        {fixtures.map((f) => (
          <li key={f.slug}>
            <button
              type="button"
              className={`thread-item${activeSlug === f.slug ? " is-active" : ""}`}
              onClick={() => onPick(f.slug)}
              title={f.title}
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
              : `Rozpočet ukázky: zbývá ${budget.remainingUsd.toFixed(2)} $`}
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
