/**
 * App shell. All state is in memory — reload and the session is gone, which is
 * the privacy guarantee the demo makes rather than a limitation to work around.
 *
 * Layout: a permanent left rail for everything to do with *which* documents are
 * loaded (upload, the list, clearing them) and a reading area on the right for
 * everything to do with what they say. That split is the one the Streamlit
 * original had, and it is the right one — ingest is a side activity you return
 * to, not a card that sits at the bottom of every screen you read.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildChatContext, getStatus, type Budget } from "./lib/api";
import type { AnalyteDef, LabReport, Measurement } from "./lib/models";
import { Registry } from "./lib/registry";
import { buildTrends } from "./lib/trends";
import { reviewOf } from "./lib/review";
import { czDate } from "./lib/czech";
import ChatPanel from "./ui/ChatPanel";
import MappingTab from "./ui/MappingTab";
import Sidebar from "./ui/Sidebar";
import ThemeSwitch from "./ui/ThemeSwitch";
import SummaryTab from "./ui/SummaryTab";
import TrendsTab from "./ui/TrendsTab";
import VerifyTab from "./ui/VerifyTab";

type TabId = "trends" | "summary" | "verify" | "mapping" | "chat";
const TABS: Array<[TabId, string]> = [
  ["trends", "📈 Trendy"],
  ["summary", "📝 Souhrn změn"],
  ["verify", "🔍 Ověření"],
  ["mapping", "🗂️ Přiřazení názvů"],
  ["chat", "💬 Zeptat se"],
];

/**
 * One tab panel. Rendered whether or not it is the active tab; `hidden` is what
 * takes it off the screen, so its subtree keeps its state while the reader is
 * looking at something else.
 *
 * `hidden` rather than a CSS class because it also removes the panel from the
 * accessibility tree and from sequential focus — a class that only sets
 * `display: none` would need all three behaviours re-implemented, and a
 * keyboard user tabbing into an invisible panel is the failure that follows
 * from getting it wrong.
 */
function Panel({
  id,
  active,
  children,
}: {
  id: TabId;
  active: TabId;
  children: React.ReactNode;
}) {
  return (
    <div
      id={`tabpanel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      hidden={active !== id}
    >
      {children}
    </div>
  );
}

export default function App() {
  const [reports, setReports] = useState<LabReport[]>([]);
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [tab, setTab] = useState<TabId>("trends");
  const [budget, setBudget] = useState<Budget | null>(null);
  const [maxPages, setMaxPages] = useState(12);
  const [unlocked, setUnlocked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  // Bumped on every mapping acceptance: the Registry is mutable, so trends
  // need an explicit signal to rebuild.
  const [registryVersion, setRegistryVersion] = useState(0);
  // Set when another tab asks to show a row in its source document. `seq`
  // makes a repeat jump to the same row a new event rather than a no-op.
  const [focus, setFocus] = useState<{ reportId: string; rawName: string; seq: number } | null>(
    null,
  );
  // The shipped demo set, kept so "clear everything" is undoable. Clearing is
  // how you get rid of the sample patient before loading your own PDF; making
  // that a one-way door would be a trap.
  const demoReports = useRef<LabReport[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [rs, defs] = await Promise.all([
          fetch("/demo/reports.json").then((r) => r.json() as Promise<LabReport[]>),
          fetch("/demo/registry.json").then((r) => r.json() as Promise<AnalyteDef[]>),
        ]);
        setRegistry(new Registry(defs));
        demoReports.current = rs;
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

  // Escape closes the drawer — it covers most of a phone screen, so getting
  // out of it must not depend on hitting the sliver of scrim beside it.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

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
   * Withdraw a mapping just accepted.
   *
   * Symmetrical with acceptMapping: the synonym is unlearned and every
   * measurement carrying that raw name goes back to unmapped, so the analyte
   * reappears on this screen exactly as it was.
   */
  const undoMapping = useCallback(
    (rawName: string, canonicalId: string) => {
      if (!registry) return;
      registry.removeSynonym(canonicalId, rawName);
      setReports((prev) =>
        prev.map((r) => ({
          ...r,
          measurements: r.measurements.map((m) =>
            m.rawAnalyteName === rawName ? { ...m, canonicalId: null } : m,
          ),
        })),
      );
      setRegistryVersion((v) => v + 1);
    },
    [registry],
  );

  /** Open the verification tab on a specific transcribed row. */
  const showSource = useCallback((reportId: string, rawName: string) => {
    setFocus({ reportId, rawName, seq: Date.now() });
    setTab("verify");
    setDrawer(false);
  }, []);

  /**
   * Jump from an analyte to the row it was read from — used by the summary,
   * where the reader's next question about a surprising number is "where does
   * that come from". Resolves to the most recent report that carries it.
   */
  const showAnalyteSource = useCallback(
    (canonicalId: string) => {
      const ordered = [...reports].sort((a, b) =>
        (b.reportDate ?? "").localeCompare(a.reportDate ?? ""),
      );
      for (const r of ordered) {
        const m = r.measurements.find((x) => x.canonicalId === canonicalId);
        if (m) return showSource(r.id, m.rawAnalyteName);
      }
    },
    [reports, showSource],
  );

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
  const patient = reports.find((r) => r.patientName)?.patientName;
  const patientId = reports.find((r) => r.patientId)?.patientId;
  const dateRange = useMemo(() => {
    const dates = reports.map((r) => r.reportDate).filter((d): d is string => !!d).sort();
    if (dates.length === 0) return null;
    const first = czDate(dates[0]);
    const last = czDate(dates[dates.length - 1]);
    return first === last ? first : `${first} – ${last}`;
  }, [reports]);

  const hasData = reports.length > 0;
  const demoLoaded =
    demoReports.current.length > 0 &&
    reports.some((r) => demoReports.current.some((d) => d.id === r.id));

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="drawer-toggle"
          aria-expanded={drawer}
          aria-controls="rail"
          onClick={() => setDrawer((d) => !d)}
        >
          ☰ <span>Dokumenty</span>
        </button>
        <div className="brand">
          <span className="mark" aria-hidden="true">
            🩸
          </span>
          <span className="name">Vývoj krevních testů</span>
          <span className="sub">přepis · ověření · trend</span>
        </div>

        {/* Who this is, on every tab. With two patients' reports loaded,
            nothing on a trend screen otherwise says whose liver enzymes are
            shown — and a chart screenshotted for the record must carry it. */}
        <div className="patient-bar">
          {hasData ? (
            <>
              <span className="pname">{patient ?? "Neznámý pacient"}</span>
              {patientId && (
                <>
                  <span className="dot" aria-hidden="true">
                    ·
                  </span>
                  <span className="pid">{patientId}</span>
                </>
              )}
              {dateRange && <span className="prange">{dateRange}</span>}
            </>
          ) : (
            <span className="muted">Žádný pacient</span>
          )}
        </div>

        <ThemeSwitch />
      </header>

      <div className="shell">
        <button
          className={`scrim${drawer ? " open" : ""}`}
          aria-label="Zavřít panel dokumentů"
          tabIndex={drawer ? 0 : -1}
          onClick={() => setDrawer(false)}
        />
        <Sidebar
          id="rail"
          open={drawer}
          onClose={() => setDrawer(false)}
          reports={reports}
          registry={registry}
          frozen={frozen}
          budget={budget}
          maxPages={maxPages}
          demoLoaded={demoLoaded}
          canRestoreDemo={demoReports.current.length > 0}
          onReport={(r) => setReports((prev) => [...prev, r])}
          onBudget={setBudget}
          onUnlock={() => setUnlocked(true)}
          onRemove={(id) => setReports((prev) => prev.filter((r) => r.id !== id))}
          onClearAll={() => {
            setReports([]);
            setFocus(null);
          }}
          onRestoreDemo={() => setReports(demoReports.current)}
          // Opening a report is not the same as pointing at a row in it: no
          // row name, so verification switches document and waits.
          onPickReport={(id) => showSource(id, "")}
        />

        <main className="main">
          {/* No tabs with nothing loaded: every one of them leads to an empty
              screen, and offering four ways to see nothing is not a choice. */}
          {hasData && (
          <div className="tabs-wrap">
            {/* A real tablist: left/right move between tabs, which is what a
                keyboard user expects the moment the strip announces itself as
                one. */}
            <nav
              className="tabs"
              role="tablist"
              onKeyDown={(e) => {
                const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const i = TABS.findIndex(([id]) => id === tab);
                const next = TABS[(i + step + TABS.length) % TABS.length][0];
                setTab(next);
                const el = e.currentTarget.querySelectorAll("button")[
                  (i + step + TABS.length) % TABS.length
                ] as HTMLButtonElement | undefined;
                el?.focus();
              }}
            >
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  id={`tab-${id}`}
                  aria-controls={`tabpanel-${id}`}
                  aria-selected={tab === id}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
          )}

          {loadError && <div className="banner warn">{loadError}</div>}

          {frozen && (
            <div className="banner warn">
              Demo vyčerpalo svůj rozpočet na AI funkce ({budget?.budgetUsd} USD). Nahrávání
              a chat jsou vypnuté; ukázková data fungují dál.
            </div>
          )}

          {demoLoaded && (
            <div className="banner">
              <details>
                <summary>
                  Ukázková data — <strong>smyšlený pacient</strong>, žádné reálné
                  zdravotní údaje. Co se děje s vlastním PDF?
                </summary>
                <p>
                  Vlastní PDF se čte ve vašem prohlížeči a nikam se neukládá.{" "}
                  <strong>
                    Obrázky stránek — včetně hlavičky se jménem a rodným číslem — se ale
                    posílají ke zpracování na Anthropic API
                  </strong>{" "}
                  a projdou serverem této ukázky. Po zavření stránky po nich tady
                  nezůstane stopa.
                </p>
              </details>
            </div>
          )}

          {!registry ? (
            <p className="muted">Načítám…</p>
          ) : !hasData ? (
            <div className="empty">
              <div className="glyph" aria-hidden="true">
                🩸
              </div>
              <h2>Žádný načtený report</h2>
              <p>
                Nahrajte laboratorní PDF v levém panelu — přepíše se, ověří proti
                zdrojové stránce a vynese do grafu. Nebo se vraťte k ukázkovému
                pacientovi.
              </p>
              {demoReports.current.length > 0 && (
                <button className="btn accent" onClick={() => setReports(demoReports.current)}>
                  Načíst ukázková data
                </button>
              )}
              <button className="btn drawer-toggle" onClick={() => setDrawer(true)}>
                Otevřít panel dokumentů
              </button>
            </div>
          ) : (
            <>
              {/* Every panel stays mounted and the inactive ones are hidden,
                  rather than `tab === x && <Panel/>`. Unmounting took the
                  panel's state with it: the charts you had opened, the chat you
                  were having, a correction typed but not yet saved. Nine pieces
                  of state across five tabs, all of it work the reader had done.
                  Hiding is also what the tablist already promises — switching
                  tabs is meant to change the view, not discard it. */}
              <Panel id="trends" active={tab}>
                <TrendsTab trends={trends} unmappedNames={unmappedNames} />
              </Panel>
              <Panel id="summary" active={tab}>
                <SummaryTab trends={trends} onShowSource={showAnalyteSource} />
              </Panel>
              <Panel id="verify" active={tab}>
                <VerifyTab
                  reports={reports}
                  onCorrect={correct}
                  focus={focus}
                  displayName={(cid) => registry.displayName(cid)}
                  curatedRange={curatedRange}
                />
              </Panel>
              <Panel id="mapping" active={tab}>
                <MappingTab
                  reports={reports}
                  registry={registry}
                  onMap={acceptMapping}
                  onUndoMap={undoMapping}
                  onShowSource={showSource}
                />
              </Panel>
              <Panel id="chat" active={tab}>
                <ChatPanel
                  dataContext={chatContext}
                  frozen={frozen}
                  unlocked={unlocked}
                  available={Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY)}
                  onBudget={setBudget}
                />
              </Panel>

              <p className="muted" style={{ marginTop: 18 }}>
                Hodnoty, jednotky i meze počítá deterministický kód, ne model. Model pouze
                přepisuje, co je vytištěno.
                {budget && !frozen && (
                  <>
                    {" "}
                    · Rozpočet dema: {budget.spentUsd.toFixed(2)} / {budget.budgetUsd} USD
                  </>
                )}
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
