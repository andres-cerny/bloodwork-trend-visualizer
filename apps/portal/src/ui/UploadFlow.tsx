/**
 * Choosing files and walking each one through the pipeline in lib/upload.ts.
 *
 * The reader's part goes one file at a time — every file stops at the
 * review screen and a person can only look at one report at once. The
 * machine's part does not wait for them: once a file is confirmed and
 * painted, its extraction runs in the background while the next file is
 * opened and reviewed, and the pages of every file in flight share one
 * ceiling (lib/inflight.ts). A five-file backlog used to take five
 * page-times because each file waited for the previous one to finish
 * reading; now it takes about one, plus the reviews.
 *
 * The queue is what lets several be picked in one go; the running list is
 * where confirmed files are read; the log under it is where each one ends
 * up, with the notes an honest read produces — a page that failed, a value
 * that disagreed with the print, a printed row nobody read.
 *
 * The files picked together are one batch (lib/batch.ts), counted here
 * because this is where a file enters and where it ends: every file gets
 * exactly one log entry, so the log is where the batch is stepped. The
 * parent is told on every change; on an account with no reports yet it
 * holds the switch to Souhrn until the batch ends, and says so here.
 *
 * ## Two inputs, because one cannot do both jobs
 *
 * `capture="environment"` is not a hint that a camera would be nice: on
 * several mobile browsers it *replaces* the picker, so an input carrying it
 * offers the camera and nothing else — no gallery, no Files, no Drive. An
 * input without it offers the library and the file browser and never the
 * viewfinder. There is no third value that means "both", so there are two
 * controls: the drop target's picker (PDF and photo types, no `capture`) and
 * `.shoot` beside it (`image/*` plus `capture`). `.shoot` is revealed by
 * `(pointer: coarse)` in CSS rather than by a guess about the user agent,
 * which also keeps it out of the tab order on a desktop, where it would open
 * a file dialog labelled as a camera.
 */
import { useEffect, useRef, useState } from "react";
import { type IdentityHit, type LabReport, type Registry, count, czDate } from "@bw/lab-core";
import { PHOTO_TYPES, PhotoError, isPhotoFile } from "@bw/lab-core/photo";
import { type Allowance, type Budget, ApiError, isFatalApiError, reportEmptyDocument, withRetry } from "../lib/api";
import { UNSUPPORTED_COPY, sameDayCheck, sizeRefusal } from "../lib/fileChecks";
import { type Batch, NO_BATCH, pick, settle, waitingLine } from "../lib/batch";
import { exhaustedCopy } from "./AllowanceChip";
import {
  FileRefused,
  type PreparedFile,
  ReadFailed,
  checkRedaction,
  extractReport,
  newReportId,
  prepareFile,
  redactFile,
  storeReport,
} from "../lib/upload";
import FileCheck from "./FileCheck";
import PhotoCheck from "./PhotoCheck";
import RedactReview from "./RedactReview";

interface Props {
  registry: Registry;
  maxPages: number;
  frozen: boolean;
  /** Documents left to upload; null before /api/status has answered. */
  allowance: Allowance | null;
  onAllowance: (a: Allowance) => void;
  /** Opens the buy sheet — the refusal at zero offers it. */
  onBuy: () => void;
  onStored: (report: LabReport) => void;
  onBudget: (b: Budget) => void;
  /** The batch changed: a file came in, or one ended. */
  onBatch: (b: Batch) => void;
  /** The parent is holding Souhrn for this batch — say so under the queue. */
  holding: boolean;
  /** What the account holds — for the same file, or the same report, picked again. */
  reports?: LabReport[];
  /** A batch ended; `problems` is how many of its files failed or carry notes. */
  onBatchEnd?: (problems: number) => void;
}

/** What the reader is doing — one file at a time. */
type Stage =
  | { kind: "idle" }
  | { kind: "preparing"; name: string; photo: boolean }
  /** A photo the checks warned on or refused — before its review. */
  | { kind: "photoCheck"; prepared: PreparedFile }
  /** A file the checks warn on (lib/fileChecks.ts) — before its review. */
  | { kind: "fileCheck"; prepared: PreparedFile }
  | { kind: "review"; prepared: PreparedFile }
  | { kind: "redacting"; name: string };

/**
 * What the picker offers.
 *
 * HEIC is named although no browser here can be relied on to decode it:
 * leaving it off greys out every iPhone photo in the file browser with no
 * explanation, whereas accepting it lets `photoAssets` fail with a sentence
 * that says what to send instead. Naming `image/jpeg` is also what makes the
 * iOS Photos picker transcode a HEIC on its way out.
 */
const ACCEPT = ["application/pdf", ...PHOTO_TYPES].join(",");

/**
 * What the log says when the read went through and the store did not. The
 * two halves are different facts: the pages were read and the document is
 * spent (the worker refuses a release once a page was read), and the row
 * was refused. „Nepodařilo se zpracovat PDF" would name the wrong half.
 * `reason` is the worker's own sentence where it gave one.
 */
export const storeFailedCopy = (reason: string) =>
  `Report se přečetl, ale nepodařilo se ho uložit: ${reason.replace(/\.?$/, ".")} Přečtené hodnoty držíme — zkuste uložit znovu, dokud je okno otevřené.`;

/**
 * Why a file would not open, in a sentence the person can act on. pdf.js
 * names its failures by class — the log used to print them as they came:
 * „PasswordException: No password given".
 */
export function openFailedCopy(e: unknown): string {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  const text = e instanceof Error ? e.message : String(e);
  if (name === "PasswordException" || /password/i.test(text))
    return "PDF je chráněné heslem. Otevřete ho, uložte kopii bez hesla (Tisk → Uložit jako PDF) a nahrajte ji.";
  if (name === "InvalidPDFException" || name === "MissingPDFException" || /invalid pdf|empty/i.test(text))
    return "Soubor není čitelné PDF — je poškozený, prázdný, nebo jde o jiný typ souboru přejmenovaný na .pdf.";
  if (/dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(text))
    return "Aplikace se mezitím aktualizovala. Obnovte prosím stránku a nahrajte soubor znovu.";
  return "Soubor se nepodařilo otevřít. Zkuste ho prosím nahrát znovu, případně ho uložte znovu jako PDF.";
}

/** What the machine is doing — as many files as have been confirmed. */
interface Running {
  id: string;
  name: string;
  phase: "extracting" | "storing";
  done: number;
  total: number;
  /** Distinct rows seen so far, across pages and readers. */
  rows: number;
  /** The last few, as "name value unit" — what the reader sees arriving. */
  latest: string[];
}

interface LogEntry {
  /** Stable across a retry, so the entry is replaced rather than duplicated. */
  key: string;
  name: string;
  status: "done" | "failed" | "skipped" | "waiting";
  notes: string[];
  error: string | null;
  /** Stored, but with a note the person should read (ExtractOutcome.serious). */
  serious?: boolean;
  /** A second choice beside `retry` — „Neukládat" beside „Uložit i tak". */
  dismiss?: { label: string; run: () => void };
  /**
   * What „Zkusit znovu" does, when a second try can succeed without the
   * person redoing anything: the redacted pages (and, after a failed save,
   * the read report) are still held in memory. Gone on reload — which is
   * why the page asks before it is left while anything is held.
   */
  retry?: { label: string; run: () => void };
}

export default function UploadFlow({ registry, maxPages, frozen, allowance, onAllowance, onBuy, onStored, onBudget, onBatch, holding, reports = [], onBatchEnd }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [queued, setQueued] = useState<File[]>([]);
  const [running, setRunning] = useState<Running[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [batch, setBatch] = useState<Batch>(NO_BATCH);
  const [dragging, setDragging] = useState(false);
  // The queue is worked from async code that outlives the render it started
  // in, so the truth lives in a ref and `queued` is its mirror. The batch
  // the same: stepped from the same async code, mirrored for the screen.
  const queueRef = useRef<File[]>([]);
  const batchRef = useRef<Batch>(NO_BATCH);
  const busyRef = useRef(false);
  // Read from async code that outlives the render: the account's reports as
  // they are now, and the files of this tab's session already on their way.
  const reportsRef = useRef<LabReport[]>(reports);
  reportsRef.current = reports;
  const underway = useRef(new Set<string>());
  const problemsRef = useRef(0);

  const publishQueue = () => setQueued([...queueRef.current]);
  const publishBatch = (b: Batch) => {
    batchRef.current = b;
    setBatch(b);
    onBatch(b);
  };
  // One entry per file, whichever way it ended — so one entry is one file
  // settled, and the batch is stepped here and nowhere else.
  const addLog = (e: Omit<LogEntry, "key"> & { key?: string }) => {
    const entry = { ...e, key: e.key ?? `${Date.now()}-${Math.random()}` };
    setLog((l) => [entry, ...l.filter((x) => x.key !== entry.key)]);
    if (entry.status === "failed" || entry.status === "waiting" || entry.serious) problemsRef.current += 1;
    const next = settle(batchRef.current);
    const closed = next.total === 0 && batchRef.current.total > 0;
    publishBatch(next);
    if (closed) {
      onBatchEnd?.(problemsRef.current);
      problemsRef.current = 0;
    }
  };
  /** A retry takes its entry off the log and puts its file back into the batch. */
  const reopen = (key: string) => {
    setLog((l) => l.filter((x) => x.key !== key));
    publishBatch(pick(batchRef.current, 1));
  };

  // A file dropped anywhere but the target — or while the review is up and
  // the target is not drawn at all — made the browser open it in place of
  // the app, and every file in flight went with the page. Caught at the
  // window, the drop target still gets its own events first.
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  // Closing or reloading the tab mid-read used to lose the file without a
  // word — and the redacted pages a retry needs. The browser's own dialog is
  // the only thing that can stop that; its text is the browser's, not ours.
  const holdsWork = stage.kind !== "idle" || running.length > 0 || queued.length > 0 || log.some((j) => j.retry);
  useEffect(() => {
    if (!holdsWork) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [holdsWork]);
  const updateRunning = (id: string, patch: Partial<Running>) =>
    setRunning((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const dropRunning = (id: string) => setRunning((rs) => rs.filter((r) => r.id !== id));

  async function startNext() {
    if (busyRef.current) return;
    const file = queueRef.current.shift();
    publishQueue();
    if (!file) return;
    busyRef.current = true;
    setStage({ kind: "preparing", name: file.name, photo: isPhotoFile(file) });
    try {
      const prepared = await prepareFile(file, maxPages);
      // The same file again — already stored, or already on its way in this
      // tab — is said before a document is spent on it.
      const fp = prepared.fingerprint;
      const held = fp ? reportsRef.current.find((r) => r.fingerprint === fp) : undefined;
      if (held || (fp && underway.current.has(fp))) {
        addLog({
          name: file.name,
          status: "skipped",
          notes: [],
          error: held ? `Tento soubor už máte nahraný (report z ${czDate(held.reportDate)}) — nic se neposílalo.` : "Tento soubor se už nahrává — nic se neposílalo podruhé.",
        });
        finish();
        return;
      }
      // A photo the checks did not pass stops first, and the person decides;
      // then the file's own warnings; then the review.
      const checked = prepared.photo && prepared.photo.verdict.outcome !== "ok";
      setStage(checked ? { kind: "photoCheck", prepared } : afterPhotoCheck(prepared));
    } catch (e) {
      // A PhotoError already carries the sentence the person needs — which
      // format it was and what to send instead. Wrapping it would bury it.
      const error = e instanceof PhotoError || e instanceof FileRefused ? e.message : openFailedCopy(e);
      addLog({ name: file.name, status: "failed", notes: [], error });
      finish();
    }
  }

  const afterPhotoCheck = (prepared: PreparedFile): Stage =>
    prepared.warnings?.length ? { kind: "fileCheck", prepared } : { kind: "review", prepared };

  function finish() {
    busyRef.current = false;
    setStage({ kind: "idle" });
    void startNext();
  }

  /** The reader's half after confirmation: paint, check, then hand over. */
  async function proceed(prepared: PreparedFile, hits: IdentityHit[]) {
    const name = prepared.name;
    try {
      setStage({ kind: "redacting", name });
      const pages = await redactFile(prepared, hits);
      const survived = checkRedaction(pages, hits);
      if (survived.length) {
        // Painted, stripped, and still readable: refuse rather than upload
        // and hope. This is the check the Python exporter makes, in the
        // browser.
        throw new Error(`anonymizace se nezdařila — v textu zůstalo: ${survived.slice(0, 3).join(", ")}`);
      }
      const id = newReportId();
      if (prepared.fingerprint) underway.current.add(prepared.fingerprint);
      // Not awaited: the next file's review must not wait for this read.
      void extractInBackground(id, name, prepared, pages);
    } catch (e) {
      addLog({ name, status: "failed", notes: [], error: `Soubor se nepodařilo zpracovat: ${e instanceof Error ? e.message : e}` });
    }
    finish();
  }

  /** The machine's half: read every page under the shared ceiling, store. */
  async function extractInBackground(
    id: string,
    name: string,
    prepared: PreparedFile,
    pages: Awaited<ReturnType<typeof redactFile>>,
    key = `${id}`,
  ) {
    setRunning((rs) => [...rs, { id, name, phase: "extracting", done: 0, total: pages.length, rows: 0, latest: [] }]);
    // Rows arrive as the readers write them, both readers, out of order
    // across pages. One line per printed row is enough for the screen: the
    // first reader to name it wins, and the count is of distinct rows.
    const seen = new Set<string>();
    const latest: string[] = [];
    let report: LabReport | null = null;
    let notes: string[] = [];
    let serious = false;
    try {
      ({ report, notes, serious = false } = await extractReport(
        id,
        prepared,
        pages,
        registry,
        (done, total) => updateRunning(id, { done, total }),
        (pageNum, row) => {
          const name = (row.raw_analyte_name ?? "").trim();
          if (!name) return;
          const k = `${pageNum}:${name.toLowerCase()}`;
          if (seen.has(k)) return;
          seen.add(k);
          latest.push([name, row.value_raw ?? "", row.unit_raw ?? ""].filter(Boolean).join(" "));
          if (latest.length > 4) latest.shift();
          updateRunning(id, { rows: seen.size, latest: [...latest] });
        },
        onAllowance,
      ));
    } catch (e) {
      dropRunning(id);
      if (prepared.fingerprint) underway.current.delete(prepared.fingerprint);
      failedRead(e, id, name, prepared, pages, key);
      return;
    }
    dropRunning(id);
    if (prepared.fingerprint) underway.current.delete(prepared.fingerprint);

    // Nothing to store, or something already stored: the read happened, and
    // the document goes back — except every third time in 30 days.
    if (report.measurements.length === 0) {
      await emptyRead(report.id, name, key, "V reportu jsme nenašli žádné hodnoty — nic se neuložilo.");
      return;
    }
    const same = sameDayCheck(report, reportsRef.current);
    if (same.kind === "duplicate") {
      await emptyRead(report.id, name, key, `Tento report už máte (${czDate(same.other.reportDate)}, stejné hodnoty) — podruhé jsme ho neuložili.`);
      return;
    }
    if (same.kind === "repeat") {
      // Same day, same parameters, other values: a second draw that day is
      // real, and so is a misread. Held until the person says which.
      const held = report;
      addLog({
        key,
        name,
        status: "waiting",
        notes,
        error: `Report ze stejného dne (${czDate(same.other.reportDate)}) už máte a hodnoty se liší. Jde o další odběr téhož dne? Pokud ano, uložte ho — v trendech budou obě hodnoty.`,
        retry: {
          label: "Uložit i tak",
          run: () => {
            reopen(key);
            void storeInBackground(held, pages, name, notes, key, serious);
          },
        },
        dismiss: {
          label: "Neukládat",
          run: () => setLog((l) => l.map((x) => (x.key === key ? { ...x, status: "skipped", error: "Neuloženo.", retry: undefined, dismiss: undefined } : x))),
        },
      });
      return;
    }
    await storeInBackground(report, pages, name, notes, key, serious);
  }

  /** A read with nothing to store: tell the worker, and say what came of it. */
  async function emptyRead(id: string, name: string, key: string, what: string) {
    const r = await withRetry(() => reportEmptyDocument(id)).catch(() => null);
    if (r) onAllowance(r.allowance);
    const after = !r
      ? " Dokument se nepodařilo vrátit — napište nám prosím."
      : r.refunded
        ? " Dokument se vrátil do vašeho nároku."
        : " Dokument se tentokrát nevrací: je to třetí takové nahrání za posledních 30 dní.";
    addLog({ key, name, status: "failed", notes: [], error: what + after });
  }

  /** Persist a read report; on failure keep it, and offer to save it again. */
  async function storeInBackground(report: LabReport, pages: Awaited<ReturnType<typeof redactFile>>, name: string, notes: string[], key: string, serious = false) {
    setRunning((rs) => [...rs, { id: report.id, name, phase: "storing", done: 0, total: 0, rows: 0, latest: [] }]);
    try {
      const stored = await withRetry(() => storeReport(report, pages));
      onStored(stored);
      addLog({ key, name, status: "done", notes, error: null, serious });
    } catch (e) {
      const reason = e instanceof ApiError ? e.message : "Neznámá chyba.";
      addLog({
        key,
        name,
        status: "failed",
        notes,
        error: storeFailedCopy(reason),
        // The document is spent and the values are read: saving again costs
        // nothing, and PUT of the same report id is safe to repeat.
        retry: {
          label: "Uložit znovu",
          run: () => {
            reopen(key);
            void storeInBackground(report, pages, name, notes, key, serious);
          },
        },
      });
      if (isFatalApiError(e)) skipQueued(e);
    }
    dropRunning(report.id);
  }

  function failedRead(e: unknown, id: string, name: string, prepared: PreparedFile, pages: Awaited<ReturnType<typeof redactFile>>, key: string) {
    const message = e instanceof ApiError || e instanceof ReadFailed ? e.message : `Soubor se nepodařilo zpracovat: ${e instanceof Error ? e.message : String(e)}`;
    if (e instanceof ApiError && e.budget) onBudget(e.budget);
    if (e instanceof ApiError && e.allowance) onAllowance(e.allowance);
    // Worth a second try when nothing the person can change caused it. The
    // pages are already redacted, so the retry skips the review; a document
    // that went back is opened afresh, one still held is reused by its id.
    const retryable = e instanceof ReadFailed || (e instanceof ApiError && !isFatalApiError(e) && e.code !== "bad_request");
    const retryId = e instanceof ReadFailed && e.released ? newReportId() : id;
    addLog({
      key,
      name,
      status: "failed",
      notes: [],
      error: message,
      retry: retryable
        ? {
            label: "Zkusit znovu",
            run: () => {
              reopen(key);
              void extractInBackground(retryId, name, prepared, pages, key);
            },
          }
        : undefined,
    });
    if (isFatalApiError(e)) skipQueued(e);
  }

  /** Every file still waiting would fail the same way; say so instead of
   *  leaving them queued and silent. A file already under review is left to
   *  the reader — its own read will say the same thing. */
  function skipQueued(e: unknown) {
    const why =
      e instanceof ApiError && e.code === "unauthorized"
        ? "Nezpracováno — přihlášení vypršelo. Přihlaste se znovu a soubor nahrajte."
        : e instanceof ApiError && (e.code === "no_documents" || e.code === "no_document")
          ? "Nezpracováno — došly dokumenty v nároku."
          : "Nezpracováno — předchozí soubor narazil na limit.";
    for (const f of queueRef.current) addLog({ name: f.name, status: "skipped", notes: [], error: why });
    queueRef.current = [];
    publishQueue();
  }

  /**
   * `accept` is a hint and nothing more — drag and drop ignores it outright,
   * and a phone's file browser hands over a HEIC whatever it says — so the
   * real filter is here, and it takes photographs as well as PDFs. A mixed
   * selection is normal: two PDFs and a photo of the third page go in one
   * queue, each one reviewed in turn.
   */
  function enqueue(files: File[]) {
    const usable: File[] = [];
    for (const f of files) {
      const photo = isPhotoFile(f);
      const pdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      // Each refused file is said, once, instead of vanishing from a mixed
      // selection without a word.
      const why = !photo && !pdf ? UNSUPPORTED_COPY : sizeRefusal(f, photo);
      if (why) {
        setLog((l) => [{ key: `${Date.now()}-${Math.random()}`, name: f.name, status: "failed", notes: [], error: why }, ...l]);
        continue;
      }
      usable.push(f);
    }
    if (usable.length === 0) return;
    // A photo's local reading needs ~6 MB of files; start fetching them
    // now, while the person is still on the first screen.
    if (usable.some(isPhotoFile)) void import("../lib/ocr").then((m) => m.preload()).catch(() => undefined);
    queueRef.current.push(...usable);
    publishQueue();
    if (batchRef.current.total === 0) problemsRef.current = 0;
    publishBatch(pick(batchRef.current, usable.length));
    void startNext();
  }

  if (frozen)
    return (
      <p className="muted">
        Měsíční limit zpracování je vyčerpán — nahrávání se obnoví začátkem příštího měsíce. Uložené
        výsledky fungují dál.
      </p>
    );

  // No document left, and nothing in flight: the picker gives way to the
  // refusal and the way to buy. A file already being read finishes.
  if (allowance && allowance.remaining === 0 && stage.kind === "idle" && running.length === 0)
    return (
      <div className="allow-out">
        <p className="muted" style={{ margin: 0 }}>{exhaustedCopy(allowance)}</p>
        <p style={{ margin: "10px 0 0" }}>
          <button type="button" className="btn small primary" onClick={onBuy}>
            Přikoupit
          </button>
        </p>
        {log.length > 0 && (
          <ul className="joblist">
            {log.map((j) => (
              <li key={j.key} className={`job ${j.status}`}>
                <span className="job-head">
                  <span className="job-mark" aria-hidden="true">
                    {j.status === "done" ? "✓" : j.status === "failed" ? "✕" : "–"}
                  </span>
                  <span className="job-name" title={j.name}>
                    {j.name}
                  </span>
                  <span className="job-state">
                    {j.status === "done" ? "uloženo" : j.status === "failed" ? "chyba" : "přeskočeno"}
                  </span>
                </span>
                {j.error && <span className="job-note err">{j.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );

  if (stage.kind === "photoCheck")
    return (
      <PhotoCheck
        prepared={stage.prepared}
        onRetake={(files) => {
          // This photo is dropped without anything sent; the new one queues
          // first, ahead of any file still waiting. It joins the batch before
          // the dropped one settles, so a batch of one does not close and
          // reopen — the parent holding Souhrn would switch in between.
          const usable = files.filter(isPhotoFile);
          queueRef.current.unshift(...usable);
          publishQueue();
          publishBatch(pick(batchRef.current, usable.length));
          addLog({ name: stage.prepared.name, status: "skipped", notes: [], error: null });
          finish();
        }}
        onSendAnyway={() => setStage(afterPhotoCheck(stage.prepared))}
        onCancel={() => {
          addLog({ name: stage.prepared.name, status: "skipped", notes: [], error: null });
          finish();
        }}
      />
    );

  if (stage.kind === "fileCheck")
    return (
      <FileCheck
        prepared={stage.prepared}
        onSendAnyway={() => setStage({ kind: "review", prepared: stage.prepared })}
        onCancel={() => {
          addLog({ name: stage.prepared.name, status: "skipped", notes: [], error: null });
          finish();
        }}
      />
    );

  if (stage.kind === "review")
    return (
      <RedactReview
        prepared={stage.prepared}
        onConfirm={(hits) => void proceed(stage.prepared, hits)}
        onCancel={() => {
          addLog({ name: stage.prepared.name, status: "skipped", notes: [], error: null });
          finish();
        }}
      />
    );

  // Busy means the reader is needed or the browser is working on their file;
  // reads in the background do not block picking the next one.
  const busy = stage.kind !== "idle";
  const status =
    stage.kind === "preparing"
      ? stage.photo
        ? `Kontroluji fotku ${stage.name}…`
        : `Otevírám ${stage.name}…`
      : stage.kind === "redacting"
        ? `Anonymizuji ${stage.name}…`
        : running.length > 0
          ? `Na pozadí se čte ${count(running.length, "soubor", "soubory", "souborů")} — můžete přidat další`
          : null;
  const keepOpen = busy || running.length > 0;

  return (
    <>
      <label
        className={`drop${dragging ? " over" : ""}${busy ? " busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          enqueue([...(e.dataTransfer.files ?? [])]);
        }}
      >
        <span className="drop-icon" aria-hidden="true">
          {busy ? "⏳" : "📄"}
        </span>
        <span className="drop-main">{status ?? "Přetáhněte PDF nebo fotku sem"}</span>
        <span className="drop-sub">
          {keepOpen
            ? queued.length > 0
              ? `Nechte okno otevřené · ve frontě ${count(queued.length, "soubor", "soubory", "souborů")}`
              : "Nechte okno otevřené."
            : `nebo klepněte a vyberte — i více najednou · nejvýše ${count(maxPages, "strana", "strany", "stran")} na report, PDF do 20 MB`}
        </span>
        {/*
          The picker half of the pair: no `capture`, so iOS offers Fotky and
          Procházet, and Android the gallery beside the file browser. `multiple`
          because a selection may be several PDFs, several photographs, or both
          at once — a photograph is simply one more page in the queue.
        */}
        <input
          type="file"
          accept={ACCEPT}
          multiple
          disabled={busy}
          onChange={(e) => {
            enqueue([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </label>

      {/*
        The camera half, on a phone only — see the note at the top of the file.
        Not `multiple`: a camera returns one frame.
      */}
      <label className={`shoot${busy ? " busy" : ""}`}>
        <span aria-hidden="true">📷</span>
        <span>Vyfotit papír</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={busy}
          onChange={(e) => {
            enqueue([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </label>

      {/*
        The first batch: the parent holds Souhrn until every file has ended,
        and the person waiting in front of a list of progress bars is told
        what the wait is for. Under the drop target and above the list, so it
        reads before the per-file detail; gone the moment the batch ends,
        which is the moment the screen switches.
      */}
      {holding && batch.total > 0 && (
        <p className="muted batch-wait" aria-live="polite" style={{ margin: "9px 0 0" }}>
          {waitingLine(batch)}
        </p>
      )}

      {running.length > 0 && (
        <ul className="joblist" aria-live="polite">
          {running.map((r) => (
            <li key={r.id} className="job running">
              <span className="job-head">
                <span className="job-mark" aria-hidden="true">
                  …
                </span>
                <span className="job-name" title={r.name}>
                  {r.name}
                </span>
                <span className="job-state">
                  {r.phase === "storing"
                    ? "ukládám"
                    : `${r.total > 0 ? `strana ${r.done} z ${r.total}` : "čtu"}${r.rows ? ` · ${count(r.rows, "řádek", "řádky", "řádků")}` : ""}`}
                </span>
              </span>
              {r.phase === "extracting" && r.latest.length > 0 && (
                <span className="job-note" aria-hidden="true">
                  {r.latest.join(" · ")}
                </span>
              )}
              {r.phase === "extracting" && r.total > 0 && (
                <div className="progressbar" style={{ marginTop: 6 }} role="progressbar" aria-valuenow={r.done} aria-valuemin={0} aria-valuemax={r.total}>
                  <i style={{ width: `${(r.done / r.total) * 100}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {log.length > 0 && (
        <ul className="joblist">
          {log.map((j) => (
            <li key={j.key} className={`job ${j.status}`}>
              <span className="job-head">
                <span className="job-mark" aria-hidden="true">
                  {j.status === "done" ? "✓" : j.status === "failed" ? "✕" : j.status === "waiting" ? "?" : "–"}
                </span>
                <span className="job-name" title={j.name}>
                  {j.name}
                </span>
                <span className="job-state">
                  {j.status === "done" ? "uloženo" : j.status === "failed" ? "chyba" : j.status === "waiting" ? "čeká na vás" : "přeskočeno"}
                </span>
              </span>
              {j.notes.map((n, k) => (
                <span className="job-note" key={k}>
                  {n}
                </span>
              ))}
              {j.error && <span className="job-note err">{j.error}</span>}
              {(j.retry || j.dismiss) && (
                <span className="job-note job-actions">
                  {j.retry && (
                    <button type="button" className="btn small" onClick={j.retry.run}>
                      {j.retry.label}
                    </button>
                  )}
                  {j.dismiss && (
                    <button type="button" className="btn small" onClick={j.dismiss.run}>
                      {j.dismiss.label}
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/*
        The claim has to survive a photograph, and the old one did not: it said
        the identity is removed from the file, which on a PDF the automatic
        detection does and on a photograph nothing can — there is no text to
        search. So the sentence names who does the removing in each case.
      */}
      <p className="muted" style={{ margin: "9px 0 0" }}>
        PDF i fotka se otevřou ve vašem prohlížeči. U PDF najdeme jméno, rodné číslo, datum narození
        a adresu v textu a začerníme je <strong>před</strong> odesláním. Ve fotce je zkusíme přečíst
        přímo v prohlížeči a navrhneme, co začernit — zkontrolovat a doplnit to ale musíte vy; ve
        skenu hledat nejde, tam začerníte vše sami. Na server pak odejdou jen začerněné obrázky
        stránek a vytištěné řádky s hodnotami. Původní soubor se nikam neukládá.
      </p>
    </>
  );
}
