/**
 * Chart is drawn by two apps, and only one of them asked for the new options.
 *
 * `chart-default.golden.json` is the exact markup this component produced
 * before `refInDomain` and `fluid` existed, captured from the commit that
 * introduced them. A chart rendered with no props must still produce it, glyph
 * for glyph — otherwise the bloodwork app's trends quietly changed shape
 * because the chat app wanted a taller plot.
 *
 * Regenerating the golden is not the fix for a failure here. It is the fix for
 * a deliberate change to what every caller gets, which is a different
 * conversation and should be a different commit.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import Chart from "../src/Chart";
import type { Trend } from "@bw/lab-core";

const golden: Record<string, string> = JSON.parse(
  readFileSync(fileURLToPath(new URL("./chart-default.golden.json", import.meta.url)), "utf-8"),
);

const mk = (
  pts: Array<[string, number, number | null, number | null, string | null]>,
): Trend =>
  ({
    canonicalId: "hemoglobin",
    displayName: "hemoglobin",
    unit: "g/l",
    points: pts.map(([date, value, refLow, refHigh, flag]) => ({
      date,
      value,
      valueRaw: String(value),
      refLow,
      refHigh,
      flag,
      unit: "g/l",
      reportId: "r",
      suspect: null,
      unconfirmed: false,
    })),
  }) as unknown as Trend;

/** One trend of each shape the component branches on. */
export const CASES: Record<string, Trend> = {
  // A limit just outside the data — the case `refInDomain` is about.
  palan: mk([
    ["2023-03-11", 149, 135, 175, null],
    ["2023-11-02", 151, 135, 175, null],
    ["2024-05-19", 166, 135, 175, null],
    ["2025-01-30", 158, 135, 175, null],
    ["2026-02-24", 150, 135, 175, null],
  ]),
  // A wide band around a falling series — the case the default protects.
  ferritin: mk([
    ["2023-02-14", 126, 30, 400, null],
    ["2024-03-05", 88, 30, 400, null],
    ["2026-02-24", 21, 30, 400, "low"],
  ]),
  noRange: mk([
    ["2023-02-14", 4.2, null, null, null],
    ["2024-03-05", 5.1, null, null, null],
  ]),
  single: mk([["2023-02-14", 12, 3, 20, null]]),
  none: mk([]),
};

describe("Chart with no props", () => {
  for (const [name, trend] of Object.entries(CASES)) {
    it(`renders ${name} exactly as it did before the options existed`, () => {
      const now = renderToStaticMarkup(createElement(Chart, { trend }));
      // Guard against a vacuous pass: a malformed fixture makes every case
      // render the same one-line "no numeric values" paragraph.
      if (name !== "none")
        expect(now).toContain(name === "single" ? "jediné měření" : "<svg");
      expect(now).toBe(golden[name]);
    });
  }
});

describe("the options are opt-in, and they do something", () => {
  it("refInDomain brings both limits inside the plot", () => {
    const off = renderToStaticMarkup(createElement(Chart, { trend: CASES.palan }));
    const on = renderToStaticMarkup(
      createElement(Chart, { trend: CASES.palan, refInDomain: true }),
    );
    expect(on).not.toBe(off);
    // Off, 135 is below the domain and gets no line. On, both are labelled.
    expect(off.match(/mez/g)?.length ?? 0).toBeLessThan(on.match(/mez/g)?.length ?? 0);
  });

  it("fluid alone changes nothing until the element has been measured", () => {
    // No layout in renderToStaticMarkup, so the fixed viewBox is still right —
    // which is also what a first paint gets, before the ResizeObserver fires.
    expect(renderToStaticMarkup(createElement(Chart, { trend: CASES.palan, fluid: true }))).toBe(
      golden.palan,
    );
  });
});
