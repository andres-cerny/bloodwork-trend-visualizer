/**
 * The compact view of a patient's data that the chat model is allowed to see.
 *
 * Domain formatting, not transport, which is why it lives here rather than with
 * the API client: every number in it came out of the deterministic layer, and
 * that is the guarantee being preserved.
 */
import { czNum } from "./summary";
import { numericPoints, type Trend } from "./trends";
import type { LabReport } from "./models";

export function buildChatContext(reports: LabReport[], trends: Map<string, Trend>): string {
  const lines: string[] = [];
  const dates = reports.map((r) => r.reportDate).filter(Boolean).sort();
  lines.push(`Počet reportů: ${reports.length}. Data odběrů: ${dates.join(", ")}.`);
  lines.push("");
  lines.push("Analyt | jednotka | referenční meze | hodnoty (datum: hodnota, stav)");
  for (const t of trends.values()) {
    const np = numericPoints(t);
    if (np.length === 0) continue;
    const last = np[np.length - 1];
    const ref =
      last.refLow !== null || last.refHigh !== null
        ? `${last.refLow !== null ? czNum(last.refLow) : ""}–${last.refHigh !== null ? czNum(last.refHigh) : ""}`
        : "neuvedeno";
    const series = np.map((p) => `${p.date}: ${czNum(p.value)} (${p.flag})`).join("; ");
    lines.push(`${t.displayName} | ${t.unit || "—"} | ${ref} | ${series}`);
  }
  return lines.join("\n");
}
