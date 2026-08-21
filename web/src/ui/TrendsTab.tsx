import { useMemo, useState } from "react";
import Chart from "./Chart";
import Flag from "./Flag";
import { czNum } from "../lib/summary";
import { numericPoints, type Trend } from "../lib/trends";

/** Out-of-range latest result first — the rows a doctor scans for. */
function sortTrends(trends: Trend[]): Trend[] {
  return [...trends].sort((a, b) => {
    const oa = outNow(a) ? 0 : 1;
    const ob = outNow(b) ? 0 : 1;
    return oa - ob || a.displayName.localeCompare(b.displayName, "cs");
  });
}

function outNow(t: Trend): boolean {
  const np = numericPoints(t);
  const last = np[np.length - 1];
  return !!last && (last.flag === "high" || last.flag === "low");
}

export default function TrendsTab({ trends }: { trends: Map<string, Trend> }) {
  const all = useMemo(() => sortTrends([...trends.values()]), [trends]);
  const [selected, setSelected] = useState<string>("");

  if (all.length === 0)
    return <p className="sub">Zatím není co zobrazit — reporty nemají datum odběru nebo namapované analyty.</p>;

  const shown = selected ? all.filter((t) => t.canonicalId === selected) : all;

  return (
    <>
      <div className="card">
        <label htmlFor="analyte" className="sub" style={{ display: "block" }}>
          Analyt
        </label>
        <select id="analyte" value={selected} onChange={(e) => setSelected(e.target.value)} style={{ width: "100%" }}>
          <option value="">Všechny ({all.length})</option>
          {all.map((t) => (
            <option key={t.canonicalId} value={t.canonicalId}>
              {t.displayName}
              {outNow(t) ? " ⚠" : ""}
            </option>
          ))}
        </select>
      </div>

      {shown.map((t) => (
        <div className="card" key={t.canonicalId}>
          <h3>
            {t.displayName} {t.unit && <span className="muted">({t.unit})</span>}
          </h3>
          <Chart trend={t} />
          <details style={{ marginTop: 8 }}>
            <summary className="muted" style={{ cursor: "pointer" }}>
              Tabulka hodnot
            </summary>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th style={{ textAlign: "right" }}>Hodnota</th>
                    <th>Rozmezí</th>
                    <th>Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {t.points.map((p, i) => (
                    <tr key={i}>
                      <td>{p.date}</td>
                      <td className="num">{p.value !== null ? czNum(p.value) : p.valueRaw}</td>
                      <td className="muted">
                        {p.refLow !== null || p.refHigh !== null
                          ? `${p.refLow !== null ? czNum(p.refLow) : ""}–${p.refHigh !== null ? czNum(p.refHigh) : ""}`
                          : "—"}
                      </td>
                      <td>
                        <Flag flag={p.flag} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ))}
    </>
  );
}
