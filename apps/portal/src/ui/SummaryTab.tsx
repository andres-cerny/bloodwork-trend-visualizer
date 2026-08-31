/**
 * What changed, in the order it is read: two or three sentences of what to
 * look at first, then a table of what is out of range and a table of what is
 * not.
 *
 * Every sentence is `patientOverview` and every fact `watchList` — the
 * deterministic templates in lab-core, no model, so nothing here can turn a
 * description into a diagnosis. The tables are `summarizeChanges`: the last
 * two draws of each parameter, with the whole series beside them as a
 * sparkline so a small step at the end of a long climb is not mistaken for
 * the whole story. Every row is a link into verification — the next question
 * about a surprising number is "where does that come from".
 */
import { useMemo } from "react";
import {
  type LabReport,
  type SummaryRecord,
  type Trend,
  count,
  czDate,
  czExact,
  czNum,
  patientOverview,
  prettyUnit,
  summarizeChanges,
  watchList,
} from "@bw/lab-core";
import { Sparkline } from "@bw/ui-kit";
import Flag from "./Flag";

interface Props {
  reports: LabReport[];
  trends: Map<string, Trend>;
  /** Open the verification tab on the row this parameter was read from. */
  onShowSource?: (canonicalId: string) => void;
}

const rangeOf = (r: SummaryRecord) =>
  r.newer.refLow !== null || r.newer.refHigh !== null
    ? `${r.newer.refLow !== null ? czNum(r.newer.refLow) : ""}–${r.newer.refHigh !== null ? czNum(r.newer.refHigh) : ""}`
    : "—";

/** "+0,17 · +18 %" or "beze změny" — sign and size, no verb. */
function changeOf(r: SummaryRecord): { text: string; dir: "up" | "down" | "flat" } {
  const ov = r.older.value as number;
  const nv = r.newer.value as number;
  const delta = nv - ov;
  if (!r.changed) return { text: "beze změny", dir: "flat" };
  const sign = delta > 0 ? "+" : "−";
  const pct = ov ? ` · ${sign}${Math.round(Math.abs((delta / ov) * 100))} %` : "";
  return { text: `${sign}${czNum(Math.abs(delta))}${pct}`, dir: delta > 0 ? "up" : "down" };
}

function Table({ records, trends, onShowSource, caption }: { records: SummaryRecord[]; trends: Map<string, Trend>; onShowSource?: Props["onShowSource"]; caption: string }) {
  return (
    <div className="scroll-x">
      <table className="sum-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th>Parametr</th>
            <th style={{ textAlign: "right" }}>Hodnota</th>
            <th>Rozmezí</th>
            <th>Změna od minule</th>
            <th>Průběh</th>
            <th aria-label="Zdroj" />
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const trend = trends.get(r.canonicalId);
            const ch = changeOf(r);
            return (
              <tr key={r.canonicalId} className="row-pick" onClick={() => onShowSource?.(r.canonicalId)} title="Ukázat řádek na zdrojové stránce">
                <td>
                  <span className="sum-name">{r.displayName}</span>
                  <span className="muted" style={{ display: "block" }}>
                    {czDate(r.older.date)} → {czDate(r.newer.date)}
                  </span>
                </td>
                <td className="num">
                  <strong className={r.outOfRange ? "out" : undefined}>{czExact(r.newer.value, r.newer.valueRaw)}</strong>{" "}
                  <span className="muted">{prettyUnit(trend?.unit)}</span>
                  <span style={{ display: "block" }}>
                    <Flag flag={r.newFlag} />
                  </span>
                </td>
                <td className="muted num">{rangeOf(r)}</td>
                <td className={`num change ${ch.dir}`}>
                  {ch.dir === "up" ? "↗ " : ch.dir === "down" ? "↘ " : ""}
                  {ch.text}
                  <span className="muted" style={{ display: "block", fontWeight: 400 }}>
                    z {czNum(r.older.value)}
                  </span>
                </td>
                <td>{trend && <Sparkline trend={trend} width={96} height={28} />}</td>
                <td className="sum-go" aria-hidden="true">
                  ověřit →
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function SummaryTab({ reports, trends, onShowSource }: Props) {
  const records = useMemo(() => summarizeChanges(trends), [trends]);
  const overview = useMemo(() => patientOverview(reports, trends), [reports, trends]);
  const watch = useMemo(() => watchList(trends), [trends]);
  const out = records.filter((r) => r.outOfRange);
  const inRange = records.filter((r) => !r.outOfRange);

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Na co se podívat nejdřív</h2>
            {overview.lastDraw && (
              <p className="sub" style={{ marginBottom: 0 }}>
                k odběru {czDate(overview.lastDraw)}
                {overview.followUp && ` · sledování ${overview.followUp}`}
                {overview.draws > 0 && ` · ${count(overview.draws, "odběr", "odběry", "odběrů")}`}
              </p>
            )}
          </div>
        </div>
        <p className="prose">{overview.sentences.join(" ")}</p>
        {watch.length > 0 && (
          <ul className="watch-list">
            {watch.map((w) => (
              <li key={w.canonicalId}>
                <button className="btn linkish" onClick={() => onShowSource?.(w.canonicalId)}>
                  {w.displayName}
                </button>{" "}
                <strong className="out">
                  {czExact(w.point.value, w.point.valueRaw)} {w.unit}
                </strong>{" "}
                <span className="muted">— {w.facts.join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted" style={{ marginTop: 10 }}>
          Popis je sestaven z pravidel nad naměřenými čísly — bez modelu, tedy bez výkladu a bez diagnózy. Co
          hodnoty znamenají, je otázka pro lékaře.
        </p>
      </section>

      {records.length === 0 ? (
        <section className="card">
          <p className="muted">Zatím není dost měření na porovnání (potřebujeme alespoň dvě u jednoho parametru).</p>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>
                  Mimo rozmezí <span className="n">{out.length}</span>
                </h2>
              </div>
            </div>
            {out.length === 0 ? <p className="muted">Nic — všechny porovnatelné parametry jsou v rozmezí.</p> : <Table records={out} trends={trends} onShowSource={onShowSource} caption="Parametry mimo referenční rozmezí" />}
          </section>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>
                  V rozmezí <span className="n">{inRange.length}</span>
                </h2>
              </div>
            </div>
            {inRange.length === 0 ? <p className="muted">Nic.</p> : <Table records={inRange} trends={trends} onShowSource={onShowSource} caption="Parametry v referenčním rozmezí" />}
          </section>
        </>
      )}
    </>
  );
}
