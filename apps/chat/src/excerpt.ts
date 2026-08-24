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
 * And one thing it will not show at any price: the internal patient ref. „ID:
 * p-hruby-1994" is the key this demo's own database is written on, it says
 * nothing about the citation, and a screen in a consulting room is the last
 * place it belongs. The clamp skips identification blocks by name, and
 * `excerptStart` then refuses to hand back an offset from which one could still
 * be read — see `hasInternalRef`.
 *
 * When the clip holds nothing but identification, the answer is no excerpt at
 * all: the card keeps its title, its date and its „Celá strana dokumentu", and
 * says nothing it cannot back. Four lines of „Pacient / Datum narození /
 * Operatér" prove which patient, never which passage. „Provedené vyšetření /
 * Technika:" is the same emptiness one line further in — a field named and a
 * value the clip never reached — and gets the same answer.
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

/**
 * Header fields: who the document is about, when, and who wrote it.
 *
 * The identity half of this list is what the second pass added — „ID", „Věk",
 * „Pohlaví" and the rest. They are key/value lines like „Technika:" is, and the
 * difference is not their shape but what they are about: one describes the
 * examination and belongs in an excerpt, the other describes the patient and is
 * already on the chip at the top of the screen.
 */
const META =
  /^(pacient|pacientka|jmeno|prijmeni|id|identifikace|vek|pohlavi|adresa|bydliste|telefon|e mail|datum [a-z ]{0,26}|rodne cislo|cislo pojistence|pojistenec|pojistovna|zdravotni pojistovna|popsal|popsala|operater|operaterka|terapeut|terapeutka|vysetril|vysetrila|vyhodnotil|vyhodnotila|provedl|provedla|odesilajici lekar|lekar|lekarka)$/;

/**
 * The heading a printed form puts above a block of those fields.
 *
 * On its own „Identifikace" is just a word, and a word with no colon is what
 * this module otherwise treats as prose — which is how the training-zones card
 * came to open on „Identifikace / ID: p-hruby-1994". It counts as boilerplate
 * only when the line under it is a header field, so a document that happens to
 * head a clinical section with one of these words keeps it.
 */
const IDENT_HEAD = /^(identifikace|identifikacni udaje|udaje o pacientovi|osobni udaje|zakladni udaje)$/;

/** The key half of „Klíč: hodnota", or the whole line when there is no colon. */
const key = (line: string): string => {
  const colon = line.indexOf(":");
  return fold(colon === -1 ? line : line.slice(0, colon));
};

/** A header field — „Pacient: Michal Novák", „Datum vyšetření: 20.9.2024". */
const isMeta = (line: string): boolean => line.includes(":") && META.test(key(line));

/**
 * A key whose value never arrived: „Technika:" — the clip ended at the colon.
 *
 * `excerptLines` has already rejoined every key the extractor split from its
 * value, so a line still ending at its colon here is one whose value is not in
 * the excerpt at all. It names a field and says nothing, which is the one thing
 * an excerpt must not do: „Technika:" on the MR card promised the technique and
 * delivered a colon.
 */
const isElidedKey = (line: string): boolean => line.endsWith(":");

/**
 * The section title standing over one of those, with nothing else beneath it.
 *
 * „Provedené vyšetření / Technika:" is a named section whose body did not
 * survive the clip. The title alone is no more a passage than the key is —
 * same argument as `IDENT_HEAD` above, and the same shape: a heading is judged
 * by the line under it.
 *
 * Deliberately narrow, because the cost of being wrong is a clinical finding
 * clamped away. A title, not a sentence: at most two words and no punctuation
 * of its own. „Kloub je stabilní" above a clipped „Doporučení:" is three words
 * and stays; a two-word heading that stays when it should have gone costs the
 * reader one line of nothing.
 */
const isEmptySectionHead = (line: string, next?: string): boolean =>
  next !== undefined &&
  isElidedKey(next) &&
  !line.includes(":") &&
  !/[.,;!?]/.test(line) &&
  line.split(/\s+/).length <= 2;

/**
 * The internal patient ref — „p-hruby-1994" — as the demo's database writes it.
 *
 * `\b` cannot be used here for the reason the whole module folds first: it is
 * an ASCII boundary and these lines are Czech. The alternation consumes the
 * preceding character instead, which is all a `test` needs, and `\p{L}`/`\p{N}`
 * make „skupina p-1" a ref while „stop-loss" — where the p is the tail of a
 * word rather than the start of a key — is not one.
 *
 * Deliberately blunt at the other end: it will also clamp away a sentence about
 * a „p-hodnota". Losing a passage costs the reader a scroll; printing a
 * patient's database key costs something that cannot be taken back.
 */
const INTERNAL_REF = /(?:^|[^\p{L}\p{N}])p-[a-z0-9]+(?:-[a-z0-9]+)*/u;

/**
 * Does this line carry an internal ref? The last gate before anything renders.
 *
 * Deliberately independent of the classification above: a header field this
 * module failed to recognise is a bug, and a leaked patient key is an incident.
 * The two must not share a failure mode.
 */
export const hasInternalRef = (line: string): boolean => INTERNAL_REF.test(line);

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

/**
 * Boilerplate: the letterhead, the department, the card's own title, a field,
 * a key the clip cut off at its colon, or the heading that opens a block of
 * either.
 *
 * `next` is the line below, and only the last two rules read it.
 */
export function isBoilerplate(line: string, label: string, next?: string): boolean {
  const flat = fold(line);
  if (ORG.test(flat)) return true;
  if (flat === fold(label)) return true;
  if (isMeta(line)) return true;
  if (isElidedKey(line)) return true;
  if (!line.includes(":") && UNIT.test(flat)) return true;
  if (isEmptySectionHead(line, next)) return true;
  return !line.includes(":") && IDENT_HEAD.test(flat) && next !== undefined && isMeta(next);
}

/**
 * The index of the first line worth reading — `lines.length` if there is none.
 *
 * The cited span cannot be located inside a document excerpt — no offsets are
 * shipped for one — so this clamps to the first clinically substantive line
 * instead, which is the honest approximation and never a fabricated one. Where
 * the clip ran out before the document said anything, the honest answer is the
 * empty one, and `Excerpt` renders nothing.
 */
export function excerptStart(lines: string[], label: string): number {
  const first = lines.findIndex((l, i) => !isBoilerplate(l, label, lines[i + 1]));
  let start = first === -1 ? lines.length : first;
  // The hard gate. Whatever the rules above concluded, an internal ref does not
  // render: the clamp moves past the line carrying it, and past every later one
  // that carries another. Advancing — never deleting — because the words that
  // do show must stay the server's, in the server's order, unbroken.
  for (let i = start; i < lines.length; i++) if (hasInternalRef(lines[i])) start = i + 1;
  return start;
}
