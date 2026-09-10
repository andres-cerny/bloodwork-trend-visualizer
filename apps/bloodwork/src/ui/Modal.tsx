/**
 * A blocking confirmation.
 *
 * Deliberately not `window.confirm`: the identity warning has to show two
 * identities side by side and offer three different answers, and a native
 * confirm can do neither. It is `role="alertdialog"` rather than `dialog`
 * because every use here interrupts something the reader did not expect to be
 * interrupted.
 */
import { useEffect, useRef, type ReactNode } from "react";

export interface ModalAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  /** The safe answer. Gets initial focus; there should be exactly one. */
  dismiss?: boolean;
}

interface Props {
  title: string;
  children: ReactNode;
  actions: ModalAction[];
  /** Escape and the backdrop both run this — always the safest answer. */
  onDismiss: () => void;
}

export default function Modal({ title, children, actions, onDismiss }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the dismissing action, not the destructive one: a stray Enter from
    // whatever the reader was typing into must not merge two patients' data.
    panelRef.current?.querySelector<HTMLButtonElement>("button[data-dismiss]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="modal-backdrop" onClick={onDismiss}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {children}
        <div className="modal-actions">
          {actions.map((a) => (
            <button
              key={a.label}
              className={a.primary ? "btn primary" : "btn"}
              data-dismiss={a.dismiss ? "" : undefined}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
