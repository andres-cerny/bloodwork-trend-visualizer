/**
 * The opening screen: what moved against its reference range since the last
 * draw, grouped by direction, then a table of what is out of range and a
 * table of what is not.
 *
 * The groups replace a joined paragraph of template sentences. The facts are
 * the same deterministic records (`summarizeChanges`, `watchList` — no
 * model), only organized by what a reader asks first: did anything get
 * worse, did anything get better. "Worse" and "better" here mean movement
 * relative to the printed reference range — a flag transition or a move
 * toward/away from the limit — never an interpretation of what the change
 * means.
 *
 * The sparkline in each table row opens the parameter's chart in Trendy;
 * "ověřit →" opens the row on its source page. Two different questions, two
 * different targets — the whole row used to be one click surface and sent
 * everyone to verification, including readers who wanted the graph.
 */
import { useMemo } from "react";
import {
  type Flag,
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
import FlagChip from "./Flag";

interface Props {
  reports: LabReport[];
  trends: Map<string, Trend>;
  /** Open the verification tab on the row this parameter was read from. */
  onShowSource?: (canonicalId: string) => void;
  /** Open the Trendy tab with this parameter's chart added. */
  onOpenTrend?: (canonicalId: string) => void;
  /** Switch to the verification tab (the review banner's target). */
  onOpenVerify?: () => void;
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

const isOut = (f: Flag) => f === "high" || f === "low";

/**
 * Movement relative to the reference range, and only that. A flag transition
 * is unambiguous; while still out of range, direction toward or away from
 * the limit decides. Everything else — in range both times, or out with no
 * measurable move — belongs to neither group and is left to the tables.
 */
function verdictOf(r: SummaryRecord): "better" | "worse" | null {
  const o = r.older.flag;
  const n = r.newer.flag;
  if (isOut(n) && !isOut(o)) return "worse";
  if (!isOut(n) && isOut(o)) return "better";
  if (isOut(n) && isOut(o) && r.changed) {
    const delta = (r.newer.value as number) - (r.older.value as number);
    return (n === "high" ? delta < 0 : delta > 0) ? "better" : "worse";
  }
  return null;
}

/** Verbless range clause for a group row — same wording family as summary.ts. */
function factOf(r: SummaryRecord): string {
  const n = r.newer.flag;
  const rng = rangeOf(r);
  const rngSfx = rng !== "—" ? ` ${rng}` : "";
  if (isOut(n) && !isOut(r.older.flag))
    return `${n === "high" ? "nově nad rozmezím" : "nově pod rozmezím"}${rngSfx}`;
  if (!isOut(n)) return `nově v rozmezí${rngSfx}`;
  const delta = (r.newer.value as number) - (r.older.value as number);
  const toward = n === "high" ? delta < 0 : delta > 0;
  return `${n === "high" ? "stále nad rozmezím" : "stále pod rozmezím"}${rngSfx} · ${
    toward ? "blíž k mezi" : "dál od meze"
  }`;
}

/** Token-coloured, not semaphore-coloured: the palette is green-free. */
function GroupIcon({ kind }: { kind: "better" | "worse" }) {
  return kind === "worse" ? (
    <svg className="gicon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M8 1.8 15 14H1L8 1.8Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <line x1="8" y1="6.4" x2="8" y2="9.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.9" r="0.9" fill="currentColor" />
    </svg>
  ) : (
    <svg className="gicon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 8.2 7.2 10.4 11 5.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Group({
  kind,
  title,
  records,
  trends,
  watchFacts,
  onOpenTrend,
}: {
  kind: "better" | "worse";
  title: string;
  records: SummaryRecord[];
  trends: Map<string, Trend>;
  watchFacts: Map<string, string>;
  onOpenTrend?: Props["onOpenTrend"];
}) {
  if (records.length === 0) return null;
  return (
    <div className={`sum-group ${kind}`}>
      <h3>
        <GroupIcon kind={kind} />
        {title} <span className="n">{records.length}</span>
      </h3>
      <ul className="sum-moves">
        {records.map((r) => {
          const ch = changeOf(r);
          const magnitude = watchFacts.get(r.canonicalId);
          return (
            <li key={r.canonicalId}>
              <button
                className="btn linkish sum-open"
                onClick={() => onOpenTrend?.(r.canonicalId)}
                title="Otevřít graf"
              >
                {r.displayName}
              </button>{" "}
              <strong className={isOut(r.newer.flag) ? "out" : undefined}>
                {czExact(r.newer.value, r.newer.valueRaw)} {prettyUnit(trends.get(r.canonicalId)?.unit)}
              </strong>{" "}
              <span className="muted">
                — {magnitude ?? factOf(r)} · {ch.dir === "up" ? "↗ " : ch.dir === "down" ? "↘ " : ""}
                {ch.text} od {czDate(r.older.date)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Table({ records, trends, onShowSource, onOpenTrend, caption }: { records: SummaryRecord[]; trends: Map<string, Trend>; onShowSource?: Props["onShowSource"]; onOpenTrend?: Props["onOpenTrend"]; caption: string }) {
  return (
    <div className="scroll-x">
      <table className="sum-table" aria-label={caption}>
        <thead>
          <tr>
            <th>Parametr</th>
            <th className="num">Hodnota</th>
            <th className="num">Rozmezí</th>
            <th className="num">Změna od minule</th>
            <th>Průběh</th>
            <th aria-label="Zdroj" />
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const trend = trends.get(r.canonicalId);
            const ch = changeOf(r);
            return (
              <tr key={r.canonicalId}>
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
                    <FlagChip flag={r.newFlag} />
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
                <td>
                  {trend && (
                    <button
                      type="button"
                      className="sparkbtn"
                      aria-label={`Otevřít graf ${r.displayName}`}
                      title="Otevřít graf"
                      onClick={() => onOpenTrend?.(r.canonicalId)}
                    >
                      <Sparkline trend={trend} width={104} height={30} />
                    </button>
                  )}
                </td>
                <td>
                  <button
                    className="btn linkish sum-go"
                    onClick={() => onShowSource?.(r.canonicalId)}
                    title="Ukázat řádek na zdrojové stránce"
                  >
                    ověřit →
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function SummaryTab({ reports, trends, onShowSource, onOpenTrend, onOpenVerify }: Props) {
  const records = useMemo(() => summarizeChanges(trends), [trends]);
  const overview = useMemo(() => patientOverview(reports, trends), [reports, trends]);
  const watch = useMemo(() => watchList(trends), [trends]);
  const out = records.filter((r) => r.outOfRange);
  const inRange = records.filter((r) => !r.outOfRange);
  const worse = records.filter((r) => verdictOf(r) === "worse");
  const better = records.filter((r) => verdictOf(r) === "better");
  // The strongest fact watchList computed for an out-of-range parameter —
  // "66 % nad horní mezí 0,83 µkat/l" says more than the flag transition.
  const watchFacts = useMemo(
    () => new Map(watch.filter((w) => w.facts.length > 0).map((w) => [w.canonicalId, w.facts[0]])),
    [watch],
  );

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
        {overview.withheldNow.length > 0 && (
          <p className="held-back">
            ⚠ {count(overview.withheldNow.length, "hodnota čeká", "hodnoty čekají", "hodnot čeká")} na
            ověření: {overview.withheldNow.join(", ")} —{" "}
            <button className="btn linkish" onClick={onOpenVerify}>
              přejít na Ověření
            </button>
            .
          </p>
        )}
        {worse.length === 0 && better.length === 0 ? (
          <p className="prose">Žádný přesun vůči referenčnímu rozmezí od minulého odběru.</p>
        ) : (
          <div className="sum-groups">
            <Group kind="worse" title="Zhoršilo se" records={worse} trends={trends} watchFacts={watchFacts} onOpenTrend={onOpenTrend} />
            <Group kind="better" title="Zlepšilo se" records={better} trends={trends} watchFacts={new Map()} onOpenTrend={onOpenTrend} />
          </div>
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
            {out.length === 0 ? <p className="muted">Nic — všechny porovnatelné parametry jsou v rozmezí.</p> : <Table records={out} trends={trends} onShowSource={onShowSource} onOpenTrend={onOpenTrend} caption="Parametry mimo referenční rozmezí" />}
          </section>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>
                  V rozmezí <span className="n">{inRange.length}</span>
                </h2>
              </div>
            </div>
            {inRange.length === 0 ? <p className="muted">Nic.</p> : <Table records={inRange} trends={trends} onShowSource={onShowSource} onOpenTrend={onOpenTrend} caption="Parametry v referenčním rozmezí" />}
          </section>
        </>
      )}
    </>
  );
}
