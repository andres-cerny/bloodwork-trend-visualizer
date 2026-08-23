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
 * bottom of a growing page. Which is also why the gate is a labelled line and
 * not a panel: three lines of explanation and an expanded widget cost ~140 of
 * a 390 × 844 phone's height, and they buy it from the answer. The line says
 * what the deal is; the widget unfolds when the reader reaches for the input,
 * which is the first moment it is about to matter.
 *
 * Collapsed, never unmounted: `useTurnstile` renders into `boxRef` in an
 * effect that does not re-run, so a box conditionally mounted on focus is a
 * box the widget never appears in.
 */
import { useState } from "react";
import type { Turnstile } from "@bw/ui-kit";

export default function Composer({
  value,
  onChange,
  onSend,
  busy,
  gate,
  blocked,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  busy: boolean;
  gate: Turnstile;
  /** Why sending is impossible at all — never a reason to hide the thread. */
  blocked: string | null;
}) {
  const sendable = !blocked && gate.ready;
  // Reaching for the input is a one-way door. Not `focused`: solving the
  // challenge means clicking into Cloudflare's iframe, which blurs the input —
  // and a widget that folds away under the cursor mid-challenge is worse than
  // one that was never folded. A chip that filled the box counts as reaching.
  const [reached, setReached] = useState(false);
  const unfolded = reached || value.trim().length > 0;

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
          onFocus={() => setReached(true)}
          placeholder="Zeptejte se na výsledky pacienta…"
          aria-label="Dotaz"
          autoComplete="off"
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
        <p className="composer-note muted">{blocked}</p>
      ) : (
        !gate.ready && (
          <div className={`composer-gate${unfolded ? " is-open" : ""}`}>
            <p className="gate-line">
              <span className="gate-eyebrow">Ověření</span>
              <span className="muted">
                Číst můžete vše. K odeslání dotazu stačí projít ověřením.
              </span>
            </p>
            <div className="gate-box">
              <div ref={gate.boxRef} />
              {gate.error && <p className="err">{gate.error}</p>}
            </div>
          </div>
        )
      )}
    </form>
  );
}
