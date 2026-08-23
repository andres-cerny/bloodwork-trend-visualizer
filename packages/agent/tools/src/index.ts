/**
 * The lab toolset the clinical agent may call.
 *
 * Every tool here is an adapter over @bw/lab-core, never new logic. That is the
 * rule worth guarding: the moment a tool computes something itself, there are
 * two implementations of a clinical rule and the deterministic one stops being
 * the only one. If a tool needs a number that lab-core does not expose, the fix
 * is in lab-core.
 *
 * Every tool reads through PatientDataSource and none may ask which
 * implementation it holds — that is what lets the session source become a
 * doctor's database without a tool changing.
 */
import {
  buildDerived,
  numericPoints,
  parseChartSpec,
  patientOverview,
  summarizeChanges,
  validateChartSpec,
  type Trend,
} from "@bw/lab-core";
import type { PatientDataSource } from "@bw/datasource";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}

export interface ToolResult {
  ok: boolean;
  /** Shown to the reader as "what the agent just did". */
  summary: string;
  /** Given back to the model. */
  content: unknown;
  /** Set only by propose_chart, and only after the server resolved it. */
  chart?: { spec: unknown; series: unknown };
}

export const TOOLS: ToolDef[] = [
  {
    name: "list_analytes",
    description:
      "Vypíše, které parametry má pacient naměřené, s jednotkou. Použij jako první, " +
      "než se doptáš na konkrétní parametr.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "get_trend",
    description: "Vrátí naměřené hodnoty jednoho parametru v čase, včetně referenčních mezí a stavu.",
    input_schema: {
      type: "object",
      properties: { canonicalId: { type: "string", description: "Identifikátor z list_analytes." } },
      required: ["canonicalId"],
      additionalProperties: false,
    },
  },
  {
    name: "summarize_changes",
    description: "Popíše, co se u pacienta změnilo napříč odběry. Bez argumentů.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "propose_chart",
    description:
      "Navrhne graf pro jeden nebo více parametrů. Graf pouze pojmenuj — data doplní " +
      "server z ověřených hodnot.",
    input_schema: {
      type: "object",
      properties: {
        parameters: { type: "array", items: { type: "string" }, description: "Identifikátory nebo přesné názvy parametrů." },
        from: { type: ["string", "null"], description: "ISO YYYY-MM-DD, včetně." },
        to: { type: ["string", "null"] },
        type: { type: "string", enum: ["line", "bar"] },
      },
      required: ["parameters"],
      additionalProperties: false,
    },
  },
  {
    name: "computed_values",
    description:
      "Vrátí odvozené hodnoty (např. non-HDL), pokud je lze spočítat. Když je spočítat nelze, " +
      "vrátí důvod — ten pak uveď místo odhadu.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

/** Every trend the source has, as the map lab-core's functions expect. */
async function allTrends(source: PatientDataSource): Promise<Map<string, Trend>> {
  const trends = new Map<string, Trend>();
  for (const a of await source.listAnalytes()) {
    const t = await source.getTrend(a.canonicalId);
    if (t) trends.set(a.canonicalId, t);
  }
  return trends;
}

const trendSummary = (t: Trend) => {
  const pts = numericPoints(t);
  return {
    canonicalId: t.canonicalId,
    displayName: t.displayName,
    unit: t.unit,
    points: pts.map((p) => ({ date: p.date, value: p.value, flag: p.flag, refLow: p.refLow, refHigh: p.refHigh })),
  };
};

/**
 * Run one tool.
 *
 * Errors are returned, not thrown: a tool that fails should let the model say
 * so and carry on, not abort the turn. The one thing it must never do is return
 * an empty result that reads like an answer — see DatabaseSource, which throws
 * rather than reporting a patient with no analytes.
 */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  source: PatientDataSource,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "list_analytes": {
        const list = await source.listAnalytes();
        return { ok: true, summary: `vypsal ${list.length} parametrů`, content: list };
      }
      case "get_trend": {
        const id = String(input.canonicalId ?? "");
        const t = await source.getTrend(id);
        if (!t) return { ok: false, summary: `parametr ${id} nenalezen`, content: { error: "not_found", canonicalId: id } };
        return { ok: true, summary: `načetl vývoj ${t.displayName}`, content: trendSummary(t) };
      }
      case "summarize_changes": {
        const reports = await source.reports();
        const trends = await allTrends(source);
        return {
          ok: true,
          summary: `porovnal ${reports.length} odběrů`,
          content: {
            overview: patientOverview(reports, trends),
            changes: summarizeChanges(trends),
          },
        };
      }
      case "propose_chart": {
        // parseChartSpec is the only door: it reads four fields and drops
        // everything else the model volunteered, including anything that looks
        // like a value. validateChartSpec then resolves it against real trends,
        // and refusing is a first-class outcome — an empty chart reads as a
        // finding, which is worse than saying no.
        const spec = parseChartSpec(input);
        if (!spec) return { ok: false, summary: "neplatný návrh grafu", content: { error: "invalid_spec" } };
        const trends = await allTrends(source);
        const resolved = validateChartSpec(spec, trends);
        if (!resolved.ok) {
          return { ok: false, summary: "graf nelze sestavit", content: { error: "refused", reason: resolved.reason } };
        }
        const drawn = resolved.charts.flatMap((c) => c.series.map((t) => t.displayName));
        return {
          ok: true,
          summary: `navrhl graf: ${drawn.join(", ")}`,
          content: { accepted: drawn, note: resolved.note },
          chart: { spec, series: resolved.charts },
        };
      }
      case "computed_values": {
        // buildDerived leaves out anything it cannot compute honestly rather
        // than approximating it, so an empty result is an answer.
        const derived = buildDerived(await allTrends(source));
        return {
          ok: true,
          summary: `spočítal ${derived.size} odvozených hodnot`,
          content: [...derived.values()],
        };
      }
      default:
        return { ok: false, summary: `neznámý nástroj ${name}`, content: { error: "unknown_tool", name } };
    }
  } catch (e) {
    return { ok: false, summary: "nástroj selhal", content: { error: String(e) } };
  }
}
