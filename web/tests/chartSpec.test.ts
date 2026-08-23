/**
 * A chart the doctor asked for in words, without letting the model near a
 * number.
 *
 * The invariant everything else here depends on: the model emits identifiers,
 * dates and a chart type, and nothing it sends can become a plotted value. It
 * is asserted directly rather than left to follow from the schema, because it
 * is the whole reason this feature is safe to ship in a clinical tool.
 */
import { describe, expect, it } from "vitest";
import {
  parseChartSpec,
  validateChartSpec,
  type ChartSpec,
  type Trend,
  type TrendPoint,
} from "@bw/lab-core";

const pt = (date: string, value: number, unit: string): TrendPoint => ({
  date,
  value,
  unit,
  flag: "normal",
  refLow: null,
  refHigh: null,
  valueRaw: String(value),
  reportId: `r-${date}`,
  suspect: null,
  unconfirmed: null,
});

const trend = (id: string, name: string, unit: string, rows: Array<[string, number]>): Trend => ({
  canonicalId: id,
  displayName: name,
  unit,
  points: rows.map(([d, v]) => pt(d, v, unit)),
});

const DATA = new Map<string, Trend>([
  [
    "cholesterol",
    trend("cholesterol", "Cholesterol celkový", "mmol/l", [
      ["2023-01-01", 4.5],
      ["2024-01-01", 5.4],
      ["2025-01-01", 6.3],
    ]),
  ],
  [
    "hdl",
    trend("hdl", "HDL cholesterol", "mmol/l", [
      ["2023-01-01", 1.4],
      ["2024-01-01", 1.2],
      ["2025-01-01", 1.1],
    ]),
  ],
  [
    "hemoglobin",
    trend("hemoglobin", "Hemoglobin", "g/l", [
      ["2023-01-01", 150],
      ["2024-01-01", 148],
      ["2025-01-01", 151],
    ]),
  ],
  ["crp", trend("crp", "CRP", "mg/l", [["2025-01-01", 3]])],
]);

const spec = (p: Partial<ChartSpec>): ChartSpec => ({
  parameters: ["cholesterol"],
  from: null,
  to: null,
  type: "line",
  ...p,
});

describe("parseChartSpec — the only door the model's output comes through", () => {
  it("keeps exactly the four fields it names", () => {
    const s = parseChartSpec({
      parameters: ["cholesterol", "hdl"],
      from: "2023-01-01",
      to: "2025-01-01",
      type: "bar",
    });
    expect(s).toEqual({
      parameters: ["cholesterol", "hdl"],
      from: "2023-01-01",
      to: "2025-01-01",
      type: "bar",
    });
  });

  it("drops anything else the model volunteered", () => {
    // A model that helpfully sends values, a title and a colour gets none of
    // them through. This is the door; nothing it does not name can pass.
    const s = parseChartSpec({
      parameters: ["cholesterol"],
      from: null,
      to: null,
      type: "line",
      values: [99, 98, 97],
      series: [{ name: "cholesterol", data: [1, 2, 3] }],
      title: "Cholesterol podle modelu",
      refHigh: 5,
      colour: "red",
    }) as unknown as Record<string, unknown>;
    expect(Object.keys(s!).sort()).toEqual(["from", "parameters", "to", "type"]);
  });

  it("refuses a window it cannot read rather than widening it", () => {
    // "from 2023" as free text must not silently become all of time — that
    // answers a different question from the one the doctor asked.
    expect(parseChartSpec({ parameters: ["cholesterol"], from: "2023", type: "line" })).toBeNull();
    expect(parseChartSpec({ parameters: ["cholesterol"], to: "loni", type: "line" })).toBeNull();
    expect(parseChartSpec({ parameters: ["cholesterol"], from: 2023, type: "line" })).toBeNull();
  });

  it("treats an absent window as no window", () => {
    expect(parseChartSpec({ parameters: ["x"], type: "line" })?.from).toBeNull();
    expect(parseChartSpec({ parameters: ["x"], from: null, to: "", type: "line" })?.to).toBeNull();
  });

  it("falls back to a line for any chart type it does not know", () => {
    expect(parseChartSpec({ parameters: ["x"], type: "pie" })?.type).toBe("line");
    expect(parseChartSpec({ parameters: ["x"] })?.type).toBe("line");
    expect(parseChartSpec({ parameters: ["x"], type: "bar" })?.type).toBe("bar");
  });

  it("refuses anything that is not a spec", () => {
    for (const junk of [null, undefined, 42, "cholesterol", [], {}, { parameters: [] }]) {
      expect(parseChartSpec(junk)).toBeNull();
    }
    expect(parseChartSpec({ parameters: [1, 2] })).toBeNull();
    expect(parseChartSpec({ parameters: ["  "] })).toBeNull();
  });
});

describe("validateChartSpec", () => {
  it("plots exactly the points already in the trend map", () => {
    // The invariant, asserted end to end: what is drawn is what the Trendy tab
    // would draw, object for object.
    const r = validateChartSpec(spec({ parameters: ["cholesterol"] }), DATA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charts[0].series[0].points).toEqual(DATA.get("cholesterol")!.points);
    expect(r.charts[0].series[0].points.map((p) => p.value)).toEqual([4.5, 5.4, 6.3]);
  });

  it("overlays series that share a unit", () => {
    const r = validateChartSpec(spec({ parameters: ["cholesterol", "hdl"] }), DATA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charts).toHaveLength(1);
    expect(r.charts[0].unit).toBe("mmol/l");
    expect(r.charts[0].series.map((s) => s.canonicalId)).toEqual(["cholesterol", "hdl"]);
  });

  it("never puts two units on one axis", () => {
    // mmol/l against g/l on a shared scale is a picture of nothing. Separate
    // charts, and say so.
    const r = validateChartSpec(spec({ parameters: ["cholesterol", "hemoglobin"] }), DATA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charts).toHaveLength(2);
    expect(r.charts.map((c) => c.unit).sort()).toEqual(["g/l", "mmol/l"]);
    expect(r.note).toContain("jednotky se liší");
  });

  it("applies the window before deciding anything", () => {
    const r = validateChartSpec(
      spec({ parameters: ["cholesterol"], from: "2024-01-01", to: "2025-01-01" }),
      DATA,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charts[0].series[0].points.map((p) => p.date)).toEqual(["2024-01-01", "2025-01-01"]);
  });

  it("refuses a parameter nobody measured, and says what there is", () => {
    const r = validateChartSpec(spec({ parameters: ["ferritin"] }), DATA);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("ferritin");
    expect(r.reason).toContain("Cholesterol celkový");
  });

  it("refuses a window with too little in it, and gives the range that has data", () => {
    const r = validateChartSpec(
      spec({ parameters: ["cholesterol"], from: "2030-01-01", to: "2031-01-01" }),
      DATA,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("2023-01-01");
    expect(r.reason).toContain("2025-01-01");
  });

  it("refuses a single measurement rather than drawing an axis around it", () => {
    const r = validateChartSpec(spec({ parameters: ["crp"] }), DATA);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("CRP");
  });

  it("draws what it can and names what it could not", () => {
    // A half-valid request is answered, not refused — but the gap is stated,
    // or the reader thinks they asked for one thing and got it.
    const r = validateChartSpec(spec({ parameters: ["cholesterol", "ferritin", "crp"] }), DATA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charts).toHaveLength(1);
    expect(r.note).toContain("ferritin");
    expect(r.note).toContain("CRP");
  });

  it("accepts a display name as well as an id, but does not guess", () => {
    expect(validateChartSpec(spec({ parameters: ["Cholesterol celkový"] }), DATA).ok).toBe(true);
    expect(validateChartSpec(spec({ parameters: ["cholesterol celkový"] }), DATA).ok).toBe(true);
    // Close is not the same as right: a near miss is refused with the list,
    // not silently resolved to something the doctor did not ask for.
    expect(validateChartSpec(spec({ parameters: ["cholestrol"] }), DATA).ok).toBe(false);
    expect(validateChartSpec(spec({ parameters: ["Cholesterol"] }), DATA).ok).toBe(false);
  });

  it("treats the same parameter twice as one series", () => {
    const r = validateChartSpec(spec({ parameters: ["cholesterol", "Cholesterol celkový"] }), DATA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charts[0].series).toHaveLength(1);
  });

  it("says so when nothing is loaded at all", () => {
    const r = validateChartSpec(spec({}), new Map());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("Nejsou načtené");
  });

  it("carries the requested chart type through", () => {
    const r = validateChartSpec(spec({ type: "bar" }), DATA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charts[0].type).toBe("bar");
  });
});

describe("the model cannot put a number on a chart", () => {
  it("ignores values attached to a spec, however plausible they look", () => {
    // The failure this feature is designed to make impossible: a model that
    // returns its own idea of the series. Parsed and resolved, the plotted
    // points are still the real ones.
    const hostile = parseChartSpec({
      parameters: ["cholesterol"],
      from: null,
      to: null,
      type: "line",
      values: [1.1, 1.2, 1.3],
      points: [{ date: "2023-01-01", value: 1.1 }],
    })!;
    const r = validateChartSpec(hostile, DATA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const plotted = r.charts[0].series[0].points.map((p) => p.value);
    expect(plotted).toEqual([4.5, 5.4, 6.3]);
    expect(plotted).not.toContain(1.1);
  });

  it("has no field through which a value could arrive", () => {
    const s = parseChartSpec({ parameters: ["cholesterol"], type: "line" })!;
    const serialised = JSON.stringify(s);
    // Only strings: ids, dates and the type. Nothing numeric survives parsing.
    expect(JSON.parse(serialised)).toEqual({
      parameters: ["cholesterol"],
      from: null,
      to: null,
      type: "line",
    });
    for (const v of Object.values(s)) {
      const items = Array.isArray(v) ? v : [v];
      for (const i of items) expect(typeof i === "string" || i === null).toBe(true);
    }
  });
});
