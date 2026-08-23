/**
 * The history rail — a column on a workstation, a drawer on a phone.
 *
 * The entries under „Nedávné" are not labels. Each one replays a committed
 * fixture into the thread with no API call and no session, so a doctor who has
 * not yet decided what to type can see what the assistant does, and then keep
 * typing into the same conversation.
 *
 * Same markup at both widths: below the breakpoint the element is positioned
 * off-canvas and slid in, rather than a second copy being rendered — one rail
 * means one tab order and one place the state lives.
 */
import { ThemeSwitch } from "@bw/ui-kit";
import type { Budget } from "@bw/api-client";
import type { Fixture } from "./fixtures";

export default function Sidebar({
  practice,
  fixtures,
  current,
  open,
  budget,
  onNew,
  onOpen,
  onClose,
}: {
  practice: string;
  fixtures: Fixture[];
  current: string | null;
  open: boolean;
  budget: Budget | null;
  onNew: () => void;
  onOpen: (slug: string) => void;
  onClose: () => void;
}) {
  return (
    <nav
      className={`rail-history${open ? " open" : ""}`}
      data-testid="sidebar"
      aria-label="Historie rozhovorů"
    >
      <div className="rail-top">
        <div className="brand">
          <span className="brand-kicker">Ordinace</span>
          <span className="brand-name">{practice}</span>
        </div>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Zavřít nabídku">
          ✕
        </button>
      </div>

      <div className="rail-scroll">
        <button type="button" className="new-thread" onClick={onNew}>
          <span className="plus" aria-hidden="true">
            +
          </span>
          Nové vlákno
        </button>

        <div className="rail-label">Nedávné</div>
        <ul className="hist">
          {fixtures.map((f) => (
            <li key={f.slug}>
              <button
                type="button"
                className={`hist-item${current === f.slug ? " on" : ""}`}
                onClick={() => onOpen(f.slug)}
                aria-current={current === f.slug ? "true" : undefined}
              >
                {f.title}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rail-foot">
        <ThemeSwitch />
        {budget && (
          <span className="rail-budget">
            {budget.frozen
              ? "Rozpočet ukázky vyčerpán"
              : /* Decimal comma: the number is read in Czech like every other. */
                `Rozpočet ukázky · zbývá ${budget.remainingUsd.toFixed(2).replace(".", ",")} $`}
          </span>
        )}
      </div>
    </nav>
  );
}
