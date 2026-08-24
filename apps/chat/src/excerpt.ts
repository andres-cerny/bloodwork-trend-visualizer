/**
 * Where a document quote should start.
 *
 * The `sources` event carries one fixed-length excerpt taken from the top of
 * the document. Every sheet in this corpus opens the same way — the practice,
 * the department, the document's own title, then four or five identity labels
 * — so eight cards in a rail quoted eight identical letterheads, and the
 * finding the `[n]` was put beside was never among the words on this side of
 * the wire.
 *
 * That last part cannot be fixed here and must not be faked here: the cited
 * sentence is frequently not in the payload at all, and an evidence panel that
 * invents the sentence it is evidence for has stopped being one. What *can* be
 * fixed is spending the whole card on the stationery.
 *
 * So this function only ever decides **where to begin**. What it returns is a
 * contiguous run of the excerpt's own lines, ending where the excerpt ends,
 * with the original line breaks intact. No word is altered, reordered,
 * paraphrased, joined or dropped from the middle. A „…" is set where a head
 * was skipped and where the excerpt itself was cut mid-sentence, because a
 * quote that silently starts and stops in the middle reads as the app's error
 * rather than as the paper's.
 *
 * On regexes: JavaScript's `\b` is ASCII-only, so `\bústav\b` can never match
 * — the boundary before „ú" needs an ASCII word character on one side. Every
 * test below is therefore either anchored, or done on tokens split with a
 * Unicode-aware class. The cases are pinned in tests/excerpt.test.ts against
 * the corpus's real strings.
 */

/** The letterhead's legal form, which is what makes the line a practice. */
const ORG = /(?:s\.\s?r\.\s?o\.|a\.\s?s\.|v\.\s?o\.\s?s\.|z\.\s?ú\.|o\.\s?p\.\s?s\.)\s*$/i;

/** „Radiodiagnostické pracoviště", „Ortopedické oddělení — operační sál". */
const FACILITY = new Set([
  "pracoviště",
  "oddělení",
  "ambulance",
  "laboratoř",
  "laboratoře",
  "klinika",
  "poliklinika",
  "centrum",
  "ústav",
  "nemocnice",
  "ordinace",
  "sál",
  "stanice",
]);

/**
 * The label heads that identify a person, a machine or a date rather than a
 * finding. „Diagnóza:", „Závěr:", „Nález:", „RA:" are absent on purpose —
 * reaching those lines is the entire point of the walk.
 */
const ADMIN = new Set([
  "pacient",
  "pacientka",
  "jméno",
  "příjmení",
  "rodné číslo",
  "rč",
  "pojišťovna",
  "zdravotní pojišťovna",
  "id",
  "identifikace",
  "věk",
  "pohlaví",
  "výška",
  "hmotnost",
  "váha",
  "adresa",
  "bydliště",
  "telefon",
  "kód",
  "technika",
  "přístroj",
  "protokol",
  "číslo protokolu",
  "oddělení",
  "pracoviště",
  "operatér",
  "operatérka",
  "asistence",
  "anesteziolog",
  "sestra",
  "terapeut",
  "terapeutka",
  "lékař",
  "lékařka",
  "odesílající lékař",
  "ošetřující lékař",
  "indikující lékař",
  "popsal",
  "popsala",
  "vyšetřil",
  "vyšetřila",
  "vyhodnotil",
  "vyhodnotila",
  "zpracoval",
  "zpracovala",
  "provedl",
  "provedla",
]);

const norm = (s: string) => s.replace(/\s+/gu, " ").trim().toLowerCase();
const tokens = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The label a line opens with, if it opens with one. */
function labelOf(line: string): string | null {
  const m = /^([^:]{1,42}):/u.exec(line.trim());
  return m ? norm(m[1]) : null;
}

function isAdminLabel(line: string): boolean {
  const label = labelOf(line);
  if (label === null) return false;
  // „Datum narození", „Datum vyšetření", „Datum výkonu", „Datum terapie",
  // „Datum protokolu" — one rule, because the tail of the label is open-ended.
  return ADMIN.has(label) || label === "datum" || label.startsWith("datum ");
}

/** How much of the tail stands in when the excerpt is stationery end to end. */
const TAIL_LINES = 2;

/**
 * Is this line part of the sheet's head rather than of its content?
 *
 * `afterOpenLabel` carries the one piece of context a single line cannot hold:
 * the extractor flattens a two-column header into one line per cell, so
 * „Pacient:" and „Michal Novák" arrive as two lines and the name is only
 * stationery because of what stands above it.
 */
function isHead(line: string, title: string | undefined, afterOpenLabel: boolean): boolean {
  const t = line.trim();
  if (!t) return true;
  // The document's own title — the card carries it as a heading two rows up.
  if (title && norm(t) === norm(title)) return true;
  if (ORG.test(t)) return true;
  const words = tokens(t);
  if (words.length <= 5 && words.some((w) => FACILITY.has(w))) return true;
  if (isAdminLabel(t)) return true;
  // The value belonging to the label on the line above.
  if (afterOpenLabel && !t.includes(":")) return true;
  // A bare section heading — „Anamnéza", „Provedené vyšetření". Short, no
  // colon, no digit, no sentence end: it announces content instead of being
  // content, and the content is the line under it.
  if (words.length <= 3 && !/[:.!?…]/u.test(t) && !/\d/u.test(t)) return true;
  return false;
}

/** A head line that is a label with nothing after the colon, so its value is next. */
const opensLabel = (line: string) => /:\s*$/u.test(line.trim());

/**
 * The excerpt, opened at its first substantive line.
 *
 * When every line is stationery — and for three documents in this corpus every
 * line genuinely is, because the excerpt stops before the sheet's first
 * clinical sentence — the tail stands in for the head. Neither end proves the
 * citation; the tail is at least the end nearest the text that follows, and
 * three different last lines beat three identical letterheads.
 */
export function openExcerpt(text: string, title?: string): string {
  const lines = text.replace(/\s+$/u, "").split("\n");
  let from = -1;
  let afterOpenLabel = false;
  for (let i = 0; i < lines.length; i++) {
    if (!isHead(lines[i], title, afterOpenLabel)) {
      from = i;
      break;
    }
    afterOpenLabel = opensLabel(lines[i]);
  }
  const start = from >= 0 ? from : Math.max(0, lines.length - TAIL_LINES);
  const body = lines
    .slice(start)
    .join("\n")
    .replace(/\s+$/u, "");
  // Nothing at all stays nothing: an ellipsis on its own is a card claiming
  // there is a quote here.
  if (!body) return "";
  // A cut mid-word („…subakromiální imping") is the registry's fixed length,
  // not a typo; a line left open on its colon is already saying it continues.
  const tail = /[.!?…:]$/u.test(body) ? "" : "…";
  return `${start > 0 ? "…" : ""}${body}${tail}`;
}
