/**
 * Recognising a report that is already in the account.
 *
 * Two kinds of "already here". The strong one is the file itself: the same
 * bytes hash to the same fingerprint, so a PDF picked twice is caught before
 * it is opened, redacted or read — nothing is spent on it. The weak one is
 * the content: a lab's portal re-exports a PDF with a new timestamp in its
 * metadata, so the bytes differ, but the printed date and laboratory are the
 * report's own and match. That one is only known after extraction, and is
 * offered as a probability, not a fact.
 *
 * Neither reads a value. This is bookkeeping about reports, not clinical
 * logic, and it stays DOM-free: `crypto.subtle` is a global in the browser,
 * in workerd and in node.
 */
import { czDate } from "./czech";
import type { LabReport } from "./models";

const HEX = /^[0-9a-f]{64}$/;

/** True for a string that could be one of ours; the worker checks the same. */
export const isFingerprint = (s: unknown): s is string => typeof s === "string" && HEX.test(s);

/** SHA-256 of the bytes, lowercase hex. The same bytes always give the same string. */
export async function fingerprintBytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The stored report with this fingerprint, if any. */
export function sameFile(reports: readonly LabReport[], fingerprint: string): LabReport | null {
  return reports.find((r) => r.fingerprint === fingerprint) ?? null;
}

/**
 * A stored report printed on the same date by the same laboratory — the
 * shape a re-exported PDF takes. Both must be known: a report without a
 * date matches nothing, because "no date" is not a date two reports share.
 * `exceptId` leaves out the report being replaced, which of course matches
 * itself.
 */
export function sameIssue(
  reports: readonly LabReport[],
  reportDate: string | null,
  labName: string | null,
  exceptId?: string,
): LabReport | null {
  if (!reportDate || !labName) return null;
  const lab = fold(labName);
  return reports.find((r) => r.id !== exceptId && r.reportDate === reportDate && r.labName !== null && fold(r.labName) === lab) ?? null;
}

/** "SPADIA LAB " and "Spadia Lab" are one laboratory. */
const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** How a report is named in a duplicate notice: "25. 10. 2024, SPADIA LAB". */
export function describeReport(r: Pick<LabReport, "reportDate" | "labName">): string {
  return r.labName ? `${czDate(r.reportDate)}, ${r.labName}` : czDate(r.reportDate);
}
