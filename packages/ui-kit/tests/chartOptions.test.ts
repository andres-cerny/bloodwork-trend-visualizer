/**
 * The two chart opt-ins, and the promise their defaults make.
 *
 * `Chart` is shared by both apps. The chat app needs a reference band that can
 * be checked against „v pásmu normy" — limits inside the view, drawn as
 * furniture — and the bloodwork app needs the opposite, a domain scaled to the
 * data so a fall inside a wide band is still a fall. So the behaviour is a
 * prop; this pins that turning the props on changes the drawing and leaving
 * them off does not.
 *
 * The check is on the rendered SVG rather than on a helper, because the
 * regression this guards against — a "small tidy" that makes the new domain
 * unconditional — would leave every helper's signature intact.
 *
 * The trend below is a fully typed `Trend`, not a cast. An earlier draft of
 * this file built it with `as never` and left `suspect` off every point;
 * `numericPoints` drops points whose `suspect` is not exactly `null`, so every
 * assertion ran against „Žádné číselné hodnoty k zobrazení." and the file
 * failed three ways at once. A real type is what makes the fixture answerable
 * by the compiler instead of by the test run.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Trend, TrendPoint } from "@bw/lab-core";
import Chart, { type ChartOptions } from "../src/Chart";

/** Four hemoglobin draws, all comfortably inside a 135–175 band. */
const trend: Trend = {
  canonicalId: "hemoglobin",
  displayName: "Hemoglobin",
  unit: "g/l",
  points: (
    [
      ["2024-01-16", 149],
      ["2024-05-21", 151],
      ["2024-07-09", 166],
      ["2025-05-19", 150],
    ] as [string, number][]
  ).map(
    ([date, value], i): TrendPoint => ({
      date,
      value,
      valueRaw: String(value),
      unit: "g/l",
      reportId: `r${i}`,
      refLow: 135,
      refHigh: 175,
      flag: "normal",
      suspect: null,
      unconfirmed: null,
    }),
  ),
};

const draw = (props: ChartOptions = {}) =>
  renderToStaticMarkup(createElement(Chart, { trend, ...props }));

describe("Chart options", () => {
  it("scales to the data and tints the band in the series colour by default", () => {
    const svg = draw();
    expect(svg).toContain('fill="var(--band)"');
    expect(svg).not.toContain("var(--band-neutral)");
    // A domain scaled to 149–166 does not reach either limit, so neither
    // dashed limit line is drawn. That is the old rendering, and callers that
    // never passed a prop must keep getting it.
    expect(svg).not.toContain("horní mez");
    expect(svg).not.toContain("dolní mez");
  });

  it("holds both reference limits, with air around them, when asked", () => {
    const svg = draw({ refInDomain: true });
    // Both limits now fall inside the view, so both are drawn and labelled —
    // which is the whole point: „v pásmu normy" becomes a distance a reader
    // can measure rather than a colour they have to trust.
    expect(svg).toContain("horní mez");
    expect(svg).toContain("dolní mez");
    // Labelled with their values, so the band's edges are named and not just
    // implied by where a tint stops.
    expect(svg).toMatch(/horní mez\s*175/);
    expect(svg).toMatch(/dolní mez\s*135/);
  });

  it("draws the band as a surface when asked", () => {
    expect(draw({ bandTone: "neutral" })).toContain('fill="var(--band-neutral)"');
  });

  it("leaves the band in the series colour unless the tone is asked for", () => {
    expect(draw({ refInDomain: true })).toContain('fill="var(--band)"');
  });
});
