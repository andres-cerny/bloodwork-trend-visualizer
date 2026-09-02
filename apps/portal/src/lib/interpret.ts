/**
 * One page's reads → rows of a report. Pure, and separate from the upload
 * pipeline so it can be proven in plain node with fake reads: this is where
 * a highlight lands on the wrong printed row, or a value the model invented
 * reaches a trend, and neither shows up in a browser walk.
 *
 * The rules are the demo's (apps/bloodwork/src/ui/UploadPanel.tsx), with the
 * portal's one difference: a scan has no printed text, so its rows carry the
 * model's snippet, no highlight, and no provenance check.
 *
 * Since the text path is read once (Moje krev's extractor runs Haiku alone on
 * born-digital pages), three deterministic checks stand in for the second
 * reader, all from lab-core/candidates:
 *   - a `row_index` whose row does not carry the value is moved to the
 *     neighbour that does — a reader once numbered a whole page one too high;
 *   - a returned name that is not printed on its row is replaced by the row's
 *     own text — "S_Kyselina možná" for "S_Kyselina močová";
 *   - printed rows nobody pointed at are surfaced: qualitative results
 *     ("málo materiálu") become rows the review shows as unparsed, numeric
 *     ones are reported as unread so the reader looks at the page.
 */
import {
  type Measurement,
  type RawRead,
  type TextRow,
  isPrintedOnPage,
  makeMeasurement,
  nameFromRow,
  nameOnRow,
  normalizeMeasurement,
  reconcile,
  repairRowIndex,
  rowBoxAt,
  rowBoxFor,
  rowTextAt,
  unclaimedRows,
} from "@bw/lab-core";

export interface PageResult {
  measurements: Measurement[];
  /** Values that do not appear on the printed page — flagged, not dropped. */
  unverified: number;
  /** Row indexes the reader got wrong and the value's own row put right. */
  repaired: number;
  /** Names the reader misspelt, replaced by the printed name. */
  renamed: number;
  /** Numeric-looking printed rows no read returned, by row index. */
  unread: number[];
  /** Qualitative printed rows no read returned, added as unparsed rows. */
  qualitative: number;
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
  const out: PageResult = {
    measurements: [],
    unverified: 0,
    repaired: 0,
    renamed: 0,
    unread: [],
    qualitative: 0,
    reportDate: null,
    labName: null,
  };
  for (const read of reads) {
    out.reportDate = out.reportDate ?? read.report_date ?? null;
    out.labName = out.labName ?? read.lab_name ?? null;
  }
  const claimed: number[] = [];
  for (const m of reconcile(reads)) {
    let rowIndex = m.rowIndex;
    let rawAnalyteName = m.rawAnalyteName;
    if (!isScan) {
      const r = repairRowIndex(m.valueRaw, m.rawAnalyteName, m.rowIndex, rows);
      if (r.repaired) out.repaired += 1;
      // A broken index would highlight the wrong row; the name search below
      // is the honest fallback, exactly as for a read that carried none.
      rowIndex = r.broken ? undefined : r.index;
      if (rowIndex !== undefined && !nameOnRow(rawAnalyteName, rows, rowIndex)) {
        const printed = nameFromRow(rows, rowIndex, m.valueRaw);
        if (printed) {
          rawAnalyteName = printed;
          out.renamed += 1;
        }
      }
      if (rowIndex !== undefined) claimed.push(rowIndex);
    }
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
      rawAnalyteName,
      rowIndex,
      // The snippet is the page's own text for the row the model pointed at,
      // so it is the printed row by construction. The box is that row too:
      // a name search is only the fallback for a read that carried no index.
      sourceSnippet: (isScan ? "" : rowTextAt(rowIndex, rows)) || m.sourceSnippet,
      sourcePage: pageNum,
      confidence,
      disagreement,
      canonicalId: match(rawAnalyteName),
      bbox: isScan ? null : rowBoxAt(rowIndex, rows) ?? rowBoxFor(rawAnalyteName, rows),
    });
  }

  if (!isScan) {
    for (const c of unclaimedRows(rows, claimed)) {
      if (c.kind === "numeric") {
        out.unread.push(c.index);
        continue;
      }
      // A qualitative result is a row of the report — "málo materiálu" says
      // the test was not done, which a reader needs to see. It carries no
      // number, so review treats it as unparsed and it never reaches a trend.
      out.qualitative += 1;
      out.measurements.push(
        normalizeMeasurement({
          ...makeMeasurement({
            rawAnalyteName: c.name,
            valueRaw: c.result,
            unitRaw: "",
            refRangeRaw: "",
            sourceSnippet: rowTextAt(c.index, rows),
            rowIndex: c.index,
            confidence: "low",
            extractedBy: "printed-row",
          }),
          sourcePage: pageNum,
          canonicalId: match(c.name),
          bbox: rowBoxAt(c.index, rows),
        }),
      );
    }
  }
  return out;
}
