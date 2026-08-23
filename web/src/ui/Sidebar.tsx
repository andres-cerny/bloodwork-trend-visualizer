/**
 * The left rail: everything about *which* documents are loaded.
 *
 * Upload sits at the top because it is the primary action; the list of loaded
 * reports sits under it because that is the answer to "what am I looking at",
 * and it is also where a report — or all of them — gets thrown away. The demo
 * previously had no way to clear the sample patient at all, so anyone trying
 * their own PDF ended up with their results mixed into a fictional person's.
 */
import { useState } from "react";
import type { Budget } from "@bw/api-client";
import { type LabReport, type Registry, czDate, count } from "@bw/lab-core";
import UploadPanel from "./UploadPanel";

interface Props {
  id: string;
  open: boolean;
  /** Closes the drawer. On a phone the rail covers most of the screen, so it
      needs a real close control — the strip of scrim left beside it is not a
      target anyone can hit reliably. */
  onClose: () => void;
  reports: LabReport[];
  registry: Registry | null;
  frozen: boolean;
  budget: Budget | null;
  maxPages: number;
  /** True while the shipped sample patient is among the loaded reports. */
  demoLoaded: boolean;
  canRestoreDemo: boolean;
  onReport: (r: LabReport) => void;
  onBudget: (b: Budget) => void;
  onUnlock: () => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onRestoreDemo: () => void;
  onPickReport: (id: string) => void;
}

export default function Sidebar({
  id,
  open,
  onClose,
  reports,
  registry,
  frozen,
  budget,
  maxPages,
  demoLoaded,
  canRestoreDemo,
  onReport,
  onBudget,
  onUnlock,
  onRemove,
  onClearAll,
  onRestoreDemo,
  onPickReport,
}: Props) {
  // Clearing everything is destructive and irreversible for an uploaded PDF —
  // the file is never stored, so re-processing it costs another API call. It
  // asks first.
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <aside id={id} className={`sidebar${open ? " open" : ""}`} aria-label="Dokumenty">
      <div className="rail-head">
        <span>Dokumenty</span>
        <button className="rl-x" onClick={onClose} aria-label="Zavřít panel">
          ✕
        </button>
      </div>

      <section className="rail-section">
        <h2>Nahrát PDF</h2>
        {registry ? (
          <UploadPanel
            registry={registry}
            frozen={frozen}
            maxPages={maxPages}
            onReport={onReport}
            onBudget={onBudget}
            onUnlock={onUnlock}
          />
        ) : (
          <p className="muted">Načítám…</p>
        )}
      </section>

      <section className="rail-section">
        <h2>
          Načtené reporty <span className="n">{reports.length}</span>
        </h2>

        {reports.length === 0 ? (
          <p className="muted" style={{ margin: "0 0 10px" }}>
            Zatím nic. Nahrajte PDF výše.
          </p>
        ) : (
          <ul className="reportlist">
            {reports.map((r) => (
              <li key={r.id}>
                <button
                  className="rl-main btn linkish"
                  style={{ textAlign: "left", textDecoration: "none", padding: "2px 0" }}
                  onClick={() => onPickReport(r.id)}
                  title="Otevřít v Ověření"
                >
                  <span className="rl-date" style={{ display: "block", color: "var(--ink-1)" }}>
                    {czDate(r.reportDate)}
                  </span>
                  <span className="rl-meta">
                    {r.labName ?? r.sourceFile} · {count(r.measurements.length, "hodnota", "hodnoty", "hodnot")}
                  </span>
                </button>
                <button
                  className="rl-x"
                  aria-label={`Odebrat report ${czDate(r.reportDate)}`}
                  title="Odebrat"
                  onClick={() => onRemove(r.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {reports.length > 0 &&
          (confirmClear ? (
            <div className="runlog" role="alert">
              <span>
                Opravdu odebrat {count(reports.length, "report", "reporty", "reportů")}? Nahrané
                PDF se nikde neukládá — načtení znovu stojí další zpracování.
              </span>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button
                  className="btn danger small"
                  onClick={() => {
                    onClearAll();
                    setConfirmClear(false);
                  }}
                >
                  Ano, odebrat vše
                </button>
                <button className="btn small" onClick={() => setConfirmClear(false)}>
                  Zrušit
                </button>
              </div>
            </div>
          ) : (
            <button className="btn danger wide small" onClick={() => setConfirmClear(true)}>
              Odebrat všechny reporty
            </button>
          ))}

        {!demoLoaded && canRestoreDemo && (
          <button
            className="btn wide small"
            style={{ marginTop: 6 }}
            onClick={onRestoreDemo}
          >
            Načíst ukázková data
          </button>
        )}
      </section>

      <div className="rail-foot">
        <p className="muted" style={{ margin: "8px 0 0" }}>
          {budget && !frozen ? (
            <>
              Rozpočet ukázky: {budget.spentUsd.toFixed(2)} / {budget.budgetUsd} USD ·{" "}
            </>
          ) : null}
          Data zůstávají jen ve vašem prohlížeči; po zavření stránky po nich tady
          nezůstane stopa.
        </p>
      </div>
    </aside>
  );
}
