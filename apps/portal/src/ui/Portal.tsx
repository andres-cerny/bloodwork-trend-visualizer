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
  type UnmappedAnalyte,
  Registry,
  buildTrends,
  count,
  czDate,
  czUsd,
  findUnmapped,
  observedStats,
  rematchReport,
  reviewOf,
  toAnalyteDef,
  trendable,
} from "@bw/lab-core";
import { ThemeSwitch } from "@bw/ui-kit";
import { type AiAsked, ApiError, type Budget, type Settings, deleteAccount, deleteReport, forgetSynonym, getSettings, getStatus, isFatalApiError, listReports, listSynonyms, logout, putReport, putSettings, suggestWithAi, teachSynonym } from "../lib/api";
import { type Judged, askingEntry, persistable, runAiMapping, withoutAsked } from "../lib/aiMapping";
import { type Batch, holdsSummary } from "../lib/batch";
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

/**
 * Mounted whether or not it is active; `hidden` keeps its state and takes it
 * out of the accessibility tree — see apps/CLAUDE.md.
 *
 * Mounted before the account has a report, too, with Reporty the one shown:
 * the upload queue lives in that panel, and a queue remounted the moment the
 * first report landed lost its log and its progress bars mid-batch. Without
 * the strip a panel is a plain region — a tabpanel labelled by a tab that is
 * not there would be a lie to a screen reader — so the role comes and goes
 * with the strip.
 */
function Panel({ id, active, strip, children }: { id: TabId; active: TabId; strip: boolean; children: React.ReactNode }) {
  return (
    <div id={`tabpanel-${id}`} role={strip ? "tabpanel" : undefined} aria-labelledby={strip ? `tab-${id}` : undefined} hidden={active !== id}>
      {children}
    </div>
  );
}

interface Props {
  /** Null in the demo — see ui/Door.tsx. */
  email: string | null;
  /**
   * Entered through the public demo link. Everything on these screens works
   * the same; the two deletions are the exception, and they are not shown
   * rather than shown and refused — the worker refuses them either way.
   */
  demo: boolean;
  onLogout: () => void;
}

export default function Portal({ email, demo, onLogout }: Props) {
  const [reports, setReports] = useState<LabReport[]>([]);
  const [registry, setRegistry] = useState<Registry | null>(null);
  /** Parameters the reader founded in Přiřazení, from the account. */
  const [customAnalytes, setCustomAnalytes] = useState<CustomAnalyte[]>([]);
  // The mapping model's run outlives the render it started in — an upload's
  // ends minutes after the click, the load's before the registry is in
  // state — so what it reads and writes lives in refs, mirrored to state for
  // the screen. `learned` is a ref alone — nothing renders it, and five
  // names filed in one answer used to spread the same stale closure five
  // times, so the account kept only the last.
  const registryRef = useRef<Registry | null>(null);
  const reportsRef = useRef<LabReport[]>([]);
  const learnedRef = useRef<Record<string, string[]>>({});
  const budgetRef = useRef<Budget | null>(null);
  const aiAskedRef = useRef<AiAsked>({});
  const [aiAsked, setAiAsked] = useState<AiAsked>({});
  const [aiError, setAiError] = useState<string | null>(null);
  // The whole settings blob, because PUT /api/settings replaces it: a save
  // of one field must carry the others (lib/settings.ts).
  const settingsRef = useRef<Settings>({});
  // Writes go out one after another: two quick saves whose PUTs crossed
  // would leave the server with whichever landed last, not the newest.
  const settingsQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [aiContext, setAiContext] = useState<AiContext | null>(null);
  const [tab, setTab] = useState<TabId>("summary");
  // The first batch: while it runs on an account that had no reports, the
  // switch to Souhrn waits for its last file (lib/batch.ts).
  const [holding, setHolding] = useState(false);
  const [budget, setBudget] = useState<Budget | null>(null);
  // The wrangler default, so the upload screen never promises more pages
  // than the worker accepts in the moment before /api/status answers.
  const [maxPages, setMaxPages] = useState(6);
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
        registryRef.current = reg;
        setRegistry(reg);
        learnedRef.current = l;
        setCustomAnalytes(custom);
        setAiContext(settingsRef.current.aiContext ?? null);
        aiAskedRef.current = settingsRef.current.aiAsked ?? {};
        setAiAsked(aiAskedRef.current);
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
        reportsRef.current = loaded;
        setReports(loaded);
        budgetRef.current = status.budget;
        setBudget(status.budget);
        setMaxPages(status.maxPages);
        // Then the model, once, for what the catalog still does not know
        // and the account has never asked about. Not awaited: the screen
        // is up, the names arrive on the card when they arrive.
        void runMapping(findUnmapped(loaded));
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

  // The "i" after a parameter's name reads the catalog's texts; a founded
  // parameter has none and gets no button (AboutParam.tsx).
  const aboutOf = useCallback((cid: string) => registry?.get(cid)?.about, [registry]);

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

  /** Every change to the reports: through the ref, so a run that started a render ago sees the current ones. */
  const commitReports = useCallback((fn: (prev: LabReport[]) => LabReport[]) => {
    reportsRef.current = fn(reportsRef.current);
    setReports(reportsRef.current);
  }, []);

  /**
   * One or many rows of one report, replaced and saved in a single PUT. A
   * single Potvrdit or Opravit sends one row; „Potvrdit všechny řádky k
   * ověření" sends every pending row through the same call, so a batch is
   * one save and one undo rather than a burst of writes racing each other.
   */
  const correct = useCallback(
    (reportId: string, changes: ReadonlyArray<{ index: number; next: Measurement }>) => {
      if (changes.length === 0) return;
      const byIndex = new Map(changes.map((c) => [c.index, c.next]));
      commitReports((prev) =>
        prev.map((r) => {
          if (r.id !== reportId) return r;
          const updated = { ...r, measurements: r.measurements.map((m, i) => byIndex.get(i) ?? m) };
          persist(updated);
          return updated;
        }),
      );
    },
    [persist, commitReports],
  );

  /**
   * Re-map every report carrying any of the raw names, and keep the ones
   * that changed. One pass, so a model answer that files five names writes
   * each touched report once, not five times.
   */
  const remapMany = useCallback(
    (pairs: Array<{ rawName: string; canonicalId: string | null }>) => {
      if (pairs.length === 0) return;
      const to = new Map(pairs.map((p) => [p.rawName, p.canonicalId]));
      const next = reportsRef.current.map((r) => {
        if (!r.measurements.some((m) => to.has(m.rawAnalyteName))) return r;
        const updated = { ...r, measurements: r.measurements.map((m) => (to.has(m.rawAnalyteName) ? { ...m, canonicalId: to.get(m.rawAnalyteName)! } : m)) };
        persist(updated);
        return updated;
      });
      commitReports(() => next);
      setRegistryVersion((v) => v + 1);
    },
    [persist, commitReports],
  );
  const remap = useCallback((rawName: string, canonicalId: string | null) => remapMany([{ rawName, canonicalId }]), [remapMany]);

  /** Every change to the learned names goes through the ref, so two in one tick both land. */
  const updateLearned = useCallback((fn: (cur: Record<string, string[]>) => Record<string, string[]>) => {
    learnedRef.current = fn(learnedRef.current);
    return learnedRef.current;
  }, []);
  const setLearned = useCallback((next: Record<string, string[]>) => updateLearned(() => next), [updateLearned]);

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
    [setLearned, saveSettings],
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

  /** The learned map with these names filed, each under its id, in acceptance order. */
  const withFiled = (cur: Record<string, string[]>, pairs: Array<{ rawName: string; canonicalId: string }>) => {
    const next = { ...cur };
    for (const { rawName, canonicalId } of pairs) next[canonicalId] = [...(next[canonicalId] ?? []).filter((n) => n !== rawName), rawName];
    return next;
  };

  const acceptMapping = useCallback(
    (rawName: string, canonicalId: string) => {
      if (!registry) return;
      registry.addSynonym(canonicalId, rawName);
      remap(rawName, canonicalId);
      saveLearned(withFiled(learnedRef.current, [{ rawName, canonicalId }]));
      // Filed under a shipped analyte by a person, the spelling is taught to
      // every account: the next one from this laboratory needs no click. What
      // the mapping model filed stays this account's (`commitAi`) — nobody
      // has looked at it yet, and a lesson for everyone takes a person. A
      // founded parameter exists in this account alone, so its names stay
      // here too. Best effort — the account's own mapping is already saved.
      if (isShipped(canonicalId)) teachSynonym(rawName, canonicalId).catch(() => undefined);
    },
    [registry, remap, saveLearned, isShipped],
  );

  /** The ledger as the last answer left it — the run reads it before spending. */
  const noteBudget = useCallback((b: Budget) => {
    budgetRef.current = b;
    setBudget(b);
  }, []);

  /** The model's record, in memory and on screen; saved by `commitAi`, never with a call in flight. */
  const updateAsked = useCallback((fn: (cur: AiAsked) => AiAsked) => {
    aiAskedRef.current = fn(aiAskedRef.current);
    setAiAsked(aiAskedRef.current);
  }, []);

  /**
   * The model's answer lands: the names it filed go into the registry, the
   * reports and the learned map — this account's only, no lesson for every
   * account — and the record and the learned map are saved in one write.
   */
  const commitAi = useCallback(
    (judged: Judged) => {
      const reg = registryRef.current;
      if (!reg) return;
      for (const { rawName, canonicalId } of judged.applied) reg.addSynonym(canonicalId, rawName);
      remapMany(judged.applied);
      const nextLearned = updateLearned((cur) => withFiled(cur, judged.applied));
      updateAsked((cur) => ({ ...cur, ...judged.entries }));
      saveSettings({ learned: nextLearned, aiAsked: persistable(aiAskedRef.current) }).catch(() => setSaveError("Přiřazení se nepodařilo uložit."));
    },
    [remapMany, updateLearned, updateAsked, saveSettings],
  );

  /**
   * The mapping model over `candidates` — the names it has never been asked
   * about among them, if the account is not frozen. Refs only, so the call
   * made at load and the one made when an upload ends both see the current
   * account; never rejects (lib/aiMapping.ts).
   */
  const runMapping = useCallback(
    async (candidates: UnmappedAnalyte[]) => {
      const reg = registryRef.current;
      if (!reg || budgetRef.current?.frozen) return;
      const out = await runAiMapping(
        {
          candidates,
          asked: () => aiAskedRef.current,
          registry: reg,
          stats: observedStats(reportsRef.current),
          ask: async (names, catalog) => {
            // The answer carries the ledger after the spend; so does a refusal.
            try {
              const a = await suggestWithAi(names, catalog);
              noteBudget(a.budget);
              return a;
            } catch (e) {
              if (e instanceof ApiError && e.budget) noteBudget(e.budget);
              throw e;
            }
          },
        },
        {
          mark: (names) => {
            setAiError(null);
            const at = new Date().toISOString().slice(0, 10);
            updateAsked((cur) => {
              const next = { ...cur };
              for (const n of names) next[n] = askingEntry(at);
              return next;
            });
          },
          unmark: (names) => updateAsked((cur) => withoutAsked(cur, names)),
          commit: commitAi,
        },
      );
      if (out.error) {
        setAiError(
          out.error instanceof Error && isFatalApiError(out.error)
            ? out.error.message
            : "Model se nepodařilo oslovit. Názvy čekají zde; zkuste to prosím za chvíli znovu.",
        );
      }
    },
    [updateAsked, commitAi, noteBudget],
  );

  /** "Zeptat se znovu": forget what the model said about these names, and ask. */
  const askAgain = useCallback(
    (rawNames: string[]) => {
      updateAsked((cur) => withoutAsked(cur, rawNames));
      const wanted = new Set(rawNames);
      void runMapping(findUnmapped(reportsRef.current).filter((a) => wanted.has(a.rawName)));
    },
    [updateAsked, runMapping],
  );

  /**
   * An upload ended and its report is stored. Only then the model, for the
   * new report's names — a call that fails leaves the report exactly where
   * it is and the names waiting in the tab.
   */
  const storeAndMap = useCallback(
    (r: LabReport) => {
      commitReports((prev) => {
        const at = prev.findIndex((p) => p.id === r.id);
        if (at < 0) return [...prev, r];
        const next = [...prev];
        next[at] = r;
        return next;
      });
      const mine = new Set(r.measurements.map((m) => m.rawAnalyteName));
      void runMapping(findUnmapped(reportsRef.current).filter((a) => mine.has(a.rawName)));
    },
    [commitReports, runMapping],
  );

  /**
   * The upload queue's batch changed. The count is read through the ref and
   * outside the updater: a batch opening on an account with nothing in it is
   * what starts the hold, and a report landing mid-batch is not what the
   * rule should see.
   */
  const onBatch = useCallback((b: Batch) => {
    const reportsNow = reportsRef.current.length;
    setHolding((held) => holdsSummary(held, b, reportsNow));
  }, []);

  const undoMapping = useCallback(
    (rawName: string, canonicalId: string) => {
      if (!registry) return;
      registry.removeSynonym(canonicalId, rawName);
      remap(rawName, null);
      const rest = (learnedRef.current[canonicalId] ?? []).filter((n) => n !== rawName);
      const next = { ...learnedRef.current };
      if (rest.length) next[canonicalId] = rest;
      else delete next[canonicalId];
      saveLearned(next);
      // The worker withdraws it only if this account taught it.
      forgetSynonym(rawName).catch(() => undefined);
    },
    [registry, remap, saveLearned],
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
      const next = withNewParameter({ learned: learnedRef.current, customAnalytes }, c, rawName);
      setLearned(next.learned);
      setCustomAnalytes(next.customAnalytes);
      saveSettings({ learned: next.learned, customAnalytes: next.customAnalytes }).catch(() =>
        setSaveError("Nový parametr se nepodařilo uložit."),
      );
    },
    [registry, remap, customAnalytes, saveSettings],
  );

  /**
   * Delete a founded parameter. Its printed names return to the unmapped list
   * — the measured values are untouched, they are only unfiled.
   */
  const deleteParameter = useCallback(
    (canonicalId: string) => {
      if (!registry) return;
      const names = namesUnder({ learned: learnedRef.current, customAnalytes }, canonicalId);
      for (const n of names) registry.removeSynonym(canonicalId, n);
      registry.removeAnalyte(canonicalId);
      for (const n of names) remap(n, null);
      const next = withoutParameter({ learned: learnedRef.current, customAnalytes }, canonicalId);
      setLearned(next.learned);
      setCustomAnalytes(next.customAnalytes);
      saveSettings({ learned: next.learned, customAnalytes: next.customAnalytes }).catch(() =>
        setSaveError("Parametr se nepodařilo smazat."),
      );
    },
    [registry, remap, customAnalytes, saveSettings],
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
      commitReports((prev) => prev.filter((r) => r.id !== id));
      if (focus?.reportId === id) setFocus(null);
    } catch {
      setSaveError("Report se nepodařilo smazat.");
    }
  }

  // Only names a mapping could put into a trend: urine and never-numeric
  // rows are left out of the banner and the mapping tab alike (`trendable`).
  const unmappedNames = useMemo(() => findUnmapped(reports).filter(trendable).map((a) => a.rawName), [reports]);
  // The strip and the five screens over the data, once there is data — and
  // not before the first batch has ended, or Souhrn would open on the first
  // report and rearrange itself as the rest of the pick landed.
  const hasData = reports.length > 0 && !holding;
  // Without the strip there is one panel to show, and it is Reporty. `tab`
  // itself is left alone, so the switch lands on Souhrn as it always has.
  const active: TabId = hasData ? tab : "reports";
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
      {/* The demo account is open to anyone with the link, so a report
          uploaded into it is readable by anyone with the link. Said here,
          where the file is chosen, and not only on the door. */}
      {demo && (
        <p className="banner warn">
          <strong>Jste v demu.</strong> Tenhle účet vidí každý, kdo má odkaz — co sem nahrajete,
          uvidí i ostatní. Vlastní výsledky si nahrajte až do vlastního účtu.
        </p>
      )}
      <UploadFlow
        registry={registry}
        maxPages={maxPages}
        frozen={frozen}
        onStored={storeAndMap}
        onBudget={noteBudget}
        onBatch={onBatch}
        holding={holding}
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
              {demo ? null : confirmDelete === r.id ? (
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
          Zpracování tento měsíc: {czUsd(budget.spentUsd)} / {czUsd(budget.budgetUsd)} USD
        </p>
      )}
    </div>
  );

  /** Export and the account's deletion — shown once the account holds a report. */
  const accountCard = (
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
      {demo ? (
        <p className="sub" style={{ margin: 0 }}>
          Jste v demu. Prohlížet, nahrávat i opravovat můžete — mazat ne.
        </p>
      ) : accountPhrase === null ? (
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
  );

  return (
    <div className="mk-app">
      <header className="mk-topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true">🩸</span>
          <span className="name">Moje krev</span>
        </div>
        <span className="mk-who muted">{email ?? "Demo pacient"}</span>
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
        ) : (
          // Every panel from the first render, Reporty shown until there is
          // data: the upload queue lives in it, and a queue remounted the
          // moment the first report landed lost its log mid-batch. The five
          // screens over the data mount their content once there is data.
          <>
            <Panel id="summary" active={active} strip={hasData}>
              {hasData && (
                <SummaryTab
                  reports={reports}
                  trends={trends}
                  onOpenTrend={showTrend}
                  onOpenVerify={() => goTab("verify")}
                  aboutOf={aboutOf}
                />
              )}
            </Panel>
            <Panel id="trends" active={active} strip={hasData}>
              {hasData && <TrendsTab trends={trends} unmappedNames={unmappedNames} open={openTrend} onVerify={showSource} aboutOf={aboutOf} />}
            </Panel>
            <Panel id="verify" active={active} strip={hasData}>
              {hasData && <VerifyTab reports={reports} onCorrect={correct} focus={focus} displayName={(cid) => registry.displayName(cid)} curatedRange={curatedRange} />}
            </Panel>
            <Panel id="mapping" active={active} strip={hasData}>
              {hasData && (
                <MappingTab
                  reports={reports}
                  registry={registry}
                  customAnalytes={customAnalytes}
                  onMap={acceptMapping}
                  onUndoMap={undoMapping}
                  onCreateParameter={createParameter}
                  onDeleteParameter={deleteParameter}
                  onShowSource={showSource}
                  aiAsked={aiAsked}
                  aiError={aiError}
                  onAskAgain={askAgain}
                  frozen={frozen}
                />
              )}
            </Panel>
            <Panel id="share" active={active} strip={hasData}>
              {hasData && <ShareTab reports={reports} trends={trends} context={aiContext} onSaveContext={saveAiContext} />}
            </Panel>
            <Panel id="reports" active={active} strip={hasData}>
              {uploadCard}
              {reportsCard}
              {/* The account card waits for the first report, as it did when
                  the empty account had its own two-card screen. */}
              {hasData && accountCard}
            </Panel>
          </>
        )}
      </main>
    </div>
  );
}
