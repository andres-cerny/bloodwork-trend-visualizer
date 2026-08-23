/**
 * `includeRefRange` is opt-in, and the default is the contract.
 *
 * Chart is shared: the bloodwork trends tab scales the axis to the DATA on
 * purpose — ferritin falling 112 → 88 inside a 30–400 band has to look like a
 * fall, not like a flat line at the bottom of a huge domain. The chat app needs
 * the opposite, because its chart arrives inside a sentence that says „vše v
 * pásmu normy" and the band is the claim.
 *
 * So both behaviours are pinned here. The failure this guards is a one-word
 * one: someone flips the default to true, every bloodwork chart silently
 * flattens, and nothing else in the suite notices.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Chart from "../src/Chart";
import type { Trend } from "@bw/lab-core";

const point = (date: string, value: number) =>
  ({
    date,
    value,
    unit: "g/l",
    flag: "normal",
    refLow: 135,
    refHigh: 175,
    valueRaw: String(value),
    reportId: "r",
    suspect: null,
    unconfirmed: null,
  }) as never;

/** Hemoglobin 149–166 inside a 135–175 range: the chat app's own fixture. */
const trend = {
  canonicalId: "hemoglobin",
  displayName: "hemoglobin",
  unit: "g/l",
  points: [
    point("2024-01-16", 149),
    point("2024-05-21", 151),
    point("2024-07-09", 166),
    point("2024-11-12", 158),
    point("2025-05-19", 150),
  ],
} as unknown as Trend;

const render = (props: { trend: Trend; includeRefRange?: boolean }) =>
  renderToStaticMarkup(createElement(Chart, props));

describe("Chart reference range", () => {
  it("scales to the data by default, and tints the band in the series colour", () => {
    const svg = render({ trend });
    expect(svg).toContain('fill="var(--band)"');
    expect(svg).not.toContain("var(--band-neutral)");
    // Both limits are outside a data-scaled domain, so neither is labelled.
    expect(svg).not.toContain("dolní mez");
    expect(svg).not.toContain("horní mez");
  });

  it("holds both limits inside the plot when a caller opts in", () => {
    const svg = render({ trend, includeRefRange: true });
    expect(svg).toContain("dolní mez");
    expect(svg).toContain("horní mez");
    // Neutral, not a second blue object arguing with the series line.
    expect(svg).toContain('fill="var(--band-neutral)"');
    expect(svg).not.toContain('fill="var(--band)"');
  });
});
