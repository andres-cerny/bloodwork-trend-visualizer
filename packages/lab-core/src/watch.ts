/**
 * What to look at first: the parameters outside their range at the most
 * recent draw, each with the three facts that say how much it matters as a
 * measurement — how far past the limit, how many draws in a row, and which
 * way the whole series has been going.
 *
 * Facts, not meaning. This module says "44 % nad horní mezí, 3 odběry po
 * sobě, nárůst od 6/2022"; it never says what an ALT above range is a sign
 * of. Same constraints as summary.ts and patientSummary.ts: deterministic,
 * verbless, the parameter name only ever in the nominative — see the header
 * of patientSummary.ts for why.
 *
 * Read through `numericPoints` / `seriesShape`, so a reading the app has
 * withheld can never head this list; the card that renders it names the
 * withheld set separately (patientOverview.withheldNow).
 */
import { count, czDate, czMonthYear, prettyUnit } from "./czech";
import type { Flag } from "./models";
import { czNum } from "./summary";
import { numericPoints, seriesShape, type SeriesShape, type Trend, type TrendPoint } from "./trends";

export interface WatchItem {
  canonicalId: string;
  displayName: string;
  unit: string;
  /** The reading at the latest draw. */
  point: TrendPoint;
  flag: Flag;
  /**
   * How far outside, as a fraction of the limit it crossed: 0.44 for 1,12
   * against an upper limit of 0,78. Null when that limit is missing or zero.
   */
  beyond: number | null;
  /** Consecutive draws outside the range, ending with this one. */
  outStreak: number;
  shape: SeriesShape | null;
  /** The facts, as short Czech phrases in the order they matter. */
  facts: string[];
}

const isOut = (f: Flag) => f === "high" || f === "low";

/** Fraction past the crossed limit — the number a reader can compare across parameters. */
export function beyondLimit(p: TrendPoint): number | null {
  if (p.value === null) return null;
  if (p.flag === "high" && p.refHigh) return (p.value - p.refHigh) / Math.abs(p.refHigh);
  if (p.flag === "low" && p.refLow) return (p.refLow - p.value) / Math.abs(p.refLow);
  return null;
}

function factsFor(p: TrendPoint, unit: string, beyond: number | null, streak: number, shape: SeriesShape | null): string[] {
  const facts: string[] = [];
  const limit = p.flag === "high" ? p.refHigh : p.refLow;
  const side = p.flag === "high" ? "nad horní mezí" : "pod dolní mezí";
  if (beyond !== null && limit !== null) {
    // Whole percent, like every other magnitude in the app; a fraction of a
    // percent would claim a precision two measurements do not carry.
    const pct = Math.round(beyond * 100);
    facts.push(pct >= 1 ? `${pct} % ${side} ${czNum(limit)}${unit ? ` ${unit}` : ""}` : `těsně ${side} ${czNum(limit)}`);
  } else {
    facts.push(p.flag === "high" ? "nad rozmezím" : "pod rozmezím");
  }
  if (streak >= 2) facts.push(`${count(streak, "odběr", "odběry", "odběrů")} po sobě mimo rozmezí`);
  else if (shape && shape.count >= 2) facts.push("nově mimo rozmezí");
  // The whole-series move, only when it is a real span and a real move — a
  // noun ("nárůst"), so the parameter name governs nothing.
  if (shape && shape.spanDays > 0 && shape.direction !== "flat") {
    const word = shape.direction === "rising" ? "nárůst" : "pokles";
    const rel =
      shape.relChange !== null && Math.round(Math.abs(shape.relChange) * 100) > 0
        ? ` o ${Math.round(Math.abs(shape.relChange) * 100)} %`
        : "";
    facts.push(`${word}${rel} od ${czMonthYear(shape.first.date)} (${czNum(shape.first.value)} → ${czNum(shape.last.value)})`);
  }
  return facts;
}

/**
 * The out-of-range parameters at the latest draw across all trends, furthest
 * past its limit first.
 *
 * "Latest draw" is one date for the whole set: a parameter last measured two
 * years ago is not out of range *now*, whatever it was then — the same rule
 * patientOverview applies, for the same reason.
 */
export function watchList(trends: Map<string, Trend>): WatchItem[] {
  let lastDraw: string | null = null;
  for (const t of trends.values()) for (const p of t.points) if (!lastDraw || p.date > lastDraw) lastDraw = p.date;
  if (!lastDraw) return [];

  const out: WatchItem[] = [];
  for (const t of trends.values()) {
    const pts = numericPoints(t);
    const last = pts[pts.length - 1];
    if (!last || last.date !== lastDraw || !isOut(last.flag)) continue;
    let streak = 0;
    for (let i = pts.length - 1; i >= 0 && isOut(pts[i].flag); i--) streak++;
    const shape = seriesShape(t);
    const beyond = beyondLimit(last);
    const unit = prettyUnit(t.unit);
    out.push({
      canonicalId: t.canonicalId,
      displayName: t.displayName,
      unit,
      point: last,
      flag: last.flag,
      beyond,
      outStreak: streak,
      shape,
      facts: factsFor(last, unit, beyond, streak, shape),
    });
  }
  return out.sort(
    (a, b) => (b.beyond ?? -1) - (a.beyond ?? -1) || b.outStreak - a.outStreak || a.displayName.localeCompare(b.displayName, "cs"),
  );
}

/** "k odběru 15. 8. 2025" — the date the list is true of. */
export function watchDate(trends: Map<string, Trend>): string | null {
  let lastDraw: string | null = null;
  for (const t of trends.values()) for (const p of t.points) if (!lastDraw || p.date > lastDraw) lastDraw = p.date;
  return lastDraw ? czDate(lastDraw) : null;
}
