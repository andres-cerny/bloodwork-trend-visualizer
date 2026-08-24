/**
 * What a tool hands the server when it says "I read this here".
 *
 * A citation is a registry entry, not a convention: the tool describes the
 * evidence, the loop owns the number, and the client renders exactly what was
 * registered — so a [n] the model invented points at nothing visibly. Nothing
 * in here may compute a coordinate. Every field is copied out of the lossless
 * report payload or left null, because the rail draws the crop from these
 * numbers and an invented box is a photograph of the wrong row.
 *
 * The one function that matters is `citeMeasuredRow`. A lab value the agent
 * states was printed on a row of a page, and that row is the evidence: with a
 * bbox the reader gets a photograph of the printed row itself, which is the
 * best thing this product has to show. Without one they get a labelled
 * reference and the whole page behind a click. get_trend had this right and
 * summarize_changes did not — it cited the *report* each number came from,
 * which is a picture of a letterhead standing in for a claim about a value.
 * Both now go through here, so there is one answer to "how do I cite a row".
 */
import { type Box, type LabReport, type Measurement, type TrendPoint } from "@bw/lab-core";

/** One citable piece of evidence, as the client will render it. */
export type SourceInfo =
  | {
      kind: "lab";
      /** "Ferritin 22 µg/l" — what the row says, for the panel label. */
      label: string;
      date: string;
      lab: string;
      reportId: string;
      page: number;
      imageUrl: string | null;
      /** Pixel box of the row on the page image, for the crop. */
      bbox: Box | null;
      /** The page image's pixel size — the crop math needs the denominator. */
      pageW: number | null;
      pageH: number | null;
    }
  | {
      kind: "document";
      label: string;
      date: string;
      documentId: string;
      title: string;
      excerpt: string;
      imageUrl: string | null;
    };

/** Register one piece of evidence and get its number back. */
export type Cite = (s: SourceInfo) => number;

/**
 * The report a trend point was read from.
 *
 * By id, because that is what the point carries and it is exact. Matching on
 * the printed date — which is what get_trend used to do — silently picks the
 * wrong report when a patient has two draws on one day, and finds nothing at
 * all when a report's date failed to parse. Date is kept only as a fallback
 * for a point that reached here without an id.
 */
export function reportOfPoint(reports: LabReport[], point: TrendPoint): LabReport | null {
  if (point.reportId) {
    const byId = reports.find((r) => r.id === point.reportId);
    if (byId) return byId;
  }
  return reports.find((r) => r.reportDate && r.reportDate === point.date) ?? null;
}

/**
 * Cite the printed row one measured value came from.
 *
 * Always returns a number. A row the payload cannot locate degrades to a
 * citation without a bbox — the same labelled reference every lab source used
 * to be — rather than disappearing. Dropping it was the old behaviour and it
 * is the worse one: the value still appears in the answer, so the reader is
 * left with a number carrying no marker while its neighbours carry one, and
 * nothing on screen says why. An honest "here is the page, we could not point
 * at the line" is a weaker citation, not a missing one.
 */
export function citeMeasuredRow(
  cite: Cite,
  reports: LabReport[],
  canonicalId: string,
  displayName: string,
  point: TrendPoint,
): number {
  const report = reportOfPoint(reports, point);
  const m: Measurement | null =
    report?.measurements.find((mm) => mm.canonicalId === canonicalId) ?? null;
  // sourcePage is 1-based; a page the report does not carry leaves the crop
  // without an image, which the client already renders as a bare reference.
  const pageNum = m?.sourcePage ?? 1;
  const page = report?.pages?.[pageNum - 1] ?? null;
  // The value as printed, not as parsed — this label sits beside a photograph
  // of the row, and a rounded number next to the paper it came from is what
  // makes a reader stop trusting the tool.
  const shown = (m?.valueRaw ?? point.valueRaw ?? "").trim();
  const unit = (m?.unit ?? point.unit ?? "").trim();
  return cite({
    kind: "lab",
    label: [displayName, shown, unit].filter(Boolean).join(" "),
    date: point.date ?? "",
    lab: report?.labName ?? "",
    reportId: report?.id ?? point.reportId ?? "",
    page: pageNum,
    imageUrl: page?.imageUrl ?? null,
    bbox: m?.bbox ?? null,
    pageW: page?.imageWidth ?? null,
    pageH: page?.imageHeight ?? null,
  });
}
