/**
 * The composer, pinned — and the gate, inside it.
 *
 * The verification lives here rather than in front of the transcript because
 * the transcript is not what needs protecting: the canned conversations, the
 * sidebar and every source image are static content that costs nothing to read.
 * Only sending a turn spends money, so only sending is gated. A doctor can walk
 * the whole demo, decide it is worth a click, and verify at the moment the
 * click is worth making.
 *
 * The same reasoning applies to the two blocked states: a spent budget or a
 * demo with no site key disables sending and says so, and leaves everything
 * readable behind it.
 *
 * On a phone this is also the whole ergonomics of the app: the input sits above
 * the keyboard and the thread scrolls under it, rather than the composer being
 * pushed off the bottom of a growing page.
 */
import type { RefObject } from "react";

export default function Composer({
  value,
  onChange,
  onSend,
  busy,
  ready,
  blocked,
  gateBoxRef,
  gateError,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  /** A session is held: turns can be sent. */
  ready: boolean;
  /** Why sending is off, in Czech, or null. */
  blocked: string | null;
  gateBoxRef: RefObject<HTMLDivElement>;
  gateError: string | null;
}) {
  const canSend = ready && !blocked && !busy && value.trim().length > 0;

  return (
    <div className="composer-zone">
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) onSend();
        }}
      >
        {blocked ? (
          <p className="composer-note">{blocked}</p>
        ) : !ready ? (
          <div className="composer-gate">
            <div ref={gateBoxRef} className="turnstile-box" />
            <p className="composer-note">
              Nejdřív krátké ověření, že nejste robot. Nedávné rozhovory si můžete prohlížet
              i bez něj.
            </p>
            {gateError && <p className="err">{gateError}</p>}
          </div>
        ) : null}

        <div className="composer-row">
          <input
            type="text"
            data-testid="composer-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Napište dotaz…"
            aria-label="Dotaz"
            autoComplete="off"
          />
          <button className="btn accent" type="submit" disabled={!canSend}>
            Odeslat
          </button>
        </div>
      </form>
      <p className="disclaimer">
        Popisuje, nediagnostikuje. Čísla pocházejí z ověřených hodnot. Ukázka — nezadávejte
        údaje skutečných pacientů.
      </p>
    </div>
  );
}
