/**
 * The free checks before a document is spent, and after a read before it is
 * stored (src/lib/fileChecks.ts).
 */
import { describe, expect, it } from "vitest";
import type { LabReport } from "@bw/lab-core";
import { MAX_PDF_BYTES, MAX_PHOTO_BYTES, dateDoubtOf, drawDateOf, drawDates, sameDayCheck, sizeRefusal } from "../src/lib/fileChecks";
import { pdfWarnings } from "../src/lib/upload";

describe("size", () => {
  it("refuses an empty file and one over the limit, saying the limit", () => {
    expect(sizeRefusal({ size: 0 }, false)).toMatch(/prázdný/);
    expect(sizeRefusal({ size: MAX_PDF_BYTES + 1 }, false)).toMatch(/Nejvýše 20 MB na PDF/);
    expect(sizeRefusal({ size: MAX_PDF_BYTES + 1 }, true)).toBeNull();
    expect(sizeRefusal({ size: MAX_PHOTO_BYTES + 1 }, true)).toMatch(/Nejvýše 25 MB na fotku/);
    expect(sizeRefusal({ size: 300_000 }, false)).toBeNull();
  });
});

describe("the draw date a page prints", () => {
  it("reads the date after the draw's label, not the birth date or the print date", () => {
    expect(drawDateOf(["Datum narození: 01.01.1980", "Datum odběru: 14.04.2026 07:32", "Vytištěno 15.04.2026"])).toBe("2026-04-14");
    expect(drawDateOf(["Odběr 3. 2. 2025"])).toBe("2025-02-03");
    expect(drawDateOf(["Přijetí vzorku: 5.6.26"])).toBe("2026-06-05");
    expect(drawDateOf(["Vytištěno 15.04.2026"])).toBeNull();
  });

  it("finds two reports in one file only when two pages print different draw dates", () => {
    expect(drawDates([["Datum odběru: 14.04.2026"], ["Datum odběru: 14.04.2026"], ["pokračování"]])).toEqual(["2026-04-14"]);
    expect(drawDates([["Datum odběru: 14.04.2026"], ["Datum odběru: 02.09.2025"]])).toEqual(["2026-04-14", "2025-09-02"]);
  });
});

describe("a PDF's warnings", () => {
  const row = (text: string) => ({ cells: [text], cellBoxes: [], box: [0, 0, 0, 0] as [number, number, number, number] });
  const lab = [
    row("Biochemie Výsledek Jednotky Ref. meze"),
    row("S_Glukóza 5,32 mmol/l 3,9 - 5,6"),
    row("S_Kreatinin 81 µmol/l 44 - 104"),
    row("S_Urea 5,1 mmol/l 2,8 - 8,1"),
    row("S_CRP 1,2 mg/l 0 - 5"),
  ];
  it("says nothing about an ordinary one-page lab sheet", () => {
    expect(pdfWarnings([{ pageNum: 1, rows: [row("Datum odběru: 14.04.2026"), ...lab] }], [])).toEqual([]);
  });
  it("warns on seven pages, on two draw dates, and on a text that is not a lab sheet", () => {
    const pages = Array.from({ length: 7 }, (_, i) => ({ pageNum: i + 1, rows: lab }));
    expect(pdfWarnings(pages, [])).toContain("long");
    expect(pdfWarnings([{ pageNum: 1, rows: [row("Datum odběru: 14.04.2026"), ...lab] }, { pageNum: 2, rows: [row("Datum odběru: 01.03.2026"), ...lab] }], [])).toContain("multi_date");
    expect(pdfWarnings([{ pageNum: 1, rows: [row("Faktura za služby"), row("Celkem k úhradě 1 200 Kč")] }], [])).toEqual(["not_lab"]);
  });
  it("does not judge a scan it cannot read", () => {
    expect(pdfWarnings([{ pageNum: 1, rows: [] }], [1])).toEqual([]);
  });
});

const rep = (id: string, date: string | null, rows: Array<[string, string]>): LabReport =>
  ({ id, reportDate: date, measurements: rows.map(([c, v]) => ({ canonicalId: c, rawAnalyteName: c, valueRaw: v })) }) as unknown as LabReport;

describe("the same day twice", () => {
  const held = rep("a", "2026-04-14", [["glukoza", "5,3"], ["kreatinin", "81"], ["urea", "5,1"]]);
  it("is a duplicate with the same parameters and values", () => {
    expect(sameDayCheck(rep("b", "2026-04-14", [["glukoza", "5.3"], ["kreatinin", "81"], ["urea", "5,1"]]), [held]).kind).toBe("duplicate");
  });
  it("is a repeat draw with the same parameters and other values", () => {
    expect(sameDayCheck(rep("b", "2026-04-14", [["glukoza", "7,9"], ["kreatinin", "95"], ["urea", "6,0"]]), [held]).kind).toBe("repeat");
  });
  it("is nothing for another panel of the same draw, or another day", () => {
    expect(sameDayCheck(rep("b", "2026-04-14", [["hemoglobin", "140"], ["leukocyty", "6,1"], ["glukoza", "5,3"]]), [held]).kind).toBe("none");
    expect(sameDayCheck(rep("b", "2026-04-15", [["glukoza", "5,3"], ["kreatinin", "81"], ["urea", "5,1"]]), [held]).kind).toBe("none");
    expect(sameDayCheck(rep("b", null, [["glukoza", "5,3"]]), [held]).kind).toBe("none");
  });
});

describe("a date in doubt", () => {
  const today = new Date("2026-09-27T12:00:00Z");
  it("names a missing, future, ancient or disputed date, and passes an ordinary one", () => {
    expect(dateDoubtOf({ reportDate: null }, today)).toMatch(/nenašlo/);
    expect(dateDoubtOf({ reportDate: "2062-04-14" }, today)).toMatch(/budoucnosti/);
    expect(dateDoubtOf({ reportDate: "1962-04-14" }, today)).toMatch(/staré/);
    expect(dateDoubtOf({ reportDate: "2026-04-14", dateDoubt: "Čtení se neshodla" }, today)).toBe("Čtení se neshodla");
    expect(dateDoubtOf({ reportDate: "2026-04-14" }, today)).toBeNull();
  });
});

describe("the trend screens' view of doubted dates", () => {
  it("holds a future-dated report out and marks a disputed one's readings unconfirmed, through review.ts", async () => {
    const { forTrends } = await import("../src/lib/fileChecks");
    const { reviewOf } = await import("@bw/lab-core");
    const today = new Date("2026-09-27T12:00:00Z");
    const m = { canonicalId: "glukoza", rawAnalyteName: "Glu", valueRaw: "5,1", value: 5.1, unit: "mmol/l", refRangeLow: 3.9, refRangeHigh: 5.6 };
    const out = forTrends(
      [
        { id: "ok", reportDate: "2026-04-14", measurements: [m] },
        { id: "future", reportDate: "2062-04-14", measurements: [m] },
        { id: "disputed", reportDate: "2026-04-17", dateDoubt: "Čtení se na datu odběru neshodla.", measurements: [m] },
      ] as never,
      today,
    );
    expect(out.map((r) => r.id)).toEqual(["ok", "disputed"]);
    const r = reviewOf(out[1].measurements[0] as never, () => null);
    expect(r.level).toBe("unconfirmed");
    expect(r.chip).toBe("ověřit datum");
    expect(reviewOf(out[0].measurements[0] as never, () => null).level).toBe("ok");
  });
});

describe("a file's fingerprint", () => {
  it("depends on the account's salt, so the same file under another account — or unsalted — does not match", async () => {
    const { fingerprintOf } = await import("../src/lib/fileChecks");
    const bytes = new TextEncoder().encode("%PDF-1.4 the same file").buffer as ArrayBuffer;
    const a = await fingerprintOf(bytes, "salt-a");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await fingerprintOf(bytes, "salt-a")).toBe(a);
    expect(await fingerprintOf(bytes, "salt-b")).not.toBe(a);
  });
});
