/**
 * Turning "ukaž mi cholesterol a HDL od roku 2023 jako sloupcový graf" into a
 * chart, without letting the model near a number.
 *
 * The guarantee this file exists to hold: **the model emits identifiers, dates
 * and a chart type — never values.** Everything plotted is read from the same
 * trend map the Trendy tab renders from, so a chart in the chat is by
 * construction the same data as the chart in the tab. There is no path by
 * which an invented number reaches the screen, because numbers never travel
 * through the model at all.
 *
 * That is the same move the extraction path already makes: Claude assigns
 * columns rather than recognising characters, because the characters come from
 * the file.
 *
 * `parseChartSpec` therefore reads exactly four fields and ignores everything
 * else the model might have sent. It is deliberately not a general JSON
 * validator — anything it does not name cannot get through.
 *
 * Refusing is a first-class outcome. A parameter nobody measured, a window with
 * no draws in it, a single point: each says so and says what is available
 * instead. An empty chart that silently means "no data" is the one thing worse
 * than a refusal, because it looks like a finding.
 */
import { numericPoints, type Trend } from "./trends";

export type ChartType = "line" | "bar";

export interface ChartSpec {
  /** canonicalIds, or exact display names. Never free text. */
  parameters: string[];
  /** ISO YYYY-MM-DD, inclusive. */
  from: string | null;
  to: string | null;
  type: ChartType;
}

/** One chart to draw: a set of series that share a unit. */
export interface ResolvedChart {
  unit: string;
  type: ChartType;
  series: Trend[];
}

export type ChartResolution =
  | { ok: true; charts: ResolvedChart[]; note: string | null }
  | { ok: false; reason: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read a model's tool call into a spec, or null if it is not one.
 *
 * Values, labels, colours, titles and anything else the model may have
 * volunteered are dropped here rather than downstream: this is the only door,
 * so it is the only place that has to be right.
 */
export function parseChartSpec(input: unknown): ChartSpec | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;

  const params = raw.parameters;
  if (!Array.isArray(params) || params.length === 0) return null;
  const parameters = params.filter((p): p is string => typeof p === "string" && p.trim() !== "");
  if (parameters.length === 0) return null;

  const dateOr = (v: unknown): string | null | undefined => {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || !ISO.test(v)) return undefined; // present but unusable
    return v;
  };
  const from = dateOr(raw.from);
  const to = dateOr(raw.to);
  // A window the model meant but got wrong must not silently become "all
  // time" — that answers a different question from the one asked.
  if (from === undefined || to === undefined) return null;

  const type: ChartType = raw.type === "bar" ? "bar" : "line";

  return { parameters: parameters.map((p) => p.trim()), from, to, type };
}

/** canonicalId, else an exact display-name match. No fuzzy guessing. */
function findTrend(trends: Map<string, Trend>, name: string): Trend | null {
  const direct = trends.get(name);
  if (direct) return direct;
  const lower = name.toLowerCase();
  for (const t of trends.values()) {
    if (t.displayName.toLowerCase() === lower) return t;
  }
  return null;
}

function windowed(t: Trend, from: string | null, to: string | null): Trend {
  if (!from && !to) return t;
  return {
    ...t,
    points: t.points.filter((p) => (!from || p.date >= from) && (!to || p.date <= to)),
  };
}

const list = (xs: string[], max = 8): string =>
  xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} a další`;

/**
 * Resolve a spec against the loaded data, or refuse with a reason in Czech.
 *
 * `trends` must be the same map the Trendy tab reads, derived series included.
 */
export function validateChartSpec(
  spec: ChartSpec,
  trends: Map<string, Trend>,
): ChartResolution {
  const names = [...trends.values()].map((t) => t.displayName).sort();
  if (trends.size === 0) {
    return { ok: false, reason: "Nejsou načtené žádné hodnoty, ze kterých by šel graf sestavit." };
  }

  const found: Trend[] = [];
  const missing: string[] = [];
  for (const p of spec.parameters) {
    const t = findTrend(trends, p);
    if (t) {
      // The same parameter twice is one series, not two overlaid on themselves.
      if (!found.some((f) => f.canonicalId === t.canonicalId)) found.push(t);
    } else missing.push(p);
  }

  if (found.length === 0) {
    return {
      ok: false,
      reason:
        `${missing.length === 1 ? "Parametr" : "Parametry"} ${list(missing)} ` +
        `v načtených reportech nemám. K dispozici je: ${list(names)}.`,
    };
  }

  const dropped: string[] = [];
  const usable: Trend[] = [];
  for (const t of found) {
    const w = windowed(t, spec.from, spec.to);
    // One measurement is not a trend — the same rule the chart itself applies,
    // rather than drawing an axis around a single point.
    if (numericPoints(w).length >= 2) usable.push(w);
    else dropped.push(t.displayName);
  }

  if (usable.length === 0) {
    const span = spec.from || spec.to ? " v tomto období" : "";
    const everything = found
      .map((t) => numericPoints(t))
      .filter((ps) => ps.length > 0)
      .flatMap((ps) => [ps[0].date, ps[ps.length - 1].date])
      .sort();
    const have =
      everything.length >= 2
        ? ` Měření jsou od ${everything[0]} do ${everything[everything.length - 1]}.`
        : "";
    return {
      ok: false,
      reason: `Pro ${list(dropped)}${span} nemám aspoň dvě měření, ze kterých by šel vývoj vykreslit.${have}`,
    };
  }

  // Mixed units cannot share an axis: cholesterol in mmol/l against
  // haemoglobin in g/l on one scale is a picture of nothing. Same unit
  // overlays — which is exactly the lipid panel — and the rest becomes one
  // chart per unit rather than a refusal.
  const byUnit = new Map<string, Trend[]>();
  for (const t of usable) {
    const u = t.unit ?? "";
    byUnit.set(u, [...(byUnit.get(u) ?? []), t]);
  }

  const charts: ResolvedChart[] = [...byUnit.entries()].map(([unit, series]) => ({
    unit,
    type: spec.type,
    series,
  }));

  const notes: string[] = [];
  if (missing.length)
    notes.push(`${list(missing)} v načtených reportech nemám`);
  if (dropped.length)
    notes.push(`${list(dropped)} nemá v tomto období aspoň dvě měření`);
  if (charts.length > 1)
    notes.push("jednotky se liší, takže je každá v samostatném grafu");

  return {
    ok: true,
    charts,
    note: notes.length ? `${notes.join("; ")}.` : null,
  };
}
