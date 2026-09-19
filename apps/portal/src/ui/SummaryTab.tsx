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
 * The name, the sparkline and "graf →" in each table row all open the
 * parameter's chart in Trendy. The row used to end in "ověřit →" as well;
 * that door now lives under the chart, in the table of values, where every
 * reading has its own — Souhrn answers "what moved", the chart's table
 * answers "is that number right", and a reader reaches the second through
 * the first.
 *
 * A group row carries two readings of the same record and the width picks
 * one. A desktop gets the single clause it always had: the magnitude
 * (lab-core's `watchList` sentence), the change, the date. A phone gets two
 * short lines — the value with its printed range, then the draw before it —
 * because one clause of that density is four wrapped lines on a 360px
 * column, and four lines × seven parameters is a wall nobody reads. The
 * phone keeps the numbers and drops the elaboration: the percentage past the
 * limit and the signed delta are on the desktop only, and both are one tap
 * away in Trendy, where the row's own name leads.
 *
 * Every list here folds to its first two rows on a phone, behind "Více".
 * Four lists of everything measured is a scroll nobody finishes; the count
 * beside each heading says how much is folded away.
 *
 * The opening card is one card on a desktop and three on a phone: a Souhrn
 * card — the draw date, the span, the count, and the withheld notice that
 * qualifies them — then one card per direction. At 360px the head and both
 * groups in a single box is three headings deep and nothing says where one
 * answer ends and the next begins. Same markup at both widths;
 * `styles.css` decides which head shows and where the card chrome sits.
 */
import { useMemo, useState } from "react";
import {
  type Flag,
  type LabReport,
  type SummaryRecord,
  type Trend,
  count,
  czDate,
  czExact,
  czNum,
  czRange,
  numericPoints,
  patientOverview,
  prettyUnit,
  summarizeChanges,
  watchList,
} from "@bw/lab-core";
import { Sparkline } from "@bw/ui-kit";
import AboutParam, { type About } from "./AboutParam";
import { type PickerOption } from "./AnalytePicker";
import SearchParam from "./SearchParam";
import FlagChip from "./Flag";

interface Props {
  reports: LabReport[];
  trends: Map<string, Trend>;
  /** Open the Trendy tab with this parameter's chart added. */
  onOpenTrend?: (canonicalId: string) => void;
  /** Switch to the verification tab (the review banner's target). */
  onOpenVerify?: () => void;
  /** The catalog's two sentences about a parameter, for the "i" after its name. */
  aboutOf?: (canonicalId: string) => About | undefined;
}

const rangeOf = (r: SummaryRecord) =>
  r.newer.refLow !== null || r.newer.refHigh !== null ? czRange(r.newer.refLow, r.newer.refHigh) : "—";

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

/**
 * The fold, on a phone only.
 *
 * Rendered at every width and hidden by CSS above 820px, so nothing here
 * branches on a viewport width that React cannot see. The rows beyond the
 * second are hidden the same way — they stay in the DOM, and in the
 * accessibility tree, at every width where the fold is not shown.
 */
function Fold({ open, rest, onToggle, controls }: { open: boolean; rest: number; onToggle: () => void; controls: string }) {
  if (rest < 1) return null;
  return (
    <button className="btn linkish sum-fold" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {open ? "Méně" : `Více (${rest})`}
    </button>
  );
}

/** Rows past the second are folded away on a phone — see `Fold`. */
const foldClass = (open: boolean, total: number) => (!open && total > 2 ? " folded" : "");

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
  aboutOf,
}: {
  kind: "better" | "worse";
  title: string;
  records: SummaryRecord[];
  trends: Map<string, Trend>;
  watchFacts: Map<string, string>;
  onOpenTrend?: Props["onOpenTrend"];
  aboutOf?: Props["aboutOf"];
}) {
  const [open, setOpen] = useState(false);
  if (records.length === 0) return null;
  const listId = `sum-moves-${kind}`;
  return (
    <div className={`sum-group ${kind}`}>
      <h3>
        <GroupIcon kind={kind} />
        {title} <span className="n">{records.length}</span>
      </h3>
      <ul className={`sum-moves${foldClass(open, records.length)}`} id={listId}>
        {records.map((r) => {
          const ch = changeOf(r);
          const magnitude = watchFacts.get(r.canonicalId);
          const rng = rangeOf(r);
          return (
            <li key={r.canonicalId}>
              <button
                className="btn linkish sum-open"
                onClick={() => onOpenTrend?.(r.canonicalId)}
                title="Otevřít graf"
              >
                {r.displayName}
              </button>
              <AboutParam name={r.displayName} about={aboutOf?.(r.canonicalId)} />{" "}
              <strong className={isOut(r.newer.flag) ? "out" : undefined}>
                {czExact(r.newer.value, r.newer.valueRaw)} {prettyUnit(trends.get(r.canonicalId)?.unit)}
              </strong>
              {rng !== "—" && <span className="muted sum-range"> — rozmezí ({rng})</span>}{" "}
              <span className="muted sum-clause">
                — {magnitude ?? factOf(r)} · {ch.dir === "up" ? "↗ " : ch.dir === "down" ? "↘ " : ""}
                {ch.text} od {czDate(r.older.date)}
              </span>
              <span className="muted sum-prev">
                předchozí měření {czExact(r.older.value, r.older.valueRaw)} ({czDate(r.older.date)})
              </span>
            </li>
          );
        })}
      </ul>
      <Fold open={open} rest={records.length - 2} onToggle={() => setOpen((v) => !v)} controls={listId} />
    </div>
  );
}

function Table({ records, trends, onOpenTrend, aboutOf, caption, id }: { records: SummaryRecord[]; trends: Map<string, Trend>; onOpenTrend?: Props["onOpenTrend"]; aboutOf?: Props["aboutOf"]; caption: string; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="scroll-x">
        <table className={`sum-table${foldClass(open, records.length)}`} aria-label={caption} id={id}>
          <thead>
            <tr>
              <th>Parametr</th>
              <th className="num">Hodnota</th>
              <th className="num">Rozmezí</th>
              <th className="num sum-wide">Změna od minule</th>
              <th className="sum-wide">Průběh</th>
              {/* The last column opens the chart at every width. The way to
                  the printed row moved to Trendy, under the chart, where
                  each reading has its own "ověřit →" — Souhrn asks "what
                  moved", the chart's table asks "is it right". */}
              <th className="sum-more" aria-label="Graf" />
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const trend = trends.get(r.canonicalId);
              const ch = changeOf(r);
              return (
                <tr key={r.canonicalId}>
                  <td>
                    <button type="button" className="btn linkish sum-open sum-name" onClick={() => onOpenTrend?.(r.canonicalId)} title="Otevřít graf">
                      {r.displayName}
                    </button>
                    <AboutParam name={r.displayName} about={aboutOf?.(r.canonicalId)} />
                    <span className="muted sum-wide" style={{ display: "block" }}>
                      {czDate(r.older.date)} → {czDate(r.newer.date)}
                    </span>
                  </td>
                  <td className="num">
                    <strong className={r.outOfRange ? "out" : undefined}>{czExact(r.newer.value, r.newer.valueRaw)}</strong>{" "}
                    <span className="muted unit-line">{prettyUnit(trend?.unit)}</span>
                    <span className="sum-wide" style={{ display: "block" }}>
                      <FlagChip flag={r.newFlag} />
                    </span>
                  </td>
                  <td className="muted num">{rangeOf(r)}</td>
                  <td className={`num change sum-wide ${ch.dir}`}>
                    {ch.dir === "up" ? "↗ " : ch.dir === "down" ? "↘ " : ""}
                    {ch.text}
                    <span className="muted" style={{ display: "block", fontWeight: 400 }}>
                      z {czNum(r.older.value)}
                    </span>
                  </td>
                  <td className="sum-wide">
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
                  <td className="sum-more">
                    <button className="btn linkish sum-go" onClick={() => onOpenTrend?.(r.canonicalId)} title="Otevřít graf">
                      graf →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Fold open={open} rest={records.length - 2} onToggle={() => setOpen((v) => !v)} controls={id} />
    </>
  );
}

/** Every parameter with a chart to open, out-of-range ones marked. */
function searchOptions(trends: Map<string, Trend>): PickerOption[] {
  return [...trends.values()]
    .filter((t) => numericPoints(t).length > 0)
    .map((t) => {
      const np = numericPoints(t);
      const last = np[np.length - 1];
      const out = last.flag === "high" || last.flag === "low";
      return { id: t.canonicalId, label: t.displayName, note: out ? "mimo rozmezí" : undefined, outOfRange: out };
    })
    .sort((a, b) => Number(b.outOfRange ?? false) - Number(a.outOfRange ?? false) || a.label.localeCompare(b.label, "cs"));
}

export default function SummaryTab({ reports, trends, onOpenTrend, onOpenVerify, aboutOf }: Props) {
  const records = useMemo(() => summarizeChanges(trends), [trends]);
  const overview = useMemo(() => patientOverview(reports, trends), [reports, trends]);
  const watch = useMemo(() => watchList(trends), [trends]);
  const options = useMemo(() => searchOptions(trends), [trends]);
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
      <section className="card sum-lead">
        {/* Head and withheld notice travel together. On a phone this wrapper
            is the Souhrn card and the notice sits inside it, beside the facts
            it qualifies; on a desktop it is layout-neutral — its children keep
            their own margins and the lead card is the one it always was. */}
        <div className="sum-head">
          {/* The phone's reading of the head, and the card's own below it.
              Both ship at every width and styles.css picks one — the same way
              `sum-clause` and `sum-prev` split a group row. */}
          <div className="sum-overview">
            <h2>Souhrn</h2>
            <dl className="sum-facts">
              <div>
                <dt>Poslední měření:</dt>
                <dd>{overview.lastDraw ? czDate(overview.lastDraw) : "—"}</dd>
              </div>
              <div>
                <dt>Doba sledování:</dt>
                <dd>{overview.followUp ?? "—"}</dd>
              </div>
              <div>
                <dt>Počet odběrů:</dt>
                <dd>{overview.draws > 0 ? overview.draws : "—"}</dd>
              </div>
            </dl>
          </div>
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
              ⚠ {count(overview.withheldNow.length, "hodnota čeká", "hodnoty čekají", "hodnot čeká")}{" "}
              na ověření: {overview.withheldNow.join(", ")} —{" "}
              <button className="btn linkish" onClick={onOpenVerify}>
                přejít na Ověření
              </button>
              .
            </p>
          )}
        </div>
        {worse.length === 0 && better.length === 0 ? (
          <p className="prose">Žádný přesun vůči referenčnímu rozmezí od minulého odběru.</p>
        ) : (
          <div className="sum-groups">
            <Group kind="worse" title="Zhoršilo se" records={worse} trends={trends} watchFacts={watchFacts} onOpenTrend={onOpenTrend} aboutOf={aboutOf} />
            <Group kind="better" title="Zlepšilo se" records={better} trends={trends} watchFacts={new Map()} onOpenTrend={onOpenTrend} aboutOf={aboutOf} />
          </div>
        )}
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
              {onOpenTrend && <SearchParam options={options} onPick={onOpenTrend} label="Hledat parametr a otevřít graf" />}
            </div>
            {out.length === 0 ? <p className="muted">Nic — všechny porovnatelné parametry jsou v rozmezí.</p> : <Table records={out} trends={trends} onOpenTrend={onOpenTrend} aboutOf={aboutOf} caption="Parametry mimo referenční rozmezí" id="sum-table-out" />}
          </section>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>
                  V rozmezí <span className="n">{inRange.length}</span>
                </h2>
              </div>
              {onOpenTrend && <SearchParam options={options} onPick={onOpenTrend} label="Hledat parametr a otevřít graf" />}
            </div>
            {inRange.length === 0 ? <p className="muted">Nic.</p> : <Table records={inRange} trends={trends} onOpenTrend={onOpenTrend} aboutOf={aboutOf} caption="Parametry v referenčním rozmezí" id="sum-table-in" />}
          </section>
        </>
      )}
    </>
  );
}
