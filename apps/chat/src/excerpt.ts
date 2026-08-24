/**
 * Where a document excerpt starts reading, and how its lines are laid out.
 *
 * The registry ships a document citation as the document from offset 0, clipped
 * to a fixed length. For every generated report in this demo that means the
 * first five lines are the practice's letterhead, the department, the title the
 * card already carries in bold, and the header fields — after which the clamp
 * has run out and the finding the answer actually cited never appears. The card
 * proved *which document*; it never showed the passage.
 *
 * So this decides where to start. Two rules bound it, and neither is negotiable:
 *
 * - **The words are the server's.** Nothing here alters, reorders or
 *   paraphrases them. It collapses the whitespace the PDF extractor left behind
 *   and it chooses an offset to start at. That is all.
 * - **No invented highlight.** A document citation carries no character offsets,
 *   so the cited span cannot be located inside the excerpt. There is therefore
 *   no ring on an excerpt — only the clamp. Ringing a guess would be worse than
 *   ringing nothing.
 *
 * Lives in its own module, away from React, so the rules below can be run
 * against the real fixture excerpts in `apps/chat/tests/excerpt.test.ts`.
 */

/**
 * Every pattern below is matched against `fold`, never against the raw line.
 *
 * `\b` is an ASCII word boundary, and Czech is not ASCII: /\boddělení\b/ never
 * matches „Oddělení funkční diagnostiky", because the position after „í" is not
 * a boundary at all — `í` is not a word character, so the regex sees the word
 * ending at „odd". Folding the diacritics away first is what makes a word test
 * on this language mean what it reads as.
 */
export const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The practice's own name, at the top of every sheet it prints.
 *
 * Anchored to the end, and to a legal-form suffix, so it recognises a
 * letterhead rather than any line that happens to mention the clinic.
 */
const ORG = /(^| )(s r o|a s|spol s r o|v o s|k s)$/;

/** The department line under it — a place, not a finding. */
const UNIT =
  /\b(pracoviste|oddeleni|ambulance|laborator|laboratore|klinika|centrum|ordinace|sal)\b/;

/** Header fields: who the document is about, when, and who wrote it. */
const META =
  /^(pacient|pacientka|datum [a-z ]{0,26}|rodne cislo|pojistovna|zdravotni pojistovna|popsal|popsala|operater|operaterka|terapeut|terapeutka|vysetril|vysetrila|vyhodnotil|vyhodnotila|provedl|provedla|odesilajici lekar|lekar|lekarka)$/;

/** The key half of „Klíč: hodnota", or the whole line when there is no colon. */
const key = (line: string): string => {
  const colon = line.indexOf(":");
  return fold(colon === -1 ? line : line.slice(0, colon));
};

/** A header field — „Pacient: Michal Novák", „Datum vyšetření: 20.9.2024". */
const isMeta = (line: string): boolean => line.includes(":") && META.test(key(line));

/**
 * The excerpt's lines, laid out as the document reads.
 *
 * The only edit is to whitespace: runs of spaces collapse, and a header's key
 * is rejoined to its value. „Pacient:" and „Michal Novák" arrive as two lines
 * because of where the PDF's text ran out, not because the document has them on
 * two lines — hard-wrapped that way, five header fields read as ten lines of
 * nothing and swallow the whole clamp.
 */
export function excerptLines(excerpt: string): string[] {
  const raw = excerpt
    .split("\n")
    .map((l) => l.replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].endsWith(":") && i + 1 < raw.length && !raw[i + 1].endsWith(":")) {
      out.push(`${raw[i]} ${raw[i + 1]}`);
      i++;
    } else out.push(raw[i]);
  }
  return out;
}

/** Boilerplate: the letterhead, the department, the card's own title, a field. */
export function isBoilerplate(line: string, label: string): boolean {
  const flat = fold(line);
  if (ORG.test(flat)) return true;
  if (flat === fold(label)) return true;
  if (isMeta(line)) return true;
  return !line.includes(":") && UNIT.test(flat);
}

/**
 * The index of the first line worth reading.
 *
 * The cited span cannot be located inside a document excerpt — no offsets are
 * shipped for one — so this clamps to the first clinically substantive line
 * instead, which is the honest approximation and never a fabricated one.
 */
export function excerptStart(lines: string[], label: string): number {
  const first = lines.findIndex((l) => !isBoilerplate(l, label));
  if (first !== -1) return first;
  // Nothing but the header fits inside the clip. Then the fields themselves are
  // the evidence — they say whose document this is and when — and only the
  // letterhead, the department and the repeated title are dropped.
  const meta = lines.findIndex(isMeta);
  return meta === -1 ? 0 : meta;
}
