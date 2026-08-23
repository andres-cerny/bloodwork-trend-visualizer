/**
 * The clinical agent, as its own app.
 *
 * This app renders; it does not reason. It holds no lab code and imports
 * neither lab-core nor the toolset — every number it shows arrived through the
 * agent, which got it from the deterministic layer. That is what lets the data
 * source live in a practice's database without the client learning anything.
 *
 * The URL path is the practice: /sport and /orto are separate tenants over
 * separate databases, and the server refuses a slug it does not know. The
 * patient is a chip, not a belief: the server resolves identity and hands back
 * a ref in a `patient` event; this client pins it, shows who is open, and
 * sends the ref back with every turn. It never invents one.
 *
 * Mobile first, because the phone case is the strict one: a composer pinned
 * above the keyboard, a transcript that scrolls under it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, askAgent, getStatus, type Budget } from "@bw/api-client";
import { ThemeSwitch, useTurnstile } from "@bw/ui-kit";
import Transcript, { type Turn } from "./Transcript";
import Composer from "./Composer";

const TENANTS: Record<string, { label: string; suggestions: string[] }> = {
  sport: {
    label: "Sportovní medicína",
    suggestions: [
      "Dej mi souhrn Tomáše Hrubého.",
      "Jak se vyvíjí ferritin Kláry Šebestové?",
      "Ukaž hemoglobin Vojtěcha Palána v grafu.",
    ],
  },
  orto: {
    label: "Ortopedie a fyzioterapie",
    suggestions: [
      "Dej mi souhrn Michala Nováka.",
      "Které předoperační hodnoty jsou mimo rozmezí?",
      "Shrň, co se změnilo od minulého odběru.",
    ],
  },
};

interface Patient {
  ref: string;
  fullName: string;
  birthDate: string;
}

/** /sport and /orto are practices; anything else offers the choice. */
function tenantFromPath(): string | null {
  const slug = window.location.pathname.split("/")[1] ?? "";
  return slug in TENANTS ? slug : null;
}

export default function App() {
  const [tenant] = useState<string | null>(tenantFromPath);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
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
    if (!text.trim() || busy || !tenant) return;
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

      for await (const ev of askAgent({
        profile: "clinical",
        history,
        tenant,
        ...(patient ? { patientRef: patient.ref } : {}),
      })) {
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
        } else if (ev.type === "patient") {
          // The server resolved who the conversation is about. Pin the ref;
          // the chip below is what keeps a near-miss visible.
          setPatient({ ref: ev.ref, fullName: ev.fullName, birthDate: ev.birthDate });
        } else if (ev.type === "sources") {
          setTurns((prev) => [
            ...prev,
            { role: "sources", content: "", sources: ev.sources as never },
          ]);
          opened = false;
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

  if (!tenant) {
    return (
      <div className="chat-app">
        <header className="chat-top">
          <h1>Klinický asistent</h1>
          <ThemeSwitch />
        </header>
        <main className="chat-main chat-pick">
          <p className="muted">Vyberte ordinaci:</p>
          {Object.entries(TENANTS).map(([slug, t]) => (
            <a key={slug} className="chat-pick-card" href={`/${slug}`}>
              {t.label}
            </a>
          ))}
        </main>
      </div>
    );
  }

  const blocked = !gate.available
    ? "Asistent není v této ukázce zapnutý."
    : budget?.frozen
      ? "Rozpočet ukázky na AI funkce je vyčerpán."
      : null;

  return (
    <div className="chat-app">
      <header className="chat-top">
        <h1>{TENANTS[tenant].label}</h1>
        {patient && (
          <span className="chat-patient" title={`Otevřená karta: ${patient.fullName}`}>
            {patient.fullName} · nar. {patient.birthDate.slice(0, 4)}
            <button
              type="button"
              aria-label="Zavřít kartu pacienta"
              onClick={() => setPatient(null)}
            >
              ✕
            </button>
          </span>
        )}
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
          <Transcript
            turns={turns}
            busy={busy}
            suggestions={TENANTS[tenant].suggestions}
            onPick={send}
          />
        )}
        {error && <p className="err">{error}</p>}
      </main>

      {!blocked && gate.ready && <Composer busy={busy} onSend={send} />}

      <footer className="chat-foot">
        <span className="muted">
          Popisuje, nediagnostikuje. Čísla pocházejí z ověřených hodnot. Ukázka
          — nezadávejte údaje skutečných pacientů.
        </span>
      </footer>
    </div>
  );
}
