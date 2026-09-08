/**
 * The portal chart draws only what was measured, in two colours.
 *
 * Three rules from the round-two review, each pinned on rendered markup:
 * the line is straight segments (a curve claims a shape for the days
 * between two draws); the out-of-range zones are the soft status tint and
 * nothing else is painted under the line (blue says "the line", red says
 * "outside"); the last point carries no value tag (the value sits above the
 * chart and every point answers to hover). Each was proven by running the
 * test against the previous chart, which failed all three.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TrendChart, { Sparkline } from "../src/TrendChart";
import type { Trend } from "@bw/lab-core";

const point = (date: string, value: number, flag: "normal" | "high" | "low" = "normal") =>
  ({
    date,
    value,
    unit: "g/l",
    flag,
    refLow: 135,
    refHigh: 175,
    valueRaw: String(value),
    reportId: "r",
    suspect: null,
    unconfirmed: null,
  }) as never;

const trend = {
  canonicalId: "hemoglobin",
  displayName: "hemoglobin",
  unit: "g/l",
  points: [point("2024-01-16", 149), point("2024-05-21", 131, "low"), point("2024-07-09", 166), point("2025-05-19", 181, "high")],
} as unknown as Trend;

const chart = () => renderToStaticMarkup(createElement(TrendChart, { trend }));
const spark = () => renderToStaticMarkup(createElement(Sparkline, { trend }));

describe("TrendChart", () => {
  it("joins the draws with straight segments, never a curve", () => {
    const line = /<path d="(M[^"]+)"/.exec(chart())?.[1] ?? "";
    expect(line).toMatch(/^M[\d.]+,[\d.]+(L[\d.]+,[\d.]+){3}$/);
    expect(line).not.toContain("C");
  });

  it("tints beyond each limit with the status colour and paints nothing under the line", () => {
    const svg = chart();
    expect(svg.match(/fill="var\(--status-critical-soft\)"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(svg).not.toContain("band-neutral");
    expect(svg).not.toContain("linearGradient");
    expect(svg).not.toContain('fill="url(');
  });

  it("tags no value onto the last point", () => {
    // The tag was a rect with the number inside; the only rect left is the
    // clip and the two zones. The latest value is nowhere as text.
    const svg = chart();
    expect(svg).not.toContain(">181");
    expect(svg).not.toContain("181 ↑");
  });
});

describe("Sparkline", () => {
  it("draws by the same rules at thumbnail size", () => {
    const svg = spark();
    const line = /<path d="(M[^"]+)"/.exec(svg)?.[1] ?? "";
    expect(line).toMatch(/^M[\d.]+,[\d.]+(L[\d.]+,[\d.]+){3}$/);
    expect(svg).toContain('fill="var(--status-critical-soft)"');
    expect(svg).not.toContain("band-neutral");
    expect(svg).not.toContain("linearGradient");
  });
});
