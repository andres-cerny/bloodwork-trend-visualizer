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
 * bottom of a growing page.
 */
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
          <div className="composer-gate">
            {/* One line, deliberately. On a phone the pre-gate composer was
                taking almost half the viewport and clipping the answer behind
                it — and the second sentence („číst se dá i bez něj") was
                explaining something the visible transcript already proves. */}
            <p className="muted">Odeslání odemkne krátké ověření.</p>
            <div ref={gate.boxRef} />
            {gate.error && <p className="err">{gate.error}</p>}
          </div>
        )
      )}
    </form>
  );
}
