/**
 * The logged-in app: one person's reports, and the screens over them.
 *
 * Souhrn opens: what changed and what is out of range, with the review
 * banner on top — the former Přehled tile wall said the same things twice
 * and was dropped for it. Trendy, Ověření and Přiřazení názvů are the
 * demo's screens (argued over with clinicians —
 * apps/bloodwork/docs/design-notes.md) over the stored payloads; Reporty is
 * where PDFs come in and go out. Every report arrives from the account and
 * every change goes back to it, so the same trend is there on the next
 * device.
 *
 * The tab strip stays at the top on every width. A desktop shows all six
 * labels; a phone shows the three that carry the daily use and keeps the
 * rest behind ⋯, because six labels sharing 360px meant 0,7rem type on a
 * 2mm-tall target — unreadable to the eyes this app is for. Three labels and
 * a ⋯ get a legible size and a real tap target, and the ⋯ row is one tap.
 * Both rows are the same three columns wide, so moving a tab between them
 * buys it no room — only the ⋯ tap it costs the reader.
 *
 * Which three, and the order they sit in, is the phone's business alone:
 * every tab is in the DOM in its desktop order, and mobile CSS reorders and
 * hides. Same buttons, same `hidden` panels.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AiContext,
  type AnalyteDef,
  type CustomAnalyte,
  type LabReport,
  type Measurement,
  Registry,
  buildTrends,
  count,
  czDate,
  findUnmapped,
  rematchReport,
  reviewOf,
  toAnalyteDef,
  trendable,
} from "@bw/lab-core";
import { ThemeSwitch } from "@bw/ui-kit";
import { type Budget, type Settings, deleteAccount, deleteReport, forgetSynonym, getSettings, getStatus, listReports, listSynonyms, logout, putReport, putSettings, teachSynonym } from "../lib/api";
import { namesUnder, withNewParameter, withoutParameter } from "../lib/customParams";
import { mergeSettings } from "../lib/settings";
import MappingTab from "./MappingTab";
import ShareTab from "./ShareTab";
import SummaryTab from "./SummaryTab";
import TrendsTab from "./TrendsTab";
import UploadFlow from "./UploadFlow";
import VerifyTab from "./VerifyTab";

type TabId = "trends" | "summary" | "verify" | "mapping" | "reports" | "share";
// A label must not wrap *conditionally*: bolding the active one would break
// it into two lines and the bar would jump in height exactly when that tab
// is chosen. One-line labels are written with non-breaking spaces to hold
// that. "AI konzultace" is 13 characters against a phone column of about
// eleven, so it wraps at every weight instead of at some of them — stable,
// and it keeps 0,92rem type rather than buying one line with a size this
// app's readers cannot use.
const TABS: Array<[TabId, string]> = [
  ["summary", "Souhrn"],
  ["trends", "Trendy"],
  ["verify", "Ověření"],
  ["mapping", "Přiřazení"],
  ["reports", "Reporty"],
  ["share", "AI konzultace"],
];
/**
 * The three a phone keeps in the strip, in the order it shows them: read the
 * summary, read a curve, get the PDFs in and out. Ověření, Přiřazení and AI
 * konzultace are the ones you go to on purpose, so they live behind ⋯ rather
 * than costing every label two points of type size.
 */
const PHONE_TABS: TabId[] = ["summary", "trends", "reports"];
const onPhoneStrip = (id: TabId) => PHONE_TABS.includes(id);

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
  /** Parameters the reader founded in Přiřazení, from the account. */
  const [customAnalytes, setCustomAnalytes] = useState<CustomAnalyte[]>([]);
  // The whole settings blob, because PUT /api/settings replaces it: a save
  // of one field must carry the others (lib/settings.ts).
  const settingsRef = useRef<Settings>({});
  // Writes go out one after another: two quick saves whose PUTs crossed
  // would leave the server with whichever landed last, not the newest.
  const settingsQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [aiContext, setAiContext] = useState<AiContext | null>(null);
  const [tab, setTab] = useState<TabId>("summary");
  const [budget, setBudget] = useState<Budget | null>(null);
  const [maxPages, setMaxPages] = useState(30);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [registryVersion, setRegistryVersion] = useState(0);
  const [focus, setFocus] = useState<{ reportId: string; rawName: string; seq: number } | null>(null);
  const [openTrend, setOpenTrend] = useState<{ id: string; seq: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [accountPhrase, setAccountPhrase] = useState<string | null>(null);
  // The ⋯ row, on a phone. Open it when one of the tabs behind it is chosen
  // by any route — a keyboard arrow, or showSource sending the reader to
  // Ověření — so the strip never hides the tab it is showing.
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [defs, rs, settings, status, taught] = await Promise.all([
          fetch("/registry.json").then((r) => r.json() as Promise<AnalyteDef[]>),
          listReports(),
          getSettings(),
          getStatus(),
          // What other accounts taught is worth having; not having it is not
          // worth a blank screen.
          listSynonyms().catch(() => []),
        ]);
        const reg = new Registry(defs);
        settingsRef.current = settings as Settings;
        // Founded parameters before the learned names, not after: addSynonym
        // is a no-op for an id the registry does not hold yet, so the other
        // order would silently drop every printed name filed under one — the
        // parameter would exist and its own trend would be empty.
        const custom = settingsRef.current.customAnalytes ?? [];
        for (const c of custom) reg.addAnalyte(toAnalyteDef(c));
        const l = settingsRef.current.learned ?? {};
        for (const [cid, names] of Object.entries(l)) for (const n of names) reg.addSynonym(cid, n);
        // Then everyone's, as shipped names: this account's own come first so
        // they stay its own to withdraw; another account's cannot be unlearned
        // here, the same as a name from the shipped table.
        for (const t of taught) reg.addSynonym(t.canonicalId, t.rawName, false);
        setRegistry(reg);
        setLearned(l);
        setCustomAnalytes(custom);
        setAiContext(settingsRef.current.aiContext ?? null);
        // A catalog that grew since a report was uploaded reaches that
        // report here: the stored canonicalId was computed at upload and
        // would otherwise stay null forever. Only null rows are touched — a
        // name the reader filed by hand keeps their choice — and a report
        // that changed is written back.
        const loaded = rs.map((r) => {
          const matched = rematchReport(r, reg);
          if (matched) putReport(matched).catch(() => undefined);
          return matched ?? r;
        });
        setReports(loaded);
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

  /** Every settings write: merge into what the account holds, then PUT the whole. */
  const saveSettings = useCallback((patch: Partial<Settings>) => {
    settingsRef.current = mergeSettings(settingsRef.current, patch);
    const whole = settingsRef.current;
    const p = settingsQueue.current.then(() => putSettings(whole));
    settingsQueue.current = p.catch(() => undefined);
    return p;
  }, []);

  const saveLearned = useCallback(
    (next: Record<string, string[]>) => {
      setLearned(next);
      saveSettings({ learned: next }).catch(() => setSaveError("Přiřazení se nepodařilo uložit."));
    },
    [saveSettings],
  );

  const saveAiContext = useCallback(
    async (next: AiContext) => {
      const value = Object.keys(next).length ? next : undefined;
      await saveSettings({ aiContext: value });
      setAiContext(value ?? null);
    },
    [saveSettings],
  );

  /** A shipped analyte, as opposed to one this account founded. */
  const isShipped = useCallback(
    (canonicalId: string) => !!registry?.get(canonicalId) && !customAnalytes.some((c) => c.canonicalId === canonicalId),
    [registry, customAnalytes],
  );

  const acceptMapping = useCallback(
    (rawName: string, canonicalId: string) => {
      if (!registry) return;
      registry.addSynonym(canonicalId, rawName);
      remap(rawName, canonicalId);
      saveLearned({ ...learned, [canonicalId]: [...(learned[canonicalId] ?? []).filter((n) => n !== rawName), rawName] });
      // Filed under a shipped analyte, the spelling is taught to every
      // account: the next person from this laboratory needs no click. A
      // founded parameter exists in this account alone, so its names stay
      // here. Best effort — the account's own mapping is already saved.
      if (isShipped(canonicalId)) teachSynonym(rawName, canonicalId).catch(() => undefined);
    },
    [registry, remap, learned, saveLearned, isShipped],
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
      // The worker withdraws it only if this account taught it.
      forgetSynonym(rawName).catch(() => undefined);
    },
    [registry, remap, learned, saveLearned],
  );

  /**
   * Found a parameter on a printed name, and file that name under it.
   *
   * Both settings fields move together in one write: the parameter and the
   * name filed under it are one decision, and a blob that carried only half
   * of it would load as a parameter with an empty trend, or as a synonym for
   * an id the registry does not hold.
   */
  const createParameter = useCallback(
    (rawName: string, c: CustomAnalyte) => {
      if (!registry) return;
      registry.addAnalyte(toAnalyteDef(c));
      registry.addSynonym(c.canonicalId, rawName);
      remap(rawName, c.canonicalId);
      const next = withNewParameter({ learned, customAnalytes }, c, rawName);
      setLearned(next.learned);
      setCustomAnalytes(next.customAnalytes);
      saveSettings({ learned: next.learned, customAnalytes: next.customAnalytes }).catch(() =>
        setSaveError("Nový parametr se nepodařilo uložit."),
      );
    },
    [registry, remap, learned, customAnalytes, saveSettings],
  );

  /**
   * Delete a founded parameter. Its printed names return to the unmapped list
   * — the measured values are untouched, they are only unfiled.
   */
  const deleteParameter = useCallback(
    (canonicalId: string) => {
      if (!registry) return;
      const names = namesUnder({ learned, customAnalytes }, canonicalId);
      for (const n of names) registry.removeSynonym(canonicalId, n);
      registry.removeAnalyte(canonicalId);
      for (const n of names) remap(n, null);
      const next = withoutParameter({ learned, customAnalytes }, canonicalId);
      setLearned(next.learned);
      setCustomAnalytes(next.customAnalytes);
      saveSettings({ learned: next.learned, customAnalytes: next.customAnalytes }).catch(() =>
        setSaveError("Parametr se nepodařilo smazat."),
      );
    },
    [registry, remap, learned, customAnalytes, saveSettings],
  );

  const goTab = useCallback((id: TabId) => {
    setTab(id);
    setMoreOpen(!onPhoneStrip(id));
  }, []);

  const showSource = useCallback(
    (reportId: string, rawName: string) => {
      setFocus({ reportId, rawName, seq: Date.now() });
      goTab("verify");
    },
    [goTab],
  );

  const showTrend = useCallback(
    (canonicalId: string) => {
      setOpenTrend({ id: canonicalId, seq: Date.now() });
      goTab("trends");
      window.scrollTo({ top: 0 });
    },
    [goTab],
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

  // Only names a mapping could put into a trend: urine and never-numeric
  // rows are left out of the banner and the mapping tab alike (`trendable`).
  const unmappedNames = useMemo(() => findUnmapped(reports).filter(trendable).map((a) => a.rawName), [reports]);
  const hasData = reports.length > 0;
  const frozen = budget?.frozen ?? false;
  const sorted = useMemo(() => [...reports].sort((a, b) => (b.reportDate ?? "").localeCompare(a.reportDate ?? "")), [reports]);

  const uploadCard = registry && (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Nahrát výsledky</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            PDF z laboratoře nebo fotka papíru — přepíše se a přidá do trendů; u PDF navíc
            ověříme čísla proti stránce.
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
  );

  const reportsCard = (
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
                <span style={{ display: "inline-flex", gap: 6 }}>
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
  );

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
          <div className={`tabs-wrap${moreOpen ? " more-open" : ""}`}>
            <nav
              className="tabs"
              role="tablist"
              onKeyDown={(e) => {
                const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const i = TABS.findIndex(([id]) => id === tab);
                const j = (i + step + TABS.length) % TABS.length;
                // After the paint, not during the handler: arrowing onto one
                // of the ⋯ tabs opens that row, and a button still display:
                // none this frame cannot take focus.
                const nav = e.currentTarget;
                goTab(TABS[j][0]);
                requestAnimationFrame(() => (nav.querySelectorAll("button")[j] as HTMLButtonElement | undefined)?.focus());
              }}
            >
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  id={`tab-${id}`}
                  className={onPhoneStrip(id) ? "tab-first" : "tab-more"}
                  aria-controls={`tabpanel-${id}`}
                  aria-selected={tab === id}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => goTab(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
            {/* Not a tab: a disclosure for the three that do not fit, and so
                outside the tablist. It wears the selected look while one of
                them is open, or the strip would show nothing selected. */}
            <button
              className="tabs-toggle"
              aria-expanded={moreOpen}
              aria-label={moreOpen ? "Skrýt další záložky" : "Další záložky"}
              title={moreOpen ? "Skrýt další záložky" : "Další záložky"}
              data-holding={!onPhoneStrip(tab)}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <span aria-hidden="true">⋯</span>
            </button>
          </div>
        )}

        {!registry ? (
          !loadError && <p className="muted">Načítám…</p>
        ) : !hasData ? (
          <>
            {uploadCard}
            {reportsCard}
          </>
        ) : (
          <>
            <Panel id="summary" active={tab}>
              <SummaryTab
                reports={reports}
                trends={trends}
                onOpenTrend={showTrend}
                onOpenVerify={() => goTab("verify")}
              />
            </Panel>
            <Panel id="trends" active={tab}>
              <TrendsTab trends={trends} unmappedNames={unmappedNames} open={openTrend} onVerify={showSource} />
            </Panel>
            <Panel id="verify" active={tab}>
              <VerifyTab reports={reports} onCorrect={correct} focus={focus} displayName={(cid) => registry.displayName(cid)} curatedRange={curatedRange} />
            </Panel>
            <Panel id="mapping" active={tab}>
              <MappingTab
                reports={reports}
                registry={registry}
                customAnalytes={customAnalytes}
                onMap={acceptMapping}
                onUndoMap={undoMapping}
                onCreateParameter={createParameter}
                onDeleteParameter={deleteParameter}
                onShowSource={showSource}
              />
            </Panel>
            <Panel id="share" active={tab}>
              <ShareTab reports={reports} trends={trends} context={aiContext} onSaveContext={saveAiContext} />
            </Panel>
            <Panel id="reports" active={tab}>
              {uploadCard}
              {reportsCard}
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Váš účet, vaše data</h2>
                    <p className="sub" style={{ marginBottom: 0 }}>
                      Uloženy jsou jen hodnoty a začerněné stránky — <a href="/soukromi">co ukládáme, a co ne</a>.
                    </p>
                  </div>
                </div>
                <div className="toolbar" style={{ marginBottom: 10 }}>
                  <a className="btn small" href="/api/export" download>
                    Stáhnout vše (JSON)
                  </a>
                  <a className="btn small" href="/api/export?format=csv" download>
                    Stáhnout tabulku (CSV)
                  </a>
                </div>
                {accountPhrase === null ? (
                  <button className="btn danger small" onClick={() => setAccountPhrase("")}>
                    Smazat účet i se vším uloženým
                  </button>
                ) : (
                  <div className="runlog" role="alert">
                    <p style={{ margin: "0 0 6px" }}>
                      Smazání je okamžité a úplné — hodnoty, stránky, opravy i e-mail. Bez kopie, bez
                      návratu. Napište <strong>SMAZAT</strong> a potvrďte.
                    </p>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <input aria-label="Potvrzení smazání" value={accountPhrase} onChange={(e) => setAccountPhrase(e.target.value)} />
                      <button
                        className="btn danger small"
                        disabled={accountPhrase !== "SMAZAT"}
                        onClick={() => {
                          deleteAccount().then(onLogout, () => setSaveError("Účet se nepodařilo smazat. Zkuste to prosím znovu."));
                        }}
                      >
                        Smazat účet
                      </button>
                      <button className="btn small" onClick={() => setAccountPhrase(null)}>
                        Zrušit
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          </>
        )}

        {registry && (
          <p className="muted mk-foot">
            Hodnoty, jednotky i meze počítá deterministický kód, ne model. Model pouze přepisuje, co je
            vytištěno. Uloženy jsou jen hodnoty a začerněné stránky — bez jména, bez rodného čísla.
          </p>
        )}
      </main>
    </div>
  );
}
