/**
 * get_perf_trend: the adapter over the card's performance store, and the
 * three behaviours that matter — degrade without a card (the session mode
 * must not pretend performance data was searched), refuse an unknown metric
 * with the list-hint, and cite each point's own document with the passage
 * around the printed number, skipping honestly where a visit has no note.
 */
import { describe, expect, it } from "vitest";
import type { FullDocument, PerfMetricRef, PerfPoint, VisitRow } from "@bw/datasource";
import { runTool, type SourceInfo, type ToolContext } from "../src/index";

const POINTS: PerfPoint[] = [
  { visitId: "v1", metricId: "vo2max_rel", displayName: "VO₂max", unit: "ml/kg/min", value: 71.2, refLow: null, refHigh: null, testDate: "2024-06-05" },
  { visitId: "v2", metricId: "vo2max_rel", displayName: "VO₂max", unit: "ml/kg/min", value: 70.4, refLow: null, refHigh: null, testDate: "2026-06-09" },
];

const VISITS: VisitRow[] = [
  { id: "v1", visitDate: "2024-06-05", kind: "annual", title: "Roční prohlídka", noteDocumentId: null }, // the honest gap
  { id: "v2", visitDate: "2026-06-09", kind: "annual", title: "Roční prohlídka", noteDocumentId: "d2" },
];

const DOC: FullDocument = {
  id: "d2",
  docDate: "2026-06-09",
  kind: "perf_eval",
  title: "Zpráva z vyšetření",
  bodyText:
    "Centrum sportovní medicíny z.s.\nSokolská 35\n\n" +
    "Anamnéza: bez interkurentních onemocnění, trénink dle plánu, subjektivně bez obtíží. " +
    "Objektivně: eupnoe, akce srdeční pravidelná, dýchání čisté, bez otoků.\n\n" +
    "Spiroergometrie: dosaženo VO₂max 70,4 ml/kg/min při maximální zátěži.\n\nZávěr: sportu schopen.",
  pages: [{ pageNum: 1, imageUrl: "/demo/csm/pages/d2_p1.png", width: 100, height: 100 }],
};

function ctxWith(over: Partial<ToolContext>): ToolContext {
  return { source: {} as ToolContext["source"], ...over };
}

describe("get_perf_trend", () => {
  const card = {
    async listPerfMetrics(): Promise<PerfMetricRef[]> {
      return [{ metricId: "vo2max_rel", displayName: "VO₂max", unit: "ml/kg/min", points: 2, lastDate: "2026-06-09" }];
    },
    async perfTrend(id: string) {
      return id === "vo2max_rel" ? POINTS : [];
    },
    async visits() {
      return VISITS;
    },
  };

  it("degrades without a card, telling the model not to pretend", async () => {
    const r = await runTool("get_perf_trend", {}, ctxWith({ card: undefined }));
    expect(r.ok).toBe(false);
    expect((r.content as any).error).toBe("no_perf_data");
  });

  it("lists the patient's metrics when no metricId is asked", async () => {
    const r = await runTool("get_perf_trend", {}, ctxWith({ card }));
    expect(r.ok).toBe(true);
    expect((r.content as any).metrics[0].metricId).toBe("vo2max_rel");
  });

  it("refuses an unknown metric with the list-hint, never an empty series", async () => {
    const r = await runTool("get_perf_trend", { metricId: "wingate" }, ctxWith({ card }));
    expect(r.ok).toBe(false);
    expect((r.content as any).error).toBe("not_found");
  });

  it("cites the visit's document around the printed value, and skips the noteless visit honestly", async () => {
    const registered: SourceInfo[] = [];
    const ctx = ctxWith({
      card,
      documents: { getDocument: async (id: string) => (id === "d2" ? DOC : null) } as any,
      cite: (s) => registered.push(s),
    });
    const r = await runTool("get_perf_trend", { metricId: "vo2max_rel" }, ctx);
    expect(r.ok).toBe(true);
    const pts = (r.content as any).points;
    expect(pts[0].src).toBeUndefined(); // v1 has no note — uncited, not invented
    expect(pts[1].src).toBe(1);
    expect(registered).toHaveLength(1);
    const src = registered[0] as Extract<SourceInfo, { kind: "document" }>;
    expect(src.excerpt).toContain("70,4"); // the passage around the printed number
    expect(src.excerpt).not.toContain("Sokolská"); // not the letterhead
    expect(src.label).toBe("VO₂max 70,4 ml/kg/min");
  });
});
