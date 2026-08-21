/**
 * What changed between the last two draws, grouped the way it is read.
 *
 * Out-of-range first, then real moves inside the interval, then a collapsed
 * list of the analytes that did not move — which is most of them, and which as
 * one flat list buried the four rows a doctor actually opened this for.
 *
 * Every row is a link into verification: the reader's next question about a
 * surprising number is "where does that come from", and the answer is the
 * printed row on the source page.
 */
import { useMemo } from "react";
import { summarizeChanges } from "../lib/summary";
import type { SummaryRecord } from "../lib/summary";
import type { Trend } from "../lib/trends";

interface Props {
  trends: Map<string, Trend>;
  /** Open the verification tab on the row this analyte was read from. */
  onShowSource?: (canonicalId: string) => void;
}

function Rows({ records, onShowSource }: { records: SummaryRecord[]; onShowSource?: Props["onShowSource"] }) {
  return (
    <ul className="summary">
      {records.map((r) => (
        <li key={r.canonicalId}>
          <button
            className="sum-row"
            onClick={() => onShowSource?.(r.canonicalId)}
            title="Ukázat řádek na zdrojové stránce"
          >
            <span className="sum-text">
              {r.outOfRange && <span className="chip alert">mimo rozmezí</span>}
              {/* The analyte is what the eye scans for; the generated sentence
                  leads with it, so it is picked back out and set in bold. */}
              <span className="sum-name">{r.displayName}</span>
              {r.text.startsWith(`${r.displayName}:`) ? r.text.slice(r.displayName.length) : ` — ${r.text}`}
            </span>
            <span className="sum-go" aria-hidden="true">
              ověřit →
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function SummaryTab({ trends, onShowSource }: Props) {
  const records = useMemo(() => summarizeChanges(trends), [trends]);
  const out = records.filter((r) => r.outOfRange);
  const moved = records.filter((r) => !r.outOfRange && r.changed);
  const stable = records.filter((r) => !r.outOfRange && !r.changed);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Souhrn změn</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            Popis posledních dvou měření u každého analytu. Text je generován
            deterministickými pravidly — žádný model, tedy žádná interpretace ani
            diagnóza. Aktualizuje se okamžitě, pokud v Ověření opravíte hodnotu.
          </p>
        </div>
      </div>

      {records.length === 0 ? (
        <p className="muted">Zatím není dost měření na porovnání (potřebujeme alespoň dvě).</p>
      ) : (
        <>
          {out.length > 0 && (
            <>
              <p className="section-title">Mimo referenční rozmezí ({out.length})</p>
              <Rows records={out} onShowSource={onShowSource} />
            </>
          )}
          {moved.length > 0 && (
            <>
              <p className="section-title">Změny v rámci rozmezí ({moved.length})</p>
              <Rows records={moved} onShowSource={onShowSource} />
            </>
          )}
          {stable.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary className="section-title" style={{ cursor: "pointer", margin: 0 }}>
                Prakticky beze změny ({stable.length})
              </summary>
              <Rows records={stable} onShowSource={onShowSource} />
            </details>
          )}
        </>
      )}
    </div>
  );
}
