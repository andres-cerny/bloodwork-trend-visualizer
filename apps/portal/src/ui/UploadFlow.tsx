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
 * The order of things lives in lib/uploadQueue.ts; this file renders its
 * state and hands the reader's choices back. Two of those choices are new
 * since the queue learned to recognise a report it already holds: a file
 * the account has (by its bytes) stops before anything is opened, and a
 * read that looks like a stored report (same date, same laboratory) stops
 * before it is saved. Both offer Přeskočit, the default, and Nahradit.
 *
 * The queue is what lets several be picked in one go; the running list is
 * where confirmed files are read; the log under it is where each one ends
 * up, with the notes an honest read produces — a page that failed, a value
 * that disagreed with the print, a printed row nobody read.
 */
import { useRef, useState } from "react";
import { type LabReport, type Registry, count } from "@bw/lab-core";
import type { Budget } from "../lib/api";
import { checkRedaction, extractReport, fingerprintFile, newReportId, prepareFile, redactFile, storeReport } from "../lib/upload";
import { type QueueState, type UploadQueue, alreadyStored, createUploadQueue, probablyStored } from "../lib/uploadQueue";
import RedactReview from "./RedactReview";

interface Props {
  registry: Registry;
  maxPages: number;
  frozen: boolean;
  /** The account's reports as loaded — what a picked file is checked against. */
  reports: LabReport[];
  onStored: (report: LabReport) => void;
  onBudget: (b: Budget) => void;
}

/** The notice under a held file, with the two ways out. Skip is the default. */
function DuplicateChoice({ text, onSkip, onReplace }: { text: string; onSkip: () => void; onReplace: () => void }) {
  return (
    <>
      <span className="job-note dup">{text}</span>
      <span className="job-actions">
        <button type="button" className="btn small primary" onClick={onSkip}>
          Přeskočit
        </button>
        <button type="button" className="btn small" onClick={onReplace}>
          Nahradit
        </button>
      </span>
    </>
  );
}

export default function UploadFlow({ registry, maxPages, frozen, reports, onStored, onBudget }: Props) {
  const [state, setState] = useState<QueueState>({ stage: { kind: "idle" }, queued: [], running: [], log: [] });
  const [dragging, setDragging] = useState(false);
  // The queue outlives any one render and its work is async, so the props
  // it reads go through refs that every render refreshes.
  const live = useRef({ registry, maxPages, reports, onStored, onBudget });
  live.current = { registry, maxPages, reports, onStored, onBudget };
  const queue = useRef<UploadQueue | null>(null);
  if (!queue.current) {
    queue.current = createUploadQueue(
      {
        reports: () => live.current.reports,
        fingerprint: fingerprintFile,
        prepare: (file) => prepareFile(file, live.current.maxPages),
        redact: redactFile,
        check: checkRedaction,
        extract: (id, prepared, pages, onProgress, onRow, fingerprint) =>
          extractReport(
            id,
            prepared,
            pages,
            live.current.registry,
            onProgress,
            (pageNum, row) => {
              const name = (row.raw_analyte_name ?? "").trim();
              if (name) onRow(pageNum, name, row.value_raw ?? "", row.unit_raw ?? "");
            },
            fingerprint,
          ),
        store: storeReport,
        newId: newReportId,
        onStored: (r) => live.current.onStored(r),
        onBudget: (b) => live.current.onBudget(b),
      },
      setState,
    );
  }
  const q = queue.current;
  const { stage, queued, running, log } = state;

  if (frozen)
    return (
      <p className="muted">
        Měsíční limit zpracování je vyčerpán — nahrávání se obnoví začátkem příštího měsíce. Uložené
        výsledky fungují dál.
      </p>
    );

  if (stage.kind === "review")
    return <RedactReview prepared={stage.prepared} onConfirm={(hits) => q.confirm(hits)} onCancel={() => q.cancelReview()} />;

  // Busy means the reader is needed or the browser is working on their file;
  // reads in the background do not block picking the next one.
  const busy = stage.kind !== "idle";
  const status =
    stage.kind === "preparing"
      ? `Otevírám ${stage.name}…`
      : stage.kind === "redacting"
        ? `Anonymizuji ${stage.name}…`
        : stage.kind === "duplicate"
          ? `Čekám na vaši volbu u souboru ${stage.name}`
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
          q.enqueue([...(e.dataTransfer.files ?? [])]);
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
            q.enqueue([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </label>

      {stage.kind === "duplicate" && (
        <ul className="joblist" aria-live="polite">
          <li className="job duplicate">
            <span className="job-head">
              <span className="job-mark" aria-hidden="true">
                =
              </span>
              <span className="job-name" title={stage.name}>
                {stage.name}
              </span>
              <span className="job-state">už nahráno</span>
            </span>
            <DuplicateChoice text={alreadyStored(stage.existing)} onSkip={() => q.decide("skip")} onReplace={() => q.decide("replace")} />
          </li>
        </ul>
      )}

      {running.length > 0 && (
        <ul className="joblist" aria-live="polite">
          {running.map((r) => (
            <li key={r.id} className={`job ${r.phase === "probable" ? "duplicate" : "running"}`}>
              <span className="job-head">
                <span className="job-mark" aria-hidden="true">
                  {r.phase === "probable" ? "=" : "…"}
                </span>
                <span className="job-name" title={r.name}>
                  {r.name}
                </span>
                <span className="job-state">
                  {r.phase === "storing"
                    ? "ukládám"
                    : r.phase === "probable"
                      ? "přečteno, neuloženo"
                      : `${r.total > 0 ? `strana ${r.done} z ${r.total}` : "čtu"}${r.rows ? ` · ${count(r.rows, "řádek", "řádky", "řádků")}` : ""}`}
                </span>
              </span>
              {r.phase === "probable" && r.existing && (
                <DuplicateChoice text={probablyStored(r.existing)} onSkip={() => q.resolve(r.id, "skip")} onReplace={() => q.resolve(r.id, "replace")} />
              )}
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
