/**
 * One page's reads → rows of a report. Pure, and separate from the upload
 * pipeline so it can be proven in plain node with fake reads: this is where
 * a highlight lands on the wrong printed row, or a value the model invented
 * reaches a trend, and neither shows up in a browser walk.
 *
 * The rules are the demo's (apps/bloodwork/src/ui/UploadPanel.tsx), with the
 * portal's one difference: a scan has no printed text, so its rows carry the
 * model's snippet, no highlight, and no provenance check.
 */
import {
  type Measurement,
  type RawRead,
  type TextRow,
  isPrintedOnPage,
  reconcile,
  rowBoxAt,
  rowBoxFor,
  rowTextAt,
} from "@bw/lab-core";

export interface PageResult {
  measurements: Measurement[];
  /** Values that do not appear on the printed page — flagged, not dropped. */
  unverified: number;
  reportDate: string | null;
  labName: string | null;
}

export interface ReadsLike extends RawRead {
  report_date?: string | null;
  lab_name?: string | null;
}

export function interpretPage(
  reads: ReadsLike[],
  rows: TextRow[],
  pageNum: number,
  isScan: boolean,
  match: (rawName: string) => string | null,
): PageResult {
  const out: PageResult = { measurements: [], unverified: 0, reportDate: null, labName: null };
  for (const read of reads) {
    out.reportDate = out.reportDate ?? read.report_date ?? null;
    out.labName = out.labName ?? read.lab_name ?? null;
  }
  for (const m of reconcile(reads)) {
    // Provenance: on the text path a transcribed value must literally
    // appear on the page. Anything that does not is a fabrication, and it
    // is flagged for review rather than allowed into a trend.
    let disagreement = m.disagreement;
    let confidence = m.confidence;
    if (!isScan && !isPrintedOnPage(m.valueRaw, rows)) {
      disagreement = `hodnota "${m.valueRaw}" není na stránce vytištěna`;
      confidence = "low";
      out.unverified += 1;
    }
    out.measurements.push({
      ...m,
      // The snippet is the page's own text for the row the model pointed at,
      // so it is the printed row by construction. The box is that row too:
      // a name search is only the fallback for a read that carried no index.
      sourceSnippet: (isScan ? "" : rowTextAt(m.rowIndex, rows)) || m.sourceSnippet,
      sourcePage: pageNum,
      confidence,
      disagreement,
      canonicalId: match(m.rawAnalyteName),
      bbox: isScan ? null : rowBoxAt(m.rowIndex, rows) ?? rowBoxFor(m.rawAnalyteName, rows),
    });
  }
  return out;
}
