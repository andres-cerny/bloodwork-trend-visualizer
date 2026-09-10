/**
 * One parameterised extraction call.
 *
 * A deliberate near-copy of `extractPageText` in worker/claude.ts, with every
 * knob the sweep varies pulled out into an `Arm`. The system prompt and tool
 * schema are *imported* from the Worker rather than restated, so an arm that
 * wins here is describable as a diff against what is deployed — the moment
 * this file restates the Czech prompt, the two can drift and the benchmark
 * silently stops measuring the demo.
 *
 * **Reproducibility caveat.** `SYSTEM_EXTRACT_TEXT` is imported from the Worker
 * rather than restated, which is what keeps this benchmark measuring the demo.
 * Since arm A3 shipped, that prompt *contains* the row_index rule — so the
 * "snippet" arm here no longer reproduces the pre-change A0 baseline, because
 * it now also carries an instruction about a field its schema does not have.
 * To re-measure the original baseline, take the prompt from git history before
 * the A5 adoption commit rather than trusting a fresh "snippet" run.
 *
 * `maxRetries: 0` is not an oversight. The Worker retries 429/5xx with
 * exponential backoff; a retried call would be recorded here as several
 * seconds of model latency, which is precisely the number we are trying to
 * measure. Failures are recorded as failures and re-run separately.
 */
import Anthropic from "@anthropic-ai/sdk";

import { SYSTEM_EXTRACT_TEXT, TOOL, type PageExtraction, type Usage } from "@bw/extraction";
import { columnMapRequest, rebuild, type ColumnMap } from "./columnmap";
import { MODEL_PRICING } from "@bw/agent-core";
import { type TextRow } from "@bw/lab-core";

/** Extends the Worker's table; Haiku is only ever a benchmark arm today. */
export const PRICING: Record<string, [number, number]> = {
  ...MODEL_PRICING,
  "claude-haiku-4-5": [1.0, 5.0],
  // Paid tier, USD per 1M tokens. Becomes [1.50, 7.50] on 2027-01-01 —
  // docs/plans/lab-adaptability.md "Risks". Re-run C5's table then.
  "gemini-3.8-flash": [0.75, 3.75],
  // NOTE: `mistral-ocr-4-1` is deliberately absent. It is billed PER PAGE
  // ($0.004), not per token, so `priceUsd` must never be called for it —
  // mistral.ts computes its own cost from `usage_info.pages_processed`. A
  // token pair added here would silently make it look token-priced.
};

export function priceUsd(model: string, u: Usage): number {
  const [inP, outP] = PRICING[model] ?? [3.0, 15.0];
  return (
    (u.inputTokens / 1e6) * inP +
    (u.cacheWriteTokens / 1e6) * inP * 1.25 +
    (u.cacheReadTokens / 1e6) * inP * 0.1 +
    (u.outputTokens / 1e6) * outP
  );
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingMode = "default" | "adaptive" | "disabled";

/** How the model is asked to point back at the printed row. */
export type Anchor =
  /** Deployed: echo the whole printed row back. Costs output tokens per row. */
  | "snippet"
  /** Return the 0-based index of the row it came from. One integer. */
  | "index"
  /** Nothing — the verify tab falls back to the analyte name. */
  | "none";

export interface Reader {
  model: string;
  effort?: Effort;
  thinking?: ThinkingMode;
  /**
   * Which API answers. Absent means Anthropic, so every existing arm is
   * untouched. `mistral` is not an LLM call at all — it is the OCR layout
   * parser, priced per page rather than per token (mistral.ts).
   */
  provider?: "anthropic" | "google" | "mistral";
  /** Gemini only: how many tokens the image is worth to the model (gemini.ts). */
  mediaResolution?: "high" | "ultra_high";
}

export interface Arm {
  id: string;
  /** One line, shown in the notebook legend. */
  label: string;
  /** What this arm is testing — why it is worth an API call. */
  why: string;
  readers: Reader[];
  anchor: Anchor;
  /**
   * What shape the model returns. "rows" is the deployed contract — one object
   * per measurement. "columnMap" returns integers only and the client rebuilds
   * the measurements out of its own `rows` array (see columnmap.ts).
   */
  mode?: "rows" | "columnMap";
  /** Run every reader on every page, or only escalate when the first flags. */
  escalation: "always" | "onFlag";
  /** Set once an arm has been superseded, so the notebook can grey it out. */
  supersededBy?: string;
}

/* -------------------------------------------------- the provider's own answer */

/**
 * A single field of a `RawAnswer` is truncated at this many characters.
 *
 * Generous on purpose: a dense A4 lab page comes back as a few kilobytes of
 * markdown, so this is roughly an order of magnitude of headroom and in
 * practice never fires. It exists so that one pathological page — a scan that
 * OCRs into a wall of repeated glyphs — cannot put megabytes into
 * `results/adapt/<arm>/<slug>.json` and make the directory unusable.
 */
export const RAW_FIELD_MAX = 100_000;

/**
 * Truncate one field and **say so in the file**: the marker is left inside the
 * value, where anyone reading the JSON will see it, and the field's name is
 * also listed in `RawAnswer.truncated` so a program can check without parsing
 * prose. A silent truncation would make a stored answer look complete.
 */
export function truncateRawField(s: string, name: string, truncated: string[]): string {
  if (s.length <= RAW_FIELD_MAX) return s;
  truncated.push(name);
  return s.slice(0, RAW_FIELD_MAX) + `\n…[truncated at ${RAW_FIELD_MAX} characters by RAW_FIELD_MAX]`;
}

/**
 * What the provider actually said, beside what we made of it.
 *
 * `extraction` is our *mapping* of the answer. For an LLM arm those are nearly
 * the same thing — the model returned our tool schema — but for the OCR arm
 * the mapping is the whole accuracy of the arm (mistral.ts, "Mapping OCR
 * output onto RawMeasurement"), and storing only the mapped rows means a
 * mapping bug found later can only be re-judged through whatever those rows
 * happened to carry. That is a real limit and it cost us: re-mapping from
 * `source_snippet` alone can move a row from wrong to right but never from
 * absent to present, and one page whose table was dropped entirely could not
 * be judged at all.
 *
 * So the provider's own answer is stored next to ours. It is set **only** where
 * there is a real one to store — Mistral OCR's page: its markdown, the tables
 * it isolated, and the per-block confidences the derived `confidence` field
 * rests on. For Anthropic and Gemini it is left `undefined` rather than filled
 * with a re-serialisation of the tool input we already have; inventing a `raw`
 * that is just `extraction` again would make the field a lie about what is
 * recoverable.
 */
export interface RawAnswer {
  /** Which API said it — the answer's shape is only meaningful per provider. */
  provider: "mistral";
  /** The page as the provider rendered it, tables replaced by placeholders. */
  markdown?: string;
  /** Each table the provider isolated, in its own markup, with its id. */
  tables?: Array<{ id: string; content: string }>;
  /** Per-block average content confidence, keyed to the table a block points at. */
  blocks?: Array<{ tableId: string; confidence: number | null }>;
  /** The page-level average, the fallback when a table has no block of its own. */
  pageConfidence?: number | null;
  /** Names of the fields cut by `RAW_FIELD_MAX`. Absent when nothing was cut. */
  truncated?: string[];
}

export interface CallResult {
  ok: boolean;
  model: string;
  /** Wall-clock of the API round-trip alone. */
  ms: number;
  usage: Usage;
  costUsd: number;
  /** Did the response actually contain a thinking block? Settles A2 by
   *  observation rather than by reading the docs. */
  thought: boolean;
  /** Gemini only: prompt tokens the image cost — the plan's open item on $/page. */
  imageTokens?: number;
  extraction: PageExtraction | null;
  /**
   * The provider's own answer, where there is one worth storing. See
   * `RawAnswer` — deliberately unset for the arms that have nothing to add.
   */
  raw?: RawAnswer;
  error: string | null;
}

/* ------------------------------------------------------------------ prompt */

/** Deployed format: cells joined by "|", one row per line. */
export function rowsPlain(rows: TextRow[]): string {
  return rows.map((r) => r.cells.join(" | ")).join("\n");
}

/** Indexed format, for the `index` anchor: "12\tcell | cell | cell". */
export function rowsIndexed(rows: TextRow[]): string {
  return rows.map((r, i) => `${i}\t${r.cells.join(" | ")}`).join("\n");
}

const ANCHOR_RULE: Record<Anchor, string> = {
  snippet: "",
  index:
    " Každý řádek vstupu začíná pořadovým číslem a tabulátorem. U každého " +
    "výsledku vrať v poli 'row_index' číslo řádku, ze kterého pochází. " +
    "Samotné číslo neopisuj do žádného jiného pole.",
  none: "",
};

function systemFor(arm: Arm): string {
  return SYSTEM_EXTRACT_TEXT + ANCHOR_RULE[arm.anchor];
}

/**
 * The tool schema with the anchor field swapped.
 *
 * Structurally identical to the Worker's apart from that one property, so a
 * difference in results is attributable to the anchor and not to a reworded
 * description or a reordered `required` list.
 */
function toolFor(arm: Arm): Anthropic.Tool {
  const base = JSON.parse(JSON.stringify(TOOL)) as any;
  const item = base.input_schema.properties.measurements.items;

  delete item.properties.source_snippet;
  item.required = item.required.filter((k: string) => k !== "source_snippet");

  if (arm.anchor === "snippet") {
    item.properties.source_snippet = {
      type: "string",
      description: "Celý řádek tak, jak je vytištěn (pro ověření).",
    };
    item.required.push("source_snippet");
  } else if (arm.anchor === "index") {
    item.properties.row_index = {
      type: "integer",
      description: "Pořadové číslo řádku vstupu, ze kterého tento výsledek pochází.",
    };
    item.required.push("row_index");
  }

  return base as Anthropic.Tool;
}

/* -------------------------------------------------------------------- call */

function client(apiKey: string): Anthropic {
  // See the file header: retries would be recorded as model latency.
  return new Anthropic({ apiKey, maxRetries: 0 });
}

function usageOf(u: Anthropic.Usage | undefined): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

export async function callReader(
  apiKey: string,
  arm: Arm,
  reader: Reader,
  rows: TextRow[],
): Promise<CallResult> {
  if (reader.provider === "google") {
    const { callGemini } = await import("./gemini");
    return callGemini(apiKey, reader, { kind: "text", rows });
  }
  const columnMode = arm.mode === "columnMap";
  // The column map is addressed by row number, so it always needs the indexed
  // rendering regardless of what `anchor` says.
  const rowsText = (columnMode || arm.anchor === "index" ? rowsIndexed(rows) : rowsPlain(rows)).slice(0, 40000);

  const params: Record<string, unknown> = columnMode ? columnMapRequest(rowsText, reader.model) : {
    model: reader.model,
    max_tokens: 8000,
    system: [
      { type: "text", text: systemFor(arm), cache_control: { type: "ephemeral" } },
    ],
    tools: [toolFor(arm)],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [
      { role: "user", content: `Řádky vytištěné na stránce:\n\n${rowsText}` },
    ],
  };
  if (reader.effort) params.output_config = { effort: reader.effort };
  if (reader.thinking === "adaptive") params.thinking = { type: "adaptive" };
  if (reader.thinking === "disabled") params.thinking = { type: "disabled" };

  const t0 = performance.now();
  try {
    const message = await client(apiKey).messages.create(params as any);
    const ms = performance.now() - t0;
    const usage = usageOf(message.usage);
    const block = message.content.find((b) => b.type === "tool_use");
    const input = (block && "input" in block ? (block.input as any) : {}) ?? {};

    return {
      ok: true,
      model: reader.model,
      ms,
      usage,
      costUsd: priceUsd(reader.model, usage),
      thought: message.content.some((b) => b.type === "thinking"),
      extraction: {
        report_date: input.report_date ?? null,
        report_date_raw: input.report_date_raw ?? null,
        lab_name: input.lab_name ?? null,
        patient_name: input.patient_name ?? null,
        patient_id: input.patient_id ?? null,
        measurements: columnMode
          ? (rebuild(input as ColumnMap, rows) as any[])
          : Array.isArray(input.measurements)
            ? input.measurements
            : [],
        usage,
        model: reader.model,
      },
      error: null,
    };
  } catch (e: any) {
    return {
      ok: false,
      model: reader.model,
      ms: performance.now() - t0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0,
      thought: false,
      extraction: null,
      error: `${e?.status ?? ""} ${e?.name ?? "Error"}: ${e?.message ?? String(e)}`.trim(),
    };
  }
}

/** Does this page need a second opinion? Mirrors the Python pipeline's rule. */
export function needsEscalation(x: PageExtraction | null): boolean {
  if (!x) return true;
  return x.measurements.some(
    (m: any) =>
      m.confidence === "low" ||
      m.confidence === "medium" ||
      // A numeric-looking value that will not parse is the other trigger.
      (m.value_raw && !/^[<>]?\s*-?[\d\s.,]+$/.test(String(m.value_raw))),
  );
}

/**
 * Run one page through one arm.
 *
 * Readers run concurrently when the arm always escalates — matching the
 * Worker's `Promise.allSettled` — so the page's latency is the slower reader,
 * not their sum. Under `onFlag` the second reader is a second round-trip, and
 * the recorded latency says so.
 */
export async function runArmOnPage(
  apiKey: string,
  arm: Arm,
  rows: TextRow[],
): Promise<{ calls: CallResult[]; ms: number }> {
  const t0 = performance.now();

  if (arm.escalation === "always" || arm.readers.length === 1) {
    const calls = await Promise.all(arm.readers.map((r) => callReader(apiKey, arm, r, rows)));
    return { calls, ms: performance.now() - t0 };
  }

  const first = await callReader(apiKey, arm, arm.readers[0], rows);
  if (!needsEscalation(first.extraction)) {
    return { calls: [first], ms: performance.now() - t0 };
  }
  const rest = await Promise.all(
    arm.readers.slice(1).map((r) => callReader(apiKey, arm, r, rows)),
  );
  return { calls: [first, ...rest], ms: performance.now() - t0 };
}
