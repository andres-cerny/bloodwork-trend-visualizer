/**
 * The logged-in app: one person's reports, and the screens over them.
 *
 * The screens are the bloodwork demo's — verification, trends, the change
 * summary, name mapping — because the clinical core is the same and those
 * four were argued over with clinicians (apps/bloodwork/docs/design-notes.md).
 * What is new is where the data lives: every report arrives from the account
 * and every change goes back to it, so the same trend is there on the next
 * device. The fresh, mobile-first layout is Phase 4; this shell is the
 * plainest thing that makes the round trip true.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AnalyteDef,
  type LabReport,
  type Measurement,
  Registry,
  buildTrends,
  count,
  czDate,
  reviewOf,
} from "@bw/lab-core";
import { ThemeSwitch } from "@bw/ui-kit";
import { type Budget, type Settings, deleteReport, getSettings, getStatus, listReports, logout, putReport, putSettings } from "../lib/api";
import MappingTab from "./MappingTab";
import SummaryTab from "./SummaryTab";
import TrendsTab from "./TrendsTab";
import UploadFlow from "./UploadFlow";
import VerifyTab from "./VerifyTab";

type TabId = "home" | "trends" | "summary" | "verify" | "mapping";
const TABS: Array<[TabId, string]> = [
  ["home", "🩸 Přehled"],
  ["trends", "📈 Trendy"],
  ["summary", "📝 Souhrn změn"],
  ["verify", "🔍 Ověření"],
  ["mapping", "🗂️ Přiřazení názvů"],
];

/** Mounted whether or not it is active; `hidden` keeps its state and takes it
 *  out of the accessibility tree — see apps/CLAUDE.md. */
function Panel({ id, active, children }: { id: TabId; active: TabId; children: React.ReactNode }) {
  return (
    <div id={`tabpanel-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} hidden={active !== id}>
      {children}
    </div>
  );
}

interface Props {
  email: string;
  onLogout: () => void;
}

export default function Portal({ email, onLogout }: Props) {
  const [reports, setReports] = useState<LabReport[]>([]);
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [learned, setLearned] = useState<Record<string, string[]>>({});
  const [tab, setTab] = useState<TabId>("home");
  const [budget, setBudget] = useState<Budget | null>(null);
  const [maxPages, setMaxPages] = useState(30);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [registryVersion, setRegistryVersion] = useState(0);
  const [focus, setFocus] = useState<{ reportId: string; rawName: string; seq: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [defs, rs, settings, status] = await Promise.all([
          fetch("/registry.json").then((r) => r.json() as Promise<AnalyteDef[]>),
          listReports(),
          getSettings(),
          getStatus(),
        ]);
        const reg = new Registry(defs);
        const l = (settings as Settings).learned ?? {};
        for (const [cid, names] of Object.entries(l)) for (const n of names) reg.addSynonym(cid, n);
        setRegistry(reg);
        setLearned(l);
        setReports(rs);
        setBudget(status.budget);
        setMaxPages(status.maxPages);
      } catch (e) {
        setLoadError(e instanceof Error && e.message === "Přihlaste se prosím." ? e.message : "Data se nepodařilo načíst. Zkuste stránku obnovit.");
      }
    })();
  }, []);

  /** Write a report back, and say so if that failed — a correction that
   *  only lived in this tab would be gone on the next device. */
  const persist = useCallback((r: LabReport) => {
    putReport(r).then(
      () => setSaveError(null),
      () => setSaveError("Změnu se nepodařilo uložit. Zkontrolujte připojení a zkuste to znovu."),
    );
  }, []);

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

  const correct = useCallback(
    (reportId: string, index: number, next: Measurement) => {
      setReports((prev) =>
        prev.map((r) => {
          if (r.id !== reportId) return r;
          const updated = { ...r, measurements: r.measurements.map((m, i) => (i === index ? next : m)) };
          persist(updated);
          return updated;
        }),
      );
    },
    [persist],
  );

  /** Re-map every report carrying a raw name, and keep the ones that changed. */
  const remap = useCallback(
    (rawName: string, canonicalId: string | null) => {
      setReports((prev) =>
        prev.map((r) => {
          if (!r.measurements.some((m) => m.rawAnalyteName === rawName)) return r;
          const updated = { ...r, measurements: r.measurements.map((m) => (m.rawAnalyteName === rawName ? { ...m, canonicalId } : m)) };
          persist(updated);
          return updated;
        }),
      );
      setRegistryVersion((v) => v + 1);
    },
    [persist],
  );

  const saveLearned = useCallback((next: Record<string, string[]>) => {
    setLearned(next);
    putSettings({ learned: next }).catch(() => setSaveError("Přiřazení se nepodařilo uložit."));
  }, []);

  const acceptMapping = useCallback(
    (rawName: string, canonicalId: string) => {
      if (!registry) return;
      registry.addSynonym(canonicalId, rawName);
      remap(rawName, canonicalId);
      saveLearned({ ...learned, [canonicalId]: [...(learned[canonicalId] ?? []).filter((n) => n !== rawName), rawName] });
    },
    [registry, remap, learned, saveLearned],
  );

  const undoMapping = useCallback(
    (rawName: string, canonicalId: string) => {
      if (!registry) return;
      registry.removeSynonym(canonicalId, rawName);
      remap(rawName, null);
      const rest = (learned[canonicalId] ?? []).filter((n) => n !== rawName);
      const next = { ...learned };
      if (rest.length) next[canonicalId] = rest;
      else delete next[canonicalId];
      saveLearned(next);
    },
    [registry, remap, learned, saveLearned],
  );

  const showSource = useCallback((reportId: string, rawName: string) => {
    setFocus({ reportId, rawName, seq: Date.now() });
    setTab("verify");
  }, []);

  const showAnalyteSource = useCallback(
    (canonicalId: string) => {
      const ordered = [...reports].sort((a, b) => (b.reportDate ?? "").localeCompare(a.reportDate ?? ""));
      for (const r of ordered) {
        const m = r.measurements.find((x) => x.canonicalId === canonicalId);
        if (m) return showSource(r.id, m.rawAnalyteName);
      }
    },
    [reports, showSource],
  );

  async function remove(id: string) {
    setConfirmDelete(null);
    try {
      await deleteReport(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
      if (focus?.reportId === id) setFocus(null);
    } catch {
      setSaveError("Report se nepodařilo smazat.");
    }
  }

  const unmappedNames = useMemo(
    () => [...new Set(reports.flatMap((r) => r.measurements.filter((m) => m.canonicalId === null).map((m) => m.rawAnalyteName)))],
    [reports],
  );
  const hasData = reports.length > 0;
  const frozen = budget?.frozen ?? false;
  const sorted = useMemo(() => [...reports].sort((a, b) => (b.reportDate ?? "").localeCompare(a.reportDate ?? "")), [reports]);

  return (
    <div className="mk-app">
      <header className="mk-topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true">🩸</span>
          <span className="name">Moje krev</span>
        </div>
        <span className="mk-who muted">{email}</span>
        <ThemeSwitch />
        <button
          className="btn small"
          onClick={() => {
            logout().catch(() => null);
            onLogout();
          }}
        >
          Odhlásit se
        </button>
      </header>

      <main className="mk-main">
        {loadError && <div className="banner warn">{loadError}</div>}
        {saveError && <div className="banner warn">{saveError}</div>}

        {hasData && (
          <div className="tabs-wrap">
            <nav
              className="tabs"
              role="tablist"
              onKeyDown={(e) => {
                const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const i = TABS.findIndex(([id]) => id === tab);
                const j = (i + step + TABS.length) % TABS.length;
                setTab(TABS[j][0]);
                (e.currentTarget.querySelectorAll("button")[j] as HTMLButtonElement | undefined)?.focus();
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

        {!registry ? (
          !loadError && <p className="muted">Načítám…</p>
        ) : (
          <>
            <Panel id="home" active={hasData ? tab : "home"}>
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Nahrát výsledky</h2>
                    <p className="sub" style={{ marginBottom: 0 }}>
                      PDF z laboratoře — přepíše se, ověří proti stránce a přidá do trendů.
                    </p>
                  </div>
                </div>
                <UploadFlow
                  registry={registry}
                  maxPages={maxPages}
                  frozen={frozen}
                  onStored={(r) =>
                    setReports((prev) => {
                      const at = prev.findIndex((p) => p.id === r.id);
                      if (at < 0) return [...prev, r];
                      const next = [...prev];
                      next[at] = r;
                      return next;
                    })
                  }
                  onBudget={setBudget}
                />
              </div>

              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>
                      Uložené reporty <span className="n">{reports.length}</span>
                    </h2>
                  </div>
                </div>
                {reports.length === 0 ? (
                  <p className="muted">Zatím nic. Nahrajte první PDF výše.</p>
                ) : (
                  <ul className="reportlist">
                    {sorted.map((r) => (
                      <li key={r.id}>
                        <button className="rl-main btn linkish" style={{ textAlign: "left", textDecoration: "none", padding: "2px 0" }} onClick={() => showSource(r.id, "")} title="Otevřít v Ověření">
                          <span className="rl-date" style={{ display: "block", color: "var(--ink-1)" }}>
                            {czDate(r.reportDate)}
                          </span>
                          <span className="rl-meta">
                            {r.labName ?? r.sourceFile} · {count(r.measurements.length, "hodnota", "hodnoty", "hodnot")}
                          </span>
                        </button>
                        {confirmDelete === r.id ? (
                          <span className="row" style={{ display: "inline-flex", gap: 6 }}>
                            <button className="btn danger small" onClick={() => void remove(r.id)}>
                              Smazat
                            </button>
                            <button className="btn small" onClick={() => setConfirmDelete(null)}>
                              Zrušit
                            </button>
                          </span>
                        ) : (
                          <button className="rl-x" aria-label={`Smazat report ${czDate(r.reportDate)}`} title="Smazat" onClick={() => setConfirmDelete(r.id)}>
                            ✕
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {budget && (
                  <p className="muted" style={{ margin: "10px 0 0" }}>
                    Zpracování tento měsíc: {budget.spentUsd.toFixed(2)} / {budget.budgetUsd} USD
                  </p>
                )}
              </div>
            </Panel>

            {hasData && (
              <>
                <Panel id="trends" active={tab}>
                  <TrendsTab trends={trends} unmappedNames={unmappedNames} />
                </Panel>
                <Panel id="summary" active={tab}>
                  <SummaryTab trends={trends} onShowSource={showAnalyteSource} />
                </Panel>
                <Panel id="verify" active={tab}>
                  <VerifyTab reports={reports} onCorrect={correct} focus={focus} displayName={(cid) => registry.displayName(cid)} curatedRange={curatedRange} />
                </Panel>
                <Panel id="mapping" active={tab}>
                  <MappingTab reports={reports} registry={registry} onMap={acceptMapping} onUndoMap={undoMapping} onShowSource={showSource} />
                </Panel>
              </>
            )}

            <p className="muted" style={{ marginTop: 18 }}>
              Hodnoty, jednotky i meze počítá deterministický kód, ne model. Model pouze přepisuje,
              co je vytištěno. Uloženy jsou jen hodnoty a začerněné stránky — bez jména, bez rodného čísla.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
