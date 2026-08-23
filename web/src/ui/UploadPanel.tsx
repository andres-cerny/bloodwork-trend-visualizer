/**
 * Turnstile-gated upload, living in the left rail: a drop target, a challenge
 * and honest per-file, per-page progress. One challenge mints a session
 * covering a bounded number of pages, so a multi-page report needs one CAPTCHA,
 * not one per page.
 *
 * Several PDFs can be selected or dropped at once, and more can be added while
 * the first ones are still running — they join a queue. The queue is worked
 * strictly one **file** at a time, which keeps the session's page allowance
 * spending in an order the reader can follow: when it runs out, it is clear
 * which document got the last page.
 *
 * Within a file, **pages run concurrently** (see `CONCURRENCY` below). They used
 * to be sequential, on the reasoning that a phone rendering a long report at
 * 220 DPI concurrently is the fastest way to run it out of memory. That reason
 * had expired: the common path is the text layer, which renders at 110 DPI for
 * human display only, and sequential pages made a ten-file batch cost over ten
 * minutes — the measurements are in docs/extraction-speed.md.
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
import {
  type LabReport,
  type Measurement,
  reconcile,
  type Registry,
  count,
  plural,
} from "@bw/lab-core";
import { createLimiter } from "../lib/inflight";
import { type Job, makeJob, runQueue } from "../lib/uploadQueue";

/**
 * How many extraction requests may be in flight across the whole upload,
 * whatever the pages are spread over.
 *
 * Measured, not guessed. A ten-file batch of 2-3 page reports took 182 s live
 * when files ran one at a time — the per-file bound of 8 was never more than
 * three deep, because the bound was sized for a long report and the real
 * corpus is many short ones. Bounding the total instead keeps the ceiling
 * meaningful either way.
 *
 * Measured on the real corpus, both readers, ten files (21 pages):
 *
 *     concurrency  4 -> 85.4 s      8 -> 43.6 s
 *                 16 -> 28.9 s     32 -> 24.4 s
 *
 * and then thirty files (66 pages, 144 calls in flight) -> **27.8 s**, with
 * per-page latency unchanged and not one failed call. There is no rate-limit
 * wall anywhere near here, so the binding constraint is simply how long one
 * page takes: once every page is in flight, the batch *is* the slowest page,
 * whether that is ten files or thirty.
 *
 * 64 therefore covers a thirty-file drop with headroom, and the only reason it
 * is not higher is that each in-flight page also holds a rendered canvas —
 * memory, not throughput, is what would break first, and that has only been
 * verified on a desktop browser.
 */
const PAGE_REQUESTS_IN_FLIGHT = 64;

/**
 * How many files are open at once.
 *
 * Only needs to be large enough that short files cannot leave the request
 * budget idle; the requests themselves are what `PAGE_REQUESTS_IN_FLIGHT`
 * bounds. Real reports are two or three pages, so this has to be roughly a
 * third of the request budget before the budget is actually reachable — at 4
 * it was not, which is the whole reason a ten-file drop took 182 s.
 *
 * Not simply unbounded because each open file holds its rendered page images.
 * Those are retained for the verification tab regardless, so opening more
 * files at once changes *when* that memory is allocated rather than how much —
 * but allocating it all in one burst is still the thing most likely to hurt a
 * phone, and that has not been measured.
 */
const FILES_AT_ONCE = 24;

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

  // One limiter for the whole panel, not one per file — that is the entire
  // point. Kept in a ref so a re-render cannot hand a half-finished run a
  // second, empty budget.
  const limiterRef = useRef(createLimiter(PAGE_REQUESTS_IN_FLIGHT));

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
    const { isPrintedOnPage, loadPdf, pageAssets, rowBoxFor, rowsAsText, rowTextAt } =
      await import("../pdf/pdf");
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

    // Pages are independent, so they are read concurrently. Serially, a report
    // cost the sum of its pages' round-trips — measured at ~20-40 s each, which
    // put a ten-file batch at well over ten minutes of spinner. Now it costs
    // roughly the slowest wave.
    //
    // The bound is not arbitrary, and it is measured rather than guessed. An
    // unbounded fan-out would convert model latency into 429s and retry
    // backoff, which is slower than not fanning out at all; each page also
    // renders a canvas, this demo's largest memory cost on a phone.
    //
    // Within one file this only decides how many pages are *prepared* at once;
    // the requests themselves queue on the panel-wide limiter, so this can be
    // generous without oversubscribing the API. It is still bounded because
    // each prepared page holds a rendered canvas, the largest memory cost on a
    // phone.
    const CONCURRENCY = PAGE_REQUESTS_IN_FLIGHT;

    interface PageOutcome {
      pageNum: number;
      assets: Awaited<ReturnType<typeof pageAssets>>;
      res: Awaited<ReturnType<typeof extract>> | null;
    }
    // Indexed by page, not appended: workers finish out of order and the
    // assembled report has to read in page order.
    const outcomes: Array<PageOutcome | undefined> = new Array(pageCount);
    // Interpreted once, as each page lands, so publishing a partial report is
    // a concatenation rather than a re-parse of everything read so far.
    const interpreted: Array<PageResult | undefined> = new Array(pageCount);
    let claimed = 0;
    let finished = 0;
    let fatal: unknown = null;

    const worker = async () => {
      for (;;) {
        // A fatal error means every later page would fail identically, so
        // stop claiming work; pages already in flight are allowed to land.
        if (fatal) return;
        const i = claimed++;
        if (i >= pageCount) return;
        const p = i + 1;
        const assets = await pageAssets(doc, p);

        // Digital PDF: send the reconstructed rows, not the image. The model
        // assigns columns; the characters come from the file.
        //
        // Only the request holds a slot. Rendering the page happens outside
        // the limiter, so a file waiting its turn has its next page ready the
        // moment one frees up rather than starting the render then.
        let res: Awaited<ReturnType<typeof extract>> | null = null;
        try {
          res = await limiterRef.current.run(() =>
            assets.hasTextLayer
              ? extract(null, null, null, rowsAsText(assets.rows))
              : extract(assets.imageBase64, assets.mediaType, assets.textLayer, null),
          );
        } catch (e) {
          // A page that fails is skipped and reported, not allowed to sink the
          // whole report — same behaviour as the local pipeline.
          if (isFatalApiError(e)) {
            fatal = e;
            return;
          }
          failedPages.push(p);
        }
        outcomes[i] = { pageNum: p, assets, res };
        interpreted[i] = interpret(outcomes[i]!);
        // Show the rows now rather than at the end of the file.
        publishReport(false);
        // Progress now counts pages *completed*, since there is no single
        // "current" page once several are in flight.
        job.page = ++finished;
        publish();
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pageCount) }, worker));
    if (fatal) throw fatal;
    failedPages.sort((a, b) => a - b);

    // Everything below turns landed pages into rows. It is unchanged in *what*
    // it does from the serial version — only when it runs.
    interface PageResult {
      page: { pageNum: number; imageUrl: string; imageWidth: number; imageHeight: number };
      measurements: Measurement[];
      unverified: number;
      sawScan: boolean;
      reportDate: string | null;
      labName: string | null;
    }

    /** Interpret one landed page. Pure, and run exactly once per page. */
    function interpret(outcome: PageOutcome): PageResult {
      const { pageNum: p, assets, res } = outcome;
      const out: PageResult = {
        page: {
          pageNum: p,
          imageUrl: assets.imageUrl,
          imageWidth: assets.imageWidth,
          imageHeight: assets.imageHeight,
        },
        measurements: [],
        unverified: 0,
        sawScan: res?.mode === "vision",
        reportDate: null,
        labName: null,
      };
      if (!res) return out;

      for (const read of res.reads) {
        out.reportDate = out.reportDate ?? read.report_date ?? null;
        out.labName = out.labName ?? read.lab_name ?? null;
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
          out.unverified += 1;
        }
        out.measurements.push({
          ...m,
          // On the text path the model returns a row index, not the row: the
          // snippet shown in the verification tab is rebuilt from the page's
          // own text, so it is the printed row by construction.
          sourceSnippet: rowTextAt(m.rowIndex, assets.rows) || m.sourceSnippet,
          sourcePage: p,
          confidence,
          disagreement,
          canonicalId: registry.match(m.rawAnalyteName),
          bbox: rowBoxFor(m.rawAnalyteName, assets.rows),
        });
      }
      return out;
    }

    /**
     * Publish what has been read so far.
     *
     * Called once per page that lands, not once at the end. A ten-file batch
     * takes ~44 s but the first page is ready at ~6 s, and a table that starts
     * filling in at six seconds reads as finished long before a spinner that
     * ends at the same moment. `onReport` upserts by id, so each call replaces
     * the previous partial rather than adding a second report.
     *
     * Interpretation happens once per page in `interpret`; this only
     * concatenates, so publishing on every page stays cheap.
     */
    function publishReport(done: boolean) {
      const measurements: Measurement[] = [];
      const pages: PageResult["page"][] = [];
      let unverified = 0;
      let sawScan = false;
      let reportDate: string | null = null;
      let labName: string | null = null;

      for (const r of interpreted) {
        if (!r) continue;
        pages.push(r.page);
        measurements.push(...r.measurements);
        unverified += r.unverified;
        sawScan = sawScan || r.sawScan;
        reportDate = reportDate ?? r.reportDate;
        labName = labName ?? r.labName;
      }

      // Notes describe a finished read — how many pages failed, how much needs
      // review — so they would be wrong and alarming while pages are still
      // arriving. They land with the final publish.
      if (done) {
        const notes: string[] = [];
        if (doc.numPages > maxPages)
          notes.push(
            `Zpracováno prvních ${count(maxPages, "strana", "strany", "stran")} ` +
              `z ${doc.numPages} — limit ukázky.`,
          );
        if (sawScan)
          notes.push("Některé strany nemají textovou vrstvu (sken) — přepsány z obrázku.");
        if (failedPages.length)
          notes.push(
            `Nepodařilo se přečíst ${count(failedPages.length, "stranu", "strany", "stran")} ` +
              `(${failedPages.join(", ")}) — ostatní jsou zpracované.`,
          );
        if (unverified)
          notes.push(
            `${count(unverified, "hodnota", "hodnoty", "hodnot")} ` +
              `${plural(unverified, "nesouhlasí", "nesouhlasí", "nesouhlasí")} s textem na stránce ` +
              `— ${plural(unverified, "označena", "označeny", "označeno")} k ověření.`,
          );
        job.notes = notes;
      }

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

    // Everything has landed: publish once more, this time with the notes.
    publishReport(true);
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
        fileConcurrency: FILES_AT_ONCE,
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
