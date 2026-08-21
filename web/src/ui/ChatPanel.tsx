import { useState } from "react";
import { ApiError, askChat, type Budget } from "../lib/api";

interface Props {
  dataContext: string;
  frozen: boolean;
  unlocked: boolean;
  onBudget: (b: Budget) => void;
}

const SUGGESTIONS = [
  "Co se změnilo od minule?",
  "Které hodnoty jsou mimo rozmezí?",
  "Jak se vyvíjí cholesterol?",
];

export default function ChatPanel({ dataContext, frozen, unlocked, onBudget }: Props) {
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="card">
      <h2>Zeptejte se na výsledky</h2>
      <p className="sub">
        Odpovídá na základě už přepsaných a ověřených hodnot. Popisuje, nediagnostikuje.
      </p>

      {frozen ? (
        <p className="muted">Rozpočet dema na AI funkce je vyčerpán — chat je dočasně vypnutý.</p>
      ) : !unlocked ? (
        <p className="muted">Nejdřív projděte ověřením „Nejsem robot“ níže.</p>
      ) : (
        <>
          {history.length > 0 && (
            <div className="chat-log">
              {history.map((m, i) => (
                <div key={i} className={`msg ${m.role === "user" ? "user" : "bot"}`}>
                  {m.content}
                </div>
              ))}
              {busy && <div className="msg bot muted">…</div>}
            </div>
          )}

          {history.length === 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn" style={{ fontSize: "0.82rem" }} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
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
            <button className="btn primary" type="submit" disabled={busy || !input.trim()}>
              Odeslat
            </button>
          </form>
          {error && <p className="err" style={{ marginBottom: 0 }}>{error}</p>}
        </>
      )}
    </div>
  );
}
