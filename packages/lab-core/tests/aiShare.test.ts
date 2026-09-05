/**
 * The AI share page carries values only — never a name, an e-mail, a report
 * id or a page. The reports fed in here carry all four, so each absence is
 * a real check rather than a vacuous one; `patientName` and `patientId` are
 * what the portal empties before storing, but this builder must not depend
 * on that having happened.
 */
import { describe, expect, it } from "vitest";
import { AI_SHARE_HEADER, buildAiShare, buildTrends, makeMeasurement, normalizeMeasurement, type LabReport } from "@bw/lab-core";

const m = (name: string, value: string, cid: string, unit = "mmol/l", ref = "(4,11-5,60)") =>
  normalizeMeasurement(makeMeasurement({ rawAnalyteName: name, valueRaw: value, unitRaw: unit, refRangeRaw: ref, canonicalId: cid }));

const reports: LabReport[] = [
  {
    id: "rep-7f3a", sourceFile: "Novak_Jan_vysledky.pdf", reportDate: "2024-02-14", labName: "Lab",
    patientName: "Jan Novák", patientId: "800101/0011",
    pages: [{ pageNum: 1, imageWidth: 800, imageHeight: 1100, imageUrl: "/api/pages/rep-7f3a/1" } as never],
    measurements: [m("S_Glukóza", "3,80", "glukoza"), m("S_CRP", "12", "crp", "mg/l", ""), m("S_Ferritin", "40", "ferritin", "µg/l", "")],
  },
  {
    id: "rep-9c1d", sourceFile: "Novak_Jan_2025.pdf", reportDate: "2025-08-13", labName: "Lab",
    patientName: "Jan Novák", patientId: "800101/0011",
    pages: [],
    measurements: [m("S_Glukóza", "6,10", "glukoza"), m("S_CRP", "3", "crp", "mg/l", "")],
  },
];

const share = () => buildAiShare(reports, buildTrends(reports, (c) => c));

describe("buildAiShare", () => {
  it("opens with the settled header, verbatim, then the table", () => {
    const s = share();
    expect(s.startsWith(AI_SHARE_HEADER + "\n\n")).toBe(true);
    expect(s).toContain("Počet reportů: 2");
    expect(s).toContain("glukoza | mmol/l | 4,11–5,6 | 2024-02-14: 3,8 (L); 2025-08-13: 6,1 (H)");
  });

  it("spells the status the way the header defines it, and says nothing for a point with no range", () => {
    const s = share();
    expect(s).toMatch(/\((H|L|norm)\)/);
    expect(s).not.toMatch(/\((high|low|normal|unknown)\)/);
    // CRP printed no range: value, date, no invented status.
    expect(s).toContain("crp | mg/l | neuvedeno | 2024-02-14: 12; 2025-08-13: 3");
  });

  it("carries no name, no e-mail, no report id, no file name, no page", () => {
    const s = share();
    for (const leak of ["Jan Novák", "Novák", "800101", "rep-7f3a", "rep-9c1d", "Novak_Jan", ".pdf", "/api/pages", "@"]) {
      expect(s, leak).not.toContain(leak);
    }
  });

  it("ends with a newline, so the page is a complete text file", () => {
    expect(share().endsWith("\n")).toBe(true);
  });
});
