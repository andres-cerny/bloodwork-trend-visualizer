/**
 * „Jak čteme názvy z laboratoří": every decision that decides which trend a
 * printed name lands in, for this account — not a table of the database, but
 * the answer to „why is this value in that chart?".
 *
 * Grouped by laboratory, because that is how the person knows their reports
 * („the hospital lab", „the clinic"), and each line reads as a sentence:
 * printed name and unit → the parameter it counts as, and who decided —
 * the person (withdrawable) or „automaticky": the model (overrulable: a
 * person's decision always outranks a model's) or another account, which is
 * deliberately not told apart, so nothing hints that someone else has
 * reports from the same lab (shown without a button — the worker would
 * refuse a change). Under them, the
 * parameters the app added from the NČLP code table, each opening the same
 * sheet the „přidáno automaticky" mark opens.
 *
 * Lives in Reporty under „Váš účet, vaše data": the app has no settings
 * screen, and that card is where account-level things are. Shown only with
 * one of the mapping switches on (VITE_SHARE_AI_MAPPINGS, VITE_SECOND_OPINION,
 * VITE_AUTO_ENTRIES, VITE_UNRECOGNISED_TRENDS); with them off the app looks
 * exactly as before. There is no curator view: the app has no notion of an
 * administrator, so the shared list of every account's model decisions and
 * auto entries stays on the CLI (docs/plans/model-loop.md).
 */
import { useState } from "react";
import { type Registry, count, czDate, prettyUnit } from "@bw/lab-core";
import type { AutoEntry } from "../lib/api";
import { type NameDecision, type NameScope, WHO_CS, byLab, friendlyNclpName, specimenCs } from "../lib/decisions";

interface Props {
  decisions: NameDecision[];
  autos: Array<{ entry: AutoEntry; rows: NameScope[] }>;
  registry: Registry;
  /** A parameter's name as the app shows it. */
  nameOf: (canonicalId: string) => string;
  /** Take back one of this account's own decisions. */
  onWithdraw: (d: NameDecision) => void;
  /** An automatic decision the person disagrees with: opens the sheet. */
  onOverrule: (d: NameDecision) => void;
  /** An auto-added parameter: opens its sheet. */
  onAutoInfo: (code: string) => void;
}

const keyOf = (d: NameScope) => `${d.lab}\u0000${d.rawName}\u0000${d.unit}`;

export default function NamesCard({ decisions, autos, nameOf, onWithdraw, onOverrule, onAutoInfo }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const groups = byLab(decisions);
  const empty = decisions.length === 0 && autos.length === 0;

  return (
    <div className="card names-card">
      <div className="card-head">
        <div>
          <h2>Jak čteme názvy z laboratoří</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            Každá laboratoř píše názvy po svém. Tady vidíte, ke kterému parametru jsme který název z vašich
            zpráv přiřadili a kdo o tom rozhodl. Co nesedí, můžete vrátit — hodnoty se tím nemění, jen
            přejdou do jiného grafu.
          </p>
        </div>
      </div>

      {empty && <p className="muted" style={{ margin: 0 }}>Zatím nic — všechny názvy z vašich zpráv známe ze základního seznamu.</p>}

      {groups.map((g) => (
        <details key={g.lab || "-"} className="names-lab" open={groups.length === 1}>
          <summary>
            <span className="nl-lab">{g.lab || "Bez uvedené laboratoře"}</span>{" "}
            <span className="muted">· {count(g.items.length, "název", "názvy", "názvů")}</span>
          </summary>
          <ul className="names-list">
            {g.items.map((d) => {
              const k = keyOf(d);
              return (
                <li key={k}>
                  <p className="nl-line">
                    <span className="nl-raw">{d.rawName}</span>
                    {d.unit && <span className="muted"> {prettyUnit(d.unit)}</span>}
                    <span className="nl-arrow"> → </span>
                    {d.canonicalId ? <strong>{nameOf(d.canonicalId)}</strong> : <em className="muted">žádný parametr</em>}
                  </p>
                  <div className="nl-meta">
                    <span className={`who who-${d.who}`}>{WHO_CS[d.who]}</span>
                    {d.mine && d.who === "you" ? (
                      confirming === k ? (
                        <span className="nl-confirm">
                          <button type="button" className="btn small" onClick={() => {
                              setConfirming(null);
                              onWithdraw(d);
                            }}>
                            Vrátit
                          </button>
                          <button type="button" className="btn small" onClick={() => setConfirming(null)}>
                            Zrušit
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="btn small" onClick={() => setConfirming(k)} aria-label={`Vrátit zpět: ${d.rawName}`}>
                          Vrátit zpět
                        </button>
                      )
                    ) : d.who === "auto" ? (
                      d.where === "alias" ? (
                        d.overrulable && (
                        <button type="button" className="btn small" onClick={() => onOverrule(d)} aria-label={`Nesedí: ${d.rawName}`}>
                          Nesedí
                        </button>
                        )
                      ) : (
                        <button type="button" className="btn small" onClick={() => onWithdraw(d)} aria-label={`Vrátit zpět: ${d.rawName}`}>
                          Vrátit zpět
                        </button>
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      ))}

      {autos.length > 0 && (
        <>
          <p className="section-title">Parametry přidané automaticky</p>
          <p className="muted nl-note">
            Tyto parametry v našem seznamu nebyly; aplikace je našla v národním číselníku laboratorních
            položek (NČLP) podle názvu, jednotky a materiálu.
          </p>
          <ul className="names-list">
            {autos.map(({ entry, rows }) => (
              <li key={entry.code}>
                <p className="nl-line">
                  <strong>{friendlyNclpName(entry.nameCs)}</strong>
                  <span className="muted">
                    {" "}
                    · NČLP {entry.code}
                    {specimenCs(entry.material) && <> · {specimenCs(entry.material)}</>}
                    {entry.unit && <> · {prettyUnit(entry.unit)}</>}
                  </span>
                  <span className="nl-from muted">
                    z názvu {[...new Set(rows.map((r) => r.rawName))].join(", ")} · přidáno {czDate(entry.at.slice(0, 10))}
                  </span>
                </p>
                <div className="nl-meta">
                  <span className="who who-auto">automaticky</span>
                  <button type="button" className="btn small" onClick={() => onAutoInfo(entry.code)} aria-label={`Podrobnosti: ${friendlyNclpName(entry.nameCs)}`}>
                    Podrobnosti
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
