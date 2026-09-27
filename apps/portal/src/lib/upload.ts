/**
 * One PDF, from the file picker to a stored report — the privacy pipeline of
 * docs/plans/portal.md, in the order it has to happen:
 *
 *   prepare   open the PDF, render and read every page, find the identity
 *   review    (the screen) the reader sees the boxes and adds or removes
 *   redact    paint the boxes, drop the strings from the text layer, verify
 *   open      one document from the allowance, under the report's id
 *   extract   the redacted rows to the extractor, one request per page
 *   store     payload to D1, images to KV
 *
 * Nothing between `prepare` and `redact` leaves the browser. The original
 * file is dropped once its pages are read; what is uploaded is the painted
 * image and the stripped rows, and `checkRedaction` refuses to go on if an
 * identifier can still be read from those rows.
 *
 * A scanned page has no text layer to search, so nothing is found on it
 * automatically; the review screen says so, the reader paints the boxes by
 * hand and confirms the page, and the painted image goes to the extractor's
 * vision path. On such a page the reader's look is the only guard — which is
 * why the confirmation is per page and explicit.
 *
 * **A photograph enters through that same door, and through no other.** It has
 * no text layer either — not because a scanner lost it but because a camera
 * never had one — so `prepareFile` gives it the shape a scan gets: no words,
 * its page number in `scanPages`, drawing on at the review. The word on screen
 * differs, because telling someone their phone snapshot is a "sken" is telling
 * them something false about their own file.
 *
 * **What a photograph gets that a scan does not (2026-09-26, Ondřej's yes):**
 * a local OCR pass — the sheet found and flattened, Tesseract in a Web Worker
 * (`./ocr`, its own lazy chunk), `identityFromOcr` — whose hits arrive at the
 * review as *suggested* boxes. This overrides the 2026-09-09 rule "do not run
 * detection on photos"; that rule's reason — an empty result looking clean —
 * is kept by the copy and the review, not by not running: the pencil stays
 * on, the page still needs the reader's yes, and no hits reads "nic jsme
 * nenašli — zkontrolujte ručně", never "nic tam není". The same pass scores
 * whether the text looks like a lab sheet, and the photo checks
 * (photoQuality.ts) turn all of it into a verdict the flow shows before the
 * review: warn → "Vyfotit znovu" / "Nahrát i tak", refuse → only the first.
 */
import {
  type IdentityHit,
  type LabReport,
  type Measurement,
  type Registry,
  canRedact,
  count,
  findIdentity,
  plural,
  stringsOf,
  survivingIdentity,
} from "@bw/lab-core";
import type { PageAssets, RedactedPage } from "@bw/lab-core/pdf";
import {
  type OcrLine,
  type PhotoVerdict,
  type PreparedPhoto,
  identityFromOcr,
  isPhotoFile,
  labSheetScore,
  ocrLineTexts,
  photoPage,
  preparePhoto,
  withPageChecks,
} from "@bw/lab-core/photo";
import { type Allowance, ApiError, type ProvisionalRow, extractPage, isFatalApiError, openDocument, putPage, putReport, releaseDocument, withRetry } from "./api";
import { type FileWarning, LONG_REPORT_PAGES, drawDates, fingerprintOf, tooManyPagesCopy } from "./fileChecks";
import { createLimiter } from "./inflight";
import { type PageResult, interpretPage } from "./interpret";

export interface PreparedFile {
  name: string;
  /** Where the pixels came from. Only the copy reads this — every step of the
   *  pipeline routes on `scanPages`, which a photograph is always in. */
  kind: "pdf" | "photo";
  pages: PageAssets[];
  hits: IdentityHit[];
  /** Pages with no usable text layer: nothing was found on them automatically,
   *  the reader must redact by hand, and they are read from the image. */
  scanPages: number[];
  /** Pages past the per-report cap, left unread. Always 0 now: a file over
   *  the cap is refused before anything is read (`FileRefused`). */
  truncated: number;
  /** Photos only: what the checks and the local OCR said. */
  photo?: PhotoFindings;
  /** SHA-256 of the picked file — the same file picked again is recognised. */
  fingerprint?: string | null;
  /** What the person is asked about before the review (lib/fileChecks.ts). */
  warnings?: FileWarning[];
}

/** A file that cannot be uploaded as it is — the message says what to do. */
export class FileRefused extends Error {}

export interface PhotoFindings {
  /** ok, warn (the person may send it anyway) or refuse (they may not). */
  verdict: PhotoVerdict;
  /** Whether the OCR pass ran: its hits are only suggestions either way, and
   *  "failed" (the files did not load, an old browser) is said as such. */
  ocr: "done" | "failed" | "skipped";
}

/** Pages are read one at a time: each holds a rendered canvas, and a phone
 *  opening a thirty-page report is the memory case that matters.
 *
 *  A photograph goes its own way: one page, no pdf.js (~1.4 MB that someone
 *  photographing a sheet on a phone should not download), and the OCR chunk
 *  instead — see `preparePhotoFile`. */
export async function prepareFile(file: File, maxPages: number): Promise<PreparedFile> {
  const fingerprint = await fingerprintOf(await file.arrayBuffer()).catch(() => null);
  if (isPhotoFile(file)) return { ...(await preparePhotoFile(file)), fingerprint };
  const { loadPdf, pageAssets } = await import("@bw/lab-core/pdf");
  const doc = await loadPdf(file);
  // Over the cap is refused, not cut: reading the first pages of a longer
  // file used to spend the document and say so only afterwards, in a note.
  if (doc.numPages > maxPages) {
    await doc.destroy();
    throw new FileRefused(tooManyPagesCopy(doc.numPages, maxPages));
  }
  const pages: PageAssets[] = [];
  for (let p = 1; p <= doc.numPages; p++) pages.push(await pageAssets(doc, p));
  await doc.destroy();
  const scanPages = pages.filter((p) => !p.hasTextLayer || !canRedact(p.words)).map((p) => p.pageNum);
  const { hits } = findIdentity(pages.map((p) => ({ pageNum: p.pageNum, words: p.words })));
  return { name: file.name, kind: "pdf", pages, hits, scanPages, truncated: 0, fingerprint, warnings: pdfWarnings(pages, scanPages) };
}

/**
 * What a PDF's own text says before anything is sent: long, several draw
 * dates, or not a lab sheet at all. A page without a text layer says
 * nothing either way, so a scan is only ever checked for length.
 */
export function pdfWarnings(pages: Array<Pick<PageAssets, "pageNum" | "rows">>, scanPages: number[]): FileWarning[] {
  const out: FileWarning[] = [];
  if (pages.length > LONG_REPORT_PAGES) out.push("long");
  const texts = pages.filter((p) => !scanPages.includes(p.pageNum)).map((p) => p.rows.map((r) => r.cells.join(" ")));
  if (drawDates(texts).length > 1) out.push("multi_date");
  if (texts.length > 0 && !labSheetScore(texts.flat()).lab) out.push("not_lab");
  return out;
}

/**
 * How long local OCR may take before the photo goes on without suggestions.
 * The first photo downloads ~6 MB (worker core + Czech data) and then reads
 * a page on the phone's CPU; a slow line or a weak phone must not leave
 * "Kontroluji fotku…" up for ever. Worse, a worker the browser kills mid-job
 * (out of memory) never settles its promise at all — tesseract only rejects
 * a failed *creation*. On timeout the photo is treated as a failed OCR: no
 * suggestions, the pencil, "fotku se nepodařilo přečíst — začerněte ručně".
 */
export const OCR_TIMEOUT_MS = 60_000;

/** `p`, or a rejection after `ms` — whichever comes first. */
export function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`OCR did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * A photograph: the checks, then — unless they refuse it — local OCR for the
 * identity suggestions and the lab-sheet score. `recognize` is injectable so a
 * test can stand in for Tesseract; the app always takes the lazy chunk.
 *
 * The readers get `shot`, the unflattened encode, exactly as before
 * (`preparePhoto`); OCR boxes found on the flattened page come back in that
 * image's pixels. A failed OCR costs the suggestions, never the upload.
 */
export async function preparePhotoFile(
  file: File,
  recognize: (img: PreparedPhoto["ocr"]) => Promise<OcrLine[]> = async (img) => (await import("./ocr")).recognize(img),
): Promise<PreparedFile> {
  const p = await preparePhoto(file);
  const page = photoPage(p.shot);
  const base = { name: file.name, kind: "photo" as const, pages: [page], scanPages: [page.pageNum], truncated: 0 };
  if (p.quality.outcome === "refuse") return { ...base, hits: [], photo: { verdict: p.quality, ocr: "skipped" } };
  try {
    const lines = await within(recognize(p.ocr), OCR_TIMEOUT_MS);
    const hits = identityFromOcr(lines, p.toPhoto, page.pageNum);
    const verdict = withPageChecks(p.quality, p.page, labSheetScore(ocrLineTexts(lines)));
    return { ...base, hits, photo: { verdict, ocr: "done" } };
  } catch {
    // A job that timed out is still running in the worker, and the next
    // photo would queue behind it and time out too: that worker goes.
    void import("./ocr").then((m) => m.reset()).catch(() => undefined);
    return { ...base, hits: [], photo: { verdict: withPageChecks(p.quality, p.page, null), ocr: "failed" }, warnings: ["unverified"] };
  }
}

/** Paint the boxes the reader confirmed, and strip their strings everywhere. */
export async function redactFile(prepared: PreparedFile, hits: IdentityHit[]): Promise<RedactedPage[]> {
  const { paintRedactions } = await import("@bw/lab-core/pdf");
  const strings = stringsOf(hits.filter((h) => h.kind !== "manual"));
  const out: RedactedPage[] = [];
  for (const page of prepared.pages) {
    const boxes = hits.filter((h) => h.pageNum === page.pageNum).map((h) => h.box);
    out.push(await paintRedactions(page, boxes, strings));
  }
  return out;
}

/**
 * The last look before anything is sent: can any confirmed identifier still
 * be read from what will be uploaded? Returns the strings that survived —
 * empty is the only answer that lets the upload continue.
 */
export function checkRedaction(pages: RedactedPage[], hits: IdentityHit[]): string[] {
  const strings = stringsOf(hits.filter((h) => h.kind !== "manual"));
  const survived = new Set<string>();
  for (const p of pages) for (const s of survivingIdentity(p.words, strings)) survived.add(s);
  return [...survived];
}

export interface ExtractOutcome {
  report: LabReport;
  notes: string[];
  /** A note that needs the person — a page not read, printed rows no read
   *  returned — as against the routine ones (a photo has no text layer). */
  serious?: boolean;
}

/**
 * A read that produced no report. `released` says whether the document went
 * back to the allowance: a retry then opens a new one, and otherwise reuses
 * this id — opening the same id again takes nothing (POST /api/documents).
 */
export class ReadFailed extends Error {
  constructor(message: string, readonly released: boolean, readonly cause?: unknown) {
    super(message);
  }
}

/**
 * How many pages are in flight at once — across every file being read, not
 * per file. A confirmed file extracts in the background while the reader
 * reviews the next one, so their pages share this ceiling. Eight is what the
 * demo measured as saturating without failed calls; a phone holds only the
 * painted pages, which are already rendered by then.
 */
const IN_FLIGHT = 8;
const pageSlots = createLimiter(IN_FLIGHT);

/**
 * Read every page through the extractor and assemble the report — the same
 * interpretation the demo's upload panel does, with one difference: there is
 * only the text path, so every value is checked against the printed page.
 */
export async function extractReport(
  id: string,
  prepared: PreparedFile,
  pages: RedactedPage[],
  registry: Registry,
  onProgress: (done: number, total: number) => void,
  /** A row as a reader writes it — for the screen only; the page's final read is what is kept. */
  onRow?: (pageNum: number, row: ProvisionalRow) => void,
  /** The allowance after the document was taken, and after one was given back. */
  onAllowance?: (a: Allowance) => void,
): Promise<ExtractOutcome> {
  const { rowsAsText } = await import("@bw/lab-core/pdf");

  // One document from the allowance, before any page goes: this is the
  // moment it is taken, once, whatever the page count. At zero the worker
  // refuses here — an ApiError `no_documents` with the allowance on it — and
  // nothing has been sent. Given back below if no page could be read.
  // Same id on every try: a second open of it takes nothing.
  const opened = await withRetry(() => openDocument(id));
  onAllowance?.(opened.allowance);
  const giveBack = async (): Promise<boolean> => {
    // Retried: this is the call that returns a document, and a dropped
    // connection here used to keep it spent. The hourly sweep on the server
    // is the net under this one (workers/portal/src/sweep.ts).
    const r = await withRetry(() => releaseDocument(id)).catch(() => null);
    if (r) onAllowance?.(r.allowance);
    return !!r?.released;
  };

  const results: Array<PageResult | undefined> = new Array(pages.length);
  const failed: number[] = [];
  /** Why the first page failed, verbatim from the server — the one line a
   *  reader can act on when every page fails the same way. */
  let firstError: string | null = null;
  let fatal: unknown = null;
  let done = 0;

  // Every page asks for a slot at once; the shared limiter decides the order.
  // A fatal error (the ledger froze) stops pages not yet started; pages
  // already in flight are allowed to land.
  await Promise.all(
    pages.map((page, i) =>
      pageSlots.run(async () => {
        if (fatal) return;
        const isScan = prepared.scanPages.includes(page.pageNum);
        try {
          // A dropped connection, a timeout or a busy reader gets two more
          // tries before the page counts as failed; the worker lets a failed
          // page be sent again (workers/portal/src/db.ts sendPage).
          const res = await withRetry(() =>
            extractPage(
              isScan ? { imageBase64: page.imageBase64, mediaType: page.mediaType } : { rowsText: rowsAsText(page.rows) },
              id,
              onRow ? (row) => onRow(page.pageNum, row) : undefined,
            ),
          );
          results[i] = interpretPage(
            res.reads,
            page.rows,
            page.pageNum,
            isScan,
            // The page's own material rides along with the name, so a bare
            // "Glukóza" under Moč is refused the serum analyte.
            (raw, mat) => registry.match(raw, mat),
            res.readersAttempted,
          );
        } catch (e) {
          if (isFatalApiError(e)) {
            fatal = e;
            return;
          }
          failed.push(page.pageNum);
          // Only an ApiError's message is written for a reader; anything
          // else is a bug's text, and the screen gets a sentence instead.
          firstError = firstError ?? (e instanceof ApiError ? e.message : "Čtení stránky selhalo.");
        }
        onProgress(++done, pages.length);
      }),
    ),
  );
  // Nothing read — the ledger froze before the first page, or every page
  // failed — and the document goes back. The worker checks that nothing
  // was read before it agrees, so this cannot be a way to read for free.
  if (fatal) {
    await giveBack();
    throw fatal;
  }
  // One failed page is a note on a report; every page failed is no report.
  // Storing an empty row would show "uloženo" over nothing.
  if (!results.some(Boolean)) {
    const released = await giveBack();
    throw new ReadFailed(
      `Žádnou stranu se nepodařilo přečíst — report nebyl uložen.${firstError ? ` ${firstError}` : ""}${released ? " Dokument se vrátil do vašeho nároku." : ""}`,
      released,
    );
  }

  const measurements: Measurement[] = [];
  let unverified = 0;
  let qualitative = 0;
  /** "strana 2: řádky 14, 15" — printed rows that look like results and no read returned. */
  const unread: string[] = [];
  let reportDate: string | null = null;
  let labName: string | null = null;
  const pageDates = new Set<string>();
  const conflicts = new Set<string>();
  for (const [i, r] of results.entries()) {
    if (!r) continue;
    if (r.reportDate) pageDates.add(r.reportDate);
    for (const d of r.dateConflict ?? []) conflicts.add(d);
    measurements.push(...r.measurements);
    unverified += r.unverified;
    qualitative += r.qualitative;
    if (r.unread.length) unread.push(`strana ${pages[i].pageNum}: ${plural(r.unread.length, "řádek", "řádky", "řádky")} ${r.unread.map((n) => n + 1).join(", ")}`);
    reportDate = reportDate ?? r.reportDate;
    labName = labName ?? r.labName;
  }

  // The date is the one thing every value of the report hangs on; a doubt
  // about it travels with the report so Ověření asks instead of trusting.
  const cz = (iso: string) => iso.split("-").reverse().map((x) => String(Number(x))).join(". ");
  const dateDoubt =
    pageDates.size > 1
      ? `Strany reportu nesou různá data (${[...pageDates].sort().map(cz).join(", ")}) — zkontrolujte, které je datum odběru.`
      : conflicts.size > 1
        ? `Čtení se na datu neshodla (${[...conflicts].map(cz).join(" / ")}) — zkontrolujte ho prosím.`
        : null;

  const notes: string[] = [];
  // A photograph has no text layer by definition, so calling it a sken would
  // name the wrong thing; what carries over is the consequence, which is that
  // nothing checked the numbers against the print.
  if (prepared.kind === "photo")
    notes.push(
      "Fotografie nemá textovou vrstvu — přepsána z obrázku; hodnoty nelze ověřit proti tištěnému textu, zkontrolujte je v Ověření.",
    );
  else if (prepared.scanPages.length)
    notes.push(
      `${plural(prepared.scanPages.length, "Strana", "Strany", "Strany")} ${prepared.scanPages.join(", ")} ${plural(prepared.scanPages.length, "nemá", "nemají", "nemají")} textovou vrstvu (sken) — ${plural(prepared.scanPages.length, "přepsána", "přepsány", "přepsány")} z obrázku; hodnoty z ní nelze ověřit proti tištěnému textu, zkontrolujte je v Ověření.`,
    );
  if (prepared.truncated > 0)
    notes.push(`Zpracováno prvních ${count(pages.length, "strana", "strany", "stran")} — dalších ${prepared.truncated} zůstalo nepřečteno.`);
  if (failed.length)
    notes.push(
      `Nepodařilo se přečíst ${count(failed.length, "stranu", "strany", "stran")} (${failed.sort((a, b) => a - b).join(", ")}) — ostatní jsou zpracované.${firstError ? ` Důvod: ${firstError}` : ""}`,
    );
  if (unread.length)
    notes.push(`Některé vytištěné řádky vypadají jako výsledky, ale nebyly přečteny (${unread.join("; ")}) — zkontrolujte je na stránce v Ověření.`);
  if (qualitative)
    notes.push(`${count(qualitative, "řádek", "řádky", "řádků")} bez číselné hodnoty (např. „málo materiálu") ${plural(qualitative, "je uveden", "jsou uvedeny", "je uvedeno")} k ověření.`);
  if (unverified)
    notes.push(
      `${count(unverified, "hodnota", "hodnoty", "hodnot")} ${plural(unverified, "nesouhlasí", "nesouhlasí", "nesouhlasí")} s textem na stránce — ${plural(unverified, "označena", "označeny", "označeno")} k ověření.`,
    );

  return {
    report: {
      id,
      // Never the original filename: lab downloads are named after the
      // patient ("vysledky_Novak.pdf"), which would carry identity to the
      // server through the one field the redaction does not touch. A date is
      // all the report list needs, and the worker enforces this too.
      sourceFile: reportDate ? `report-${reportDate}.pdf` : "report.pdf",
      reportDate,
      labName,
      // Never filled here, and emptied again by the worker if they were.
      patientName: null,
      patientId: null,
      pages: pages.map((p) => ({ pageNum: p.pageNum, imageUrl: p.imageUrl, imageWidth: p.imageWidth, imageHeight: p.imageHeight })),
      measurements,
      fingerprint: prepared.fingerprint ?? null,
      dateDoubt,
    },
    notes,
    serious: failed.length > 0 || unread.length > 0 || unverified > 0 || dateDoubt !== null,
  };
}

/**
 * Persist: the row first (pages attach to a report that exists), then each
 * painted image, then the row again with the images named by route so the
 * data: URLs can be let go of.
 *
 * The first row goes without the pixels. `report.pages[].imageUrl` is the
 * painted page as a data: URL — ~59 kB each — and the worker, which never
 * stores that field, still counts it against its 2 MiB payload cap: six
 * pages answered 413 „Report je příliš velký." after the document was taken
 * and every page read. What the first PUT needs is the page numbers and
 * sizes; the routes come with the second.
 *
 * Nothing here gives the document back. By the time a report is stored its
 * pages were read and paid for, and the worker would refuse the release
 * anyway (it checks that nothing was read); a failure here is reported as
 * what it is — read, not stored — by the caller.
 */
export async function storeReport(report: LabReport, pages: RedactedPage[]): Promise<LabReport> {
  await putReport({ ...report, pages: report.pages.map(({ imageUrl: _pixels, ...p }) => p) });
  const stored = [];
  for (const p of pages) {
    const { imageUrl } = await putPage(report.id, p.pageNum, p.blob, p.imageWidth, p.imageHeight);
    stored.push({ pageNum: p.pageNum, imageUrl, imageWidth: p.imageWidth, imageHeight: p.imageHeight });
  }
  const final = { ...report, pages: stored };
  const saved = await putReport(final);
  return { ...final, rev: saved?.rev ?? null };
}

export const newReportId = (): string => crypto.randomUUID();
