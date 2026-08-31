/**
 * One PDF, from the file picker to a stored report — the privacy pipeline of
 * docs/plans/portal.md, in the order it has to happen:
 *
 *   prepare   open the PDF, render and read every page, find the identity
 *   review    (the screen) the reader sees the boxes and adds or removes
 *   redact    paint the boxes, drop the strings from the text layer, verify
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
import { extractPage, isFatalApiError, putPage, putReport } from "./api";
import { type PageResult, interpretPage } from "./interpret";

export interface PreparedFile {
  name: string;
  pages: PageAssets[];
  hits: IdentityHit[];
  /** Pages with no usable text layer: nothing was found on them automatically,
   *  the reader must redact by hand, and they are read from the image. */
  scanPages: number[];
  /** Pages past the per-report cap, left unread. */
  truncated: number;
}

/** Pages are read one at a time: each holds a rendered canvas, and a phone
 *  opening a thirty-page report is the memory case that matters. */
export async function prepareFile(file: File, maxPages: number): Promise<PreparedFile> {
  const { loadPdf, pageAssets } = await import("@bw/lab-core/pdf");
  const doc = await loadPdf(file);
  const n = Math.min(doc.numPages, maxPages);
  const pages: PageAssets[] = [];
  for (let p = 1; p <= n; p++) pages.push(await pageAssets(doc, p));
  await doc.destroy();
  const scanPages = pages.filter((p) => !p.hasTextLayer || !canRedact(p.words)).map((p) => p.pageNum);
  const { hits } = findIdentity(pages.map((p) => ({ pageNum: p.pageNum, words: p.words })));
  return { name: file.name, pages, hits, scanPages, truncated: doc.numPages - n };
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

/** How many pages are in flight at once. Enough to make a long report a few
 *  waves rather than a queue; small enough for a phone. */
const IN_FLIGHT = 4;

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
): Promise<ExtractOutcome> {
  const { rowsAsText } = await import("@bw/lab-core/pdf");

  const results: Array<PageResult | undefined> = new Array(pages.length);
  const failed: number[] = [];
  /** Why the first page failed, verbatim from the server — the one line a
   *  reader can act on when every page fails the same way. */
  let firstError: string | null = null;
  let fatal: unknown = null;
  let done = 0;
  let next = 0;

  const worker = async () => {
    for (;;) {
      if (fatal) return;
      const i = next++;
      if (i >= pages.length) return;
      const page = pages[i];
      const isScan = prepared.scanPages.includes(page.pageNum);
      try {
        const res = await extractPage(
          isScan ? { imageBase64: page.imageBase64, mediaType: page.mediaType } : { rowsText: rowsAsText(page.rows) },
        );
        const out = interpretPage(res.reads, page.rows, page.pageNum, isScan, (raw) => registry.match(raw));
        results[i] = out;
      } catch (e) {
        if (isFatalApiError(e)) {
          fatal = e;
          return;
        }
        failed.push(page.pageNum);
        firstError = firstError ?? (e instanceof Error ? e.message : String(e));
      }
      onProgress(++done, pages.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, pages.length) }, worker));
  if (fatal) throw fatal;
  // One failed page is a note on a report; every page failed is no report.
  // Storing an empty row would show "uloženo" over nothing.
  if (!results.some(Boolean)) {
    throw new Error(`žádnou stranu se nepodařilo přečíst — report nebyl uložen${firstError ? ` (${firstError})` : ""}`);
  }

  const measurements: Measurement[] = [];
  let unverified = 0;
  let reportDate: string | null = null;
  let labName: string | null = null;
  for (const r of results) {
    if (!r) continue;
    measurements.push(...r.measurements);
    unverified += r.unverified;
    reportDate = reportDate ?? r.reportDate;
    labName = labName ?? r.labName;
  }

  const notes: string[] = [];
  if (prepared.scanPages.length)
    notes.push(
      `${plural(prepared.scanPages.length, "Strana", "Strany", "Strany")} ${prepared.scanPages.join(", ")} ${plural(prepared.scanPages.length, "nemá", "nemají", "nemají")} textovou vrstvu (sken) — ${plural(prepared.scanPages.length, "přepsána", "přepsány", "přepsány")} z obrázku; hodnoty z ní nelze ověřit proti tištěnému textu, zkontrolujte je v Ověření.`,
    );
  if (prepared.truncated > 0)
    notes.push(`Zpracováno prvních ${count(pages.length, "strana", "strany", "stran")} — dalších ${prepared.truncated} zůstalo nepřečteno.`);
  if (failed.length)
    notes.push(
      `Nepodařilo se přečíst ${count(failed.length, "stranu", "strany", "stran")} (${failed.sort((a, b) => a - b).join(", ")}) — ostatní jsou zpracované.${firstError ? ` Důvod: ${firstError}` : ""}`,
    );
  if (unverified)
    notes.push(
      `${count(unverified, "hodnota", "hodnoty", "hodnot")} ${plural(unverified, "nesouhlasí", "nesouhlasí", "nesouhlasí")} s textem na stránce — ${plural(unverified, "označena", "označeny", "označeno")} k ověření.`,
    );

  return {
    report: {
      id,
      sourceFile: prepared.name,
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
