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
import type { DocumentStore, PatientDataSource, PatientLookup } from "@bw/datasource";

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
  /**
   * Set only by find_patient, and only on a unique match. The ref comes from
   * the directory lookup, never from model text — the loop turns it into a
   * `patient` event and the client pins it.
   */
  patient?: { ref: string; fullName: string; birthDate: string };
}

/**
 * What a tool may reach on this request. `source` is null until a patient is
 * pinned — the lab tools answer "no patient selected" through the model rather
 * than erroring the turn, because telling the model to go find one first is
 * the recovery. `directory` exists only for profiles that resolve identity.
 */
export interface ToolContext {
  source: PatientDataSource | null;
  directory?: PatientLookup;
  documents?: DocumentStore;
  /**
   * Register one piece of evidence and get its citation number. The server
   * owns the registry and the numbering; a tool only says what it read. The
   * numbers a tool embeds in its content are the ones the model may write as
   * [n] — a number with no registered source is the model inventing one, and
   * the client renders exactly what was registered, so the invention shows.
   */
  cite?: (s: SourceInfo) => number;
  /**
   * Supplied by the server. find_patient calls it on a unique match so the
   * rest of THIS turn is already scoped — "dej mi souhrn X" is one turn, not
   * a resolution turn and then a question turn. The ref it passes is one the
   * directory returned; there is still no path from model text to a source.
   */
  bind?: (ref: string) => void;
}

/** One citable piece of evidence, as the client will render it. */
export type SourceInfo =
  | {
      kind: "lab";
      /** "Ferritin 22 µg/l" — what the row says, for the panel label. */
      label: string;
      date: string;
      lab: string;
      reportId: string;
      page: number;
      imageUrl: string | null;
      /** Pixel box of the row on the page image, for the crop. */
      bbox: [number, number, number, number] | null;
      /** The page image's pixel size — the crop math needs the denominator. */
      pageW: number | null;
      pageH: number | null;
    }
  | {
      kind: "document";
      label: string;
      date: string;
      documentId: string;
      title: string;
      excerpt: string;
      imageUrl: string | null;
    };

export const TOOLS: ToolDef[] = [
  {
    name: "find_patient",
    description:
      "Vyhledá pacienta v kartotéce ordinace podle jména (bez ohledu na diakritiku a pořadí slov). " +
      "Použij vždy, když se otázka týká pacienta a žádný není vybraný. Při více shodách se čtenáře " +
      "zeptej, kterého myslí — uveď roky narození — a zavolej znovu s birthYear. Nikdy pacienta " +
      "nevybírej sám.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Jméno nebo jeho část, jak ho lékař napsal." },
        birthYear: { type: ["number", "null"], description: "Rok narození pro rozlišení jmenovců." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "cohort_query",
    description:
      "Najde napříč kartotékou pacienty, u kterých se jeden parametr vyvíjí daným směrem nebo je " +
      "mimo rozmezí. Vrací jen jména a poslední hodnoty — detail pacienta vyžaduje jeho otevření. " +
      "canonicalId je identifikátor parametru (např. 'ferritin', 'hemoglobin').",
    input_schema: {
      type: "object",
      properties: {
        canonicalId: { type: "string", description: "Parametr, o který jde." },
        direction: { type: "string", enum: ["rising", "falling", "stable", "any"] },
        flag: { type: "string", enum: ["high", "low", "any"] },
      },
      required: ["canonicalId"],
      additionalProperties: false,
    },
  },
  {
    name: "search_documents",
    description:
      "Prohledá dokumentaci vybraného pacienta (zprávy, nálezy, záznamy z rehabilitace) a vrátí " +
      "úryvky s místem nálezu. Hledej krátkým heslem (např. 'VO2max', 'koleno', 'MR'). " +
      "Cituj jen to, co úryvek skutečně říká.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Hledané heslo nebo sousloví." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_document",
    description:
      "Vrátí celý text jednoho dokumentu podle id ze search_documents nebo ze seznamu dokumentů. " +
      "Bez argumentu id vypíše seznam dokumentů pacienta s daty a názvy.",
    input_schema: {
      type: "object",
      properties: { id: { type: ["string", "null"], description: "Id dokumentu; vynech pro seznam." } },
      required: [],
      additionalProperties: false,
    },
  },
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
const NO_PATIENT: ToolResult = {
  ok: false,
  summary: "žádný pacient není vybrán",
  content: {
    error: "no_patient_selected",
    hint: "Nejprve vyhledej pacienta nástrojem find_patient a nech čtenáře potvrdit, o koho jde.",
  },
};

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    if (name === "find_patient") {
      if (!ctx.directory) {
        return { ok: false, summary: "kartotéka není připojena", content: { error: "no_directory" } };
      }
      const query = String(input.query ?? "");
      const year = typeof input.birthYear === "number" ? input.birthYear : null;
      const all = await ctx.directory.findPatients(query);
      const hits = year ? all.filter((p) => p.birthDate.startsWith(String(year))) : all;
      const shown = hits.map((p) => ({ ref: p.id, fullName: p.fullName, birthDate: p.birthDate }));
      if (shown.length === 1) {
        ctx.bind?.(shown[0].ref);
        return {
          ok: true,
          summary: `nalezen pacient ${shown[0].fullName} (${shown[0].birthDate.slice(0, 4)})`,
          content: { matches: shown },
          patient: shown[0],
        };
      }
      return {
        ok: shown.length > 0,
        summary: shown.length === 0 ? "nikdo takový v kartotéce není" : `nalezeno ${shown.length} pacientů — zeptej se, kterého myslí`,
        content: { matches: shown },
      };
    }

    if (name === "cohort_query") {
      if (!ctx.directory) {
        return { ok: false, summary: "kartotéka není připojena", content: { error: "no_directory" } };
      }
      const dirIn = String(input.direction ?? "any");
      const flagIn = String(input.flag ?? "any");
      const direction = (["rising", "falling", "stable", "any"].includes(dirIn) ? dirIn : "any") as
        "rising" | "falling" | "stable" | "any";
      const flag = (["high", "low", "any"].includes(flagIn) ? flagIn : "any") as "high" | "low" | "any";
      // Refs and last values only — a cohort answer names WHO, never opens
      // anyone. The rows come from the seed-time summary table; this is a
      // filter over what lab-core computed, not an analyst.
      const rows = await ctx.directory.cohort(String(input.canonicalId ?? ""), direction, flag);
      return {
        ok: true,
        summary: rows.length === 0 ? "nikdo neodpovídá" : `nalezeno ${rows.length} pacientů`,
        content: {
          patients: rows.map((r) => ({
            fullName: r.fullName,
            birthYear: r.birthDate.slice(0, 4),
            parameter: r.displayName,
            lastValue: r.lastValue,
            unit: r.unit,
            lastDate: r.lastDate,
            flag: r.lastFlag,
            direction: r.direction,
          })),
        },
      };
    }

    if (name === "search_documents" || name === "get_document") {
      const docs = ctx.documents;
      // Two different absences, two different answers. No documents STORE
      // means this mode has no documentation at all — telling the model "no
      // patient selected" when one is bound sends it hunting for a patient
      // it already has, in circles, until the round budget dies. Seen live.
      if (!docs) {
        return ctx.source
          ? {
              ok: false,
              summary: "dokumentace není v tomto režimu dostupná",
              content: { error: "no_documents", hint: "Pokračuj s laboratorními nástroji; dokumentaci nezmiňuj jako prohledanou." },
            }
          : NO_PATIENT;
      }
      if (name === "search_documents") {
        const hits = await docs.searchDocuments(String(input.query ?? ""));
        const cited = await Promise.all(
          hits.map(async (h) => {
            if (!ctx.cite) return h;
            const full = await docs.getDocument(h.id);
            const src = ctx.cite({
              kind: "document",
              label: h.title,
              date: h.docDate,
              documentId: h.id,
              title: h.title,
              excerpt: h.excerpt,
              imageUrl: full?.pages[0]?.imageUrl ?? null,
            });
            return { ...h, src };
          }),
        );
        return {
          ok: true,
          summary: hits.length === 0 ? "v dokumentaci nic nenalezeno" : `nalezeno v ${hits.length} dokumentech`,
          content: { matches: cited },
        };
      }
      const id = input.id == null ? null : String(input.id);
      if (!id) {
        const list = await docs.listDocuments();
        return {
          ok: true,
          summary: `vypsal ${list.length} dokumentů`,
          content: { documents: list },
        };
      }
      const doc = await docs.getDocument(id);
      if (!doc) return { ok: false, summary: `dokument ${id} nenalezen`, content: { error: "not_found", id } };
      const src = ctx.cite?.({
        kind: "document",
        label: doc.title,
        date: doc.docDate,
        documentId: doc.id,
        title: doc.title,
        excerpt: doc.bodyText.slice(0, 240),
        imageUrl: doc.pages[0]?.imageUrl ?? null,
      });
      return {
        ok: true,
        summary: `otevřel ${doc.title} (${doc.docDate})`,
        content: { id: doc.id, title: doc.title, docDate: doc.docDate, kind: doc.kind, text: doc.bodyText, pages: doc.pages, ...(src ? { src } : {}) },
      };
    }

    const source = ctx.source;
    if (!source) return NO_PATIENT;

    switch (name) {
      case "list_analytes": {
        const list = await source.listAnalytes();
        return { ok: true, summary: `vypsal ${list.length} parametrů`, content: list };
      }
      case "get_trend": {
        const id = String(input.canonicalId ?? "");
        const t = await source.getTrend(id);
        if (!t) return { ok: false, summary: `parametr ${id} nenalezen`, content: { error: "not_found", canonicalId: id } };
        const base = trendSummary(t);
        if (!ctx.cite) return { ok: true, summary: `načetl vývoj ${t.displayName}`, content: base };
        // Each numeric point is one row on one printed report. The citation
        // is that row: found by (analyte, date) in the lossless payloads, so
        // the crop the reader opens is the same pixels the value came from.
        const reports = await source.reports();
        const points = base.points.map((pt) => {
          const rep = reports.find((r) => r.reportDate === pt.date);
          const m = rep?.measurements.find((mm) => mm.canonicalId === id);
          if (!rep || !m) return pt;
          const page = rep.pages?.[(m.sourcePage ?? 1) - 1];
          const src = ctx.cite!({
            kind: "lab",
            label: `${t.displayName} ${m.valueRaw} ${m.unit ?? ""}`.trim(),
            date: pt.date ?? "",
            lab: rep.labName ?? "",
            reportId: rep.id,
            page: m.sourcePage ?? 1,
            imageUrl: page?.imageUrl ?? null,
            bbox: (m.bbox as [number, number, number, number] | null) ?? null,
            pageW: page?.imageWidth ?? null,
            pageH: page?.imageHeight ?? null,
          });
          return { ...pt, src };
        });
        return { ok: true, summary: `načetl vývoj ${t.displayName}`, content: { ...base, points } };
      }
      case "summarize_changes": {
        const reports = await source.reports();
        const trends = await allTrends(source);
        // One source per draw: the printed report the numbers came from. The
        // summary speaks about draws, so the citation grain is the draw.
        const cited = ctx.cite
          ? reports.map((r) => ({
              date: r.reportDate,
              lab: r.labName,
              src: ctx.cite!({
                kind: "lab",
                label: `Odběr ${r.reportDate ?? ""}`.trim(),
                date: r.reportDate ?? "",
                lab: r.labName ?? "",
                reportId: r.id,
                page: 1,
                imageUrl: r.pages?.[0]?.imageUrl ?? null,
                bbox: null,
                pageW: r.pages?.[0]?.imageWidth ?? null,
                pageH: r.pages?.[0]?.imageHeight ?? null,
              }),
            }))
          : undefined;
        return {
          ok: true,
          summary: `porovnal ${reports.length} odběrů`,
          content: {
            overview: patientOverview(reports, trends),
            changes: summarizeChanges(trends),
            ...(cited ? { reports: cited } : {}),
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
