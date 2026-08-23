/**
 * The history rail.
 *
 * Left column on a workstation, a drawer on a phone — one component either
 * way, because the content is identical and a second copy is a second thing to
 * forget. It holds the practice, a way back to an empty thread, and the canned
 * conversations: clicking one replays it instantly, with no session and no
 * call to the worker.
 */
import type { Budget } from "@bw/api-client";
import { ThemeSwitch } from "@bw/ui-kit";
import type { Fixture } from "./fixtures";

export default function Sidebar({
  practice,
  fixtures,
  active,
  budget,
  open,
  onOpen,
  onNew,
  onClose,
}: {
  practice: string;
  fixtures: Fixture[];
  active: string | null;
  budget: Budget | null;
  /** Drawer state; ignored by the desktop layout, which is always open. */
  open: boolean;
  onOpen: (slug: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <aside className={`rail-left${open ? " open" : ""}`} data-testid="sidebar">
      <div className="rail-head">
        <div className="rail-brand">
          <span className="eyebrow">Ordinace</span>
          <strong>{practice}</strong>
        </div>
        <button type="button" className="icon-btn rail-close" onClick={onClose} aria-label="Zavřít panel">
          ✕
        </button>
      </div>

      <button type="button" className="new-thread" onClick={onNew}>
        <span className="plus" aria-hidden="true">
          +
        </span>
        Nové vlákno
      </button>

      <div className="rail-scroll">
        <div className="eyebrow rail-section">Nedávné</div>
        <ul className="hist">
          {fixtures.map((f) => (
            <li key={f.slug}>
              <button
                type="button"
                className={`hist-item${active === f.slug ? " on" : ""}`}
                onClick={() => onOpen(f.slug)}
                aria-current={active === f.slug ? "true" : undefined}
              >
                <span className="hist-title">{f.title}</span>
                <span className="hist-sub">{f.turns[0]?.user}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rail-foot">
        {budget && (
          <div className="budget" title={`Vyčerpáno ${budget.spentUsd.toFixed(2)} z ${budget.budgetUsd.toFixed(2)} USD`}>
            <div className="budget-row">
              <span className="eyebrow">Rozpočet ukázky</span>
              <span className="budget-num">
                {Math.min(100, Math.round((budget.spentUsd / Math.max(budget.budgetUsd, 0.01)) * 100))} %
              </span>
            </div>
            <div className="budget-bar">
              <span
                className={budget.frozen ? "over" : undefined}
                style={{
                  width: `${Math.min(100, (budget.spentUsd / Math.max(budget.budgetUsd, 0.01)) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
        <ThemeSwitch />
      </div>
    </aside>
  );
}
