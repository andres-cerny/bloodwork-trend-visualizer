/**
 * App shell. All state is in memory — reload and the session is gone, which is
 * the privacy guarantee the demo makes rather than a limitation to work around.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildChatContext, getStatus, type Budget } from "./lib/api";
import type { AnalyteDef, LabReport, Measurement } from "./lib/models";
import { Registry } from "./lib/registry";
import { buildTrends } from "./lib/trends";
import { reviewOf } from "./lib/review";
import { count, czDate } from "./lib/czech";
import { distinctIdentities } from "./lib/identity";
import ChatPanel from "./ui/ChatPanel";
import MappingTab from "./ui/MappingTab";
import SummaryTab from "./ui/SummaryTab";
import TrendsTab from "./ui/TrendsTab";
import Modal from "./ui/Modal";
import UploadPanel from "./ui/UploadPanel";
import VerifyTab from "./ui/VerifyTab";

type TabId = "trends" | "summary" | "verify" | "mapping";
const TABS: Array<[TabId, string]> = [
  ["trends", "📈 Trendy"],
  ["summary", "📝 Souhrn změn"],
  ["verify", "🔍 Ověření"],
  ["mapping", "🗂️ Přiřazení názvů"],
];

export default function App() {
  const [reports, setReports] = useState<LabReport[]>([]);
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [tab, setTab] = useState<TabId>("trends");
  const [budget, setBudget] = useState<Budget | null>(null);
  const [maxPages, setMaxPages] = useState(12);
  const [unlocked, setUnlocked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped on every mapping acceptance: the Registry is mutable, so trends
  // need an explicit signal to rebuild.
  const [registryVersion, setRegistryVersion] = useState(0);
  // Set when the mapping tab asks to show a row in its source document.
  const [focus, setFocus] = useState<{ reportId: string; rawName: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // The pristine demo payload, so "vymazat" is undoable for the sample data
  // (it is not for an upload — that would cost another extraction).
  const demo = useRef<{ reports: LabReport[]; defs: AnalyteDef[] } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [rs, defs] = await Promise.all([
          fetch("/demo/reports.json").then((r) => r.json() as Promise<LabReport[]>),
          fetch("/demo/registry.json").then((r) => r.json() as Promise<AnalyteDef[]>),
        ]);
        demo.current = { reports: rs, defs };
        setRegistry(new Registry(defs));
        setReports(rs);
      } catch {
        setLoadError("Ukázková data se nepodařilo načíst.");
      }
    })();
    getStatus()
      .then((s) => {
        setBudget(s.budget);
        setMaxPages(s.maxPages);
      })
      .catch(() => {
        /* status is best-effort; the pre-baked demo works without it */
      });
  }, []);

  /** Curated interval for an analyte, when the table covers it. */
  const curatedRange = useCallback(
    (cid: string | null) => {
      const r = cid && registry ? registry.get(cid)?.referenceRange : null;
      return r ? { low: r[0], high: r[1] } : null;
    },
    [registry],
  );

  const trends = useMemo(
    () =>
      registry
        ? buildTrends(
            reports,
            (cid) => registry.displayName(cid),
            // A reading believed wrong is held out of the series; one that is
            // merely unconfirmed is plotted and marked. Both come from the
            // same authority the verification table uses, so a doubt cannot be
            // shown on one screen and dropped on the other.
            (m) => {
              const r = reviewOf(m, curatedRange);
              return r.level === "withheld" ? r.reason : null;
            },
            (m) => {
              const r = reviewOf(m, curatedRange);
              return r.level === "unconfirmed" ? r.reason : null;
            },
          )
        : new Map(),
    [reports, registry, registryVersion, curatedRange],
  );

  const correct = useCallback((reportId: string, index: number, next: Measurement) => {
    setReports((prev) =>
      prev.map((r) =>
        r.id !== reportId
          ? r
          : { ...r, measurements: r.measurements.map((m, i) => (i === index ? next : m)) },
      ),
    );
  }, []);

  const acceptMapping = useCallback(
    (rawName: string, canonicalId: string) => {
      if (!registry) return;
      registry.addSynonym(canonicalId, rawName);
      setReports((prev) =>
        prev.map((r) => ({
          ...r,
          measurements: r.measurements.map((m) =>
            m.rawAnalyteName === rawName ? { ...m, canonicalId } : m,
          ),
        })),
      );
      setRegistryVersion((v) => v + 1);
    },
    [registry],
  );

  /**
   * Rebuild the Registry from the shipped definitions, dropping every synonym
   * accepted during the session. Clearing the data but keeping "this lab calls
   * it S_ALT" would leave a mapping decision applying to a patient it was never
   * made for.
   */
  const freshRegistry = useCallback(() => {
    if (demo.current) setRegistry(new Registry(demo.current.defs));
    setRegistryVersion((v) => v + 1);
  }, []);

  const clearAll = useCallback(() => {
    setReports([]);
    setFocus(null);
    setConfirmClear(false);
    freshRegistry();
  }, [freshRegistry]);

  const restoreDemo = useCallback(() => {
    if (!demo.current) return;
    // Cloned, so a correction made after a restore cannot reach back into the
    // snapshot and make the next restore return something already edited.
    setReports(structuredClone(demo.current.reports));
    setFocus(null);
    freshRegistry();
  }, [freshRegistry]);

  /** Keep only the uploaded report — the answer to "this is a different patient". */
  const replaceAll = useCallback((report: LabReport) => {
    setReports([report]);
    setFocus(null);
  }, []);

  const chatContext = useMemo(() => buildChatContext(reports, trends), [reports, trends]);
  // Analytes excluded from every trend. Without saying so, "Všechny (20)" reads
  // as the complete picture while two measurements are quietly missing.
  const unmappedNames = useMemo(
    () => [
      ...new Set(
        reports.flatMap((r) =>
          r.measurements.filter((m) => m.canonicalId === null).map((m) => m.rawAnalyteName),
        ),
      ),
    ],
    [reports],
  );
  const frozen = budget?.frozen ?? false;
  // Whether any of the shipped synthetic reports are still loaded. The
  // "smyšlený pacient" reassurance must not sit above a real patient's results
  // once the demo data has been replaced by an upload.
  const hasDemoData = useMemo(
    () => reports.some((r) => demo.current?.reports.some((d) => d.id === r.id)),
    [reports],
  );
  // Taken from one report, together. Finding the name and the rodné číslo
  // independently used to be able to pair patient A's name with patient B's
  // number — a header that is wrong in the one place the reader trusts.
  const identities = useMemo(() => distinctIdentities(reports), [reports]);
  const patient = identities[0]?.name ?? null;
  const patientId = identities[0]?.id ?? null;
  const dateRange = useMemo(() => {
    const dates = reports.map((r) => r.reportDate).filter((d): d is string => !!d).sort();
    if (dates.length === 0) return null;
    const first = czDate(dates[0]);
    const last = czDate(dates[dates.length - 1]);
    return first === last ? first : `${first} – ${last}`;
  }, [reports]);

  const uploadedCount = reports.length - reports.filter((r) =>
    demo.current?.reports.some((d) => d.id === r.id),
  ).length;

  // One element, rendered from either branch below, so the upload path stays
  // reachable when there is nothing loaded to upload *against*.
  const uploadPanel = registry && (
    <UploadPanel
      registry={registry}
      frozen={frozen}
      maxPages={maxPages}
      reports={reports}
      onReport={(r) => setReports((prev) => [...prev, r])}
      onReplaceAll={replaceAll}
      onBudget={setBudget}
      onUnlock={() => setUnlocked(true)}
    />
  );

  return (
    <div className="wrap">
      <header className="top">
        <h1>Vývoj krevních testů</h1>
        <p>Přepis z laboratorního PDF, ověření proti zdroji a vývoj hodnot v čase.</p>
      </header>

      {loadError && <div className="banner warn">{loadError}</div>}

      {frozen && (
        <div className="banner warn">
          Demo vyčerpalo svůj rozpočet na AI funkce ({budget?.budgetUsd} USD). Nahrávání
          a chat jsou vypnuté; ukázková data níže fungují dál.
        </div>
      )}

      {/* Who this is, on every tab. With two patients' reports loaded, nothing
          on a trend screen otherwise says whose liver enzymes are shown — so
          that case is called out here rather than left to be inferred. Hidden
          entirely when nothing is loaded: an identity line reading "no data"
          is a second empty state competing with the real one below it. */}
      {reports.length > 0 && (
      <div className="patient-bar sticky">
        <span>
          <strong>{patient ?? "Neznámý pacient"}</strong>
          {patientId && <span className="muted"> · {patientId}</span>}
        </span>
        {identities.length > 1 && (
          <span className="chip alert">
            {count(identities.length, "pacient", "pacienti", "pacientů")} v jednom grafu
          </span>
        )}
        {dateRange && <span className="muted">{dateRange}</span>}
        <button className="btn linkish danger clear-all" onClick={() => setConfirmClear(true)}>
          Vymazat vše
        </button>
      </div>
      )}

      <div className="banner">
        {hasDemoData && (
          <>
            Ukázková data — <strong>smyšlený pacient</strong>, žádné reálné zdravotní údaje.
            <br />
          </>
        )}
        Vlastní PDF se čte ve vašem prohlížeči a nikam se neukládá. <strong>Obrázky
        stránek — včetně hlavičky se jménem a rodným číslem — se ale posílají ke
        zpracování na Anthropic API</strong> a projdou serverem této ukázky. Po zavření
        stránky po nich tady nezůstane stopa.
      </div>

      {reports.length > 0 && (
        <div className="tabs-wrap">
          <nav className="tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
        </div>
      )}

      {!registry ? (
        <p className="muted">Načítám…</p>
      ) : reports.length === 0 ? (
        // Four empty tabs and an empty chat read as a broken app. With nothing
        // loaded there is exactly one useful thing on the page — a way to load
        // something — so that is all it shows.
        <>
          <div className="card empty-state">
            <h2>Žádná načtená data</h2>
            <p className="sub">Grafy, souhrn i ověření se objeví, jakmile nahrajete PDF.</p>
            {demo.current && (
              <button className="btn" onClick={restoreDemo}>
                Načíst ukázková data
              </button>
            )}
          </div>
          {uploadPanel}
        </>
      ) : (
        <>
          {tab === "trends" && <TrendsTab trends={trends} unmappedNames={unmappedNames} />}
          {tab === "summary" && <SummaryTab trends={trends} />}
          {tab === "verify" && (
            <VerifyTab
              reports={reports}
              onCorrect={correct}
              focus={focus}
              displayName={(cid) => registry.displayName(cid)}
              curatedRange={curatedRange}
            />
          )}
          {tab === "mapping" && (
            <MappingTab
              reports={reports}
              registry={registry}
              onMap={acceptMapping}
              onShowSource={(reportId, rawName) => {
                setFocus({ reportId, rawName });
                setTab("verify");
              }}
            />
          )}

          <ChatPanel
            dataContext={chatContext}
            frozen={frozen}
            unlocked={unlocked}
            available={Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY)}
            onBudget={setBudget}
          />

          {uploadPanel}
        </>
      )}

      {confirmClear && (
        <Modal
          title="Vymazat všechna data?"
          onDismiss={() => setConfirmClear(false)}
          actions={[
            { label: "Vymazat", primary: true, onClick: clearAll },
            { label: "Zrušit", dismiss: true, onClick: () => setConfirmClear(false) },
          ]}
        >
          <p>
            Odstraní {count(reports.length, "načtený report", "načtené reporty", "načtených reportů")}{" "}
            včetně oprav a přiřazení názvů, která jste potvrdili.
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            {uploadedCount > 0
              ? `Ukázková data půjdou načíst zpět jedním kliknutím; ${count(uploadedCount, "nahraný PDF report", "nahrané PDF reporty", "nahraných PDF reportů")} by bylo nutné nahrát a přepsat znovu.`
              : "Ukázková data půjdou načíst zpět jedním kliknutím."}
          </p>
        </Modal>
      )}

      <p className="muted" style={{ marginTop: 18 }}>
        Hodnoty, jednotky i meze počítá deterministický kód, ne model. Model pouze
        přepisuje, co je vytištěno.
        {budget && !frozen && (
          <> · Rozpočet dema: {budget.spentUsd.toFixed(2)} / {budget.budgetUsd} USD</>
        )}
      </p>
    </div>
  );
}
