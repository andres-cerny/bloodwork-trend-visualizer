/**
 * The clinical agent, as its own app.
 *
 * This app renders; it does not reason. It holds no lab code and imports
 * neither lab-core nor the toolset — every number it shows arrived through the
 * agent, which got it from the deterministic layer. That is what lets the data
 * source move from this browser to a doctor's database without the client
 * learning anything new.
 *
 * Mobile first, because the phone case is the strict one: a composer pinned
 * above the keyboard, a transcript that scrolls under it, and a rail that is
 * not there at all below the breakpoint.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, askAgent, getStatus, type Budget } from "@bw/api-client";
import { ThemeSwitch, useTurnstile } from "@bw/ui-kit";
import Transcript, { type Turn } from "./Transcript";
import Composer from "./Composer";

const SUGGESTIONS = [
  "Co se u pacienta změnilo od minule?",
  "Které hodnoty jsou mimo rozmezí?",
  "Ukaž vývoj cholesterolu v grafu.",
];

export default function App() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const onUnlock = useCallback(() => setError(null), []);
  const gate = useTurnstile(
    import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined,
    onUnlock,
  );

  useEffect(() => {
    getStatus().then((s) => setBudget(s.budget)).catch(() => {});
  }, []);

  // A reply that lands below the fold reads as no reply at all.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: text.trim() }];
    setTurns(next);
    setBusy(true);
    setError(null);

    try {
      let answer = "";
      let opened = false;
      const history = next
        .filter((t) => t.role === "user" || t.role === "assistant")
        .map((t) => ({ role: t.role as "user" | "assistant", content: t.content }));

      for await (const ev of askAgent({ profile: "clinical", history, reports: [] })) {
        if (ev.type === "text") {
          answer += ev.text;
          setTurns((prev) => {
            const base = opened ? prev.slice(0, -1) : prev;
            return [...base, { role: "assistant", content: answer }];
          });
          opened = true;
        } else if (ev.type === "tool_start") {
          // Showing the step is the point of streaming a tool-using turn: the
          // agent spends most of it not talking.
          setTurns((prev) => [...prev, { role: "tool", content: ev.name, pending: true }]);
          opened = false;
        } else if (ev.type === "tool_result") {
          setTurns((prev) => {
            // findLastIndex needs ES2023; this targets ES2022 and the array is
            // a conversation, not a dataset.
            let i = -1;
            for (let k = prev.length - 1; k >= 0; k--) {
              if (prev[k].role === "tool" && prev[k].pending) { i = k; break; }
            }
            if (i === -1) return prev;
            const copy = [...prev];
            copy[i] = { role: "tool", content: ev.summary, ok: ev.ok };
            return copy;
          });
        } else if (ev.type === "chart") {
          setTurns((prev) => [...prev, { role: "chart", content: "", chart: ev }]);
          opened = false;
        } else if (ev.type === "error") {
          setError(ev.message);
        } else if (ev.type === "done") {
          getStatus().then((s) => setBudget(s.budget)).catch(() => {});
        }
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nepodařilo se odpovědět.");
      if (e instanceof ApiError && e.budget) setBudget(e.budget);
    } finally {
      setBusy(false);
    }
  }

  const blocked = !gate.available
    ? "Asistent není v této ukázce zapnutý."
    : budget?.frozen
      ? "Rozpočet ukázky na AI funkce je vyčerpán."
      : null;

  return (
    <div className="chat-app">
      <header className="chat-top">
        <h1>Klinický asistent</h1>
        <ThemeSwitch />
      </header>

      <main className="chat-main" ref={logRef}>
        {blocked ? (
          <p className="muted">{blocked}</p>
        ) : !gate.ready ? (
          <div className="chat-gate">
            <p className="muted">Nejdřív krátké ověření, že nejste robot.</p>
            <div ref={gate.boxRef} />
            {gate.error && <p className="err">{gate.error}</p>}
          </div>
        ) : (
          <Transcript turns={turns} busy={busy} suggestions={SUGGESTIONS} onPick={send} />
        )}
        {error && <p className="err">{error}</p>}
      </main>

      {!blocked && gate.ready && <Composer busy={busy} onSend={send} />}

      <footer className="chat-foot">
        <span className="muted">
          Popisuje, nediagnostikuje. Čísla pocházejí z ověřených hodnot.
        </span>
      </footer>
    </div>
  );
}
