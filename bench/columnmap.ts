/**
 * Arm A9 — return a column map, not the data.
 *
 * Earned from Stage 1b's first numbers. A dense page costs ~4,200 output
 * tokens because the model re-types every cell it was just given: ~117 tokens
 * per printed row. But the rows arrive *already reconstructed* from the PDF's
 * own text coordinates, and within one page they nearly all share a layout.
 * The model's actual job is two small decisions:
 *
 *   1. which cell index holds the name / value / unit / reference range, and
 *   2. which rows are measurements at all.
 *
 * Expressed that way the answer is a handful of integers — an order of
 * magnitude less output, and output is what the latency is made of.
 *
 * The provenance argument gets *stronger*, not weaker. Today the demo checks
 * that a returned value is printed on the page (`isPrintedOnPage`) and flags
 * it when it is not. Here no text is returned at all: every character is read
 * out of the client's own `rows` array by index, so a fabricated value is not
 * merely detectable, it is unrepresentable.
 *
 * The risk this arm is really testing: ragged rows. A row missing its unit
 * shifts every later cell left, so one global column map will misread it.
 * Hence `overrides`, and hence the derived confidence below — a row whose
 * value cell does not look like a number is flagged rather than trusted.
 */
import Anthropic from "@anthropic-ai/sdk";

import { type TextRow } from "@bw/lab-core";
import type { RawMeasurement } from "./score";

export const TOOL_COLUMNS = {
  name: "record_lab_layout",
  description:
    "Zaznamenej rozvržení sloupců na stránce a čísla řádků, které jsou " +
    "naměřenými výsledky. Text nepřepisuj — vracíš pouze čísla.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      report_date: { type: ["string", "null"] },
      report_date_raw: { type: ["string", "null"] },
      lab_name: { type: ["string", "null"] },
      patient_name: { type: ["string", "null"] },
      patient_id: { type: ["string", "null"] },
      name_col: { type: "integer", description: "Index buňky s názvem analytu." },
      value_col: { type: "integer", description: "Index buňky s hodnotou." },
      unit_col: { type: "integer", description: "Index buňky s jednotkou, nebo -1." },
      range_col: { type: "integer", description: "Index buňky s referenčním rozmezím, nebo -1." },
      measurement_rows: {
        type: "array",
        items: { type: "integer" },
        description: "Čísla řádků (podle vstupu), které jsou naměřenými výsledky.",
      },
      overrides: {
        type: "array",
        description:
          "Pouze řádky, jejichž rozvržení se liší od výchozího (např. chybí " +
          "jednotka a buňky jsou posunuté).",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            row: { type: "integer" },
            name_col: { type: "integer" },
            value_col: { type: "integer" },
            unit_col: { type: "integer" },
            range_col: { type: "integer" },
          },
          required: ["row", "name_col", "value_col", "unit_col", "range_col"],
        },
      },
    },
    required: [
      "report_date",
      "report_date_raw",
      "lab_name",
      "patient_name",
      "patient_id",
      "name_col",
      "value_col",
      "unit_col",
      "range_col",
      "measurement_rows",
      "overrides",
    ],
  },
} as const;

export const SYSTEM_COLUMNS =
  "Jsi přesný analytik rozvržení českých laboratorních výsledků. Dostaneš " +
  "řádky vytištěné na stránce, každý začíná svým číslem a tabulátorem, buňky " +
  "jsou oddělené znakem '|'. NIC NEPŘEPISUJ. Tvým úkolem je pouze určit, " +
  "který index buňky nese název analytu, hodnotu, jednotku a referenční " +
  "rozmezí, a vyjmenovat čísla řádků, které jsou naměřenými výsledky. " +
  "Hlavičky, patičky a údaje o pacientovi mezi výsledky nepatří. Pokud " +
  "některý sloupec na stránce chybí, vrať -1. Pokud se konkrétní řádek " +
  "rozvržením liší (např. chybí jednotka a buňky jsou posunuté), uveď ho v " +
  "'overrides'; jinak nech 'overrides' prázdné.";

export interface ColumnMap {
  name_col: number;
  value_col: number;
  unit_col: number;
  range_col: number;
  measurement_rows: number[];
  overrides: Array<{
    row: number;
    name_col: number;
    value_col: number;
    unit_col: number;
    range_col: number;
  }>;
}

const NUMERIC = /^[<>]?\s*-?\d[\d\s.,]*$/;

/**
 * Rebuild measurements from the map, taking every character out of `rows`.
 *
 * Confidence is *derived* rather than self-reported: a row whose value cell
 * does not look like a number, or which is too short for the map it was
 * assigned, is marked low. That is a stricter signal than a model's own
 * estimate of how sure it feels, and it cannot be optimistic.
 */
export function rebuild(map: ColumnMap, rows: TextRow[]): RawMeasurement[] {
  const overrideBy = new Map(map.overrides?.map((o) => [o.row, o]) ?? []);
  const out: RawMeasurement[] = [];

  for (const idx of map.measurement_rows ?? []) {
    const row = rows[idx];
    if (!row) continue; // an index off the end is a miss, not a crash
    const cols = overrideBy.get(idx) ?? map;
    const cell = (i: number) => (i >= 0 && i < row.cells.length ? row.cells[i] : "");

    const value_raw = cell(cols.value_col);
    const name = cell(cols.name_col);
    const shortRow = row.cells.length <= Math.max(cols.value_col, cols.name_col);

    out.push({
      raw_analyte_name: name,
      value_raw,
      unit_raw: cell(cols.unit_col),
      ref_range_raw: cell(cols.range_col),
      source_snippet: row.cells.join(" "),
      row_index: idx,
      confidence: !name || !value_raw || shortRow || !NUMERIC.test(value_raw) ? "low" : "high",
    });
  }
  return out;
}

/** The request body for one column-map call. */
export function columnMapRequest(rowsText: string, model: string): Record<string, unknown> {
  return {
    model,
    max_tokens: 4000,
    system: [{ type: "text", text: SYSTEM_COLUMNS, cache_control: { type: "ephemeral" } }],
    tools: [TOOL_COLUMNS as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: TOOL_COLUMNS.name },
    messages: [{ role: "user", content: `Řádky vytištěné na stránce:\n\n${rowsText}` }],
  };
}
