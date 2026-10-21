/**
 * One printed name, and what the person can decide about it — in a sheet,
 * because the question comes up on three screens (Trendy, Souhrn, Ověření)
 * and on the names list in Reporty, and the answer is the same everywhere.
 *
 * Three ways in:
 *
 *   unrecognised  a series Trendy shows under the lab's own name: which known
 *                 parameter is it? The evidence-backed suggestion first (the
 *                 same `suggestMappings` the mapping tab ranks with), any
 *                 parameter by search, and the full comparison one tap away
 *                 in Přiřazení.
 *   auto          a parameter the app added from the NČLP code table: what
 *                 that means, in words, and „nesedí to" — another parameter,
 *                 or none.
 *   decision      a decision made automatically (a saved model answer): the
 *                 same „nesedí to", which saves the person's own decision —
 *                 a person's always outranks a model's.
 *
 * The sheet decides nothing itself: it hands the printed names and the choice
 * to Portal, which files them through the same path a click in Přiřazení
 * takes (`acceptMapping`), or saves „not this parameter" for them.
 */
import { useMemo, useState } from "react";
import { type LabReport, type Registry, czDate, findUnmapped, observedStats, prettyUnit, suggestMappings, verdictOf } from "@bw/lab-core";
import type { AutoEntry } from "../lib/api";
import { type NameDecision, type NameScope, autoEntryId, friendlyNclpName, rowsUnder, specimenCs } from "../lib/decisions";
import AnalytePicker, { type PickerOption } from "./AnalytePicker";
import Sheet from "./Sheet";

export type NameSheetState =
  | { kind: "unrecognised"; rawName: string; lab: string; unit: string }
  | { kind: "auto"; code: string }
  | { kind: "decision"; d: NameDecision };

interface Props {
  state: NameSheetState;
  registry: Registry;
  /** A parameter's name as the app shows it. */
  nameOf: (canonicalId: string) => string;
  reports: LabReport[];
  autoEntries: AutoEntry[];
  /** Unrecognised readings have a trend of their own (VITE_UNRECOGNISED_TRENDS) — said when a name is let go. */
  unrecognisedShown: boolean;
  onAssign: (rows: NameScope[], canonicalId: string) => void;
  onLeave: (rows: NameScope[]) => void;
  /** To Přiřazení, where every signal for and against is laid out. */
  onOpenMapping?: () => void;
  onClose: () => void;
}

const fromLab = (lab: string) => (lab ? <> z laboratoře <strong>{lab}</strong></> : null);

export default function NameSheet({ state, registry, nameOf, reports, autoEntries, unrecognisedShown, onAssign, onLeave, onOpenMapping, onClose }: Props) {
  const [picking, setPicking] = useState(false);

  const current = state.kind === "auto" ? autoEntryId(state.code) : state.kind === "decision" ? state.d.canonicalId : null;
  const options: PickerOption[] = useMemo(
    () =>
      [...registry.analytes.values()]
        .filter((d) => d.canonicalId !== current)
        .map((d) => ({ id: d.canonicalId, label: nameOf(d.canonicalId) }))
        .sort((x, y) => x.label.localeCompare(y.label, "cs")),
    [registry, current, nameOf],
  );

  const picker = (rows: NameScope[], label: string) =>
    picking ? (
      <AnalytePicker inline label="Přiřadit k parametru" options={options} onPick={(id) => onAssign(rows, id)} onClose={() => setPicking(false)} />
    ) : (
      <button type="button" className="btn" onClick={() => setPicking(true)}>
        {label}
      </button>
    );

  if (state.kind === "unrecognised") {
    const rows: NameScope[] = [{ rawName: state.rawName, lab: state.lab, unit: state.unit }];
    return <UnrecognisedBody state={state} rows={rows} registry={registry} reports={reports} picker={picker} onAssign={onAssign} onOpenMapping={onOpenMapping} onClose={onClose} />;
  }

  const letGo = unrecognisedShown
    ? "Hodnoty pak uvidíte zvlášť, pod názvem z laboratoře."
    : "Hodnoty zůstanou uložené u svého dokumentu v Ověření, jen se nezobrazí v trendech.";

  if (state.kind === "auto") {
    const entry = autoEntries.find((e) => e.code === state.code);
    const rows = rowsUnder(reports, autoEntryId(state.code));
    const name = entry ? friendlyNclpName(entry.nameCs) : nameOf(autoEntryId(state.code));
    const specimen = specimenCs(entry?.material);
    const printed = rows.length ? [...new Set(rows.map((r) => r.rawName))] : entry ? [entry.rawName] : [];
    const labs = [...new Set(rows.map((r) => r.lab).filter(Boolean))];
    return (
      <Sheet title={name} onClose={onClose} className="name-sheet">
        <p className="ns-lead">
          <span className="auto-mark static">přidáno automaticky</span>
        </p>
        <p>
          Tento parametr v našem základním seznamu nebyl. Aplikace ho podle názvu z laboratoře, jednotky a
          materiálu našla v <strong>Národním číselníku laboratorních položek</strong> (NČLP) — seznamu,
          podle kterého si české laboratoře předávají výsledky — a přidala ho sama, aby se vaše hodnoty
          mohly ukázat v trendu.
        </p>
        <dl className="ns-facts">
          <dt>Položka číselníku</dt>
          <dd>
            {state.code}
            {entry && entry.nameCs !== name && <span className="muted"> · {entry.nameCs}</span>}
          </dd>
          {specimen && (
            <>
              <dt>Materiál</dt>
              <dd>{specimen}</dd>
            </>
          )}
          {entry?.unit && (
            <>
              <dt>Jednotka</dt>
              <dd>{prettyUnit(entry.unit)}</dd>
            </>
          )}
          {printed.length > 0 && (
            <>
              <dt>Název ve zprávě</dt>
              <dd>
                {printed.join(", ")}
                {labs.length > 0 && <span className="muted"> · {labs.join(", ")}</span>}
              </dd>
            </>
          )}
          {entry?.at && (
            <>
              <dt>Přidáno</dt>
              <dd>{czDate(entry.at.slice(0, 10))}</dd>
            </>
          )}
        </dl>
        <p>
          <strong>Co to pro vás znamená:</strong> hodnoty jsou přesně ty, které vytiskla laboratoř, a
          rozmezí je to z vaší zprávy. Chybí jen náš krátký popis parametru.
        </p>
        <Wrong rows={rows} canLeave={rows.length > 0} letGo={letGo} picker={picker} onLeave={onLeave} />
      </Sheet>
    );
  }

  const d = state.d;
  const rows: NameScope[] = [{ rawName: d.rawName, lab: d.lab, unit: d.unit }];
  return (
    <Sheet title={d.rawName} onClose={onClose} className="name-sheet">
      <p>
        Tento název{fromLab(d.lab)}
        {d.unit && <> v jednotce {prettyUnit(d.unit)}</>} jsme automaticky{" "}
        {d.canonicalId ? (
          <>
            přiřadili k parametru <strong>{nameOf(d.canonicalId)}</strong>.
          </>
        ) : (
          <>nechali bez přiřazení.</>
        )}{" "}
        Vaše rozhodnutí má vždy přednost před automatickým.
      </p>
      <Wrong rows={rows} canLeave={d.canonicalId !== null} letGo={letGo} picker={picker} onLeave={onLeave} />
    </Sheet>
  );
}

/** „Nesedí to?": another parameter, or none. */
function Wrong({ rows, canLeave, letGo, picker, onLeave }: { rows: NameScope[]; canLeave: boolean; letGo: string; picker: (rows: NameScope[], label: string) => React.ReactNode; onLeave: (rows: NameScope[]) => void }) {
  const labs = [...new Set(rows.map((r) => r.lab).filter(Boolean))];
  return (
    <div className="ns-wrong">
      <p className="section-title">Nesedí to?</p>
      <p className="muted">
        Jde-li o jiné vyšetření, přiřaďte název správnému parametru{canLeave ? <>, nebo ho nechte bez přiřazení. {letGo}</> : "."} Oprava platí
        pro tento název
        {labs.length === 1 ? " z této laboratoře — i pro ostatní, kdo z ní mají výsledky." : labs.length > 1 ? " z těchto laboratoří — i pro ostatní, kdo z nich mají výsledky." : "."}
      </p>
      <div className="ns-actions">
        {picker(rows, "Přiřadit jinému parametru…")}
        {canLeave && (
          <button type="button" className="btn" onClick={() => onLeave(rows)}>
            Nechat bez přiřazení
          </button>
        )}
      </div>
    </div>
  );
}

function UnrecognisedBody({
  state,
  rows,
  registry,
  reports,
  picker,
  onAssign,
  onOpenMapping,
  onClose,
}: {
  state: { rawName: string; lab: string; unit: string };
  rows: NameScope[];
  registry: Registry;
  reports: LabReport[];
  picker: (rows: NameScope[], label: string) => React.ReactNode;
  onAssign: (rows: NameScope[], canonicalId: string) => void;
  onOpenMapping?: () => void;
  onClose: () => void;
}) {
  // The suggestion the mapping tab would lead with — only when the evidence
  // backs it; a contradicted leader is not offered for one tap.
  const lead = useMemo(() => {
    const a = findUnmapped(reports).find((x) => x.rawName === state.rawName);
    if (!a) return null;
    const c = suggestMappings(a, registry, observedStats(reports))[0];
    return c && verdictOf(c) !== "contradicted" ? c : null;
  }, [reports, registry, state.rawName]);

  return (
    <Sheet title={state.rawName} onClose={onClose} className="name-sheet">
      <p className="ns-lead">
        <span className="chip unrec">nerozpoznáno</span>
        {state.unit && <span className="muted">{prettyUnit(state.unit)}</span>}
      </p>
      <p>
        Tento název{fromLab(state.lab)} zatím neumíme přiřadit k žádnému známému parametru, proto má vlastní
        graf a s ostatními se nemíchá. Víte-li, o jaký parametr jde, přiřaďte ho — hodnoty se připojí k
        jeho trendu. Přiřazení můžete kdykoli vrátit.
      </p>
      {lead && (
        <>
          <p className="section-title">Doporučené přiřazení</p>
          <div className="ns-lead-cand">
            <span>
              <strong>{lead.displayName}</strong>
              {verdictOf(lead) === "recommended" && <span className="chip best">doporučeno</span>}
            </span>
            <button type="button" className="btn primary" onClick={() => onAssign(rows, lead.canonicalId)}>
              Přiřadit
            </button>
          </div>
        </>
      )}
      <p className="section-title">{lead ? "Jiný parametr" : "Známý parametr"}</p>
      <div className="ns-actions">{picker(rows, "Vybrat parametr…")}</div>
      {onOpenMapping && (
        <p className="muted ns-more">
          Co pro které přiřazení mluví a co proti, ukazuje{" "}
          <button type="button" className="btn linkish" onClick={onOpenMapping}>
            záložka Přiřazení
          </button>
          .
        </p>
      )}
    </Sheet>
  );
}
