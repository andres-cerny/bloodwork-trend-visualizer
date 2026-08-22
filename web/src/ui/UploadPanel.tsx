/**
 * Turnstile-gated upload, living in the left rail: a drop target, a challenge
 * and honest per-file, per-page progress. One challenge mints a session
 * covering a bounded number of pages, so a multi-page report needs one CAPTCHA,
 * not one per page.
 *
 * Several PDFs can be selected or dropped at once, and more can be added while
 * the first ones are still running — they join a queue. The queue is worked
 * strictly one file at a time, and each file one page at a time, for the same
 * reason the page loop is sequential: a phone rendering a long report at 220
 * DPI concurrently is the fastest way to run it out of memory. Sequential also
 * keeps the session's page allowance spending in an order the reader can
 * follow, so when it runs out it is clear which document got the last page.
 */
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  type Budget,
  extract,
  hasSession,
  isFatalApiError,
  startSession,
} from "../lib/api";
import { type LabReport, type Measurement } from "../lib/models";
import { reconcile } from "../lib/reconcile";
import { type Registry } from "../lib/registry";
import { count, plural } from "../lib/czech";
import { type Job, makeJob, runQueue } from "../lib/uploadQueue";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => void };
    onTurnstileLoad?: () => void;
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

interface Props {
  registry: Registry;
  frozen: boolean;
  maxPages: number;
  onReport: (report: LabReport) => void;
  onBudget: (b: Budget) => void;
  onUnlock: () => void;
}

export default function UploadPanel({ registry, frozen, maxPages, onReport, onBudget, onUnlock }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(hasSession());
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job<File>[]>([]);

  // The queue is driven from an async loop that outlives the render it started
  // in, so it reads and writes through refs. `jobs` is the render mirror,
  // republished after every mutation.
  const jobsRef = useRef<Job<File>[]>([]);
  const runningRef = useRef(false);
  const seqRef = useRef(0);
  // Props the loop reads. Captured at call time they would go stale the moment
  // the budget or the allowance changed mid-queue.
  const propsRef = useRef({ registry, maxPages, onReport, onBudget });
  propsRef.current = { registry, maxPages, onReport, onBudget };

  const publish = () => setJobs([...jobsRef.current]);

  useEffect(() => {
    if (ready || !SITE_KEY || !boxRef.current) return;
    const el = boxRef.current;
    const render = () => {
      if (!window.turnstile || el.childElementCount > 0) return;
      window.turnstile.render(el, {
        sitekey: SITE_KEY,
        callback: async (token: string) => {
          try {
            await startSession(token);
            setReady(true);
            onUnlock();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "Ověření se nezdařilo.");
          }
        },
      });
    };
    if (window.turnstile) render();
    else {
      window.onTurnstileLoad = render;
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
      s.async = true;
      document.head.appendChild(s);
    }
  }, [ready, onUnlock]);

  /** Read one PDF end to end. Throws only on a fatal, queue-stopping error. */
  async function processOne(job: Job<File>) {
    const { registry, maxPages, onReport, onBudget } = propsRef.current;
    // pdf.js is ~1.4 MB and only the upload path needs it, so it is pulled in
    // on first use rather than shipped in the landing bundle.
    const { isPrintedOnPage, loadPdf, pageAssets, rowBoxFor, rowsAsText } = await import("../pdf/pdf");
    const doc = await loadPdf(job.file);
    const pageCount = Math.min(doc.numPages, maxPages);
    const measurements: Measurement[] = [];
    const pages = [];
    let unverified = 0;
    let sawScan = false;
    let reportDate: string | null = null;
    let labName: string | null = null;
    const failedPages: number[] = [];

    job.total = pageCount;

    for (let p = 1; p <= pageCount; p++) {
      job.page = p;
      publish();
      const assets = await pageAssets(doc, p);

      // Digital PDF: send the reconstructed rows, not the image. The model
      // assigns columns; the characters come from the file.
      let res;
      try {
        res = assets.hasTextLayer
          ? await extract(null, null, null, rowsAsText(assets.rows))
          : await extract(assets.imageBase64, assets.mediaType, assets.textLayer, null);
      } catch (e) {
        // A page that fails is skipped and reported, not allowed to sink the
        // whole report — same behaviour as the local pipeline.
        if (isFatalApiError(e)) throw e;
        failedPages.push(p);
        pages.push({
          pageNum: p,
          imageUrl: assets.imageUrl,
          imageWidth: assets.imageWidth,
          imageHeight: assets.imageHeight,
        });
        continue;
      }
      onBudget(res.budget);
      if (res.mode === "vision") sawScan = true;

      for (const read of res.reads) {
        reportDate = reportDate ?? read.report_date ?? null;
        labName = labName ?? read.lab_name ?? null;
      }
      for (const m of reconcile(res.reads)) {
        // Provenance: on the text path a transcribed value must literally
        // appear on the page. Anything that does not is a fabrication, and it
        // is flagged for review rather than allowed into a trend.
        let disagreement = m.disagreement;
        let confidence = m.confidence;
        if (assets.hasTextLayer && !isPrintedOnPage(m.valueRaw, assets.rows)) {
          disagreement = `hodnota "${m.valueRaw}" není na stránce vytištěna`;
          confidence = "low";
          unverified += 1;
        }
        measurements.push({
          ...m,
          sourcePage: p,
          confidence,
          disagreement,
          canonicalId: registry.match(m.rawAnalyteName),
          bbox: rowBoxFor(m.rawAnalyteName, assets.rows),
        });
      }
      pages.push({
        pageNum: p,
        imageUrl: assets.imageUrl,
        imageWidth: assets.imageWidth,
        imageHeight: assets.imageHeight,
      });
    }

    const out: string[] = [];
    if (doc.numPages > maxPages)
      out.push(
        `Zpracováno prvních ${count(maxPages, "strana", "strany", "stran")} ` +
          `z ${doc.numPages} — limit ukázky.`,
      );
    if (sawScan) out.push("Některé strany nemají textovou vrstvu (sken) — přepsány z obrázku.");
    if (failedPages.length)
      out.push(
        `Nepodařilo se přečíst ${count(failedPages.length, "stranu", "strany", "stran")} ` +
          `(${failedPages.join(", ")}) — ostatní jsou zpracované.`,
      );
    if (unverified)
      out.push(
        `${count(unverified, "hodnota", "hodnoty", "hodnot")} ` +
          `${plural(unverified, "nesouhlasí", "nesouhlasí", "nesouhlasí")} s textem na stránce ` +
          `— ${plural(unverified, "označena", "označeny", "označeno")} k ověření.`,
      );
    job.notes = out;

    onReport({
      // The job id, not a timestamp. `upload-${Date.now()}` collided when a
      // queue finished two files inside the same millisecond, and two reports
      // sharing an id break the rail's list and the verification picker.
      id: `upload-${job.id}`,
      sourceFile: job.file.name,
      reportDate,
      labName,
      patientName: null,
      patientId: null,
      pages,
      measurements,
    });
  }

  /** Work the queue until it is empty or something fatal stops it. */
  async function run() {
    // One runner at a time. Without this, a second drop while the first is
    // still going would start a parallel loop and both would claim the same
    // queued job.
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      await runQueue<File>({
        jobs: jobsRef.current,
        process: processOne,
        fatal: isFatalApiError,
        message: (e) =>
          e instanceof ApiError ? e.message : `Nepodařilo se zpracovat PDF: ${e}`,
        publish,
        skipReason: "Nezpracováno — předchozí soubor narazil na limit ukázky.",
      });
    } finally {
      runningRef.current = false;
      publish();
    }
  }

  function enqueue(files: File[]) {
    const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) return;
    setError(null);
    for (const file of pdfs) jobsRef.current.push(makeJob(++seqRef.current, file));
    publish();
    void run();
  }

  if (frozen)
    return (
      <p className="muted">
        Rozpočet ukázky na AI funkce je vyčerpán — nahrávání je dočasně vypnuté.
      </p>
    );

  // A missing site key is a deployment condition, not a user error. The old
  // copy printed the environment-variable name in red, which reads as a broken
  // app to anyone who is not the person who deployed it.
  if (!SITE_KEY)
    return (
      <p className="muted">
        Nahrávání vlastních PDF není v této ukázce zapnuté. Ukázková data fungují
        normálně.
      </p>
    );

  if (!ready)
    return (
      <>
        <p className="muted" style={{ margin: "0 0 8px" }}>
          Nejdřív krátké ověření, že nejste robot. Pak můžete nahrát PDF.
        </p>
        <div ref={boxRef} />
        {error && <p className="err" style={{ margin: "8px 0 0" }}>{error}</p>}
      </>
    );

  const active = jobs.find((j) => j.status === "running") ?? null;
  const waiting = jobs.filter((j) => j.status === "queued").length;
  const busy = active !== null || waiting > 0;

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
          // Dropping during a run adds to the queue rather than being
          // discarded, which is what a queue is for.
          enqueue([...(e.dataTransfer.files ?? [])]);
        }}
      >
        <span className="drop-icon" aria-hidden="true">
          {busy ? "⏳" : "📄"}
        </span>
        <span className="drop-main">
          {active
            ? `Zpracovávám stránku ${active.page} z ${active.total}…`
            : "Přetáhněte PDF sem"}
        </span>
        <span className="drop-sub">
          {busy
            ? waiting > 0
              ? `Nechte okno otevřené · ve frontě ${count(waiting, "soubor", "soubory", "souborů")}`
              : "Nechte okno otevřené."
            : `nebo klepněte a vyberte — i více najednou · limit ukázky ${maxPages} stran`}
        </span>
        <input
          type="file"
          accept="application/pdf"
          multiple
          onChange={(e) => {
            enqueue([...(e.target.files ?? [])]);
            // Clear it, or picking the same file twice in a row does nothing.
            e.target.value = "";
          }}
        />
      </label>

      {active && active.total > 0 && (
        <div className="progressbar" style={{ marginTop: 8 }} role="progressbar"
             aria-valuenow={active.page} aria-valuemin={0} aria-valuemax={active.total}>
          <i style={{ width: `${(active.page / active.total) * 100}%` }} />
        </div>
      )}

      {jobs.length > 0 && (
        <ul className="joblist">
          {jobs.map((j) => (
            <li key={j.id} className={`job ${j.status}`}>
              <span className="job-head">
                <span className="job-mark" aria-hidden="true">
                  {j.status === "done"
                    ? "✓"
                    : j.status === "failed"
                      ? "✕"
                      : j.status === "running"
                        ? "⏳"
                        : j.status === "skipped"
                          ? "–"
                          : "·"}
                </span>
                <span className="job-name" title={j.file.name}>
                  {j.file.name}
                </span>
                <span className="job-state">{stateLabel(j)}</span>
              </span>
              {j.notes.map((n, i) => (
                <span className="job-note" key={i}>
                  {n}
                </span>
              ))}
              {j.error && <span className="job-note err">{j.error}</span>}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="err" style={{ margin: "8px 0 0" }}>{error}</p>}

      <p className="muted" style={{ margin: "9px 0 0" }}>
        PDF se čte ve vašem prohlížeči. Obrázky stránek —{" "}
        <strong>včetně hlavičky se jménem a rodným číslem</strong> — se posílají
        k přepisu na Anthropic API a nikde se neukládají.
      </p>
    </>
  );
}

function stateLabel(j: Job<File>): string {
  switch (j.status) {
    case "queued":
      return "ve frontě";
    case "running":
      return j.total > 0 ? `${j.page}/${j.total}` : "čtu…";
    case "done":
      return "hotovo";
    case "failed":
      return "chyba";
    case "skipped":
      return "nezpracováno";
  }
}
