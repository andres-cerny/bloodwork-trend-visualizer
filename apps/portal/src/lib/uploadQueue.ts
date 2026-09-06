/**
 * The upload queue, without the screen: which file is where, and what
 * happens to it next. UploadFlow.tsx renders this state and forwards the
 * reader's choices; nothing in here knows about React, which is what lets
 * the paths that must never spend anything be proven in plain node.
 *
 * Two gates against uploading a report twice, one before any cost and one
 * after:
 *
 *   fingerprint   The file's bytes are hashed the moment it is picked. A
 *                 stored report with the same fingerprint stops the file
 *                 here — before the PDF is opened, before redaction, before
 *                 a page reaches the extractor. The reader skips it (the
 *                 default) or replaces the stored one.
 *
 *   content       A re-exported PDF has new bytes and the same printed
 *                 report. Once the pages are read, a stored report with the
 *                 same date and laboratory is offered as a probable
 *                 duplicate, with the same choice, before anything is saved.
 *
 * The worker keeps the same rule server-side (a unique fingerprint per
 * account); its 409 lands on the second gate too, so a report saved from
 * another device gets the same notice rather than an error.
 *
 * "Replace" means the new read is stored under the existing report's id —
 * an upsert, so the trends see one report on that date, not two.
 */
import { type IdentityHit, type LabReport, describeReport, sameFile, sameIssue } from "@bw/lab-core";
import type { RedactedPage } from "@bw/lab-core/pdf";
import { type Budget, ApiError, isFatalApiError } from "./api";
import type { ExtractOutcome, PreparedFile } from "./upload";

/** What the reader is doing — one file at a time. */
export type Stage =
  | { kind: "idle" }
  | { kind: "preparing"; name: string }
  /** Stopped at the first gate, waiting for the reader's choice. */
  | { kind: "duplicate"; name: string; existing: LabReport }
  | { kind: "review"; prepared: PreparedFile }
  | { kind: "redacting"; name: string };

/** What the machine is doing — as many files as have been confirmed. */
export interface Running {
  id: string;
  name: string;
  /** "probable": read, not saved — stopped at the second gate. */
  phase: "extracting" | "storing" | "probable";
  done: number;
  total: number;
  /** Distinct rows seen so far, across pages and readers. */
  rows: number;
  /** The last few, as "name value unit" — what the reader sees arriving. */
  latest: string[];
  /** In phase "probable": the stored report this read seems to repeat. */
  existing: LabReport | null;
}

export interface LogEntry {
  name: string;
  status: "done" | "failed" | "skipped";
  notes: string[];
  error: string | null;
}

export interface QueueState {
  stage: Stage;
  queued: File[];
  running: Running[];
  log: LogEntry[];
}

export type Choice = "skip" | "replace";

/** Everything the queue does to a file, injectable so a test can fake it. */
export interface QueueDeps {
  /** The account's reports as they are now — the list the gates search. */
  reports: () => readonly LabReport[];
  fingerprint: (file: File) => Promise<string>;
  prepare: (file: File) => Promise<PreparedFile>;
  redact: (prepared: PreparedFile, hits: IdentityHit[]) => Promise<RedactedPage[]>;
  check: (pages: RedactedPage[], hits: IdentityHit[]) => string[];
  extract: (
    id: string,
    prepared: PreparedFile,
    pages: RedactedPage[],
    onProgress: (done: number, total: number) => void,
    onRow: (pageNum: number, name: string, value: string, unit: string) => void,
    fingerprint: string,
  ) => Promise<ExtractOutcome>;
  store: (report: LabReport, pages: RedactedPage[]) => Promise<LabReport>;
  newId: () => string;
  onStored: (report: LabReport) => void;
  onBudget: (b: Budget) => void;
}

export interface UploadQueue {
  enqueue: (files: File[]) => void;
  /** The review screen's answer: the boxes to paint, or nothing. */
  confirm: (hits: IdentityHit[]) => void;
  cancelReview: () => void;
  /** The first gate's answer, for the file in stage "duplicate". */
  decide: (choice: Choice) => void;
  /** The second gate's answer, for the running entry with this id. */
  resolve: (id: string, choice: Choice) => void;
  state: () => QueueState;
}

export const alreadyStored = (existing: LabReport) => `Tento report už máte nahraný (${describeReport(existing)}).`;
export const probablyStored = (existing: LabReport) =>
  `Pravděpodobně už nahraný report (stejné datum a laboratoř): ${describeReport(existing)}.`;
const replacedNote = (existing: LabReport) => `Nahradil původní report (${describeReport(existing)}).`;

/** A file stopped at the first gate: what to open if the reader says replace. */
interface Held {
  file: File;
  fingerprint: string;
  existing: LabReport;
}

/** A read stopped at the second gate: what to save if the reader says replace. */
interface Pending {
  name: string;
  report: LabReport;
  notes: string[];
  pages: RedactedPage[];
  existing: LabReport;
}

export function createUploadQueue(deps: QueueDeps, notify: (s: QueueState) => void): UploadQueue {
  const s: QueueState = { stage: { kind: "idle" }, queued: [], running: [], log: [] };
  let busy = false;
  let held: Held | null = null;
  /** The review stage's hidden half: the fingerprint, and the id to replace. */
  let opened: { fingerprint: string; replaceId: string | null } | null = null;
  const pending = new Map<string, Pending>();

  const emit = () => notify({ stage: s.stage, queued: [...s.queued], running: [...s.running], log: [...s.log] });
  const setStage = (stage: Stage) => {
    s.stage = stage;
    emit();
  };
  const addLog = (e: LogEntry) => {
    s.log = [e, ...s.log];
    emit();
  };
  const patchRunning = (id: string, patch: Partial<Running>) => {
    s.running = s.running.map((r) => (r.id === id ? { ...r, ...patch } : r));
    emit();
  };
  const dropRunning = (id: string) => {
    s.running = s.running.filter((r) => r.id !== id);
    emit();
  };

  function finish() {
    busy = false;
    held = null;
    opened = null;
    setStage({ kind: "idle" });
    void startNext();
  }

  async function startNext() {
    if (busy) return;
    const file = s.queued.shift();
    emit();
    if (!file) return;
    busy = true;
    setStage({ kind: "preparing", name: file.name });
    try {
      // The first gate, before the PDF is even opened.
      const fingerprint = await deps.fingerprint(file);
      const existing = sameFile(deps.reports(), fingerprint);
      if (existing) {
        held = { file, fingerprint, existing };
        setStage({ kind: "duplicate", name: file.name, existing });
        return;
      }
      await open(file, fingerprint, null);
    } catch (e) {
      addLog({ name: file.name, status: "failed", notes: [], error: `Soubor se nepodařilo otevřít: ${e instanceof Error ? e.message : e}` });
      finish();
    }
  }

  async function open(file: File, fingerprint: string, replaceId: string | null) {
    try {
      const prepared = await deps.prepare(file);
      opened = { fingerprint, replaceId };
      setStage({ kind: "review", prepared });
    } catch (e) {
      addLog({ name: file.name, status: "failed", notes: [], error: `Soubor se nepodařilo otevřít: ${e instanceof Error ? e.message : e}` });
      finish();
    }
  }

  function decide(choice: Choice) {
    if (s.stage.kind !== "duplicate" || !held) return;
    const { file, fingerprint, existing } = held;
    if (choice === "skip") {
      addLog({ name: file.name, status: "skipped", notes: [alreadyStored(existing)], error: null });
      finish();
      return;
    }
    setStage({ kind: "preparing", name: file.name });
    void open(file, fingerprint, existing.id);
  }

  /** The reader's half after confirmation: paint, check, then hand over. */
  async function confirm(hits: IdentityHit[]) {
    if (s.stage.kind !== "review" || !opened) return;
    const prepared = s.stage.prepared;
    const { fingerprint, replaceId } = opened;
    const name = prepared.name;
    try {
      setStage({ kind: "redacting", name });
      const pages = await deps.redact(prepared, hits);
      const survived = deps.check(pages, hits);
      if (survived.length) {
        // Painted, stripped, and still readable: refuse rather than upload
        // and hope. This is the check the Python exporter makes, in the
        // browser.
        throw new Error(`anonymizace se nezdařila — v textu zůstalo: ${survived.slice(0, 3).join(", ")}`);
      }
      const id = replaceId ?? deps.newId();
      s.running = [...s.running, { id, name, phase: "extracting", done: 0, total: pages.length, rows: 0, latest: [], existing: null }];
      emit();
      // Not awaited: the next file's review must not wait for this read.
      void extractInBackground(id, name, prepared, pages, fingerprint, replaceId);
    } catch (e) {
      addLog({ name, status: "failed", notes: [], error: `Nepodařilo se zpracovat PDF: ${e instanceof Error ? e.message : e}` });
    }
    finish();
  }

  function cancelReview() {
    if (s.stage.kind !== "review") return;
    addLog({ name: s.stage.prepared.name, status: "skipped", notes: [], error: null });
    finish();
  }

  /** The machine's half: read every page under the shared ceiling, then the second gate, then store. */
  async function extractInBackground(
    id: string,
    name: string,
    prepared: PreparedFile,
    pages: RedactedPage[],
    fingerprint: string,
    replaceId: string | null,
  ) {
    // Rows arrive as the readers write them, out of order across pages. One
    // line per printed row is enough for the screen: the first reader to
    // name it wins, and the count is of distinct rows.
    const seen = new Set<string>();
    const latest: string[] = [];
    try {
      const { report, notes } = await deps.extract(
        id,
        prepared,
        pages,
        (done, total) => patchRunning(id, { done, total }),
        (pageNum, rowName, value, unit) => {
          const key = `${pageNum}:${rowName.toLowerCase()}`;
          if (seen.has(key)) return;
          seen.add(key);
          latest.push([rowName, value, unit].filter(Boolean).join(" "));
          if (latest.length > 4) latest.shift();
          patchRunning(id, { rows: seen.size, latest: [...latest] });
        },
        fingerprint,
      );
      // The second gate: a replacement already names its report, so it is
      // not asked again.
      const existing = replaceId ? null : sameIssue(deps.reports(), report.reportDate, report.labName);
      if (existing) {
        hold(id, { name, report, notes, pages, existing });
        return;
      }
      await save(id, name, report, notes, pages, replaceId ? deps.reports().find((r) => r.id === replaceId) ?? null : null);
    } catch (e) {
      fail(id, name, e);
    }
  }

  function hold(id: string, p: Pending) {
    pending.set(id, p);
    patchRunning(id, { phase: "probable", existing: p.existing });
  }

  async function save(id: string, name: string, report: LabReport, notes: string[], pages: RedactedPage[], replaced: LabReport | null) {
    try {
      patchRunning(id, { phase: "storing", existing: null });
      const stored = await deps.store(report, pages);
      deps.onStored(stored);
      addLog({ name, status: "done", notes: replaced ? [replacedNote(replaced), ...notes] : notes, error: null });
      dropRunning(id);
    } catch (e) {
      // The worker knows a report this one repeats — saved from another
      // device, or before this list was loaded. Same notice, same choice.
      if (e instanceof ApiError && e.code === "duplicate" && e.existingId) {
        const existingId = e.existingId;
        const existing = deps.reports().find((r) => r.id === existingId) ?? { ...report, id: existingId };
        hold(id, { name, report, notes, pages, existing });
        return;
      }
      fail(id, name, e);
    }
  }

  function resolve(id: string, choice: Choice) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (choice === "skip") {
      addLog({ name: p.name, status: "skipped", notes: [probablyStored(p.existing)], error: null });
      dropRunning(id);
      return;
    }
    void save(id, p.name, { ...p.report, id: p.existing.id }, p.notes, p.pages, p.existing);
  }

  function fail(id: string, name: string, e: unknown) {
    const message = e instanceof ApiError ? e.message : `Nepodařilo se zpracovat PDF: ${e instanceof Error ? e.message : e}`;
    addLog({ name, status: "failed", notes: [], error: message });
    if (e instanceof ApiError && e.budget) deps.onBudget(e.budget);
    if (isFatalApiError(e)) {
      // Every file still waiting would fail the same way; say so instead
      // of leaving them queued and silent. A file already under review is
      // left to the reader — its own read will say the same thing.
      for (const f of s.queued) addLog({ name: f.name, status: "skipped", notes: [], error: "Nezpracováno — předchozí soubor narazil na limit." });
      s.queued = [];
    }
    dropRunning(id);
  }

  function enqueue(files: File[]) {
    const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) return;
    s.queued.push(...pdfs);
    emit();
    void startNext();
  }

  return {
    enqueue,
    confirm: (hits) => void confirm(hits),
    cancelReview,
    decide,
    resolve,
    state: () => ({ stage: s.stage, queued: [...s.queued], running: [...s.running], log: [...s.log] }),
  };
}
