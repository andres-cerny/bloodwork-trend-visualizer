/**
 * Placeholder shell — the UI tournament's variants replace this file.
 *
 * What it proves meanwhile: the gate mints a session, the picker lists the
 * practice, and a patient's timeline arrives through the card API. Plumbing,
 * not design; the tournament owns the design.
 */
import { useCallback, useEffect, useState } from "react";
import { CsmMark, ThemeSwitch, useTurnstile } from "@bw/ui-kit";
import { hasSession, type CardPatient, type CardVisit } from "@bw/api-client";
import { liveData, type CardData } from "./data";

const data: CardData = liveData;

export default function App() {
  const [unlocked, setUnlocked] = useState(hasSession());
  const gate = useTurnstile(
    import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined,
    useCallback(() => setUnlocked(true), []),
  );
  const ready = unlocked || gate.ready;
  const [patients, setPatients] = useState<CardPatient[] | null>(null);
  const [picked, setPicked] = useState<CardPatient | null>(null);
  const [visits, setVisits] = useState<CardVisit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    data.patients().then(setPatients).catch((e) => setError(String(e.message ?? e)));
  }, [ready]);

  useEffect(() => {
    if (!picked) return;
    setVisits(null);
    data.visits(picked.id).then(setVisits).catch((e) => setError(String(e.message ?? e)));
  }, [picked]);

  return (
    <div className="shell">
      <header className="topbar">
        <CsmMark size={26} />
        <strong>Moje CSM</strong>
        <span className="spacer" />
        <ThemeSwitch />
      </header>
      {!ready && <div className="gate" ref={gate.boxRef} />}
      {error && <p role="alert">{error}</p>}
      {ready && !picked && (
        <main>
          <h1>Kdo se dívá?</h1>
          <ul className="picker">
            {(patients ?? []).map((p) => (
              <li key={p.id}>
                <button onClick={() => setPicked(p)}>
                  {p.fullName} <small>nar. {p.birthDate}</small>
                </button>
              </li>
            ))}
          </ul>
        </main>
      )}
      {picked && (
        <main>
          <h1>{picked.fullName}</h1>
          <ul className="timeline">
            {(visits ?? []).map((v) => (
              <li key={v.id}>
                {v.visitDate} · {v.title}
                {v.outOfRange > 0 && <em> · {v.outOfRange} mimo rozmezí</em>}
              </li>
            ))}
          </ul>
        </main>
      )}
    </div>
  );
}
