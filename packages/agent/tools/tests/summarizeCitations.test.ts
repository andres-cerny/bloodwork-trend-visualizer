/**
 * What summarize_changes offers as evidence, over the corpus the demo shows.
 *
 * The defect this pins: the tool used to register one source per *report* with
 * a hardcoded `bbox: null` and `page: 1`, so the rail on the first turn a
 * doctor takes — "dej mi souhrn X" — was six labelled references to a
 * letterhead and not one photograph of a printed row. In the captured
 * hruby-souhrn turn the model then marked four different values (CK, ferritin,
 * saturace transferinu, železo) with the same [6], while the five other draw
 * cards it had been handed went unreferenced.
 *
 * Two levels on purpose. The committed corpus proves the demo-visible outcome;
 * the hand-built reports below prove the bound and the degradation, which no
 * corpus here can reach — every measurement in both demo tenants happens to
 * carry a box, so a guard that only ran over them would never see the
 * unlocated path at all.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SessionSource } from "@bw/datasource";
import type { LabReport, Measurement } from "@bw/lab-core";
import { runTool, type SourceInfo, type ToolContext } from "../src/index";

const ROOT = new URL("../../../../", import.meta.url);
const corpus = (p: string) =>
  JSON.parse(readFileSync(new URL(p, ROOT), "utf-8")) as Array<LabReport & { patientRef?: string }>;

function registry() {
  const sources: Array<{ n: number } & SourceInfo> = [];
  return { sources, cite: (s: SourceInfo) => sources.push({ n: sources.length + 1, ...s }) };
}

async function summarize(reports: LabReport[]) {
  const { sources, cite } = registry();
  const ctx: ToolContext = { source: new SessionSource(reports), cite };
  const r = await runTool("summarize_changes", {}, ctx);
  const content = r.content as {
    changes: Array<{ canonicalId: string; displayName: string; src?: number }>;
    reports: Array<Record<string, unknown>>;
  };
  return { sources, content };
}

const CORPORA: Array<[string, () => LabReport[]]> = [
  ["sport / Tomáš Hrubý", () => corpus("apps/chat/public/demo/sport/reports.json").filter((r) => r.patientRef === "p-hruby-1994")],
  ["orto / Jiří Novák 1963", () => corpus("apps/chat/public/demo/orto/reports.json").filter((r) => r.patientRef === "p-novak-1963")],
  ["bloodwork demo patient", () => corpus("apps/bloodwork/public/demo/reports.json")],
];

describe.each(CORPORA)("summarize_changes over %s", (_name, load) => {
  it("cites printed rows, every one of them croppable", async () => {
    const { sources } = await summarize(load());
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(s.kind).toBe("lab");
      if (s.kind !== "lab") continue;
      // The four fields the rail needs before it will draw a crop.
      expect(s.bbox).not.toBeNull();
      expect(s.imageUrl).not.toBeNull();
      expect(s.pageW).not.toBeNull();
      expect(s.pageH).not.toBeNull();
    }
  });

  it("registers no whole-report source — the defect, stated", async () => {
    const { sources } = await summarize(load());
    for (const s of sources) {
      // "Odběr 2026-02-24" was the old label, and it is the shape of a
      // citation that stands for a draw rather than for a value.
      expect(s.label).not.toMatch(/^Odběr\b/);
    }
  });

  it("names the analyte and its printed value in every label", async () => {
    const { sources, content } = await summarize(load());
    const cited = content.changes.filter((c) => c.src !== undefined);
    expect(cited.length).toBe(sources.length);
    for (const c of cited) {
      const s = sources[c.src! - 1];
      expect(s.label.startsWith(`${c.displayName} `)).toBe(true);
    }
  });

  it("stays bounded, and cites the most notable changes first", async () => {
    const { sources, content } = await summarize(load());
    expect(sources.length).toBeLessThanOrEqual(6);
    // The head of the ranked list, not an arbitrary subset of it.
    const cited = content.changes.map((c) => c.src !== undefined);
    const firstUncited = cited.indexOf(false);
    if (firstUncited !== -1) expect(cited.slice(firstUncited).every((x) => !x)).toBe(true);
  });

  it("keeps the draws in the payload but not in the rail", async () => {
    // The model writes "6 odběrů od … do … v laboratoři X" out of this list,
    // and nothing else in the result carries a lab name. It is information,
    // not evidence, so it travels without a source number.
    const { content } = await summarize(load());
    expect(content.reports.length).toBe(load().length);
    for (const r of content.reports) {
      expect(Object.keys(r).sort()).toEqual(["date", "lab"]);
    }
  });
});

/**
 * A synthetic patient with more out-of-range parameters than the rail may
 * show, and one row the extractor never located. Neither state exists in the
 * committed corpora — every demo measurement has a box — so without this the
 * bound and the degradation would be untested and a green run would imply
 * coverage it does not have.
 */
function syntheticReports(analytes: number, located: boolean): LabReport[] {
  const draw = (i: number, id: string, date: string): LabReport => ({
    id,
    sourceFile: `${id}.pdf`,
    reportDate: date,
    labName: "Laboratoř Test",
    patientName: "Test",
    patientId: null,
    pages: [{ pageNum: 1, imageUrl: `/${id}.png`, imageWidth: 1000, imageHeight: 1400 }],
    measurements: Array.from({ length: analytes }, (_, a) => ({
      rawAnalyteName: `Analyt ${a}`,
      valueRaw: String(100 + i * 10 + a),
      unitRaw: "mmol/l",
      refRangeRaw: "0-1",
      sourceSnippet: "",
      sourcePage: 1,
      confidence: "high",
      canonicalId: `an${a}`,
      value: 100 + i * 10 + a,
      unit: "mmol/l",
      refRangeLow: 0,
      refRangeHigh: 1,
      refRangeText: "0-1",
      // Out of range at every draw, so every analyte ranks high enough to be
      // a candidate for citation and the bound is what has to stop it.
      flag: "high",
      extractedBy: "test",
      escalated: false,
      disagreement: null,
      corrected: false,
      bbox: located ? [1, 2 + a, 3, 4 + a] : null,
    })) as Measurement[],
  });
  return [draw(0, "t1", "2025-01-01"), draw(1, "t2", "2025-06-01")];
}

describe("summarize_changes on data the demo corpus cannot produce", () => {
  it("cites at most six rows however many parameters moved", async () => {
    const { sources, content } = await summarize(syntheticReports(20, true));
    expect(content.changes.length).toBe(20);
    expect(sources.length).toBe(6);
  });

  it("cites an unlocated row without a box rather than dropping it", async () => {
    const { sources, content } = await summarize(syntheticReports(3, false));
    // Three changes, three citations — none of them silently missing.
    expect(content.changes.length).toBe(3);
    expect(content.changes.every((c) => c.src !== undefined)).toBe(true);
    expect(sources.length).toBe(3);
    for (const s of sources) {
      if (s.kind !== "lab") continue;
      expect(s.bbox).toBeNull();
      // Degraded to what every lab source used to be, and no worse.
      expect(s.imageUrl).toBe("/t2.png");
    }
  });

  it("says nothing at all when there is nothing to cite with", async () => {
    // No cite function: the tool still answers, and registers nothing.
    const ctx: ToolContext = { source: new SessionSource(syntheticReports(3, true)) };
    const r = await runTool("summarize_changes", {}, ctx);
    const content = r.content as { changes: Array<{ src?: number }> };
    expect(r.ok).toBe(true);
    expect(content.changes.every((c) => c.src === undefined)).toBe(true);
  });
});
