/**
 * The composer — and, until the gate is passed, the gate.
 *
 * The verification used to stand in front of the transcript, which meant the
 * whole app was a Turnstile checkbox until someone clicked it: the canned
 * conversations, the evidence, everything readable was hidden behind a robot
 * test. None of that content costs anything to show. So the widget moved to
 * the one place that genuinely needs a session — the box you type into — and
 * everything else renders regardless.
 *
 * The input is live before the gate is: clicking a suggestion or a follow-up
 * chip fills it, so the doctor's question survives the verification instead of
 * being thrown away by it.
 *
 * On a phone this is the whole ergonomics of the app: the box sits above the
 * keyboard and the thread scrolls under it, rather than being pushed off the
 * bottom of a growing page. That makes the composer's height the phone's
 * scarcest resource — every pixel it takes is a pixel of answer that fades out
 * underneath it. So on a phone the verification folds to one labelled line and
 * the widget itself only unfolds when the reader reaches for the input, which
 * is the moment before they need it and not one second earlier.
 *
 * The widget is clipped rather than unmounted. `useTurnstile` renders into its
 * ref once, in an effect keyed on the site key; unmount the box and the effect
 * never fires again, and the gate would be permanently unpassable for anyone
 * who collapsed it. Clipping keeps the iframe mounted and laid out at its own
 * size — only the container's height is zero.
 */
import { useEffect, useRef, useState } from "react";
import type { Turnstile } from "@bw/ui-kit";

export default function Composer({
  value,
  onChange,
  onSend,
  busy,
  gate,
  blocked,
  compact,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  busy: boolean;
  gate: Turnstile;
  /** Why sending is impossible at all — never a reason to hide the thread. */
  blocked: string | null;
  /** Phone: the gate starts folded, because 844px is the whole screen. */
  compact: boolean;
}) {
  const sendable = !blocked && gate.ready;
  const [gateOpen, setGateOpen] = useState(!compact);
  const boxWrapRef = useRef<HTMLDivElement>(null);
  // Rotating the phone into a desktop width should not leave the gate folded
  // in a layout that has room for it.
  useEffect(() => setGateOpen(!compact), [compact]);

  // Clipping hides the widget from an eye and from nothing else: folded, it is
  // still 71px of live checkbox sitting in the tab order, which is how a
  // keyboard user ends up tabbing into a control that is not on the screen.
  // `inert` costs the widget nothing — it is still mounted and still rendered,
  // it just cannot be reached until the disclosure that owns it is open.
  useEffect(() => {
    const el = boxWrapRef.current;
    if (!el) return;
    if (gateOpen) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [gateOpen, gate.ready, blocked]);

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (sendable && !busy) onSend();
      }}
    >
      <div className="composer-row">
        <input
          type="text"
          className="composer-input"
          data-testid="composer-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setGateOpen(true)}
          placeholder="Zeptejte se na výsledky pacienta…"
          aria-label="Dotaz"
          aria-describedby={blocked || !gate.ready ? "composer-gate-note" : undefined}
          autoComplete="off"
          enterKeyHint="send"
        />
        <button
          className="send"
          type="submit"
          disabled={!sendable || busy || !value.trim()}
          aria-label="Odeslat dotaz"
          title="Odeslat dotaz"
        >
          <span aria-hidden="true">➤</span>
        </button>
      </div>

      {blocked ? (
        <p className="composer-note muted" id="composer-gate-note" role="status">
          {blocked}
        </p>
      ) : (
        !gate.ready && (
          <div className="composer-gate" data-open={gateOpen}>
            <button
              type="button"
              className="gate-head"
              aria-expanded={gateOpen}
              aria-controls="composer-gate-box"
              onClick={() => setGateOpen((o) => !o)}
            >
              <span className="gate-label">Ověření</span>
              <span className="gate-copy muted" id="composer-gate-note">
                Číst můžete vše. K odeslání dotazu stačí projít ověřením.
              </span>
              <span className="gate-caret" aria-hidden="true" data-open={gateOpen} />
            </button>
            <div className="gate-box" id="composer-gate-box" ref={boxWrapRef}>
              <div ref={gate.boxRef} />
            </div>
            {gate.error && (
              <p className="err gate-err" role="alert">
                {gate.error}
              </p>
            )}
          </div>
        )
      )}
    </form>
  );
}
