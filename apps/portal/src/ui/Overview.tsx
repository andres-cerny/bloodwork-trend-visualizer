/**
 * The opening screen: what is out of range now, then everything else at a
 * glance.
 *
 * The watch strip is `watchList` from lab-core — each tile the value in the
 * status colour, the facts beside it (how far past the limit, how many draws
 * in a row, which way the series went) and the series as a sparkline. Below
 * it every parameter, out-of-range first, each a tile that opens its chart.
 * Nothing here computes a number; the tiles render what lab-core decided.
 *
 * A reading the app withheld at this draw is named at the top, not folded
 * into a count: it is neither in range nor out of it, and a strip with no
 * red tiles must not read as an all-clear while a value sits unresolved.
 */
import { useMemo } from "react";
import {
  type LabReport,
  type Trend,
  count,
  czExact,
  numericPoints,
  patientOverview,
  prettyUnit,
  watchDate,
  watchList,
} from "@bw/lab-core";
import { Sparkline } from "@bw/ui-kit";

interface Props {
  reports: LabReport[];
  trends: Map<string, Trend>;
  onOpenTrend: (canonicalId: string) => void;
}

const isOut = (t: Trend) => {
  const pts = numericPoints(t);
  const last = pts[pts.length - 1];
  return !!last && (last.flag === "high" || last.flag === "low");
};

export default function Overview({ reports, trends, onOpenTrend }: Props) {
  const watch = useMemo(() => watchList(trends), [trends]);
  const when = useMemo(() => watchDate(trends), [trends]);
  const overview = useMemo(() => patientOverview(reports, trends), [reports, trends]);
  const all = useMemo(
    () =>
      [...trends.values()]
        .filter((t) => numericPoints(t).length > 0)
        .sort((a, b) => Number(isOut(b)) - Number(isOut(a)) || a.displayName.localeCompare(b.displayName, "cs")),
    [trends],
  );

  if (all.length === 0) return <p className="sub">Zatím není co zobrazit — reporty nemají datum odběru nebo přiřazené parametry.</p>;

  return (
    <>
      <section className="card">
        <div className="watch-head">
          <h2>Na co se podívat</h2>
          {when && (
            <span className="muted">
              k odběru {when} · {count(all.length, "parametr", "parametry", "parametrů")}
            </span>
          )}
        </div>
        {overview.withheldNow.length > 0 && (
          <p className="held-back">
            ⚠ {count(overview.withheldNow.length, "hodnota čeká", "hodnoty čekají", "hodnot čeká")} na ověření:{" "}
            {overview.withheldNow.join(", ")} — v záložce <strong>Ověření</strong>.
          </p>
        )}
        {watch.length === 0 ? (
          <p className="prose">
            {overview.withheldNow.length ? "Žádná ověřená hodnota mimo referenční rozmezí." : "Žádná hodnota mimo referenční rozmezí."}
          </p>
        ) : (
          <div className="watch">
            {watch.map((w) => (
              <button key={w.canonicalId} className="tile out" onClick={() => onOpenTrend(w.canonicalId)} title="Otevřít graf">
                <span className="tile-name">{w.displayName}</span>
                <span className="tile-value">
                  {czExact(w.point.value, w.point.valueRaw)}
                  {w.unit && <span className="unit">{w.unit}</span>}
                </span>
                <ul className="tile-facts">
                  {w.facts.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
                <Sparkline trend={trends.get(w.canonicalId)!} />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="watch-head">
          <h2>Všechny parametry</h2>
          <span className="muted">poslední hodnota a průběh · klepnutím otevřete graf</span>
        </div>
        <div className="watch grid-all">
          {all.map((t) => {
            const pts = numericPoints(t);
            const last = pts[pts.length - 1];
            const out = isOut(t);
            return (
              <button key={t.canonicalId} className={`tile${out ? " out" : ""}`} onClick={() => onOpenTrend(t.canonicalId)} title="Otevřít graf">
                <span className="tile-name">{t.displayName}</span>
                <span className="tile-value">
                  {czExact(last.value, last.valueRaw)}
                  {t.unit && <span className="unit">{prettyUnit(t.unit)}</span>}
                  {last.unconfirmed && <span className="chip"> nepotvrzeno</span>}
                </span>
                <Sparkline trend={t} />
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
