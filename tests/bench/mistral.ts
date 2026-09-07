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
 *     retried call would be recorded as model latency. The one retry this file
 *     does make is its own, on 429 and nothing else, timed per attempt so the
 *     waiting is never charged to the model — "429 is not a bad read", below.
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
 * This mapping is the whole accuracy of the arm, and its first version got the
 * value column wrong on entire pages: on `19_06_12.pdf` every row came back
 * with the *upper reference bound* as its value — `WBS leukocyty` read 10,00
 * where the sheet prints 5,00 (4,00 - 10,00). Mistral had read the page
 * correctly; the row `WBS leukocyty | **5,00** | 10^9/l | 4,00 | - | 10,00 |
 * (X)` was mapped by taking the numeric column with the largest share, which
 * was a bound, because the emphasis on `**5,00**` made the real value fail
 * every numeric test. A plausible number in the value field, silently wrong,
 * is the worst shape a reader failure can take, so rules 1 to 5 below exist to
 * make each step of that mistake impossible on its own.
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
 *  6. **Headerless inference**, in the order the rules depend on each other —
 *     see `fromShape`. A split reference interval is consumed first (rule R1),
 *     then evaluation-marker columns (R5), then the `name` (leftmost column
 *     that is mostly words), then the flag and lab-code columns standing
 *     before it (R4), then `range`, then `value` (R3), then `unit`. "Most" is
 *     a simple majority of non-empty cells, and a tie is broken by *leftmost*
 *     — never by "the last numeric column", which is what read a bound as a
 *     value on every row of a page.
 *  7. **A table with no value column and no name column is not a results
 *     table** and contributes nothing. That is what drops the patient block —
 *     `Jméno: | | Datum a čas odběru: | 21.05.2024 10:08` — which Mistral
 *     returns as a table beside the real one.
 *  8. **A row is kept** when it has a non-empty name that is not itself a
 *     number and a non-empty value that is not a marker. A section heading
 *     printed as a lone cell (`Biochemie`) therefore drops out, and so does a
 *     fully empty padding row.
 *  9. **Cells are copied verbatim, once markdown is not part of them.** The
 *     accreditation star in `* urea`, the parentheses in `( 2,5000 - 6,4000 )`,
 *     `!`/`*` markers, `<`/`>` censors — all kept as printed. What is removed
 *     is markdown's own emphasis wrappers (rule R2), which are Mistral's
 *     rendering of *printed boldness* and were never characters on the page.
 *     `nameKey`/`valKey` in score.ts do the rest of the folding, and a reader
 *     that "tidies" a value is exactly what this benchmark is for.
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
 *     verification"), and what `isPrintedOnPage` provenance would read. It is
 *     also what makes `remapMeasurements` possible: a mapping change can be
 *     re-judged against the API's real answers without paying for them again.
 * 13. **The OCR answer itself is kept**, in `CallResult.raw` — the page
 *     markdown, the tables and the block confidences, which is every input
 *     `rowsFromOcrPage` reads (`rawAnswerFor`). Rule 12's snippets can only
 *     re-judge a row the old mapping *kept*; `raw` re-judges the whole page,
 *     through `remapFromRaw`. That distinction is not academic: the first
 *     mapping bug found here dropped rows, and dropped rows leave no snippet.
 *
 * ### The five rules that fixed the value column
 *
 * R1. **A reference interval split across cells is one field.** `low | - |
 *     high`, `low | – | high`, and the `od`/`do` header pair all join into
 *     `4,00 - 10,00`. This is not a new opinion: `SYSTEM_EXTRACT_TEXT` in
 *     packages/extraction/src/extract.ts already instructs the deployed reader
 *     in exactly this form ("spoj obě čísla do jednoho pole ve tvaru '0,17 -
 *     0,78'"), and `split_range.pdf` is the fixture drawn for the layout.
 *     `findRangeGroup` is that instruction made deterministic. A bare pair of
 *     adjacent numeric columns with neither separator nor header is *not*
 *     joined — that guess would invent the failure this fixes.
 * R2. **Markdown emphasis is not data.** `**5,00**` is 5,00 printed bold. The
 *     wrappers come off before any cell is classified; a lone unpaired `*` or
 *     `!` — the lab's own out-of-range marker — is left exactly as printed.
 *     `stripEmphasis` and `isEmphasised`.
 * R3. **The value is what is left.** Once the range cells, the markers, the
 *     name, the flag and the lab code are consumed, the value is the remaining
 *     numeric column: the emphasised one if there is one, since Mistral bolds
 *     the printed result, and otherwise the leftmost.
 * R4. **A single-letter leading cell is a flag, not a name.** Rows came back
 *     named `A` (the accreditation column) and valued `81365` (the LIS item
 *     code). `nameStart`/`nameFromRow` in packages/lab-core/src/candidates.ts
 *     already solve this class for the text path; `nameAt` and the flag/lab
 *     code columns in `fromShape` are the same rule over markdown cells.
 * R5. **Trailing marker cells are decoration.** `(X)`, `( )X`, `*( )`, `[*]`,
 *     `(*)`, a lone `.` — evaluation markers, and never a value, unit or
 *     range. `MARKER_CELL`. A bare `-` is deliberately excluded: it is a
 *     printed unit and the separator inside a split interval.
 */
import { Mistral } from "@mistralai/mistralai";
import type { OCRPageObject, OCRRequest, OCRResponse } from "@mistralai/mistralai/models/components";

import { type Usage } from "@bw/extraction";

import { truncateRawField, type CallResult, type RawAnswer, type Reader } from "./extract";
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

/* ----------------------------------------------- rule 2: emphasis is not data */

/**
 * Mistral marks *printed boldness* with markdown emphasis: a result printed
 * bold comes back as `**5,00**`. That is a fact about the ink, not a character
 * on the page, and leaving it in was enough to make `**5,00**` fail every
 * numeric test in this file — which is how the value column came to be chosen
 * from among the reference bounds instead.
 *
 * What must survive is the lab's own out-of-range marker, which is *also* an
 * asterisk: `0,93 !`, `1,04 *`, `* urea`, `*Leukocyty`, `(*)`, `[*]`. So only a
 * balanced wrapper is stripped — `**x**`, `__x__`, `*x*`, and `_x_` around a
 * whole cell — and a lone, unpaired `*` or `!` is left exactly as printed.
 * `score.ts`'s `valKey` folds the printed markers away before comparing anyway
 * (`stripValueMarkers`, the one place that rule is stated), and `normalize()`
 * does the same in the deployed parser; a *wrapper* is not that.
 *
 * The single-underscore form is restricted to a whole cell whose interior
 * carries no other underscore, because Czech analyte names are full of them
 * (`S_Sodík`, `fU_Vápník-odpad`) and CommonMark does not emphasise intra-word
 * underscores either.
 */
const BOLD = /\*\*(\S(?:[^*]*\S)?)\*\*/g;
const BOLD_UNDERSCORE = /__(\S(?:[^_]*\S)?)__/g;
const ITALIC = /\*(\S(?:[^*]*\S)?)\*/g;
const ITALIC_UNDERSCORE = /^_(\S(?:[^_]*\S)?)_$/;

export function stripEmphasis(cell: string): string {
  let t = cell.trim();
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(BOLD, "$1").replace(BOLD_UNDERSCORE, "$1");
    if (t === before) break;
  }
  t = t.replace(ITALIC, "$1").replace(ITALIC_UNDERSCORE, "$1");
  return t.trim();
}

/** Was the whole cell wrapped in emphasis? Rule 3 prefers such a cell as the value. */
export function isEmphasised(cell: string): boolean {
  const t = cell.trim();
  return (
    /^\*\*(\S(?:[^*]*\S)?)\*\*$/.test(t) ||
    /^__(\S(?:[^_]*\S)?)__$/.test(t) ||
    /^\*(\S(?:[^*]*\S)?)\*$/.test(t) ||
    /^_(\S(?:[^_]*\S)?)_$/.test(t)
  );
}

/* ------------------------------------------------------------ cell classes */

/** A cell that reads as a number, censor included. Mirrors columnmap.ts's NUMERIC. */
const NUMERIC = /^[<>]?\s*-?\d[\d\s.,]*$/;
/** A complete printed interval: two numbers with a dash (or `až`) between them. */
export const INTERVAL_RE = /-?\d+(?:[.,]\d+)?\s*(?:-|–|—|až)\s*-?\d+(?:[.,]\d+)?/g;
/** One end of an interval printed in its own cell. Censors are not bounds. */
const BOUND_CELL = /^-?\d+(?:[.,]\d+)?$/;
/** The cell that stands *between* two bounds, carrying no digits of its own. */
const SEPARATOR_CELL = /^(?:-|–|—|až|az)$/i;
/** Rule 4, from candidates.ts: a lone letter leading a row is a flag, not a name. */
const FLAG_CELL = /^[A-Za-zÀ-ž]$/;
/** Rule 4, from candidates.ts: the LIS item code printed before the name. */
const LAB_CODE = /^\d{3,6}$/;
const DATE_CELL = /^\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}$/;
/** Two letters in a row — the cheapest test for "this cell is words, not a number". */
const LETTERS2 = /[A-Za-zÀ-ž][A-Za-zÀ-ž]/;
/**
 * An abbreviation column standing before the name: `URE | urea`, `KM |
 * kyselina močová`. Same rule as `ABBREVIATION` in
 * packages/lab-core/src/candidates.ts — all caps, two to six characters — and
 * it only fires when the column to its right is the name.
 */
const ABBREVIATION = /^[A-ZÀ-Ž0-9][A-ZÀ-Ž0-9._-]{1,5}$/;
/**
 * Rule 5. An evaluation marker in its own column: `(X)`, `( )X`, `*( )`,
 * `[*]`, `(*)`, the lone `.` some LIS print, a bare `*` or `!`. Brackets,
 * stars, dots and at most one X or H/L letter — nothing else. A bare `-` is
 * deliberately NOT a marker: it is a printed unit (hematocrit, pH) and the
 * separator between two range bounds.
 */
export const MARKER_CELL = /^(?=.*[()[\]*!.])[()[\]\s*!.]*[XxHL]?[()[\]\s*!.]*$/;

const isNumericCell = (s: string) => NUMERIC.test(s.trim());
const isIntervalCell = (s: string) => (s.match(INTERVAL_RE) ?? []).length >= 1;
const isUnitCell = (s: string) => {
  const t = s.trim();
  return !!t && !isNumericCell(t) && t.length <= 12 && (t.includes("/") || /^[a-zA-Zµ%°^\d.\-]+$/.test(t));
};
/** Words, not a number and not decoration — what a name column is made of. */
const isNameCell = (s: string) => {
  const t = s.trim();
  return !!t && LETTERS2.test(t) && !isNumericCell(t) && !isIntervalCell(t) && !MARKER_CELL.test(t);
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

/* -------------------------------------- rule 1: a range split across cells */

/**
 * Where a reference interval is printed as two cells rather than one.
 *
 * `low` and `high` are column indices; `sep` is the column holding the lone
 * `-` between them, when the sheet prints one.
 */
export interface RangeGroup {
  low: number;
  sep: number | null;
  high: number;
}

const RANGE_LOW_LABEL = /^(od|dolni|dolnimez|dolnihranice|min|minimum|low|lower|from)$/;
const RANGE_HIGH_LABEL = /^(do|horni|hornimez|hornihranice|max|maximum|high|upper|to)$/;

/** The one form the deployed prompt asks Claude for: `0,17 - 0,78`. */
export function joinRange(low: string, high: string): string {
  const a = (low ?? "").trim();
  const b = (high ?? "").trim();
  if (a && b) return `${a} - ${b}`;
  return a || b;
}

const shareOf = (rows: string[][], i: number, pred: (s: string) => boolean): number => {
  const cells = rows.map((r) => (r[i] ?? "").trim()).filter((c) => c !== "");
  return cells.length ? cells.filter(pred).length / cells.length : 0;
};

/** How much of a column Mistral printed emphasised — rule 3's tie-break. */
const emphasisShare = (rows: string[][], emph: boolean[][], i: number): number => {
  let seen = 0;
  let hit = 0;
  rows.forEach((r, y) => {
    if ((r[i] ?? "").trim() === "") return;
    seen++;
    if (emph[y]?.[i]) hit++;
  });
  return seen ? hit / seen : 0;
};

/**
 * Rule 1. Find the two columns that are one interval.
 *
 * `SYSTEM_EXTRACT_TEXT` in packages/extraction/src/extract.ts already tells
 * the deployed reader this, in Czech: *"Pokud je referenční interval vytištěn
 * ve dvou sloupcích (např. 'od' a 'do'), spoj obě čísla do jednoho pole ve
 * tvaru '0,17 - 0,78'"*. This is that instruction made deterministic, and it
 * is the same layout `split_range.pdf` was drawn to exercise.
 *
 * Two forms are recognised, and only two:
 *   - **named** — the header says `od`/`do` (also `dolní`/`horní`, `min`/`max`);
 *   - **printed** — three consecutive columns read `bound | - | bound` in a
 *     majority of rows, the layout `19_06_12.pdf` prints.
 *
 * A bare pair of adjacent numeric columns with neither a separator nor a
 * header is deliberately NOT a group: `value | bound` and `bound | bound` are
 * indistinguishable from the cells alone, and guessing there would invent the
 * very failure this fixes.
 */
export function findRangeGroup(rows: string[][], header: string[] | null): RangeGroup | null {
  if (header) {
    for (let i = 0; i + 1 < header.length; i++) {
      if (!RANGE_LOW_LABEL.test(headerKey(header[i]))) continue;
      for (const j of [i + 1, i + 2]) {
        if (j >= header.length) break;
        if (RANGE_HIGH_LABEL.test(headerKey(header[j]))) return { low: i, sep: j === i + 2 ? i + 1 : null, high: j };
      }
    }
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  let best: RangeGroup | null = null;
  let bestShare = 0.5; // a simple majority, as everywhere else in this file
  for (let i = 0; i + 2 < width; i++) {
    const seen = rows.filter((r) => [i, i + 1, i + 2].some((k) => (r[k] ?? "").trim() !== ""));
    if (!seen.length) continue;
    const hits = seen.filter(
      (r) =>
        BOUND_CELL.test((r[i] ?? "").trim()) &&
        SEPARATOR_CELL.test((r[i + 1] ?? "").trim()) &&
        BOUND_CELL.test((r[i + 2] ?? "").trim()),
    ).length;
    const s = hits / seen.length;
    if (s > bestShare) {
      best = { low: i, sep: i + 1, high: i + 2 };
      bestShare = s;
    }
  }
  return best;
}

/* ---------------------------------------------------------- the column map */

interface ColumnMapping {
  cols: Partial<Record<Field, number>>;
  /** Set when the interval is printed across two columns (rule 1). */
  group: RangeGroup | null;
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
  return { cols, group: null, hasHeader: true, droppedColumns: dropped };
}

/**
 * Rule 6, rewritten around rules 1–5: infer the columns from the shape of the
 * cells, in the order the rules depend on each other.
 *
 * The old order — range, value, unit, name, each taking the column with the
 * *highest* share — is what produced the `WBS leukocyty` failure: with the
 * interval split across three cells there was no interval column to take, the
 * emphasised `**5,00**` failed the numeric test, and "highest numeric share"
 * then landed on the upper bound. Every value on the page became a reference
 * bound: a plausible number, silently wrong.
 *
 * So: the split range is consumed first, then the marker columns, then the
 * name — because rule 4 cannot tell a lab code from a value until it knows
 * which side of the name the column is on. The value is what remains, and ties
 * are broken by emphasis and then by *leftmost*, never by "last numeric".
 */
function fromShape(rows: string[][], emph: boolean[][], group: RangeGroup | null): ColumnMapping {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const idx = Array.from({ length: width }, (_, i) => i);
  const taken = new Set<number>();
  const dropped: string[] = [];
  const cols: Partial<Record<Field, number>> = {};

  // Rule 1 first: those cells are an interval, not candidates for anything else.
  if (group) {
    taken.add(group.low).add(group.high);
    if (group.sep !== null) taken.add(group.sep);
    dropped.push("reference interval printed across separate columns — joined");
  }
  // Rule 5: an evaluation marker column is neither value, unit nor range.
  for (const i of idx) {
    if (taken.has(i)) continue;
    if (shareOf(rows, i, (c) => MARKER_CELL.test(c)) > 0.5) {
      taken.add(i);
      dropped.push("evaluation marker column");
    }
  }
  const leftmost = (pred: (s: string) => boolean) => idx.find((i) => !taken.has(i) && shareOf(rows, i, pred) > 0.5) ?? -1;

  let name = leftmost(isNameCell);
  // `Zkr.` without a header: an all-caps code column reads as words, but the
  // name is the column after it. candidates.ts drops the same cell for the
  // text path.
  if (name >= 0 && shareOf(rows, name, (c) => ABBREVIATION.test(c)) > 0.5) {
    const next = idx.find((i) => i > name && !taken.has(i) && shareOf(rows, i, isNameCell) > 0.5);
    if (next !== undefined) {
      taken.add(name);
      dropped.push("abbreviation column");
      name = next;
    }
  }
  if (name >= 0) {
    cols.name = name;
    taken.add(name);
  }
  // Rule 4, the mirror of `nameStart` in packages/lab-core/src/candidates.ts:
  // a single letter or a 3-6 digit code standing *before* the name is the
  // accreditation flag or the LIS item code. Never a name, never a value.
  for (const i of idx) {
    if (taken.has(i) || cols.name === undefined || i >= cols.name) continue;
    if (shareOf(rows, i, (c) => FLAG_CELL.test(c)) > 0.5) {
      taken.add(i);
      dropped.push("accreditation flag column");
    } else if (shareOf(rows, i, (c) => LAB_CODE.test(c)) > 0.5) {
      taken.add(i);
      dropped.push("lab code column");
    }
  }
  if (!group) {
    const range = leftmost(isIntervalCell);
    if (range >= 0) {
      cols.range = range;
      taken.add(range);
    }
  }
  // Rule 3: the value is what is left that reads as a number. Mistral bolds
  // the printed result, so an emphasised column wins; otherwise the leftmost.
  const numeric = idx.filter((i) => !taken.has(i) && shareOf(rows, i, isNumericCell) > 0.5);
  let value = -1;
  let bestEmph = 0;
  for (const i of numeric) {
    const e = emphasisShare(rows, emph, i);
    if (e > bestEmph) {
      bestEmph = e;
      value = i;
    }
  }
  if (value < 0 && numeric.length) value = numeric[0];
  if (value >= 0) {
    cols.value = value;
    taken.add(value);
  }
  const unit = leftmost(isUnitCell);
  if (unit >= 0) {
    cols.unit = unit;
    taken.add(unit);
  }
  return { cols, group, hasHeader: false, droppedColumns: dropped };
}

/**
 * Rule 4 at row level: the analyte name, starting at the name column.
 *
 * `candidateRows`/`nameFromRow` in packages/lab-core/src/candidates.ts walk
 * past a leading flag letter and a lab code to find where the name starts;
 * this is the same walk, over markdown cells. It is what turns the row
 * `A | 81365 | Bílkovina celková | ...` — which came back named `A` — into a
 * name. Reach is three cells, as there.
 */
export function nameAt(cells: string[], start: number | undefined): string {
  if (start === undefined || start < 0) return "";
  for (let k = start; k < Math.min(cells.length, start + 3); k++) {
    const c = (cells[k] ?? "").trim();
    if (!c || MARKER_CELL.test(c)) continue;
    if (LETTERS2.test(c) && !isNumericCell(c) && !DATE_CELL.test(c)) return c;
    if (!FLAG_CELL.test(c) && !LAB_CODE.test(c)) return "";
  }
  return "";
}

export interface MappedTable {
  rows: RawMeasurement[];
  droppedColumns: string[];
  /** Why a table contributed nothing, when it did. */
  skipped: string | null;
}

/** A grid of cells → measurements. Rules 1–10 of the header. */
export function rowsFromGrid(grid: string[][], blockConfidence?: number | null): MappedTable {
  if (!grid.length) return { rows: [], droppedColumns: [], skipped: "no rows" };
  // Rule 2: emphasis comes off before anything is classified, and the fact
  // that a cell *was* emphasised is kept beside it for rule 3.
  const emph = grid.map((r) => r.map(isEmphasised));
  const cells = grid.map((r) => r.map(stripEmphasis));

  let map = fromHeader(cells[0]);
  // Rule 3 of the file header: the header is accepted only if it names both a
  // name and a value column. Otherwise row 0 is data and the shape decides.
  if (map.cols.name !== undefined && map.cols.value !== undefined) {
    // A header that names a whole range column keeps it — unless the interval
    // it names starts there and spills into the columns beside it, which is
    // the same split range with a label over its left half.
    const group = findRangeGroup(cells.slice(1), cells[0]);
    if (group && (map.cols.range === undefined || map.cols.range === group.low)) {
      map.group = group;
      map.cols.range = undefined;
      map.droppedColumns.push("reference interval printed across separate columns — joined");
    }
  } else {
    map = fromShape(cells, emph, findRangeGroup(cells, null));
  }
  const body = map.hasHeader ? cells.slice(1) : cells;
  const { cols, group } = map;
  // Rule 7.
  if (cols.name === undefined || cols.value === undefined) {
    return { rows: [], droppedColumns: map.droppedColumns, skipped: "no name/value column" };
  }

  const need = Math.max(cols.name, cols.value, cols.unit ?? -1, cols.range ?? -1, group?.high ?? -1);
  const conf = blockConfidence ?? null;
  const out: RawMeasurement[] = [];
  for (const row of body) {
    const cell = (i: number | undefined) => (i === undefined || i < 0 || i >= row.length ? "" : row[i]);
    const name = nameAt(row, cols.name);
    const value = cell(cols.value);
    // Rule 8, plus rule 5: a marker is not a value.
    if (!name || !value || isNumericCell(name) || MARKER_CELL.test(value)) continue;
    const ragged = row.length <= need;
    const shaky = conf !== null && conf < CONF_LOW;
    out.push({
      raw_analyte_name: name,
      value_raw: value,
      unit_raw: cell(cols.unit),
      // Rule 1: `4,00 | - | 10,00` is one field, in the form the deployed
      // prompt asks for.
      ref_range_raw: group ? joinRange(cell(group.low), cell(group.high)) : cell(cols.range),
      source_snippet: row.join(" | "),
      confidence: !isNumericCell(value) || ragged || shaky ? "low" : conf !== null && conf < CONF_HIGH ? "medium" : "high",
    });
  }
  return { rows: out, droppedColumns: map.droppedColumns, skipped: out.length ? null : "no measurement rows" };
}

/** One markdown table → measurements. */
export function rowsFromTable(content: string, blockConfidence?: number | null): MappedTable {
  return rowsFromGrid(splitMarkdownTable(content), blockConfidence);
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

/* --------------------------------------------- the OCR answer, kept verbatim */

/**
 * The provider's own answer for this page, for `CallResult.raw`.
 *
 * Everything `rowsFromOcrPage` reads and nothing else: the page markdown, the
 * tables as Mistral isolated them, the per-block content confidences (which is
 * where the derived `confidence` field comes from, rule 10) and the page-level
 * average that stands in when a table has no block. Cropped images are not
 * requested and would not be stored; word-level boxes are not requested either.
 *
 * That set is exactly what makes a stored run re-judgeable: a mapping change
 * can be re-run against this and produce rows the old mapping never emitted —
 * which `remapMeasurements` from `source_snippet` structurally cannot do, since
 * a row the old mapping dropped left no snippet behind.
 */
export function rawAnswerFor(page: OCRPageObject): RawAnswer {
  const truncated: string[] = [];
  const blocks: Array<{ tableId: string; confidence: number | null }> = [];
  for (const b of page.blocks ?? []) {
    const any = b as any;
    if (any?.type === "table" && any.tableId) {
      blocks.push({ tableId: any.tableId, confidence: any.confidenceScores?.averageContentConfidenceScore ?? null });
    }
  }
  const raw: RawAnswer = {
    provider: "mistral",
    markdown: truncateRawField(page.markdown ?? "", "markdown", truncated),
    tables: (page.tables ?? []).map((t) => ({ id: t.id, content: truncateRawField(t.content ?? "", `tables[${t.id}]`, truncated) })),
    blocks,
    pageConfidence: page.confidenceScores?.averagePageConfidenceScore ?? null,
  };
  if (truncated.length) raw.truncated = truncated;
  return raw;
}

/**
 * Re-map a stored `RawAnswer` — the whole point of storing one.
 *
 * `rowsFromOcrPage` is run again on the provider's own answer, so today's
 * mapping sees exactly what it would have seen on the day of the call. Unlike
 * `remapMeasurements` below, this *can* bring a row back from absent to
 * present, and it can re-judge a page whose tables the old mapping rejected
 * outright. Returns `null` when there is nothing to work from, so a caller can
 * fall back to the snippet route for the runs recorded before `raw` existed.
 */
export function remapFromRaw(raw: RawAnswer | null | undefined): RawMeasurement[] | null {
  if (!raw || raw.provider !== "mistral") return null;
  if (!raw.tables?.length && !raw.markdown) return null;
  const conf = new Map((raw.blocks ?? []).map((b) => [b.tableId, b.confidence] as const));
  const page = {
    markdown: raw.markdown ?? "",
    tables: (raw.tables ?? []).map((t) => ({ id: t.id, content: t.content })),
    blocks: [...conf].map(([tableId, confidence]) => ({
      type: "table",
      tableId,
      confidenceScores: { averageContentConfidenceScore: confidence },
    })),
    confidenceScores:
      raw.pageConfidence === null || raw.pageConfidence === undefined
        ? undefined
        : { averagePageConfidenceScore: raw.pageConfidence },
  } as unknown as OCRPageObject;
  return rowsFromOcrPage(page).measurements;
}

/* ------------------------------------------------- re-mapping, without paying */

/**
 * Re-map measurements this file produced earlier, from their own snippets.
 *
 * The fallback route, for runs persisted before `CallResult.raw` existed.
 * `remapFromRaw` is strictly better where a stored `raw` is available.
 *
 * Rule 12 makes `source_snippet` the whole printed row, cells rejoined with
 * `" | "`, and no cell can contain a `|` because that is what they were split
 * on — so the row survives the round trip exactly. That is the only reason a
 * mapping change can be judged against the real API's answers without paying
 * for them again: `results/adapt/<arm>/<slug>.json` persists the *mapped*
 * output, not the OCR response.
 *
 * Two things it cannot recover, and they must be stated wherever its numbers
 * are: the header row (consumed, or dropped by rule 8) and any row the old
 * mapping rejected. So a re-map can move a row from wrong to right, never from
 * absent to present, and a page that came back with no table at all stays at
 * zero. Consecutive rows of equal width are treated as one table, which is
 * what a table is here; a width change starts a new one.
 */
export function remapMeasurements(rows: RawMeasurement[]): RawMeasurement[] {
  if (!rows.length) return [];
  // One grid for the whole page, not one per printed table: which table a row
  // came from is not in the file, and a page's tables share their column
  // layout far more often than not. Ragged rows cost nothing — every share is
  // computed over non-empty cells, and a missing cell reads as empty.
  const grid = rows.map((m) => (m.source_snippet ?? "").split("|").map((c) => c.trim()));
  return rowsFromGrid(grid, null).rows;
}

/* -------------------------------------------------------------------- call */

const EMPTY: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/* --------------------------------------------------- 429 is not a bad read */

/**
 * Politeness for this provider, and for this provider only.
 *
 * The first full sweep ran both OCR arms through the shared four-worker pool
 * and Mistral answered **429** to 91 of 146 photo pages and 14 of 32
 * born-digital pages. Those pages are not evidence about the model: they are
 * evidence about how fast we asked. `loadPersisted` refuses to reuse a failed
 * call, so the run simply had a hole in it.
 *
 * Retrying a 429 is honest in a way that retrying a *bad read* would never be.
 * A rate limit says "not now"; the answer we eventually get is the answer the
 * model would have given the first time. A wrong value re-rolled until it comes
 * out right would be the benchmark grading itself, which is why every other
 * arm keeps `maxRetries: 0` and why nothing here retries a 400, a 500 or an
 * empty page.
 *
 * Latency stays comparable because `ms` is measured per attempt and only the
 * attempt that answered is reported — the waiting is not charged to the model.
 * The retry count goes to stdout instead, so a run that only survived by
 * backing off cannot look like a run that did not need to.
 *
 * The other half of the fix is a concurrency cap, which belongs to the caller:
 * `adapt.bench.ts` gates the OCR provider to `MISTRAL_IN_FLIGHT` (default 2)
 * while every other arm keeps the pool's full width.
 */
export const MISTRAL_MAX_RETRIES = 4;
export const MISTRAL_BACKOFF_MS = 2_000;
export const MISTRAL_BACKOFF_CAP_MS = 30_000;

/** Is this the rate limiter, rather than a refusal to read the page? */
export function isRateLimit(e: any): boolean {
  const status = e?.statusCode ?? e?.status ?? e?.response?.status;
  if (status === 429) return true;
  return /(^|\D)429(\D|$)/.test(String(e?.message ?? ""));
}

/** How long to wait: the server's `Retry-After` when it sends one, else backoff. */
export function backoffMs(e: any, attempt: number): number {
  const header = e?.rawResponse?.headers?.get?.("retry-after") ?? e?.headers?.["retry-after"];
  const after = Number(header);
  if (Number.isFinite(after) && after > 0) return Math.min(after * 1000, MISTRAL_BACKOFF_CAP_MS);
  const grow = MISTRAL_BACKOFF_MS * 2 ** attempt;
  // Jitter, so four workers that hit the limit together do not come back together.
  return Math.min(grow, MISTRAL_BACKOFF_CAP_MS) * (0.75 + Math.random() * 0.5);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


export async function callMistral(apiKey: string, reader: Reader, input: MistralInput): Promise<CallResult> {
  const request = mistralRequest(reader, input);
  if (!apiKey) {
    return { ok: false, model: reader.model, ms: 0, usage: EMPTY, costUsd: 0, thought: false, extraction: null, error: "MISTRAL_API_KEY not set" };
  }
  // The SDK's own retry stays off: it would retry a 500 and a 400 too, and its
  // waiting would land inside the measured call. "429 is not a bad read" above.
  const client = new Mistral({ apiKey, retryConfig: { strategy: "none" } });

  for (let attempt = 0; ; attempt++) {
    const result = await attemptOcr(client, reader, request);
    if (result.ok || !result.rateLimited || attempt >= MISTRAL_MAX_RETRIES) return result.call;
    const wait = backoffMs(result.raw, attempt);
    console.log(`   mistral 429 — backing off ${Math.round(wait)} ms (retry ${attempt + 1}/${MISTRAL_MAX_RETRIES})`);
    await sleep(wait);
  }
}

interface Attempt {
  ok: boolean;
  rateLimited: boolean;
  raw: any;
  call: CallResult;
}

/** One round trip. `ms` is this attempt alone — the backoff is never in it. */
async function attemptOcr(client: Mistral, reader: Reader, request: OCRRequest): Promise<Attempt> {
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
      const call: CallResult = { ok: false, model: reader.model, ms, usage: EMPTY, costUsd, thought: false, extraction: null, error: "OCR returned no pages" };
      return { ok: false, rateLimited: false, raw: null, call };
    }
    const mapped = rowsFromOcrPage(page);
    return {
      ok: true,
      rateLimited: false,
      raw: null,
      call: {
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
        // What Mistral said, beside what we made of it. `extract.ts`,
        // `RawAnswer`: the mapping *is* this arm's accuracy, so a stored run
        // has to carry the answer the mapping was applied to.
        raw: rawAnswerFor(page),
        error: null,
      },
    };
  } catch (e: any) {
    const call: CallResult = {
      ok: false,
      model: reader.model,
      ms: performance.now() - t0,
      usage: EMPTY,
      costUsd: 0,
      thought: false,
      extraction: null,
      error: `${e?.statusCode ?? e?.status ?? ""} ${e?.name ?? "Error"}: ${e?.message ?? String(e)}`.trim(),
    };
    return { ok: false, rateLimited: isRateLimit(e), raw: e, call };
  }
}
