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
 */
import { useRef, useState } from "react";
import { type IdentityHit, type LabReport, type Registry, count } from "@bw/lab-core";
import { type Budget, ApiError, isFatalApiError } from "../lib/api";
import {
  type PreparedFile,
  checkRedaction,
  extractReport,
  newReportId,
  prepareFile,
  redactFile,
  storeReport,
} from "../lib/upload";
import RedactReview from "./RedactReview";

interface Props {
  registry: Registry;
  maxPages: number;
  frozen: boolean;
  onStored: (report: LabReport) => void;
  onBudget: (b: Budget) => void;
}

/** What the reader is doing — one file at a time. */
type Stage =
  | { kind: "idle" }
  | { kind: "preparing"; name: string }
  | { kind: "review"; prepared: PreparedFile }
  | { kind: "redacting"; name: string };

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
  name: string;
  status: "done" | "failed" | "skipped";
  notes: string[];
  error: string | null;
}

export default function UploadFlow({ registry, maxPages, frozen, onStored, onBudget }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [queued, setQueued] = useState<File[]>([]);
  const [running, setRunning] = useState<Running[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  // The queue is worked from async code that outlives the render it started
  // in, so the truth lives in a ref and `queued` is its mirror.
  const queueRef = useRef<File[]>([]);
  const busyRef = useRef(false);

  const publishQueue = () => setQueued([...queueRef.current]);
  const addLog = (e: LogEntry) => setLog((l) => [e, ...l]);
  const updateRunning = (id: string, patch: Partial<Running>) =>
    setRunning((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const dropRunning = (id: string) => setRunning((rs) => rs.filter((r) => r.id !== id));

  async function startNext() {
    if (busyRef.current) return;
    const file = queueRef.current.shift();
    publishQueue();
    if (!file) return;
    busyRef.current = true;
    setStage({ kind: "preparing", name: file.name });
    try {
      const prepared = await prepareFile(file, maxPages);
      setStage({ kind: "review", prepared });
    } catch (e) {
      addLog({ name: file.name, status: "failed", notes: [], error: `Soubor se nepodařilo otevřít: ${e}` });
      finish();
    }
  }

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
      setRunning((rs) => [...rs, { id, name, phase: "extracting", done: 0, total: pages.length, rows: 0, latest: [] }]);
      // Not awaited: the next file's review must not wait for this read.
      void extractInBackground(id, name, prepared, pages);
    } catch (e) {
      addLog({ name, status: "failed", notes: [], error: `Nepodařilo se zpracovat PDF: ${e instanceof Error ? e.message : e}` });
    }
    finish();
  }

  /** The machine's half: read every page under the shared ceiling, store. */
  async function extractInBackground(id: string, name: string, prepared: PreparedFile, pages: Awaited<ReturnType<typeof redactFile>>) {
    // Rows arrive as the readers write them, both readers, out of order
    // across pages. One line per printed row is enough for the screen: the
    // first reader to name it wins, and the count is of distinct rows.
    const seen = new Set<string>();
    const latest: string[] = [];
    try {
      const { report, notes } = await extractReport(
        id,
        prepared,
        pages,
        registry,
        (done, total) => updateRunning(id, { done, total }),
        (pageNum, row) => {
          const name = (row.raw_analyte_name ?? "").trim();
          if (!name) return;
          const key = `${pageNum}:${name.toLowerCase()}`;
          if (seen.has(key)) return;
          seen.add(key);
          latest.push([name, row.value_raw ?? "", row.unit_raw ?? ""].filter(Boolean).join(" "));
          if (latest.length > 4) latest.shift();
          updateRunning(id, { rows: seen.size, latest: [...latest] });
        },
      );
      updateRunning(id, { phase: "storing" });
      const stored = await storeReport(report, pages);
      onStored(stored);
      addLog({ name, status: "done", notes, error: null });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : `Nepodařilo se zpracovat PDF: ${e instanceof Error ? e.message : e}`;
      addLog({ name, status: "failed", notes: [], error: message });
      if (e instanceof ApiError && e.budget) onBudget(e.budget);
      if (isFatalApiError(e)) {
        // Every file still waiting would fail the same way; say so instead
        // of leaving them queued and silent. A file already under review is
        // left to the reader — its own read will say the same thing.
        for (const f of queueRef.current) addLog({ name: f.name, status: "skipped", notes: [], error: "Nezpracováno — předchozí soubor narazil na limit." });
        queueRef.current = [];
        publishQueue();
      }
    }
    dropRunning(id);
  }

  function enqueue(files: File[]) {
    const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) return;
    queueRef.current.push(...pdfs);
    publishQueue();
    void startNext();
  }

  if (frozen)
    return (
      <p className="muted">
        Měsíční limit zpracování je vyčerpán — nahrávání se obnoví začátkem příštího měsíce. Uložené
        výsledky fungují dál.
      </p>
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
      ? `Otevírám ${stage.name}…`
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
        <span className="drop-main">{status ?? "Přetáhněte PDF z laboratoře sem"}</span>
        <span className="drop-sub">
          {keepOpen
            ? queued.length > 0
              ? `Nechte okno otevřené · ve frontě ${count(queued.length, "soubor", "soubory", "souborů")}`
              : "Nechte okno otevřené."
            : `nebo klepněte a vyberte — i více najednou · nejvýše ${count(maxPages, "strana", "strany", "stran")} na report`}
        </span>
        <input
          type="file"
          accept="application/pdf"
          multiple
          disabled={busy}
          onChange={(e) => {
            enqueue([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </label>

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
          {log.map((j, i) => (
            <li key={i} className={`job ${j.status}`}>
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
              {j.notes.map((n, k) => (
                <span className="job-note" key={k}>
                  {n}
                </span>
              ))}
              {j.error && <span className="job-note err">{j.error}</span>}
            </li>
          ))}
        </ul>
      )}

      <p className="muted" style={{ margin: "9px 0 0" }}>
        PDF se otevře ve vašem prohlížeči. Jméno, rodné číslo, datum narození a adresa se z něj
        odstraní <strong>před</strong> odesláním; na server odejdou jen začerněné obrázky stránek a
        vytištěné řádky s hodnotami. Původní soubor se nikam neukládá.
      </p>
    </>
  );
}
