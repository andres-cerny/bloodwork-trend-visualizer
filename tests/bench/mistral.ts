/**
 * The third reader: Mistral OCR through the official `@mistralai/mistralai`.
 *
 * Same `CallResult` shape as `callReader` in extract.ts and `callGemini` in
 * gemini.ts, so an arm is declared once and only its `provider` says which API
 * answers. Unlike those two this is **not** an LLM call: there is no system
 * prompt, no tool schema and no Czech to keep in step with the deployed app.
 * Mistral OCR returns a *layout parse* — markdown, tables, block boxes — and
 * everything interesting about this arm lives in the mapping below, which
 * turns that parse into the four fields score.ts already knows how to judge.
 *
 * That also puts this arm in the same risk class as Docling
 * (docs/extraction-speed.md, "A7, Docling — the layout-parser family, properly
 * tested"), which was disqualified for fusing two printed rows into one record
 * with their reference intervals concatenated. `mergedRows()` in score.ts is
 * the named guard for that class and is printed for every arm, not just this
 * one.
 *
 *   MISTRAL_API_KEY, beside ANTHROPIC_API_KEY and GEMINI_API_KEY in the
 *   repo-root `.env` (a symlink; git-ignored). The harness reads process.env
 *   only, so load it into the shell first:
 *
 *     set -a; source .env; set +a
 *     BENCH_MAX_USD=1 BENCH_ARMS=mistral_ocr npm run bench:adapt
 *
 * No network without a key: `callMistral` returns a failed `CallResult` and
 * never constructs a client. `BENCH_DRY_RUN=1` prints the request shape
 * through `describeRequest` and constructs nothing either — that is how this
 * file is tested without spending.
 *
 * ## Pricing — per page, not per token
 *
 * `mistral-ocr-4-1` is billed at **$0.004 per page** ($4 / 1,000 pages;
 * annotated pages are $5 / 1,000 and this arm does not ask for annotations).
 * There is no input/output token bill, so this model is deliberately absent
 * from `PRICING` in extract.ts and `priceUsd()` is never called for it: cost
 * is `usage_info.pages_processed × PAGE_PRICE_USD`, read back from the
 * response rather than assumed. `usage` is reported as four zeros and
 * `imageTokens` is left undefined, so no table can quietly present this arm
 * as though it were token-priced.
 *
 * ## The request
 *
 *   - `tableFormat: "markdown"` — the mapping below parses markdown tables.
 *   - `includeBlocks: true` — paragraph-level boxes, which is how a table gets
 *     a confidence score attached (a block carries `tableId`).
 *   - `confidenceScoresGranularity: "block"` — per-block confidence, the input
 *     to the derived `confidence` field. `"word"` would give per-word scores
 *     and a much larger payload; it buys nothing this scorer reads.
 *   - `includeImageBase64: false` — we never use the cropped images.
 *   - no annotations: `documentAnnotationFormat` would move the model onto the
 *     $5/1,000 tier and would be a *different* arm (an LLM extracting into our
 *     schema), not "Mistral OCR as a direct reader".
 *   - `retryConfig: { strategy: "none" }` — same reason extract.ts gives: a
 *     retried call would be recorded as model latency.
 *
 * The image arm sends one rendered page as an `image_url` data URI. The
 * born-digital arm sends the **original PDF** as a `document_url` data URI
 * with `pages: [n]` (0-based), because Mistral OCR reads a PDF's embedded text
 * where it has one — that, and not a raster of it, is the fair comparison
 * against the deployed text path.
 *
 * ## Mapping OCR output onto RawMeasurement — every assumption, stated
 *
 * A page comes back as `markdown` (with each table replaced by a
 * `[tbl-N.md](tbl-N.md)` placeholder) plus `tables[]`, each a markdown string.
 * Measurements are read from `tables[]` only; free prose is never mined for
 * rows. If `tables[]` is empty the page's own `markdown` is scanned for
 * pipe-delimited blocks, so a response that inlines its tables is not silently
 * read as zero rows.
 *
 *  1. **A markdown table row splits on `|`**, outer pipes dropped, each cell
 *     trimmed. Mistral pads cells (`"|  URE | urea |"`), so trimming is not
 *     optional; interior whitespace is left alone because the decimal comma
 *     and `( 2,5000 - 6,4000 )` spacing must survive verbatim into
 *     `ref_range_raw`.
 *  2. **Separator rows** (`| --- | --- |`) are dropped.
 *  3. **The first row is a header only if it reads as one.** Markdown has no
 *     headerless table, so Mistral promotes the first *data* row into the
 *     header slot when a sheet prints no column titles — observed on
 *     `tight_rows.pdf`, whose header row is `S_Sodík | 141 | mmol/l |
 *     137-145`. Blindly skipping row one would silently delete a measurement.
 *     So: the header interpretation is computed, and accepted only if it
 *     yields **both** a name column and a value column. Otherwise the table is
 *     treated as headerless, every row is data, and the columns are inferred
 *     from the shape of the cells (rule 6).
 *  4. **Header labels → our four fields**, by `COLUMN_RULES` below, matched on
 *     a fold of the label (lowercase, diacritics stripped, non-alphanumerics
 *     removed). Czech and Slovak, first match wins.
 *  5. **A column we do not model is dropped, by name, on purpose.** `Zkr.`
 *     (abbreviation), `Text. výsl.` (textual result), the unlabelled flag cell
 *     that carries `.`/`H`/`L`, `Prim. mat.`/`Materiál`, `Kontrola I.stupně`,
 *     `Uvolnil`, `Přijal`, `Metoda`, `Poznámka`, `Předchozí`, dates. These are
 *     listed *before* the four modelled rules so a loose pattern cannot claim
 *     them — `Text. výsl.` must never be read as `Výsl.`. Any header cell
 *     matching no rule at all is also dropped, and both kinds are reported in
 *     `droppedColumns` so a lab that prints something we should model shows up
 *     as a name rather than as silence. Nothing is squeezed into
 *     `source_snippet` except the whole printed row.
 *  6. **Headerless inference.** Per column, over the data rows: `range` is the
 *     column where most cells are a complete interval; `value` the leftmost
 *     remaining column where most cells are numeric; `unit` a remaining column
 *     that is mostly unit-shaped (contains `/`, or a short non-numeric token
 *     from a lab unit); `name` the leftmost remaining column that is mostly
 *     non-numeric text. "Most" is a simple majority of non-empty cells.
 *  7. **A table with no value column and no name column is not a results
 *     table** and contributes nothing. That is what drops the patient block —
 *     `Jméno: | | Datum a čas odběru: | 21.05.2024 10:08` — which Mistral
 *     returns as a table beside the real one.
 *  8. **A row is kept** when it has a non-empty name that is not itself a
 *     number and a non-empty value. A section heading printed as a lone cell
 *     (`Biochemie`) therefore drops out, and so does a fully empty padding row.
 *  9. **Cells are copied verbatim.** The accreditation star in `* urea`, the
 *     parentheses in `( 2,5000 - 6,4000 )`, `!`/`*` markers, `<`/`>` censors —
 *     all kept as printed. `nameKey`/`valKey` in score.ts do the folding, and
 *     a reader that "tidies" a value is exactly what this benchmark is for.
 * 10. **`confidence` is derived, never self-reported** — the same argument
 *     columnmap.ts makes. OCR has no per-row opinion, so a row is `low` when
 *     its value does not look numeric, or the row is ragged (fewer cells than
 *     the column map needs), or the table block's average content confidence
 *     is below `CONF_LOW`; `medium` below `CONF_HIGH`; `high` otherwise. The
 *     two thresholds are a declared choice, not a measurement: they decide how
 *     often the deployed `needsEscalation()` rule would fire on this arm.
 * 11. **`report_date`, `lab_name`, `patient_name`, `patient_id` are null.**
 *     OCR returns no structured header fields and this arm does not guess at
 *     them from the prose. Only `measurements` is scored, so nothing is lost;
 *     an arm that invented a date would be scored as though it had read one.
 * 12. **`source_snippet` is the whole printed row**, cells rejoined with
 *     `" | "` — the field's own description ("the whole line as printed, for
 *     verification"), and what `isPrintedOnPage` provenance would read.
 */
import { Mistral } from "@mistralai/mistralai";
import type { OCRPageObject, OCRRequest, OCRResponse } from "@mistralai/mistralai/models/components";

import { type Usage } from "@bw/extraction";

import { type CallResult, type Reader } from "./extract";
import { type RawMeasurement } from "./score";

/**
 * The current OCR model. Confirmed against `GET /v1/models` on 2026-09-07:
 * `mistral-ocr-4-1`, aliased by `mistral-ocr-latest` and `mistral-ocr-4`. The
 * dated id is pinned deliberately — `latest` would silently re-point and every
 * number in docs/lab-adaptability.md would stop meaning anything.
 */
export const MISTRAL_OCR_MODEL = "mistral-ocr-4-1";

/** USD per page. Not per token — see the header. */
export const PAGE_PRICE_USD = 0.004;

/** Derived-confidence thresholds on the table block's average content score. */
export const CONF_HIGH = 0.98;
export const CONF_LOW = 0.9;

export type MistralInput =
  /** One rendered page, sent as an `image_url` data URI. */
  | { kind: "image"; base64: string; mediaType: string }
  /** The original PDF, one page selected. `page` is 1-based, as corpora.ts counts. */
  | { kind: "pdf"; base64: string; page: number; name?: string };

/* ----------------------------------------------------------------- request */

/** The full request, built without a client so a dry run can print it. */
export function mistralRequest(reader: Reader, input: MistralInput): OCRRequest {
  const document: OCRRequest["document"] =
    input.kind === "image"
      ? { type: "image_url", imageUrl: `data:${input.mediaType};base64,${input.base64}` }
      : {
          type: "document_url",
          documentUrl: `data:application/pdf;base64,${input.base64}`,
          documentName: input.name ?? "page.pdf",
        };

  return {
    model: reader.model,
    document,
    // Mistral counts pages from 0; corpora.ts counts from 1.
    ...(input.kind === "pdf" ? { pages: [input.page - 1] } : {}),
    includeImageBase64: false,
    tableFormat: "markdown",
    includeBlocks: true,
    confidenceScoresGranularity: "block",
  };
}

/** The request with the document bytes elided — what a dry run prints. */
export function describeRequest(req: OCRRequest): unknown {
  const clone = JSON.parse(JSON.stringify(req)) as any;
  const doc = clone.document ?? {};
  for (const field of ["imageUrl", "documentUrl"]) {
    const v = doc[field];
    if (typeof v === "string") doc[field] = `${v.slice(0, v.indexOf(",") + 1)}<base64, ${v.length} chars>`;
  }
  return clone;
}

/* ----------------------------------------------------------------- mapping */

type Field = "name" | "value" | "unit" | "range";

/** Fold a header label: lowercase, diacritics stripped, non-alphanumerics removed. */
export function headerKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Header label → field, first match wins.
 *
 * The columns we do **not** model come first, so a loose pattern below cannot
 * claim them: `textvysl` must never be read as `vysl`.
 */
const COLUMN_RULES: Array<{ re: RegExp; field: Field | null; why: string }> = [
  { re: /^zkr/, field: null, why: "Zkr. — abbreviation" },
  { re: /^textvysl/, field: null, why: "Text. výsl. — textual result" },
  { re: /^(kontrola|uvolnil|prijal|schvalil|podpis|lekar)/, field: null, why: "signature column" },
  { re: /^(prim)?mat/, field: null, why: "Prim. mat. / Materiál" },
  { re: /^vysetrovan/, field: null, why: "Vyšetřovaný materiál" },
  { re: /^(metoda|poznamka|komentar|predchozi|minule|datum|cas|odber|akreditac|stav|flag)/, field: null, why: "not modelled" },
  { re: /^(vysetren|analyt|nazev|nazov|parametr|ukazatel|stanoveni|test|polozka)/, field: "name", why: "" },
  { re: /^(vysl|hodnota|namer|result)/, field: "value", why: "" },
  { re: /^(jedn|mj|unit)/, field: "unit", why: "" },
  { re: /^(ref|rozmez|rozmedz|meze|norm|interval|fyziolog)/, field: "range", why: "" },
];

function classifyHeader(label: string): { field: Field | null; known: boolean; why: string } {
  const k = headerKey(label);
  if (!k) return { field: null, known: false, why: "unlabelled" };
  for (const rule of COLUMN_RULES) {
    if (rule.re.test(k)) return { field: rule.field, known: true, why: rule.why || label };
  }
  return { field: null, known: false, why: label };
}

/** A cell that reads as a number, censor included. Mirrors columnmap.ts's NUMERIC. */
const NUMERIC = /^[<>]?\s*-?\d[\d\s.,]*$/;
/** A complete printed interval: two numbers with a dash (or `až`) between them. */
export const INTERVAL_RE = /-?\d+(?:[.,]\d+)?\s*(?:-|–|—|až)\s*-?\d+(?:[.,]\d+)?/g;

const isNumericCell = (s: string) => NUMERIC.test(s.trim());
const isIntervalCell = (s: string) => (s.match(INTERVAL_RE) ?? []).length >= 1;
const isUnitCell = (s: string) => {
  const t = s.trim();
  return !!t && !isNumericCell(t) && t.length <= 12 && (t.includes("/") || /^[a-zA-Zµ%°^\d.\-]+$/.test(t));
};

/** One markdown table, split into cells. Separator rows are already gone. */
export function splitMarkdownTable(content: string): string[][] {
  const rows: string[][] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t.includes("|")) continue;
    if (/^\|?[\s:|-]+\|[\s:|-]*$/.test(t)) continue; // | --- | --- |
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|");
    rows.push(cells.map((c) => c.trim()));
  }
  return rows;
}

interface ColumnMapping {
  cols: Partial<Record<Field, number>>;
  /** True when row 0 was consumed as a header. */
  hasHeader: boolean;
  /** Header labels we saw and did not model — reported, never silently dropped. */
  droppedColumns: string[];
}

/** Rule 4/5: read the first row as a header. */
function fromHeader(row: string[]): ColumnMapping {
  const cols: Partial<Record<Field, number>> = {};
  const dropped: string[] = [];
  row.forEach((label, i) => {
    const { field, known, why } = classifyHeader(label);
    if (field && cols[field] === undefined) cols[field] = i;
    else if (!field) dropped.push(known ? why : label || "(unlabelled)");
  });
  return { cols, hasHeader: true, droppedColumns: dropped };
}

/** Rule 6: infer the columns from the shape of the cells. */
function fromShape(rows: string[][]): ColumnMapping {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const share = (i: number, pred: (s: string) => boolean) => {
    const cells = rows.map((r) => r[i] ?? "").filter((c) => c !== "");
    return cells.length ? cells.filter(pred).length / cells.length : 0;
  };
  const idx = Array.from({ length: width }, (_, i) => i);
  const taken = new Set<number>();
  const pick = (pred: (s: string) => boolean, from: number[] = idx) => {
    let best = -1;
    let bestShare = 0.5; // a simple majority of non-empty cells
    for (const i of from) {
      if (taken.has(i)) continue;
      const s = share(i, pred);
      if (s > bestShare) {
        best = i;
        bestShare = s;
      }
    }
    if (best >= 0) taken.add(best);
    return best;
  };

  const cols: Partial<Record<Field, number>> = {};
  const range = pick(isIntervalCell);
  if (range >= 0) cols.range = range;
  const value = pick(isNumericCell);
  if (value >= 0) cols.value = value;
  const unit = pick(isUnitCell);
  if (unit >= 0) cols.unit = unit;
  const name = pick((s) => !isNumericCell(s) && !isIntervalCell(s));
  if (name >= 0) cols.name = name;
  return { cols, hasHeader: false, droppedColumns: [] };
}

export interface MappedTable {
  rows: RawMeasurement[];
  droppedColumns: string[];
  /** Why a table contributed nothing, when it did. */
  skipped: string | null;
}

/** One markdown table → measurements. Rules 3–10 of the header. */
export function rowsFromTable(content: string, blockConfidence?: number | null): MappedTable {
  const grid = splitMarkdownTable(content);
  if (!grid.length) return { rows: [], droppedColumns: [], skipped: "no rows" };

  let map = fromHeader(grid[0]);
  // Rule 3: the header is accepted only if it names both a name and a value
  // column. Otherwise row 0 is data and the shape decides.
  if (map.cols.name === undefined || map.cols.value === undefined) {
    map = fromShape(grid);
  }
  const body = map.hasHeader ? grid.slice(1) : grid;
  const { cols } = map;
  // Rule 7.
  if (cols.name === undefined || cols.value === undefined) {
    return { rows: [], droppedColumns: map.droppedColumns, skipped: "no name/value column" };
  }

  const need = Math.max(cols.name, cols.value, cols.unit ?? -1, cols.range ?? -1);
  const conf = blockConfidence ?? null;
  const out: RawMeasurement[] = [];
  for (const row of body) {
    const cell = (i: number | undefined) => (i === undefined || i < 0 || i >= row.length ? "" : row[i]);
    const name = cell(cols.name);
    const value = cell(cols.value);
    // Rule 8.
    if (!name || !value || isNumericCell(name)) continue;
    const ragged = row.length <= need;
    const shaky = conf !== null && conf < CONF_LOW;
    out.push({
      raw_analyte_name: name,
      value_raw: value,
      unit_raw: cell(cols.unit),
      ref_range_raw: cell(cols.range),
      source_snippet: row.join(" | "),
      confidence: !isNumericCell(value) || ragged || shaky ? "low" : conf !== null && conf < CONF_HIGH ? "medium" : "high",
    });
  }
  return { rows: out, droppedColumns: map.droppedColumns, skipped: out.length ? null : "no measurement rows" };
}

/** Markdown tables inlined in a page's prose — the fallback when `tables` is empty. */
export function markdownTables(markdown: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  for (const line of markdown.split("\n")) {
    if (line.includes("|")) buf.push(line);
    else {
      if (buf.length >= 2) out.push(buf.join("\n"));
      buf = [];
    }
  }
  if (buf.length >= 2) out.push(buf.join("\n"));
  return out;
}

export interface MappedPage {
  measurements: RawMeasurement[];
  droppedColumns: string[];
  /** Tables that contributed nothing, and why — so a zero-row page is legible. */
  skippedTables: string[];
}

/** One OCR page → measurements. Rules 1–12 of the header. */
export function rowsFromOcrPage(page: OCRPageObject): MappedPage {
  // A block carries the confidence for the table it points at.
  const confByTable = new Map<string, number | null>();
  for (const b of page.blocks ?? []) {
    const any = b as any;
    if (any?.type === "table" && any.tableId) {
      confByTable.set(any.tableId, any.confidenceScores?.averageContentConfidenceScore ?? null);
    }
  }

  const tables: Array<{ id: string; content: string; conf: number | null }> = (page.tables ?? []).map((t) => ({
    id: t.id,
    content: t.content,
    conf: confByTable.get(t.id) ?? page.confidenceScores?.averagePageConfidenceScore ?? null,
  }));
  if (!tables.length) {
    markdownTables(page.markdown ?? "").forEach((content, i) =>
      tables.push({ id: `inline-${i}`, content, conf: page.confidenceScores?.averagePageConfidenceScore ?? null }),
    );
  }

  const measurements: RawMeasurement[] = [];
  const dropped = new Set<string>();
  const skipped: string[] = [];
  for (const t of tables) {
    const m = rowsFromTable(t.content, t.conf);
    measurements.push(...m.rows);
    for (const d of m.droppedColumns) dropped.add(d);
    if (m.skipped) skipped.push(`${t.id}: ${m.skipped}`);
  }
  return { measurements, droppedColumns: [...dropped], skippedTables: skipped };
}

/* -------------------------------------------------------------------- call */

const EMPTY: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export async function callMistral(apiKey: string, reader: Reader, input: MistralInput): Promise<CallResult> {
  const request = mistralRequest(reader, input);
  if (!apiKey) {
    return { ok: false, model: reader.model, ms: 0, usage: EMPTY, costUsd: 0, thought: false, extraction: null, error: "MISTRAL_API_KEY not set" };
  }
  // See the header: a retried call would be recorded as model latency.
  const client = new Mistral({ apiKey, retryConfig: { strategy: "none" } });

  const t0 = performance.now();
  try {
    const res: OCRResponse = await client.ocr.process(request);
    const ms = performance.now() - t0;
    // Billed per page, and the count is read back rather than assumed — if
    // selecting one page of a PDF still billed the whole document, this is
    // where it would show.
    const pages = res.usageInfo?.pagesProcessed ?? res.pages.length;
    const costUsd = pages * PAGE_PRICE_USD;
    const page = res.pages[0];
    if (!page) {
      return { ok: false, model: reader.model, ms, usage: EMPTY, costUsd, thought: false, extraction: null, error: "OCR returned no pages" };
    }
    const mapped = rowsFromOcrPage(page);
    return {
      ok: true,
      model: reader.model,
      ms,
      usage: EMPTY,
      costUsd,
      thought: false,
      extraction: {
        // Rule 11: OCR returns no structured header fields, and this arm does
        // not guess at them.
        report_date: null,
        report_date_raw: null,
        lab_name: null,
        patient_name: null,
        patient_id: null,
        measurements: mapped.measurements as any,
        usage: EMPTY,
        model: reader.model,
      },
      error: null,
    };
  } catch (e: any) {
    return {
      ok: false,
      model: reader.model,
      ms: performance.now() - t0,
      usage: EMPTY,
      costUsd: 0,
      thought: false,
      extraction: null,
      error: `${e?.statusCode ?? e?.status ?? ""} ${e?.name ?? "Error"}: ${e?.message ?? String(e)}`.trim(),
    };
  }
}
