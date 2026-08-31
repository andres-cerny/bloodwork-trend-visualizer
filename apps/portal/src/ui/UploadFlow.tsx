/**
 * Choosing files and walking each one through the pipeline in lib/upload.ts.
 *
 * Files go one at a time, because every one of them stops at the review
 * screen and a reader can only look at one report at once. The queue is what
 * lets several be picked in one go; the log under it is where each one ends
 * up, with the notes an honest read produces — a page that failed, a value
 * that disagreed with the print.
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

type Stage =
  | { kind: "idle" }
  | { kind: "preparing"; name: string }
  | { kind: "review"; prepared: PreparedFile }
  | { kind: "redacting"; name: string }
  | { kind: "extracting"; name: string; done: number; total: number }
  | { kind: "storing"; name: string };

interface LogEntry {
  name: string;
  status: "done" | "failed" | "skipped";
  notes: string[];
  error: string | null;
}

export default function UploadFlow({ registry, maxPages, frozen, onStored, onBudget }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [queued, setQueued] = useState<File[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  // The queue is worked from async code that outlives the render it started
  // in, so the truth lives in a ref and `queued` is its mirror.
  const queueRef = useRef<File[]>([]);
  const busyRef = useRef(false);

  const publishQueue = () => setQueued([...queueRef.current]);
  const addLog = (e: LogEntry) => setLog((l) => [e, ...l]);

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

  /** Everything after the reader's confirmation. */
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
      setStage({ kind: "extracting", name, done: 0, total: pages.length });
      const id = newReportId();
      const { report, notes } = await extractReport(id, prepared, pages, registry, (done, total) =>
        setStage({ kind: "extracting", name, done, total }),
      );
      setStage({ kind: "storing", name });
      const stored = await storeReport(report, pages);
      onStored(stored);
      addLog({ name, status: "done", notes, error: null });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : `Nepodařilo se zpracovat PDF: ${e instanceof Error ? e.message : e}`;
      addLog({ name, status: "failed", notes: [], error: message });
      if (e instanceof ApiError && e.budget) onBudget(e.budget);
      if (isFatalApiError(e)) {
        // Every remaining file would fail the same way; say so instead of
        // leaving them queued and silent.
        for (const f of queueRef.current) addLog({ name: f.name, status: "skipped", notes: [], error: "Nezpracováno — předchozí soubor narazil na limit." });
        queueRef.current = [];
        publishQueue();
      }
    }
    finish();
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

  const busy = stage.kind !== "idle";
  const status =
    stage.kind === "preparing"
      ? `Otevírám ${stage.name}…`
      : stage.kind === "redacting"
        ? `Anonymizuji ${stage.name}…`
        : stage.kind === "extracting"
          ? `Čtu ${stage.name}: strana ${stage.done} z ${stage.total}…`
          : stage.kind === "storing"
            ? `Ukládám ${stage.name}…`
            : null;

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
          {busy
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

      {stage.kind === "extracting" && stage.total > 0 && (
        <div className="progressbar" style={{ marginTop: 8 }} role="progressbar" aria-valuenow={stage.done} aria-valuemin={0} aria-valuemax={stage.total}>
          <i style={{ width: `${(stage.done / stage.total) * 100}%` }} />
        </div>
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
