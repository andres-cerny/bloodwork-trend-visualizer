/**
 * Derived values are the one place this app produces a number that appears on
 * no report. That makes the failure modes specific: combining two different
 * draws, and running a formula outside the conditions where it holds.
 *
 * Friedewald above 4,5 mmol/l of triglycerides is not a worse estimate of LDL,
 * it is a wrong one. Producing it quietly would be exactly the silent
 * wrongness the rest of the codebase is arranged against.
 */
import { describe, expect, it } from "vitest";
import {
  buildDerived,
  FRIEDEWALD_MAX_TG,
  isDerivedId,
  type Trend,
  type TrendPoint,
} from "@bw/lab-core";

const pt = (
  reportId: string,
  date: string,
  value: number | null,
  unit: string,
  extra: Partial<TrendPoint> = {},
): TrendPoint => ({
  date,
  value,
  unit,
  flag: "normal",
  refLow: null,
  refHigh: null,
  valueRaw: String(value ?? ""),
  reportId,
  suspect: null,
  unconfirmed: null,
  ...extra,
});

/** Build a trend map from `id -> [reportId, date, value, unit][]`. */
function trends(
  spec: Record<string, Array<[string, string, number | null, string?]>>,
): Map<string, Trend> {
  const m = new Map<string, Trend>();
  for (const [id, rows] of Object.entries(spec)) {
    m.set(id, {
      canonicalId: id,
      displayName: id,
      unit: rows[0]?.[3] ?? "mmol/l",
      points: rows.map(([r, d, v, u]) => pt(r, d, v, u ?? "mmol/l")),
    });
  }
  return m;
}

const lipids = (tg: number) =>
  trends({
    cholesterol: [
      ["r1", "2024-01-01", 5.0],
      ["r2", "2025-01-01", 6.0],
    ],
    hdl: [
      ["r1", "2024-01-01", 1.0],
      ["r2", "2025-01-01", 1.2],
    ],
    triacylglyceroly: [
      ["r1", "2024-01-01", tg],
      ["r2", "2025-01-01", tg],
    ],
  });

describe("buildDerived", () => {
  it("computes LDL a lab never printed", () => {
    const d = buildDerived(lipids(2.2)).get("derived:ldl_friedewald")!;
    expect(d.points).toHaveLength(2);
    // 5,0 − 1,0 − (2,2 / 2,2) = 3,0
    expect(d.points[0].value).toBeCloseTo(3.0, 6);
    expect(d.points[1].value).toBeCloseTo(3.8, 6);
    expect(d.derived.formula).toContain("Friedewald");
  });

  it("refuses Friedewald above the triglyceride limit, and says why", () => {
    const d = buildDerived(lipids(FRIEDEWALD_MAX_TG + 0.1)).get("derived:ldl_friedewald");
    // Both draws invalid, so fewer than two points remain: no series at all
    // rather than a chart of one point implying a trend.
    expect(d).toBeUndefined();

    // One valid draw and one over the limit: the series exists but is honest
    // about the gap.
    const mixed = buildDerived(
      trends({
        cholesterol: [
          ["r1", "2024-01-01", 5.0],
          ["r2", "2025-01-01", 6.0],
          ["r3", "2026-01-01", 6.0],
        ],
        hdl: [
          ["r1", "2024-01-01", 1.0],
          ["r2", "2025-01-01", 1.2],
          ["r3", "2026-01-01", 1.2],
        ],
        triacylglyceroly: [
          ["r1", "2024-01-01", 2.2],
          ["r2", "2025-01-01", 2.2],
          ["r3", "2026-01-01", 9.9],
        ],
      }),
    ).get("derived:ldl_friedewald")!;
    expect(mixed.points).toHaveLength(2);
    expect(mixed.derived.skipped).toBe(1);
    expect(mixed.derived.skipReason).toContain("Friedewald");
    expect(mixed.points.map((p) => p.reportId)).toEqual(["r1", "r2"]);
  });

  it("takes every input from the same draw, never from the nearest date", () => {
    // Cholesterol in January, HDL in September. Combining them is not a lipid
    // panel — it is two halves of different ones.
    const d = buildDerived(
      trends({
        cholesterol: [
          ["r1", "2024-01-01", 5.0],
          ["r2", "2024-09-01", 6.0],
        ],
        hdl: [
          ["r3", "2024-02-01", 1.0],
          ["r4", "2024-10-01", 1.2],
        ],
      }),
    ).get("derived:non_hdl");
    expect(d).toBeUndefined();
  });

  it("computes non-HDL where the draws do line up", () => {
    const d = buildDerived(lipids(2.2)).get("derived:non_hdl")!;
    expect(d.points.map((p) => p.value)).toEqual([4.0, 4.8]);
    expect(d.unit).toBe("mmol/l");
  });

  it("never labels a derived value normal or abnormal", () => {
    // No verified Czech reference source for these, and ratio targets vary by
    // guideline. A derived number is offered to look at, not judged.
    for (const d of buildDerived(lipids(2.2)).values()) {
      for (const p of d.points) {
        expect(p.flag).toBe("unknown");
        expect(p.refLow).toBeNull();
        expect(p.refHigh).toBeNull();
      }
    }
  });

  it("refuses a draw whose input is in an unexpected unit", () => {
    // mg/dl cholesterol against mmol/l HDL would subtract nonsense.
    const d = buildDerived(
      trends({
        cholesterol: [
          ["r1", "2024-01-01", 193, "mg/dl"],
          ["r2", "2025-01-01", 232, "mg/dl"],
        ],
        hdl: [
          ["r1", "2024-01-01", 1.0],
          ["r2", "2025-01-01", 1.2],
        ],
      }),
    ).get("derived:non_hdl");
    expect(d).toBeUndefined();
  });

  it("never derives from a reading the app has withheld", () => {
    const t = trends({
      cholesterol: [
        ["r1", "2024-01-01", 5.0],
        ["r2", "2025-01-01", 6.0],
        ["r3", "2026-01-01", 60.0],
      ],
      hdl: [
        ["r1", "2024-01-01", 1.0],
        ["r2", "2025-01-01", 1.2],
        ["r3", "2026-01-01", 1.2],
      ],
    });
    // A misread decimal on the last draw.
    t.get("cholesterol")!.points[2].suspect = "posunutá desetinná čárka";
    const d = buildDerived(t).get("derived:non_hdl")!;
    expect(d.points).toHaveLength(2);
    expect(d.points.some((p) => p.reportId === "r3")).toBe(false);
  });

  it("computes the ratios, and guards their division", () => {
    const ratio = buildDerived(lipids(2.2)).get("derived:chol_hdl")!;
    expect(ratio.points[0].value).toBeCloseTo(5.0, 6);
    expect(ratio.unit).toBe("");

    const zero = buildDerived(
      trends({
        cholesterol: [
          ["r1", "2024-01-01", 5.0],
          ["r2", "2025-01-01", 6.0],
        ],
        hdl: [
          ["r1", "2024-01-01", 0],
          ["r2", "2025-01-01", 0],
        ],
      }),
    ).get("derived:chol_hdl");
    expect(zero).toBeUndefined();
  });

  it("computes de Ritis from the liver enzymes", () => {
    const d = buildDerived(
      trends({
        ast: [
          ["r1", "2024-01-01", 0.6, "µkat/l"],
          ["r2", "2025-01-01", 0.8, "µkat/l"],
        ],
        alt: [
          ["r1", "2024-01-01", 0.3, "µkat/l"],
          ["r2", "2025-01-01", 0.8, "µkat/l"],
        ],
      }),
    ).get("derived:ast_alt")!;
    expect(d.points.map((p) => p.value)).toEqual([2, 1]);
  });

  it("offers nothing when the inputs are not loaded", () => {
    expect(buildDerived(trends({ glukoza: [["r1", "2024-01-01", 5.0]] })).size).toBe(0);
    expect(buildDerived(new Map()).size).toBe(0);
  });

  it("marks derived ids so they cannot be mistaken for a measured analyte", () => {
    expect(isDerivedId("derived:non_hdl")).toBe(true);
    expect(isDerivedId("cholesterol")).toBe(false);
    for (const id of buildDerived(lipids(2.2)).keys()) expect(isDerivedId(id)).toBe(true);
  });
});
