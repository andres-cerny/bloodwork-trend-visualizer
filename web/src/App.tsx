/**
 * App shell. All state is in memory — reload and the session is gone, which is
 * the privacy guarantee the demo makes rather than a limitation to work around.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildChatContext, getStatus, type Budget } from "./lib/api";
import type { AnalyteDef, LabReport, Measurement } from "./lib/models";
import { Registry } from "./lib/registry";
import { buildTrends } from "./lib/trends";
import { checkImplausible } from "./lib/implausible";
import { czDate } from "./lib/czech";
import ChatPanel from "./ui/ChatPanel";
import MappingTab from "./ui/MappingTab";
import SummaryTab from "./ui/SummaryTab";
import TrendsTab from "./ui/TrendsTab";
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

  useEffect(() => {
    (async () => {
      try {
        const [rs, defs] = await Promise.all([
          fetch("/demo/reports.json").then((r) => r.json() as Promise<LabReport[]>),
          fetch("/demo/registry.json").then((r) => r.json() as Promise<AnalyteDef[]>),
        ]);
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
            // A reading flagged as probably misread is held out of the plotted
            // series rather than drawn as a real result.
            (m) =>
              checkImplausible(
                m,
                curatedRange(m.canonicalId) ??
                  (m.refRangeLow !== null && m.refRangeHigh !== null
                    ? { low: m.refRangeLow, high: m.refRangeHigh }
                    : null),
              )?.reason ?? null,
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

  const chatContext = useMemo(() => buildChatContext(reports, trends), [reports, trends]);
  // Analytes excluded from every trend. Without saying so, "Všechny (20)" reads
  // as the complete picture while two measurements are quietly missing.
  const unmappedCount = useMemo(
    () => new Set(
      reports.flatMap((r) => r.measurements.filter((m) => m.canonicalId === null).map((m) => m.rawAnalyteName)),
    ).size,
    [reports],
  );
  const frozen = budget?.frozen ?? false;
  const patient = reports.find((r) => r.patientName)?.patientName;
  const patientId = reports.find((r) => r.patientId)?.patientId;
  const dateRange = useMemo(() => {
    const dates = reports.map((r) => r.reportDate).filter((d): d is string => !!d).sort();
    if (dates.length === 0) return null;
    const first = czDate(dates[0]);
    const last = czDate(dates[dates.length - 1]);
    return first === last ? first : `${first} – ${last}`;
  }, [reports]);

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
          on a trend screen otherwise says whose liver enzymes are shown. */}
      <div className="patient-bar">
        <span>
          <strong>{patient ?? "Neznámý pacient"}</strong>
          {patientId && <span className="muted"> · {patientId}</span>}
        </span>
        {dateRange && <span className="muted">{dateRange}</span>}
      </div>

      <div className="banner">
        Ukázková data — <strong>smyšlený pacient</strong>, žádné reálné zdravotní údaje.
        <br />
        Vlastní PDF se čte ve vašem prohlížeči a nikam se neukládá. <strong>Obrázky
        stránek — včetně hlavičky se jménem a rodným číslem — se ale posílají ke
        zpracování na Anthropic API</strong> a projdou serverem této ukázky. Po zavření
        stránky po nich tady nezůstane stopa.
      </div>

      <div className="tabs-wrap">
        <nav className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </div>

      {!registry ? (
        <p className="muted">Načítám…</p>
      ) : (
        <>
          {tab === "trends" && <TrendsTab trends={trends} unmappedCount={unmappedCount} />}
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

          <UploadPanel
            registry={registry}
            frozen={frozen}
            maxPages={maxPages}
            onReport={(r) => setReports((prev) => [...prev, r])}
            onBudget={setBudget}
            onUnlock={() => setUnlocked(true)}
          />
        </>
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
