import { useMemo } from "react";
import { summarizeChanges } from "../lib/summary";
import type { Trend } from "../lib/trends";

export default function SummaryTab({ trends }: { trends: Map<string, Trend> }) {
  const records = useMemo(() => summarizeChanges(trends), [trends]);

  return (
    <div className="card">
      <h2>Souhrn změn</h2>
      <p className="sub">
        Popis posledních dvou měření u každého analytu. Text je generován
        deterministickými pravidly — žádný model, tedy žádná interpretace ani
        diagnóza. Aktualizuje se okamžitě, pokud v Ověření opravíte hodnotu.
      </p>
      {records.length === 0 ? (
        <p className="muted">Zatím není dost měření na porovnání (potřebujeme alespoň dvě).</p>
      ) : (
        <ul className="summary">
          {records.map((r) => (
            <li key={r.canonicalId}>
              {r.outOfRange && <span className="chip alert">mimo rozmezí</span>}
              {r.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
