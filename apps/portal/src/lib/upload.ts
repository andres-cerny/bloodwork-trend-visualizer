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
 * never had one — so `prepareFile` gives it the identical shape a scan gets:
 * no words, `canRedact` false, no hits, its page number in `scanPages`. There
 * is deliberately no path on which a photograph is reported as "nothing found":
 * detection did not fail on it, detection could not run. The only thing that
 * differs is the word on screen, because telling someone their phone snapshot
 * is a "sken" is telling them something false about their own file.
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
import { isPhotoFile, photoAssets } from "@bw/lab-core/photo";
import { type Allowance, type ProvisionalRow, extractPage, isFatalApiError, openDocument, putPage, putReport, releaseDocument } from "./api";
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
  /** Pages past the per-report cap, left unread. */
  truncated: number;
}

/** Pages are read one at a time: each holds a rendered canvas, and a phone
 *  opening a thirty-page report is the memory case that matters.
 *
 *  A photograph short-circuits all of it: one page, decoded and enhanced by
 *  `photoAssets`, no pdf.js (~1.4 MB that someone photographing a sheet on a
 *  phone should not download), and — the part that matters — no `findIdentity`
 *  call at all. Running the detector over an empty word list would return an
 *  empty `hits` that is indistinguishable from a clean page. */
export async function prepareFile(file: File, maxPages: number): Promise<PreparedFile> {
  if (isPhotoFile(file)) {
    const page = await photoAssets(file);
    return { name: file.name, kind: "photo", pages: [page], hits: [], scanPages: [page.pageNum], truncated: 0 };
  }
  const { loadPdf, pageAssets } = await import("@bw/lab-core/pdf");
  const doc = await loadPdf(file);
  const n = Math.min(doc.numPages, maxPages);
  const pages: PageAssets[] = [];
  for (let p = 1; p <= n; p++) pages.push(await pageAssets(doc, p));
  await doc.destroy();
  const scanPages = pages.filter((p) => !p.hasTextLayer || !canRedact(p.words)).map((p) => p.pageNum);
  const { hits } = findIdentity(pages.map((p) => ({ pageNum: p.pageNum, words: p.words })));
  return { name: file.name, kind: "pdf", pages, hits, scanPages, truncated: doc.numPages - n };
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
  const opened = await openDocument(id);
  onAllowance?.(opened.allowance);
  const giveBack = async () => {
    const r = await releaseDocument(id).catch(() => null);
    if (r) onAllowance?.(r.allowance);
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
          const res = await extractPage(
            isScan ? { imageBase64: page.imageBase64, mediaType: page.mediaType } : { rowsText: rowsAsText(page.rows) },
            id,
            onRow ? (row) => onRow(page.pageNum, row) : undefined,
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
          firstError = firstError ?? (e instanceof Error ? e.message : String(e));
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
    await giveBack();
    throw new Error(`žádnou stranu se nepodařilo přečíst — report nebyl uložen${firstError ? ` (${firstError})` : ""}`);
  }

  const measurements: Measurement[] = [];
  let unverified = 0;
  let qualitative = 0;
  /** "strana 2: řádky 14, 15" — printed rows that look like results and no read returned. */
  const unread: string[] = [];
  let reportDate: string | null = null;
  let labName: string | null = null;
  for (const [i, r] of results.entries()) {
    if (!r) continue;
    measurements.push(...r.measurements);
    unverified += r.unverified;
    qualitative += r.qualitative;
    if (r.unread.length) unread.push(`strana ${pages[i].pageNum}: ${plural(r.unread.length, "řádek", "řádky", "řádky")} ${r.unread.map((n) => n + 1).join(", ")}`);
    reportDate = reportDate ?? r.reportDate;
    labName = labName ?? r.labName;
  }

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
    },
    notes,
  };
}

/**
 * Persist: the row first (pages attach to a report that exists), then each
 * painted image, then the row again with the images named by route so the
 * data: URLs can be let go of.
 */
export async function storeReport(report: LabReport, pages: RedactedPage[]): Promise<LabReport> {
  await putReport(report);
  const stored = [];
  for (const p of pages) {
    const { imageUrl } = await putPage(report.id, p.pageNum, p.blob, p.imageWidth, p.imageHeight);
    stored.push({ pageNum: p.pageNum, imageUrl, imageWidth: p.imageWidth, imageHeight: p.imageHeight });
  }
  const final = { ...report, pages: stored };
  await putReport(final);
  return final;
}

export const newReportId = (): string => crypto.randomUUID();
