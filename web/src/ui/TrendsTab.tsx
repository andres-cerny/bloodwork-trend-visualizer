import { useMemo, useState } from "react";
import Chart from "./Chart";
import Flag from "./Flag";
import { czExact, czNum } from "../lib/summary";
import { numericPoints, suspectPoints, type Trend } from "../lib/trends";
import { count, czDate, plural, prettyUnit } from "../lib/czech";

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

export default function TrendsTab({
  trends,
  unmappedCount = 0,
}: {
  trends: Map<string, Trend>;
  unmappedCount?: number;
}) {
  const all = useMemo(() => sortTrends([...trends.values()]), [trends]);
  const [selected, setSelected] = useState<string>("");

  if (all.length === 0)
    return <p className="sub">Zatím není co zobrazit — reporty nemají datum odběru nebo namapované analyty.</p>;

  const shown = selected ? all.filter((t) => t.canonicalId === selected) : all;

  return (
    <>
      <div className="card">
        {unmappedCount > 0 && (
          <p className="sub" style={{ marginTop: 0 }}>
            Pozor: {count(unmappedCount, "analyt se", "analyty se", "analytů se")}{" "}
            {plural(unmappedCount, "nezobrazuje", "nezobrazují", "nezobrazuje")} — zatím
            {plural(unmappedCount, " nemá", " nemají", " nemá")} přiřazený název. Najdete
            {plural(unmappedCount, " ho", " je", " je")} v záložce <strong>Přiřazení názvů</strong>.
          </p>
        )}
        <label htmlFor="analyte" className="sub" style={{ display: "block" }}>
          Analyt
        </label>
        <select id="analyte" value={selected} onChange={(e) => setSelected(e.target.value)} style={{ width: "100%" }}>
          <option value="">Všechny ({all.length})</option>
          {all.map((t) => (
            <option key={t.canonicalId} value={t.canonicalId}>
              {t.displayName}
              {outNow(t) ? " — mimo rozmezí" : ""}
              {suspectPoints(t).length ? " — čeká na ověření" : ""}
            </option>
          ))}
        </select>
      </div>

      {shown.map((t) => (
        <div className="card" key={t.canonicalId}>
          <h3>
            {t.displayName} {t.unit && <span className="muted">({prettyUnit(t.unit)})</span>}
          </h3>

          {/* A reading held out of the series has to be visible here, not only
              in Ověření. This is the screen a patient is shown, and a value
              silently missing is only marginally better than a wrong value
              silently drawn. */}
          {suspectPoints(t).map((p, i) => (
            <p key={i} className="held-back">
              ⚠ {czDate(p.date)}: <strong>{czExact(p.value, p.valueRaw)}</strong>{" "}
              {prettyUnit(t.unit)} není v grafu — hodnota čeká na ověření v záložce{" "}
              <strong>Ověření</strong>.
            </p>
          ))}

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
                      <td>{czDate(p.date)}</td>
                      {/* As printed — this table is checkable against the
                          source, so it must not round. */}
                      <td className="num">{czExact(p.value, p.valueRaw)}</td>
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
