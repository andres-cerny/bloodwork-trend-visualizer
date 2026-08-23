/**
 * The composer — and the gate, which lives inside it.
 *
 * The transcript, the history rail and every canned replay are static content:
 * they render with no session at all. Only *sending* costs anything, so the
 * verification belongs where sending happens rather than in front of the whole
 * app. Until the challenge is solved the input is still there and still
 * fillable — a suggestion or a follow-up chip drops its text in, so the reader
 * can see exactly what they are about to ask while they verify.
 *
 * On a phone this is also the whole ergonomics of the app: the input sits
 * above the keyboard and the thread scrolls under it, rather than the composer
 * being pushed off the bottom of a growing page.
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
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  gate: Turnstile;
  /** Budget spent, or the demo's AI features switched off entirely. */
  blocked: string | null;
}) {
  const canSend = !blocked && gate.ready && !busy && value.trim().length > 0;

  return (
    <div className="composer-zone">
      {blocked ? (
        <p className="notice">{blocked}</p>
      ) : (
        !gate.ready && (
          <div className="gate">
            <div className="gate-copy">
              <span className="eyebrow">Ověření</span>
              <p>Číst můžete vše. K odeslání dotazu stačí projít ověřením.</p>
              {gate.error && <p className="err">{gate.error}</p>}
            </div>
            <div className="gate-box" ref={gate.boxRef} />
          </div>
        )
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) onSend();
        }}
      >
        <input
          type="text"
          data-testid="composer-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Napište dotaz…"
          aria-label="Dotaz"
          autoComplete="off"
        />
        <button className="send" type="submit" disabled={!canSend}>
          {busy ? "Odpovídá…" : "Odeslat"}
        </button>
      </form>

      <p className="disclaimer">
        Popisuje, nediagnostikuje. Čísla pocházejí z ověřených hodnot. Ukázka — nezadávejte
        údaje skutečných pacientů.
      </p>
    </div>
  );
}
