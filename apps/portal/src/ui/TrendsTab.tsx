/**
 * Trends: nothing until the doctor asks for something.
 *
 * The tab used to open with all twenty analytes plotted. That is not a view of
 * anything — it is twenty charts to scroll past before reaching the one you
 * came for, and it made the screen look like a data dump rather than a
 * consultation. It now opens empty and analytes are added one at a time
 * through a search box, the way the Streamlit original worked, with the
 * out-of-range ones offered as one-click chips because those are what a doctor
 * opens this for.
 */
import { useEffect, useMemo, useState } from "react";
import AboutParam, { type About } from "./AboutParam";
import Mark from "./Mark";
import AnalytePicker, { type PickerOption } from "./AnalytePicker";
import { TrendChart } from "@bw/ui-kit";
import Flag from "./Flag";
import {
  czExact,
  czNum,
  czRange,
  latestTwo,
  numericPoints,
  suspectPoints,
  unconfirmedPoints,
  latestCensoredOut,
  type Trend,
  count,
  czDate,
  plural,
  prettyUnit,
} from "@bw/lab-core";

/** Out-of-range latest result first — the rows a doctor scans for. */
function sortTrends(trends: Trend[]): Trend[] {
  return [...trends].sort((a, b) => {
    const oa = outNow(a) ? 0 : 1;
    const ob = outNow(b) ? 0 : 1;
    return oa - ob || a.displayName.localeCompare(b.displayName, "cs");
  });
}

function outNow(t: Trend): boolean {
  if (latestCensoredOut(t)) return true;
  const np = numericPoints(t);
  const last = np[np.length - 1];
  return !!last && (last.flag === "high" || last.flag === "low");
}

/** The suffix the picker shows after a name, if the analyte needs attention. */
function noteFor(t: Trend): string | undefined {
  if (outNow(t)) return "mimo rozmezí";
  if (suspectPoints(t).length) return "čeká na ověření";
  if (unconfirmedPoints(t).length) return "nepotvrzeno";
  return undefined;
}

export default function TrendsTab({
  trends,
  unmappedNames = [],
  open = null,
  onVerify,
  aboutOf,
  unrecognised,
  labOf,
  onAssign,
}: {
  trends: Map<string, Trend>;
  unmappedNames?: string[];
  /**
   * Readings no parameter claims, each lab's printed name in its unit as a
   * series of its own (`buildTrends` `opts.unrecognised`) — a separate map,
   * so they are listed, picked and drawn apart from the recognised ones and
   * never on the same chart. Undefined (VITE_UNRECOGNISED_TRENDS off): the
   * tab is exactly as before, with its „N parametrů se nezobrazuje".
   */
  unrecognised?: Map<string, Trend>;
  /** The lab an unrecognised series was printed by, for its card. */
  labOf?: (t: Trend) => string | null;
  /** „Přiřadit ke známému parametru" on an unrecognised series' card. */
  onAssign?: (t: Trend) => void;

  /** Opens Ověření at one printed row — the way out of a doubted value. */
  onVerify?: (reportId: string, rawName: string) => void;
  /** A parameter another screen asked to see; `seq` makes a repeat a new ask. */
  open?: { id: string; seq: number } | null;
  /** The catalog's two sentences about a parameter, for the "i" after its name. */
  aboutOf?: (canonicalId: string) => About | undefined;
}) {
  const unmappedCount = unmappedNames.length;
  const known = useMemo(() => sortTrends([...trends.values()]), [trends]);
  const unknown = useMemo(
    () => [...(unrecognised?.values() ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName, "cs")),
    [unrecognised],
  );
  // One list for the picker and the cards, the recognised first; a series
  // keeps its own kind wherever it goes (`recognised: false`).
  const all = useMemo(() => [...known, ...unknown], [known, unknown]);
  // Chosen analytes, in the order they were added.
  const [shownIds, setShownIds] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (open) setShownIds((prev) => (prev.includes(open.id) ? prev : [open.id, ...prev]));
  }, [open]);

  if (all.length === 0)
    return <p className="sub">Zatím není co zobrazit — reporty nemají datum odběru nebo přiřazené parametry.</p>;

  const shown = shownIds
    .map((id) => all.find((t) => t.canonicalId === id))
    .filter((t): t is Trend => !!t);

  // Already-shown analytes drop out of the list: offering to add a second copy
  // of what is on screen is a dead option.
  const options: PickerOption[] = all
    .filter((t) => !shownIds.includes(t.canonicalId))
    .map((t) => ({
      id: t.canonicalId,
      label: t.displayName,
      note: t.recognised === false ? "nerozpoznáno" : noteFor(t),
      outOfRange: t.recognised === false ? false : outNow(t),
    }));

  const add = (id: string) => {
    setShownIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setPicking(false);
  };

  const suggested = known.filter(outNow).slice(0, 6);

  return (
    <>
      <div className="card toolbar-card">
        {unrecognised && unknown.length > 0 && (
          <p className="sub" style={{ marginTop: 0 }}>
            {count(unknown.length, "název", "názvy", "názvů")} z laboratoře zatím nerozpoznáváme — každý má vlastní graf
            pod svým názvem, označený <span className="chip unrec">nerozpoznáno</span>, a s ostatními parametry
            se nemíchá. Přiřadit ho můžete přímo u grafu nebo v záložce <strong>Přiřazení</strong>.
          </p>
        )}
        {!unrecognised && unmappedCount > 0 && (
          <p className="sub" style={{ marginTop: 0 }}>
            Pozor: {count(unmappedCount, "parametr se", "parametry se", "parametrů se")}{" "}
            {plural(unmappedCount, "nezobrazuje", "nezobrazují", "nezobrazuje")} — zatím
            {plural(unmappedCount, " nemá", " nemají", " nemá")} přiřazený název. Najdete
            {plural(unmappedCount, " ho", " je", " je")} v záložce{" "}
            <strong>Přiřazení názvů</strong>: {unmappedNames.join(", ")}.
          </p>
        )}
        <div className="toolbar">
          <span className="muted">
            {shown.length === 0
              ? `K dispozici ${count(all.length, "parametr", "parametry", "parametrů")}`
              : `Zobrazeno ${shown.length} z ${all.length}`}
          </span>
          <span className="spacer" />
          {shown.length > 0 && (
            <button className="btn small" onClick={() => setShownIds([])}>
              Vyčistit
            </button>
          )}
          <div className="picker-wrap">
            <button
              className="btn accent small"
              aria-expanded={picking}
              disabled={options.length === 0}
              onClick={() => setPicking((p) => !p)}
            >
              Zobrazit parametr
            </button>
            {picking && (
              <AnalytePicker options={options} onPick={add} onClose={() => setPicking(false)} />
            )}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card empty-pick">
          <h2>Vyberte parametr</h2>
          <p className="sub">
            Graf se vykreslí, až si nějaký parametr vyberete — tlačítkem{" "}
            <strong>Zobrazit parametr</strong> a psaním názvu. Zobrazit jich můžete
            kolik chcete, vykreslí se pod sebou.
          </p>
          {suggested.length > 0 && (
            <>
              <p className="section-title">Mimo referenční rozmezí</p>
              <div className="suggestions">
                {suggested.map((t) => (
                  <button key={t.canonicalId} className="btn small" onClick={() => add(t.canonicalId)}>
                    {t.displayName} <span className="chip alert">mimo rozmezí</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {unknown.length > 0 && (
            <>
              <p className="section-title">Zatím nerozpoznané</p>
              <div className="suggestions">
                {unknown.map((t) => (
                  <button key={t.canonicalId} className="btn small" onClick={() => add(t.canonicalId)}>
                    {t.displayName} <span className="chip unrec">nerozpoznáno</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className={`trend-grid${shown.length > 1 ? " multi" : ""}`}>
          {shown.map((given) => {
            // An unrecognised series is judged by nothing: its range is the
            // lab's printed one, shown as a fact, and no reading is called in
            // or out of it — not in the headline, the chart or the table.
            const unrec = given.recognised === false;
            const t = unrec ? { ...given, points: given.points.map((p) => ({ ...p, flag: "unknown" as const })) } : given;
            return (
              <div className={t.recognised === false ? "card trend-card unrec" : "card trend-card"} key={t.canonicalId}>
                <h3>
                  <span>{t.displayName}</span>
                  {t.recognised === false ? (
                    <span className="chip unrec">nerozpoznáno</span>
                  ) : (
                    <>
                      <AboutParam name={t.displayName} about={aboutOf?.(t.canonicalId)} />
                      <Mark id={t.canonicalId} />
                    </>
                  )}
                  {t.unit && <span className="unit">{prettyUnit(t.unit)}</span>}
                  <span className="spacer" />
                  {t.recognised !== false && outNow(t) && <span className="chip alert">mimo rozmezí</span>}
                  <button
                    className="rl-x"
                    aria-label={`Odebrat ${t.displayName} ze zobrazení`}
                    title="Odebrat ze zobrazení"
                    onClick={() => setShownIds((prev) => prev.filter((id) => id !== t.canonicalId))}
                  >
                    ✕
                  </button>
                </h3>

                {/* Its own series, under the lab's name: said in words, with the
                    way to the parameter it may be. */}
                {t.recognised === false && (
                  <div className="unrec-note">
                    <p>
                      Tento název{labOf?.(t) ? <> z laboratoře <strong>{labOf(t)}</strong></> : null} zatím neumíme
                      přiřadit k žádnému známému parametru. Graf ukazuje jen jeho vlastní hodnoty a rozmezí, které
                      vytiskla laboratoř.
                    </p>
                    {onAssign && (
                      <button type="button" className="btn small" onClick={() => onAssign(t)}>
                        Přiřadit ke známému parametru
                      </button>
                    )}
                  </div>
                )}

                {/* A reading held out of the series has to be visible here, not
                    only in Ověření. This is the screen a patient is shown, and a
                    value silently missing is only marginally better than a wrong
                    value silently drawn. */}
                {suspectPoints(t).map((p, i) => (
                  <p key={i} className="held-back">
                    ⚠ {czDate(p.date)}: <strong>{czExact(p.value, p.valueRaw)}</strong>{" "}
                    {prettyUnit(t.unit)} není v grafu — hodnota čeká na ověření v záložce{" "}
                    <strong>Ověření</strong>.
                  </p>
                ))}

                {/* Plotted but unconfirmed: named here, because a hollow dot alone
                    is a convention the reader has not been taught. */}
                {unconfirmedPoints(t).length > 0 && (
                  <p className="unconfirmed-note">
                    Nepotvrzené hodnoty v grafu (kroužek):{" "}
                    {unconfirmedPoints(t)
                      .map((p) => `${czDate(p.date)} — ${czExact(p.value, p.valueRaw)}`)
                      .join("; ")}
                    . Ověřte je prosím v záložce <strong>Ověření</strong>.
                  </p>
                )}

                {/* Readings in a unit nothing converts to this one: out of the
                    chart, and said so, rather than drawn as a jump. */}
                {t.otherUnits && (
                  <p className="held-back">
                    ⚠ Mimo graf:{" "}
                    {Object.entries(t.otherUnits)
                      .map(([u, n]) => `${n} měření v jednotce ${prettyUnit(u)}`)
                      .join(", ")}{" "}
                    — {Object.keys(t.otherUnits).length > 1 ? "tyto jednotky" : "tuto jednotku"} neumíme převést na {prettyUnit(t.unit)}.
                  </p>
                )}

                <StatLine trend={t} verdicts={!unrec} />
                <TrendChart
                  trend={t}
                  onVerify={onVerify && ((p) => onVerify(p.reportId, p.rawName))}
                  {...(unrec ? { verdicts: false, rangeNote: "(dle laboratoře)" } : {})}
                />
                <details className="tc-table" style={{ marginTop: 8 }}>
                  <summary className="muted" style={{ cursor: "pointer" }}>
                    Tabulka hodnot
                  </summary>
                  {/* Four columns and no scroll box: on a phone the table is as
                      wide as the card and the dash in the range may wrap. The
                      fourth column is the way to the printed row — every
                      reading has one, not only the doubted ones. A value outside
                      its range is red, the way Souhrn's table says it, so the
                      state needs no column of its own; the link's label says
                      it in words for a reader who cannot see the red. */}
                  <table>
                    <thead>
                      <tr>
                        <th>Datum</th>
                        <th className="num">Hodnota</th>
                        <th className="num">Rozmezí</th>
                        <th className="tc-verify">Ověření</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.points.map((p, i) => {
                        const out = p.flag === "high" || p.flag === "low";
                        return (
                          <tr key={i}>
                            <td className="tc-date">{czDate(p.date)}</td>
                            {/* As printed — this table is checkable against the
                                source, so it must not round. */}
                            <td className="num">
                              <strong className={out ? "out" : undefined}>{czExact(p.value, p.valueRaw)}</strong>
                              {p.convertedFrom && (
                                <span className="muted" style={{ display: "block", fontSize: "0.85em" }}>
                                  převedeno z {czExact(p.convertedFrom.value)} {prettyUnit(p.convertedFrom.unit)}
                                </span>
                              )}
                            </td>
                            <td className="muted num tc-range">
                              {p.refLow !== null || p.refHigh !== null ? czRange(p.refLow, p.refHigh) : "—"}
                            </td>
                            <td className="tc-verify">
                              {onVerify && (
                                <button
                                  type="button"
                                  className="btn linkish verify-go"
                                  onClick={() => onVerify(p.reportId, p.rawName)}
                                  title="Ukázat řádek na zdrojové stránce"
                                  aria-label={`Ověřit ${t.displayName} z ${czDate(p.date)}${
                                    out ? (p.flag === "high" ? " (nad rozmezím)" : " (pod rozmezím)") : ""
                                  } na zdrojové stránce`}
                                >
                                  ověřit →
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** The current value, its status, the step since the previous draw, the range. */
function StatLine({ trend, verdicts = true }: { trend: Trend; verdicts?: boolean }) {
  const [older, newer] = latestTwo(trend);
  // The newest result is a bound (">200"): it is the headline, not the older
  // number behind it.
  const bound = latestCensoredOut(trend);
  if (bound)
    return (
      <div className="tc-stat">
        <span className="big out">
          {bound.valueRaw} <span className="unit">{prettyUnit(trend.unit)}</span>
        </span>
        <Flag flag={bound.flag} />
        <span className="range">
          {czDate(bound.date)}
          {bound.refLow !== null || bound.refHigh !== null ? ` · rozmezí ${czRange(bound.refLow, bound.refHigh)}` : ""} · bez přesné hodnoty, v grafu není
        </span>
      </div>
    );
  if (!newer) return null;
  const out = newer.flag === "high" || newer.flag === "low";
  const delta = older ? (newer.value as number) - (older.value as number) : null;
  const pct = older && older.value ? Math.round((Math.abs(delta as number) / Math.abs(older.value)) * 100) : null;
  const range = newer.refLow !== null || newer.refHigh !== null ? `rozmezí ${czRange(newer.refLow, newer.refHigh)}${verdicts ? "" : " (dle laboratoře)"}` : null;
  return (
    <div className="tc-stat">
      <span className={`big${out ? " out" : ""}`}>
        {czExact(newer.value, newer.valueRaw)} <span className="unit">{prettyUnit(trend.unit)}</span>
      </span>
      {verdicts && <Flag flag={newer.flag} />}
      {older && delta !== null && (
        <span className="delta">
          {delta > 0 ? "↗ +" : delta < 0 ? "↘ −" : ""}
          {czNum(Math.abs(delta))}
          {pct !== null && pct > 0 ? ` (${delta > 0 ? "+" : "−"}${pct} %)` : ""} od {czDate(older.date)}
        </span>
      )}
      <span className="range">
        {czDate(newer.date)}
        {range ? ` · ${range}` : ""}
      </span>
    </div>
  );
}
