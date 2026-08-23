/**
 * Questions about the loaded results, as its own screen.
 *
 * It used to be a card pinned under every tab, where a two-line answer sat
 * below several thousand pixels of charts and the composer was never on
 * screen at the same time as the conversation. As a tab it gets the height a
 * conversation needs, and the reader chooses when to be in it.
 */
import { useEffect, useRef, useState } from "react";
import { ApiError, askChat, type Budget } from "@bw/api-client";

interface Props {
  dataContext: string;
  frozen: boolean;
  unlocked: boolean;
  /** False when no Turnstile site key is configured, so no gate can appear. */
  available: boolean;
  onBudget: (b: Budget) => void;
}

const SUGGESTIONS = [
  "Co se změnilo od minule?",
  "Které hodnoty jsou mimo rozmezí?",
  "Jak se vyvíjí cholesterol?",
];

export default function ChatPanel({ dataContext, frozen, unlocked, available, onBudget }: Props) {
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // A reply that lands below the fold reads as no reply at all.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next = [...history, { role: "user" as const, content: text.trim() }];
    setHistory(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await askChat(dataContext, next);
      setHistory([...next, { role: "assistant", content: res.text }]);
      onBudget(res.budget);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Nepodařilo se odpovědět.";
      setError(msg);
      if (e instanceof ApiError && e.budget) onBudget(e.budget);
    } finally {
      setBusy(false);
    }
  }

  const blocked = !available ? (
    // Pointing at a gate that is not rendered was a dead end: the copy told
    // the reader to complete a check that does not exist on the page.
    "Chat není v této ukázce zapnutý."
  ) : frozen ? (
    "Rozpočet ukázky na AI funkce je vyčerpán — chat je dočasně vypnutý."
  ) : !unlocked ? (
    "Nejdřív projděte ověřením „Nejsem robot“ v levém panelu Nahrát PDF."
  ) : null;

  return (
    <div className={`card chat-card${blocked ? "" : " live"}`}>
      <div className="card-head">
        <div>
          <h2>Zeptejte se na výsledky</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            Odpovídá na základě už přepsaných a ověřených hodnot. Popisuje,
            nediagnostikuje.
          </p>
        </div>
      </div>

      {blocked ? (
        <p className="muted">{blocked}</p>
      ) : (
        <>
          {history.length === 0 ? (
            <div className="chat-empty">
              <p style={{ margin: 0, fontSize: "0.9rem" }}>Například:</p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="btn small" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-log" ref={logRef}>
              {history.map((m, i) => (
                <div key={i} className={`msg ${m.role === "user" ? "user" : "bot"}`}>
                  {m.content}
                </div>
              ))}
              {busy && (
                <div className="msg bot muted" aria-live="polite">
                  …
                </div>
              )}
            </div>
          )}

          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              type="text" value={input} onChange={(e) => setInput(e.target.value)}
              placeholder="Napište dotaz…" aria-label="Dotaz" disabled={busy}
            />
            <button className="btn accent" type="submit" disabled={busy || !input.trim()}>
              Odeslat
            </button>
          </form>
          {error && <p className="err" style={{ marginBottom: 0 }}>{error}</p>}
        </>
      )}
    </div>
  );
}
