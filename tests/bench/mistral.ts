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
 *
 * ### The five rules that fixed the range and unit columns
 *
 * Same class of fault as R1, found the same way — from the stored `call.raw`,
 * not from a suspicion about the model. In every one of them Mistral read the
 * page correctly and this mapping threw the reading away. Against the accepted
 * reports on the born-digital class they take the unit disagreements from 485
 * to 57 and the range disagreements from 503 to 86, with `matched` 847 → 849
 * and no value error introduced; on the photo class, unit 1678 → 141 and range
 * 1827 → 268. `BENCH_REMAP=1 npm run bench:adapt` re-runs it, for free.
 *
 * R6. **A lone comparison operator belongs to the number after it.** A
 *     one-sided reference bound prints its operator in its *own* cell:
 *
 *         |  CK | **12,54** | µkat/l |  | < | 2,85 | ( )X  |
 *
 *     R1 only recognised `bound | separator | bound`, so the operator cell was
 *     discarded and `< 2,85` came back as a bare `2,85`. That is not a
 *     notation difference. `< 2,85` is an interval with no lower bound;
 *     `2,85` parses in `parseRange` as descriptive text with neither bound,
 *     and the flag the app computes from it is then computed from nothing.
 *     The operator now joins the bound it governs, in the form
 *     packages/lab-core/src/normalize.ts and the accepted reports both spell:
 *     `< 2,85` (`UPPER_BOUND`/`LOWER_BOUND` there accept `<`, `≤`, `>`, `≥`;
 *     `parse_range` in tools/pipeline/tests/parity_cases.json fixes
 *     `"< 5,00"` → `[null, 5.0, null]`). `OPERATOR_CELL`, `operatorOf`,
 *     `joinRange`.
 * R7. **The same operator before a *value* is a censor, and is never
 *     dropped.** `| < | 1,0 |` in the value columns is "below the assay
 *     floor", and a censored value quietly becoming `1,0` is precisely the
 *     `decensored` failure `rangeIntegrity` in score.ts tracks. The operator
 *     column standing immediately before the value joins onto it as `<1,0` —
 *     no space, which is how the accepted reports spell a censored *value*
 *     (`<1,0`) as against a one-sided *range* (`< 2,85`). The two rules
 *     cannot collide: R6 fires only where the low-bound cell beside the
 *     operator is **empty**, R7 only where the operator abuts the value
 *     column and no range group has claimed it. No stored answer exercises
 *     R7 — 77 operator cells across `results/adapt/mistral*` and every one of
 *     them a range bound — so it is a guard, and its test says so.
 * R8. **A row wider than its own header has had a column split, not gained
 *     one.** Several labs print `Hodnocení` as a little graphical scale, and
 *     Mistral returns its segments as separate cells:
 *
 *         | Vyšetření | Výsledek | Hodnocení | Jednotky | Ref. interval |
 *         | S_Urea | 4,5 | | * | | mmol/l | (2,8-8,3) |
 *
 *     Five header cells, seven or eight in the row. Every column after the
 *     scale is then read one or two places to the left, so `unit_raw` came
 *     back as `*` or blank and `ref_range_raw` with it — 403 of the 485 unit
 *     disagreements and 373 of the 503 range disagreements on the born-digital
 *     class, all of them ours. A run of two or more adjacent cells that are
 *     blank or `MARKER_CELL` collapses back to one until the row is as wide as
 *     its header, keeping whatever the run held. `collapseMarkerRuns`, applied
 *     only where a header was accepted (so there is a width to trust) and only
 *     to rows wider than it.
 * R9. **A share computed over one cell is not a majority.** `shareOf` counts
 *     only non-empty cells, so a column blank in every data row scores 1.0 on
 *     its own header label alone. On the `A | Výkon | Název metody | …` layout
 *     the empty `Výkon` was elected the name, which left the real name column
 *     unclaimed for `isUnitCell` to take: `MCV` came back as the unit of MCV,
 *     41 rows of the 485 — 25 of which this fixes outright, while the other 16
 *     become the honest residual below (Mistral printed their unit inside the
 *     range cell, so there is no unit cell to read). A column must now be
 *     non-empty on at least two rows to be elected anything, the name column
 *     is moved to wherever `nameAt` actually lands on a majority of rows
 *     (`nameIndexAt`), and a printed date
 *     can no longer be elected the value — without which the signature block
 *     `Výsledky uvolnil : | 01.07.2022 | …` is mapped as a results table.
 * R10. **The same interval split across two cells, not three**, because the
 *     separator or the operator was printed against the bound: `1,00 | - 2,10`
 *     and ` | < 5,20`. Neither cell is an interval on its own and there is no
 *     separator cell, so R1 and R6 both saw nothing and the whole reference
 *     column of two pages came back empty — 38 rows here, 215 on the photo
 *     class. The dash form requires the space (`-10,0` is a negative bound and
 *     `BOUND_CELL` already reads it as one); the operator form does not, since
 *     no bound starts with `<`. Looked for only after the three-cell form has
 *     found nothing. `GLUED_SEP_BOUND`, `GLUED_OP_BOUND`, `isGluedRangeRow`.
 */
import { Mistral } from "@mistralai/mistralai";
import type { OCRPageObject, OCRRequest, OCRResponse, ResponseFormat } from "@mistralai/mistralai/models/components";

import { SYSTEM_EXTRACT_TEXT, TOOL, type Usage } from "@bw/extraction";

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

/* ============================================================== annotations */

/**
 * `mistral_annot` — the third way, where Mistral fills OUR schema itself.
 *
 * The OCR endpoint takes `document_annotation_format`, a JSON schema it runs
 * `mistral-small-2603` over its own OCR markdown to fill. That deletes the
 * entire mapping layer above: the response *is* an extraction in the shape
 * every other reader in this bench answers in, so `rowsFromOcrPage` is never
 * called for this arm and none of rules 1–13 or R1–R10 apply to it.
 *
 * Three consequences, all of them the point of running the arm:
 *
 *  - **The schema is derived, not written.** `annotationSchema()` reads
 *    `TOOL.input_schema` from @bw/extraction — the same object the deployed
 *    Anthropic reader is handed — so this arm cannot drift from what Sonnet,
 *    Haiku and Gemini are asked for. A hand-copied schema here would make a
 *    row-count difference unattributable.
 *  - **The prompt is the deployed one.** `document_annotation_prompt` carries
 *    `SYSTEM_EXTRACT_TEXT` verbatim, not a paraphrase, for the same reason.
 *    It is an imperfect fit and that has to be said: that prompt was written
 *    for `|`-joined rows numbered per line, and its closing sentence asks for
 *    a `row_index` that `TOOL.input_schema` does not even contain (the
 *    deployed text path swaps `source_snippet` for it in `TOOL_TEXT`). The
 *    alternative — writing a nicer Czech instruction for this arm alone —
 *    would make the comparison a comparison of prompts. So it goes as
 *    deployed, and what the model does with the mismatch is a finding.
 *  - **There is no mapping to blame.** For `mistral_ocr` an accuracy number is
 *    a measurement of this file's regexes. Here it is a measurement of
 *    `mistral-small-2603`, which is exactly the axis on which the external
 *    Haiku mapper lost 342 rows on photographs and collapsed 27 on digital
 *    pages (docs/lab-adaptability.md). `mergedRows()` in score.ts runs on this
 *    arm's output like any other — `scoreSingle` calls it for every arm, and a
 *    test below asserts it sees these rows.
 *
 * ## Pricing
 *
 * An annotated page is billed on the higher tier: **$0.005 per page**
 * ($5/1,000) against $0.004 for a plain OCR page. It stays per-page and stays
 * out of `PRICING` in extract.ts for the same reason `mistral_ocr` does, and
 * the dry-run estimate uses the higher figure.
 */
export const ANNOT_PAGE_PRICE_USD = 0.005;

/** The model Mistral runs over its own OCR output to fill the schema. */
export const ANNOT_MODEL = "mistral-small-2603";

/**
 * `TOOL.input_schema` as Mistral's `json_schema` response format.
 *
 * ONE shape conversion is made and it is the only one: a JSON-Schema nullable
 * written as a **type array** — `{"type": ["string", "null"]}`, which is how
 * the Anthropic tool spells the five header fields — is rewritten as
 * `{"anyOf": [{"type": "string"}, {"type": "null"}]}`. Both are legal JSON
 * Schema and mean the same thing; the `anyOf` form is what a Pydantic
 * `Optional[str]` emits, which is the form Mistral's own
 * `response_format_from_pydantic_model` helper (and the TS
 * `responseFormatFromZodObject`, via `toJsonSchema`) produces, so it is the
 * form the endpoint is known to accept. No property is added, renamed,
 * removed or re-described, and no `description` is translated — a Czech field
 * description is part of what the model is being asked, and rewriting it here
 * would silently make this a different question from the one every other arm
 * is asked.
 *
 * `strict: true` because the schema already satisfies what strict mode wants:
 * `additionalProperties: false` and every property listed in `required`, at
 * both levels.
 */
export function toAnnotationSchema(schema: unknown): Record<string, any> {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "type" && Array.isArray(v)) {
        // The one conversion. `enum` arrays and `required` arrays are values,
        // not types, and are copied through untouched by the branch above.
        out.anyOf = v.map((t) => ({ type: t }));
        continue;
      }
      out[k] = walk(v);
    }
    return out;
  };
  return walk(JSON.parse(JSON.stringify(schema)));
}

/** The `document_annotation_format` this arm sends. */
export function annotationFormat(): ResponseFormat {
  return {
    type: "json_schema",
    jsonSchema: {
      name: TOOL.name,
      description: TOOL.description,
      schemaDefinition: toAnnotationSchema(TOOL.input_schema),
      strict: true,
    },
  };
}

/**
 * `CallResult.raw` for the annotation arm.
 *
 * `RawAnswer` in extract.ts models a layout parse, which is not what came
 * back, so the annotation is carried as an extension of it rather than
 * squeezed into `markdown` or faked into `tables` — either of which would make
 * `remapFromRaw` read this arm's answer as though it were the other arm's.
 *
 * Both halves are stored. The annotation is the answer; the OCR page beside it
 * is free (the endpoint runs OCR either way and returns it) and it is the only
 * way to settle the question this arm exists to raise: when a row is missing
 * from the annotation, did Mistral's OCR fail to see it, or did
 * `mistral-small-2603` decline to copy it?
 */
export interface AnnotRawAnswer extends RawAnswer {
  /** `document_annotation`, exactly as the API returned it: a JSON string. */
  documentAnnotation?: string;
  /** Every shape repair `measurementsFromAnnotation` made. Empty is the norm. */
  annotationNotes?: string[];
}

/**
 * The annotation, normalised in SHAPE ONLY.
 *
 * The returned object is already our schema, so there is nothing to map. What
 * this does is refuse to trust that a model honoured a schema, and it says in
 * `notes` — which are stored in the file — every time it had to intervene:
 *
 *   - the payload is a JSON *string* (`OCRResponse.documentAnnotation`), so it
 *     is parsed; a parse failure is zero rows and a note, never a guess;
 *   - `measurements` must be an array, and each entry an object;
 *   - a field that is **missing or null** becomes `""` — the empty string the
 *     deployed prompt already asks for on an absent column — and is noted;
 *   - a field that came back as a **number or boolean** is stringified and
 *     noted. This is the one lossy repair possible here: JSON `5` cannot tell
 *     us whether the page printed `5`, `5,0` or `5.0`. The schema types every
 *     field as a string precisely so this should never fire, and if it does,
 *     the note is the evidence.
 *   - `confidence` is kept only if it is one of the three enum values.
 *
 * What is NOT done, deliberately: no trimming, no decimal-comma repair, no
 * unit or range rewriting, no dropping of a row that looks empty. The cell
 * text is copied byte for byte out of the JSON. A "tidying" step here is
 * exactly the failure this bench caught the external Haiku mapper committing,
 * and it would be invisible in the score.
 */
export interface Annotation {
  report_date: string | null;
  report_date_raw: string | null;
  lab_name: string | null;
  patient_name: string | null;
  patient_id: string | null;
  measurements: RawMeasurement[];
  notes: string[];
}

const TEXT_FIELDS = ["raw_analyte_name", "value_raw", "unit_raw", "ref_range_raw", "source_snippet"] as const;
const HEADER_FIELDS = ["report_date", "report_date_raw", "lab_name", "patient_name", "patient_id"] as const;
const CONFIDENCES = new Set(["high", "medium", "low"]);

export function measurementsFromAnnotation(payload: string | null | undefined): Annotation {
  const empty: Annotation = {
    report_date: null, report_date_raw: null, lab_name: null, patient_name: null, patient_id: null,
    measurements: [], notes: [],
  };
  if (!payload) return { ...empty, notes: ["document_annotation absent"] };
  let doc: any;
  try {
    doc = JSON.parse(payload);
  } catch (e: any) {
    return { ...empty, notes: [`document_annotation is not JSON: ${e?.message ?? e}`] };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ...empty, notes: ["document_annotation is not an object"] };
  }

  const notes: string[] = [];
  const out: Annotation = { ...empty, notes };
  for (const f of HEADER_FIELDS) {
    const v = doc[f];
    if (v === undefined) notes.push(`header field missing: ${f}`);
    out[f] = typeof v === "string" ? v : v === null || v === undefined ? null : (notes.push(`header field not a string: ${f}`), String(v));
  }

  if (!Array.isArray(doc.measurements)) {
    notes.push(doc.measurements === undefined ? "measurements missing" : "measurements is not an array");
    return out;
  }
  doc.measurements.forEach((row: any, i: number) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      notes.push(`measurements[${i}] is not an object`);
      return;
    }
    const m: RawMeasurement = {};
    for (const f of TEXT_FIELDS) {
      const v = row[f];
      if (typeof v === "string") m[f] = v;
      else if (v === undefined || v === null) {
        m[f] = "";
        notes.push(`measurements[${i}].${f} ${v === undefined ? "missing" : "null"} → ""`);
      } else {
        // Lossy, and said so: `5` cannot be told from `5,0`.
        m[f] = String(v);
        notes.push(`measurements[${i}].${f} was ${typeof v}, stringified`);
      }
    }
    if (typeof row.confidence === "string" && CONFIDENCES.has(row.confidence)) m.confidence = row.confidence;
    else if (row.confidence !== undefined) notes.push(`measurements[${i}].confidence not in enum: ${JSON.stringify(row.confidence)}`);
    out.measurements.push(m);
  });
  return out;
}

export type MistralInput =
  /** One rendered page, sent as an `image_url` data URI. */
  | { kind: "image"; base64: string; mediaType: string }
  /**
   * The same rendered page, asking for a `document_annotation` in our schema
   * instead of a layout parse to map. The $0.005 tier — see "annotations".
   */
  | { kind: "image_annot"; base64: string; mediaType: string }
  /** The original PDF, one page selected. `page` is 1-based, as corpora.ts counts. */
  | { kind: "pdf"; base64: string; page: number; name?: string };

/** Is this input asking for the annotation, rather than a parse to map? */
export function isAnnotated(input: MistralInput): boolean {
  return input.kind === "image_annot";
}

/** USD per page for this input — the annotations tier is the higher one. */
export function pagePriceUsd(input: MistralInput): number {
  return isAnnotated(input) ? ANNOT_PAGE_PRICE_USD : PAGE_PRICE_USD;
}

/* ----------------------------------------------------------------- request */

/** The full request, built without a client so a dry run can print it. */
export function mistralRequest(reader: Reader, input: MistralInput): OCRRequest {
  const document: OCRRequest["document"] =
    input.kind === "pdf"
      ? {
          type: "document_url",
          documentUrl: `data:application/pdf;base64,${input.base64}`,
          documentName: input.name ?? "page.pdf",
        }
      : { type: "image_url", imageUrl: `data:${input.mediaType};base64,${input.base64}` };

  return {
    model: reader.model,
    document,
    // Mistral counts pages from 0; corpora.ts counts from 1.
    ...(input.kind === "pdf" ? { pages: [input.page - 1] } : {}),
    includeImageBase64: false,
    tableFormat: "markdown",
    includeBlocks: true,
    confidenceScoresGranularity: "block",
    // The annotation arm, and only it. The schema is derived from
    // `TOOL.input_schema` and the prompt is `SYSTEM_EXTRACT_TEXT` verbatim —
    // "annotations", above, for why neither is written out here. The OCR
    // fields above are kept: the endpoint runs OCR either way, the markdown
    // and block confidences come back for free, and storing them beside the
    // annotation is what makes a missing row attributable.
    ...(isAnnotated(input)
      ? { documentAnnotationFormat: annotationFormat(), documentAnnotationPrompt: SYSTEM_EXTRACT_TEXT }
      : {}),
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
/**
 * R6/R7. A comparison operator printed in a cell of its own.
 *
 * The entity forms are markdown's encoding of the printed glyph, exactly as
 * `**5,00**` is markdown's encoding of printed boldness (R2) — `&lt;` was
 * never a character on the page, so decoding it is not "tidying a value".
 */
export const OPERATOR_CELL = /^(?:<=?|>=?|≤|≥|&lt;=?|&gt;=?|&le;|&ge;)$/;

/**
 * The operator this cell prints, spelled the way lab-core reads it, or null.
 *
 * `UPPER_BOUND`/`LOWER_BOUND` in packages/lab-core/src/normalize.ts accept
 * `<`, `≤`, `>`, `≥` — and nothing else, so `<=` must fold to `≤` or
 * `parseRange` would take the `=` as the start of the number and give up.
 */
export function operatorOf(cell: string | undefined): string | null {
  const t = (cell ?? "").trim();
  if (!OPERATOR_CELL.test(t)) return null;
  switch (t) {
    case "<":
    case "&lt;":
      return "<";
    case ">":
    case "&gt;":
      return ">";
    case "<=":
    case "&lt;=":
    case "≤":
    case "&le;":
      return "≤";
    default:
      return "≥";
  }
}

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

/**
 * The one form the deployed prompt asks Claude for: `0,17 - 0,78`.
 *
 * R6: when the middle cell holds a comparison operator rather than a dash the
 * interval is one-sided, and the operator belongs to the bound after it —
 * `| | < | 2,85 |` is `< 2,85`, the spelling `parseRange` and the accepted
 * reports both use. A low bound *and* an operator is a contradiction no sheet
 * prints; the two bounds win there, because inventing a one-sided interval
 * out of a two-sided one would throw a number away.
 */
export function joinRange(low: string, high: string, sep?: string): string {
  const a = (low ?? "").trim();
  const b = (high ?? "").trim();
  const op = operatorOf(sep);
  if (op && !a) return b ? `${op} ${b}` : "";
  // R10: the separator or the operator printed against the bound itself.
  const glued = GLUED_OP_BOUND.exec(b);
  if (glued) return a ? `${a} - ${glued[2]}` : `${operatorOf(glued[1])} ${glued[2]}`;
  const dashed = GLUED_SEP_BOUND.exec(b);
  if (dashed) return a ? `${a} - ${dashed[1]}` : "";
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
 *     majority of rows, the layout `19_06_12.pdf` prints. R6: the same three
 *     columns read `(blank) | < | bound` where the interval is one-sided, on
 *     the same page and in the same columns — `19_06_12.pdf` prints both, six
 *     rows of the second kind among thirty-four of the first.
 *
 * A bare pair of adjacent numeric columns with neither a separator nor a
 * header is deliberately NOT a group: `value | bound` and `bound | bound` are
 * indistinguishable from the cells alone, and guessing there would invent the
 * very failure this fixes. Nor is `(blank) | - | bound`: a dash with nothing
 * on its left is not an interval, and reading one there would be the same
 * guess.
 */

/** One printed row of a three-cell split interval: `4,00 | - | 10,00`, ` | < | 2,85`. */
function isSplitRangeRow(low: string, mid: string, high: string): boolean {
  if (!BOUND_CELL.test(high)) return false;
  if (BOUND_CELL.test(low) && SEPARATOR_CELL.test(mid)) return true;
  return low === "" && operatorOf(mid) !== null;
}

/**
 * R10. The same interval, split across **two** cells rather than three,
 * because the separator or the operator was printed against the bound:
 *
 *     |  HDL-cholesterol | **1,51** | mmol/l | 1,00 | - 2,10 | (X)  |
 *     |  Cholesterol celkový | **3,92** | mmol/l |  | < 5,20 | (X)  |
 *
 * Neither cell is an interval on its own and there is no separator cell, so
 * both R1 and R6 saw nothing and `ref_range_raw` came back empty — the whole
 * reference column of `19_06_12.pdf` p2 and `19_10_31.pdf` p1, 38 rows on the
 * born-digital class alone. The dash form requires the space: `-10,0` is a
 * negative bound and `BOUND_CELL` already reads it as one, while `- 10,0`
 * cannot be anything but a separator and a bound. The operator form needs no
 * space, since no bound starts with `<`.
 */
const GLUED_SEP_BOUND = /^(?:-|–|—|až|az)\s+(-?\d+(?:[.,]\d+)?)$/i;
const GLUED_OP_BOUND = /^(<=?|>=?|≤|≥|&lt;=?|&gt;=?|&le;|&ge;)\s*(-?\d+(?:[.,]\d+)?)$/;

/** One printed row of a two-cell split interval. */
function isGluedRangeRow(low: string, high: string): boolean {
  const op = GLUED_OP_BOUND.exec(high);
  if (op) return low === "";
  return BOUND_CELL.test(low) && GLUED_SEP_BOUND.test(high);
}
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
    const hits = seen.filter((r) =>
      isSplitRangeRow((r[i] ?? "").trim(), (r[i + 1] ?? "").trim(), (r[i + 2] ?? "").trim()),
    ).length;
    const s = hits / seen.length;
    if (s > bestShare) {
      best = { low: i, sep: i + 1, high: i + 2 };
      bestShare = s;
    }
  }
  if (best) return best;
  // R10, only once the three-cell form has found nothing: the two-cell form
  // carries strictly more evidence per row (the separator is *in* the cell),
  // but it is also a narrower window, so the wider layout gets first refusal.
  bestShare = 0.5;
  for (let i = 0; i + 1 < width; i++) {
    const seen = rows.filter((r) => [i, i + 1].some((k) => (r[k] ?? "").trim() !== ""));
    if (!seen.length) continue;
    const hits = seen.filter((r) => isGluedRangeRow((r[i] ?? "").trim(), (r[i + 1] ?? "").trim())).length;
    const s = hits / seen.length;
    if (s > bestShare) {
      best = { low: i, sep: null, high: i + 1 };
      bestShare = s;
    }
  }
  return best;
}

/* ------------------------------- rule 8: a row wider than its own header */

/** Nothing, or nothing but evaluation decoration. Never a value, unit or bound. */
const isBlankOrMarker = (c: string) => {
  const t = (c ?? "").trim();
  return t === "" || MARKER_CELL.test(t);
};

/**
 * R8. Put a row that came back wider than its header back on the header's grid.
 *
 * A `Hodnocení` column printed as a graphical scale comes back as several
 * cells — `| | * | |`, `| | | * | |` — and every column after it is then read
 * one or two places to the left of where the header put it. The signal is
 * unambiguous: markdown has no ragged table, so a row wider than its own
 * header is a column that was split, never a column the row gained.
 *
 * The leftmost run of two or more adjacent blank-or-marker cells collapses to
 * one, keeping whatever the run held (`| | * | |` → `*`), and only as far as
 * the excess width requires; then the next run, until the row fits. A row with
 * no such run is left exactly as it came, because there is nothing here that
 * could tell which of its cells to fuse.
 */
export function collapseMarkerRuns(row: string[], width: number): string[] {
  let out = row.slice();
  let i = 0;
  while (out.length > width && i < out.length) {
    if (!isBlankOrMarker(out[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < out.length && isBlankOrMarker(out[j + 1])) j++;
    const run = j - i + 1;
    if (run < 2) {
      i = j + 1;
      continue;
    }
    const drop = Math.min(run - 1, out.length - width);
    const kept = out.slice(i, j + 1).map((c) => c.trim()).filter((c) => c !== "");
    const merged = [kept.join(" "), ...Array(run - drop - 1).fill("")];
    out = [...out.slice(0, i), ...merged, ...out.slice(j + 1)];
    i += merged.length;
  }
  return out;
}

/* ------------------------------ rule 7: an operator standing before a value */

/**
 * R7. The column that censors the value, when a sheet prints one.
 *
 * `| CRP | < | 5,0 | mg/l |` is a result below the assay floor, and the `<`
 * must reach `value_raw` or `censoredLostMarker` in score.ts is looking at a
 * number the lab never printed. Only the column immediately left of the value
 * qualifies, it must not already be spoken for (name, unit, range, or any cell
 * of the split-interval group R1/R6 claimed), and a simple majority of its
 * non-empty cells must be operators — the same majority every other rule here
 * uses.
 */
function valueOperatorColumn(
  body: string[][],
  cols: Partial<Record<Field, number>>,
  group: RangeGroup | null,
): number | null {
  const v = cols.value;
  if (v === undefined || v <= 0) return null;
  const j = v - 1;
  if (j === cols.name || j === cols.unit || j === cols.range) return null;
  if (group && (j === group.low || j === group.sep || j === group.high)) return null;
  return shareOf(body, j, (c) => operatorOf(c) !== null) > 0.5 ? j : null;
}

/* ---------------------------------------------------------- the column map */

interface ColumnMapping {
  cols: Partial<Record<Field, number>>;
  /** Set when the interval is printed across two columns (rule 1). */
  group: RangeGroup | null;
  /** True when row 0 was consumed as a header. */
  hasHeader: boolean;
  /**
   * The column the name was elected from before R9 moved it right, and the
   * fallback for the odd row that prints its name there anyway: `Moč
   * chemicky` gives `| 81347 | pH | | 5,5 | …` where its neighbours give
   * `| | | Bilkovina | negat. | …`. Only consulted where the name column
   * itself yields nothing, so it can never override a name that is there.
   */
  nameFallback?: number;
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
  // R9. A share computed over one cell is not a majority of anything.
  //
  // `shareOf` counts only the non-empty cells, so a column that is blank in
  // every data row and carries nothing but its own header label scores 1.0 and
  // wins whatever role it is tested for. On the `A | Výkon | Název metody | …`
  // layout that made the empty `Výkon` column the name, which left the real
  // name column free — and `isUnitCell` then claimed it, so `MCV` came back as
  // the unit of MCV. A column must be non-empty on at least two rows (or on
  // every row there is, for a table too short for that to mean anything)
  // before it can be elected to anything.
  const support = Math.min(2, rows.length);
  const seenIn = (i: number) => rows.filter((r) => (r[i] ?? "").trim() !== "").length;
  const elect = (pred: (s: string) => boolean) => (i: number) =>
    !taken.has(i) && seenIn(i) >= support && shareOf(rows, i, pred) > 0.5;
  const leftmost = (pred: (s: string) => boolean) => idx.find(elect(pred)) ?? -1;

  let name = leftmost(isNameCell);
  // `Zkr.` without a header: an all-caps code column reads as words, but the
  // name is the column after it. candidates.ts drops the same cell for the
  // text path.
  if (name >= 0 && shareOf(rows, name, (c) => ABBREVIATION.test(c)) > 0.5) {
    const next = idx.find((i) => i > name && elect(isNameCell)(i));
    if (next !== undefined) {
      taken.add(name);
      dropped.push("abbreviation column");
      name = next;
    }
  }
  let nameFallback: number | undefined;
  // R9, second half: the name column is where the names actually are.
  //
  // `nameAt` walks up to three cells past the column it is given, so a mostly
  // empty LIS column (`A | Výkon | Název metody | …`, `Výkon` holding one `pH`
  // in twenty rows) can be elected the name and still produce the right names
  // — while leaving the *real* name column unclaimed for `isUnitCell` to take,
  // which is how `Neutrofily` came back as the unit of Neutrofily. So ask
  // where the walk lands: when a majority of rows resolve their name from one
  // later column, that column is the name.
  if (name >= 0) {
    const landed = rows.map((r) => nameIndexAt(r, name)).filter((k) => k >= 0);
    const tally = new Map<number, number>();
    for (const k of landed) tally.set(k, (tally.get(k) ?? 0) + 1);
    for (const [k, n] of tally) {
      if (k > name && !taken.has(k) && n / landed.length > 0.5) {
        taken.add(name);
        dropped.push("LIS code column standing before the name");
        nameFallback = name;
        name = k;
        break;
      }
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
  //
  // A printed date reads as numeric (`01.07.2022`) and is never a result —
  // `nameAt` already refuses one for the same reason. Without this the
  // signature block `Výsledky uvolnil : | 01.07.2022 | Číslo vzorku: | …`
  // elects its date column as the value and the footer is mapped as a results
  // table.
  const numeric = idx.filter(elect((c) => isNumericCell(c) && !DATE_CELL.test(c.trim())));
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
  return { cols, group, hasHeader: false, droppedColumns: dropped, nameFallback };
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
  const k = nameIndexAt(cells, start);
  return k < 0 ? "" : (cells[k] ?? "").trim();
}

/** Which cell `nameAt` takes the name from, or -1. R9 asks this per row. */
export function nameIndexAt(cells: string[], start: number | undefined): number {
  if (start === undefined || start < 0) return -1;
  for (let k = start; k < Math.min(cells.length, start + 3); k++) {
    const c = (cells[k] ?? "").trim();
    if (!c || MARKER_CELL.test(c)) continue;
    if (LETTERS2.test(c) && !isNumericCell(c) && !DATE_CELL.test(c)) return k;
    if (!FLAG_CELL.test(c) && !LAB_CODE.test(c)) return -1;
  }
  return -1;
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
  let body: string[][];
  // Rule 3 of the file header: the header is accepted only if it names both a
  // name and a value column. Otherwise row 0 is data and the shape decides.
  if (map.cols.name !== undefined && map.cols.value !== undefined) {
    // R8 first, and only here: the header is what says how wide a row should
    // be, so a header we did not accept gives nothing to realign against.
    const width = cells[0].length;
    let realigned = 0;
    body = cells.slice(1).map((row) => {
      if (row.length <= width) return row;
      const fitted = collapseMarkerRuns(row, width);
      if (fitted.length !== row.length) realigned++;
      return fitted;
    });
    if (realigned) {
      map.droppedColumns.push(`evaluation scale split across cells — ${realigned} row(s) realigned to the header`);
    }
    // A header that names a whole range column keeps it — unless the interval
    // it names starts there and spills into the columns beside it, which is
    // the same split range with a label over its left half.
    const group = findRangeGroup(body, cells[0]);
    if (group && (map.cols.range === undefined || map.cols.range === group.low)) {
      map.group = group;
      map.cols.range = undefined;
      map.droppedColumns.push("reference interval printed across separate columns — joined");
    }
  } else {
    map = fromShape(cells, emph, findRangeGroup(cells, null));
    body = cells;
  }
  const { cols, group } = map;
  // Rule 7.
  if (cols.name === undefined || cols.value === undefined) {
    return { rows: [], droppedColumns: map.droppedColumns, skipped: "no name/value column" };
  }
  // R7: the censor column, if this sheet prints one.
  const opCol = valueOperatorColumn(body, cols, group);
  if (opCol !== null) map.droppedColumns.push("censor operator column — joined onto the value");

  const need = Math.max(cols.name, cols.value, cols.unit ?? -1, cols.range ?? -1, group?.high ?? -1);
  const conf = blockConfidence ?? null;
  const out: RawMeasurement[] = [];
  for (const row of body) {
    const cell = (i: number | undefined) => (i === undefined || i < 0 || i >= row.length ? "" : row[i]);
    const name = nameAt(row, cols.name) || nameAt(row, map.nameFallback);
    const printed = cell(cols.value);
    // Rule 8, plus rule 5: a marker is not a value.
    if (!name || !printed || isNumericCell(name) || MARKER_CELL.test(printed)) continue;
    // R7: `| < | 1,0 |` is one censored value, spelled as the accepted
    // reports spell it — no space between the censor and the number.
    const censor = opCol === null ? null : operatorOf(cell(opCol));
    const value = censor ? `${censor}${printed}` : printed;
    const ragged = row.length <= need;
    const shaky = conf !== null && conf < CONF_LOW;
    out.push({
      raw_analyte_name: name,
      value_raw: value,
      unit_raw: cell(cols.unit),
      // Rule 1: `4,00 | - | 10,00` is one field, in the form the deployed
      // prompt asks for. R6: `| < | 2,85` is the same field, one-sided.
      ref_range_raw: group ? joinRange(cell(group.low), cell(group.high), cell(group.sep ?? undefined)) : cell(cols.range),
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
  // The annotation arm first, and before the markdown test: its record carries
  // the OCR page too, and re-running `rowsFromOcrPage` on that would silently
  // re-judge `mistral_annot` as though it were `mistral_ocr`. There is no
  // mapping to re-run here — only the shape normalisation, which is re-applied
  // so that a change to it is judged the same way a mapping change is.
  const annot = (raw as AnnotRawAnswer).documentAnnotation;
  if (annot) return measurementsFromAnnotation(annot).measurements;
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

/**
 * One annotated round trip, turned into a `CallResult`.
 *
 * The annotation is the extraction — no `rowsFromOcrPage`, no `RawMeasurement`
 * built by this file. The five header fields are reported as the model
 * returned them rather than nulled the way rule 11 nulls them for the parse
 * arm: this arm really was asked for them, and only `measurements` is scored
 * either way.
 *
 * `raw` carries both halves (`AnnotRawAnswer`): the annotation string as sent,
 * and the OCR page the annotation was made from.
 */
function annotatedAttempt(reader: Reader, res: OCRResponse, page: OCRPageObject | undefined, ms: number, costUsd: number): Attempt {
  const annot = measurementsFromAnnotation(res.documentAnnotation);
  const truncated: string[] = [];
  const raw: AnnotRawAnswer = {
    ...(page ? rawAnswerFor(page) : { provider: "mistral" as const }),
    documentAnnotation: truncateRawField(res.documentAnnotation ?? "", "documentAnnotation", truncated),
  };
  if (annot.notes.length) raw.annotationNotes = annot.notes;
  if (truncated.length) raw.truncated = [...(raw.truncated ?? []), ...truncated];
  if (annot.notes.length) console.log(`   mistral annotation shape repairs (${annot.notes.length}): ${annot.notes.slice(0, 5).join("; ")}`);
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
        report_date: annot.report_date,
        report_date_raw: annot.report_date_raw,
        lab_name: annot.lab_name,
        patient_name: annot.patient_name,
        patient_id: annot.patient_id,
        measurements: annot.measurements as any,
        usage: EMPTY,
        model: reader.model,
      },
      raw,
      error: null,
    },
  };
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
    const annotated = !!request.documentAnnotationFormat;
    const costUsd = pages * (annotated ? ANNOT_PAGE_PRICE_USD : PAGE_PRICE_USD);
    const page = res.pages[0];
    if (!page && !(annotated && res.documentAnnotation)) {
      const call: CallResult = { ok: false, model: reader.model, ms, usage: EMPTY, costUsd, thought: false, extraction: null, error: "OCR returned no pages" };
      return { ok: false, rateLimited: false, raw: null, call };
    }
    if (annotated) return annotatedAttempt(reader, res, page, ms, costUsd);
    const mapped = rowsFromOcrPage(page!);
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
        raw: rawAnswerFor(page!),
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
