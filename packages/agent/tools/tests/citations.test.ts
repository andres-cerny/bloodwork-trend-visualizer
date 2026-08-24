/**
 * A citation must point at the row, and must not point at nothing.
 *
 * Two properties, both proven by reintroducing the fault they replaced. The
 * first is that a lab source carries the box the payload holds, because the
 * rail draws a crop from it and a source without one degrades to a picture of
 * a letterhead. The second is that a row the payload cannot locate still gets
 * a number: dropping it left the value in the answer wearing no marker while
 * its neighbours wore one, with nothing on screen to say why.
 */
import { describe, expect, it } from "vitest";
import type { LabReport, Measurement, TrendPoint } from "@bw/lab-core";
import { citeMeasuredRow, reportOfPoint, type SourceInfo } from "../src/citations";

function collector() {
  const out: SourceInfo[] = [];
  return { out, cite: (s: SourceInfo) => out.push(s) };
}

function measurement(over: Partial<Measurement>): Measurement {
  return {
    rawAnalyteName: "Ferritin",
    valueRaw: "21",
    unitRaw: "µg/l",
    refRangeRaw: "30-400",
    sourceSnippet: "",
    sourcePage: 1,
    confidence: "high",
    canonicalId: "ferritin",
    value: 21,
    unit: "µg/l",
    refRangeLow: 30,
    refRangeHigh: 400,
    refRangeText: "30-400",
    flag: "low",
    extractedBy: "test",
    escalated: false,
    disagreement: null,
    corrected: false,
    bbox: [10, 20, 300, 34],
    ...over,
  } as Measurement;
}

function report(over: Partial<LabReport> = {}): LabReport {
  return {
    id: "r1",
    sourceFile: "r1.pdf",
    reportDate: "2026-02-24",
    labName: "Laboratoř Zelený Ostrov s.r.o.",
    patientName: "Tomáš Hrubý",
    patientId: null,
    pages: [
      { pageNum: 1, imageUrl: "/p1.png", imageWidth: 1240, imageHeight: 1754 },
      { pageNum: 2, imageUrl: "/p2.png", imageWidth: 1240, imageHeight: 1754 },
    ],
    measurements: [measurement({})],
    ...over,
  };
}

function point(over: Partial<TrendPoint> = {}): TrendPoint {
  return {
    date: "2026-02-24",
    value: 21,
    unit: "µg/l",
    flag: "low",
    refLow: 30,
    refHigh: 400,
    valueRaw: "21",
    reportId: "r1",
    suspect: null,
    unconfirmed: null,
    ...over,
  };
}

describe("reportOfPoint", () => {
  it("resolves by report id, which is exact", () => {
    const a = report({ id: "r1" });
    const b = report({ id: "r2", reportDate: "2026-02-24" });
    // Both share a date; only the id says which one the value came from.
    expect(reportOfPoint([b, a], point({ reportId: "r1" }))?.id).toBe("r1");
    expect(reportOfPoint([a, b], point({ reportId: "r2" }))?.id).toBe("r2");
  });

  it("falls back to the printed date when a point carries no id", () => {
    const a = report({ id: "r1", reportDate: "2026-02-24" });
    expect(reportOfPoint([a], point({ reportId: "" }))?.id).toBe("r1");
  });

  it("returns null rather than guessing when neither matches", () => {
    expect(reportOfPoint([report()], point({ reportId: "nope", date: "1999-01-01" }))).toBeNull();
  });
});

describe("citeMeasuredRow", () => {
  it("carries the row's box, its page and its printed value", () => {
    const { out, cite } = collector();
    const n = citeMeasuredRow(cite, [report()], "ferritin", "ferritin", point());
    expect(n).toBe(1);
    const s = out[0];
    expect(s.kind).toBe("lab");
    if (s.kind !== "lab") return;
    expect(s.bbox).toEqual([10, 20, 300, 34]);
    expect(s.label).toBe("ferritin 21 µg/l");
    expect(s.page).toBe(1);
    expect(s.imageUrl).toBe("/p1.png");
    expect(s.pageW).toBe(1240);
    expect(s.pageH).toBe(1754);
    expect(s.lab).toBe("Laboratoř Zelený Ostrov s.r.o.");
    expect(s.reportId).toBe("r1");
  });

  it("reads the image of the page the row was printed on, not page one", () => {
    const { out, cite } = collector();
    const rep = report({ measurements: [measurement({ sourcePage: 2, bbox: [1, 2, 3, 4] })] });
    citeMeasuredRow(cite, [rep], "ferritin", "ferritin", point());
    const s = out[0];
    if (s.kind !== "lab") throw new Error("expected a lab source");
    expect(s.page).toBe(2);
    expect(s.imageUrl).toBe("/p2.png");
  });

  it("shows the value as printed, never as parsed", () => {
    // "0,40" printed and 0.4 parsed are the same number and not the same
    // string, and this label sits beside a photograph of the paper.
    const { out, cite } = collector();
    const rep = report({ measurements: [measurement({ valueRaw: "0,40", value: 0.4 })] });
    citeMeasuredRow(cite, [rep], "ferritin", "ferritin", point({ valueRaw: "0,40", value: 0.4 }));
    const s = out[0];
    if (s.kind !== "lab") throw new Error("expected a lab source");
    expect(s.label).toBe("ferritin 0,40 µg/l");
  });

  it("still cites a row the payload located nowhere, without a box", () => {
    const { out, cite } = collector();
    const rep = report({ measurements: [measurement({ bbox: null })] });
    const n = citeMeasuredRow(cite, [rep], "ferritin", "ferritin", point());
    expect(n).toBe(1);
    const s = out[0];
    if (s.kind !== "lab") throw new Error("expected a lab source");
    expect(s.bbox).toBeNull();
    // Degraded, not dropped: the whole page is still one click away.
    expect(s.imageUrl).toBe("/p1.png");
    expect(s.label).toBe("ferritin 21 µg/l");
  });

  it("still cites when the analyte is not in the report at all", () => {
    const { out, cite } = collector();
    const rep = report({ measurements: [measurement({ canonicalId: "hemoglobin" })] });
    const n = citeMeasuredRow(cite, [rep], "ferritin", "ferritin", point());
    expect(n).toBe(1);
    const s = out[0];
    if (s.kind !== "lab") throw new Error("expected a lab source");
    // Everything it can still say truthfully, and nothing it cannot.
    expect(s.bbox).toBeNull();
    expect(s.reportId).toBe("r1");
    expect(s.label).toBe("ferritin 21 µg/l");
  });

  it("still cites when no report matches, rather than returning nothing", () => {
    const { out, cite } = collector();
    const n = citeMeasuredRow(cite, [], "ferritin", "ferritin", point());
    expect(n).toBe(1);
    const s = out[0];
    if (s.kind !== "lab") throw new Error("expected a lab source");
    expect(s.bbox).toBeNull();
    expect(s.imageUrl).toBeNull();
    expect(s.reportId).toBe("r1");
    expect(s.lab).toBe("");
  });

  it("never invents a box", () => {
    // The rail computes nothing; whatever is here is what it draws. A source
    // whose payload had no box must carry null, not a plausible rectangle.
    const { out, cite } = collector();
    const rep = report({ measurements: [measurement({ bbox: null })] });
    citeMeasuredRow(cite, [rep], "ferritin", "ferritin", point());
    citeMeasuredRow(cite, [], "ferritin", "ferritin", point());
    for (const s of out) {
      if (s.kind !== "lab") continue;
      expect(s.bbox).toBeNull();
      expect(s.pageW).toBe(s.imageUrl ? 1240 : null);
    }
  });
});
