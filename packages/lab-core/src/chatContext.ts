/**
 * The compact view of a patient's data that a model is allowed to see.
 *
 * Domain formatting, not transport, which is why it lives here rather than with
 * the API client: every number in it came out of the deterministic layer, and
 * that is the guarantee being preserved. Two readers share the table: the
 * demo's chat model (`buildChatContext`) and whatever assistant a person
 * pastes their AI share link into (`buildAiShare`, aiShare.ts). They differ
 * only in how a point's status is spelled.
 */
import { czNum, czRange } from "./summary";
import { numericPoints, type Trend, type TrendPoint } from "./trends";
import type { LabReport } from "./models";

/**
 * One line per analyte: name | unit | reference range | "date: value (status)".
 * The status column is the caller's — the flag word as computed, or the
 * short form the share page's header defines. A point with no range gets no
 * status at all rather than a made-up one.
 */
export function contextTable(reports: LabReport[], trends: Map<string, Trend>, status: (p: TrendPoint) => string | null): string {
  const lines: string[] = [];
  const dates = reports.map((r) => r.reportDate).filter(Boolean).sort();
  lines.push(`Počet reportů: ${reports.length}. Data odběrů: ${dates.join(", ")}.`);
  lines.push("");
  lines.push("Analyt | jednotka | referenční meze | hodnoty (datum: hodnota, stav)");
  for (const t of trends.values()) {
    const np = numericPoints(t);
    if (np.length === 0) continue;
    const last = np[np.length - 1];
    const ref = last.refLow !== null || last.refHigh !== null ? czRange(last.refLow, last.refHigh) : "neuvedeno";
    const series = np
      .map((p) => {
        const s = status(p);
        return `${p.date}: ${czNum(p.value)}${s ? ` (${s})` : ""}`;
      })
      .join("; ");
    lines.push(`${t.displayName} | ${t.unit || "—"} | ${ref} | ${series}`);
  }
  return lines.join("\n");
}

export function buildChatContext(reports: LabReport[], trends: Map<string, Trend>): string {
  return contextTable(reports, trends, (p) => p.flag);
}
