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

/**
 * A committed document's first *substantive* passage, for get_document's
 * registered source.
 *
 * The head slice this replaces photographed the letterhead: clinic name,
 * address, a patient block — 240 characters with no clinical sentence in
 * them, which is how three of six orto excerpts came to hold no substantive
 * line (chat-ui Round 3). The reader clicking a citation wants the passage
 * the answer leaned on; the closest deterministic guess is the document's
 * conclusion when it declares one, else its first paragraph long enough to
 * be prose. The full text still rides in the tool result — this only decides
 * what the evidence card shows before the click.
 */
export function substantiveExcerpt(bodyText: string, limit = 240): string {
  const clean = (s: string) => {
    const t = s.trim().replace(/\s+/g, " ");
    return t.length <= limit ? t : `${t.slice(0, limit - 1)}…`;
  };
  // The conclusion, when the document declares one — the line a doctor would
  // quote. Matches "Závěr", "Závěr z vyšetření:", etc., at a line start.
  const m = bodyText.match(/^\s*Závěr[^\n:]*:?\s*(\S[\s\S]*?)(?:\n\s*\n|$)/im);
  if (m) return clean(m[1]);
  // Else: the first paragraph that reads as prose rather than as a header —
  // long enough, and not mostly digits and punctuation (a table row).
  for (const para of bodyText.split(/\n\s*\n/)) {
    const t = para.trim().replace(/\s+/g, " ");
    if (t.length < 80) continue;
    const letters = (t.match(/\p{L}/gu) ?? []).length;
    if (letters / t.length < 0.5) continue;
    return clean(t);
  }
  return clean(bodyText);
}

/**
 * Strip internal patient refs from text leaving the server.
 *
 * A `p-…` ref surfaced once inside an excerpt payload; the client grew a
 * guard, but an internal identifier in an outbound payload is the server's
 * defect to prevent, not the client's to hide. Refs are server-vocabulary —
 * the reader has a name and a chip, never an id.
 *
 * Two scopes, deliberately: the exact refs the caller knows (the bound
 * patient's — always removed), and the generic slug shape only when it
 * carries a digit (`p-novak-88`). A digitless pattern would also eat real
 * Czech clinical text — „p-vlna" is the EKG P-wave, not a ref.
 */
export function scrubRefs(text: string, knownRefs: string[] = []): string {
  let out = text;
  for (const ref of knownRefs) {
    if (ref) out = out.split(ref).join("");
  }
  return out.replace(/\bp-[a-z0-9-]*\d[a-z0-9-]*\b/g, "").replace(/[ \t]{2,}/g, " ");
}
