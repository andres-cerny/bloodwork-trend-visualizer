/**
 * What each tool step says it did, in Czech that agrees with its own number.
 *
 * These strings are not logging. The chat client renders `ToolResult.summary`
 * verbatim into the steps disclosure, and once a step has finished the summary
 * replaces the tool's label entirely — so each phrase has to stand alone and
 * read as Czech to the doctor looking at it. The model never sees them: the
 * loop hands it `content`, so this file is reader-facing copy and nothing else.
 *
 * Czech takes three forms by count — 1, 2–4, and 5+ (and 0 goes with 5+) — and
 * every phrase here got exactly one of them, the genitive plural, which is
 * right for "7 pacientů" and wrong for both "1 pacientů" and "2 pacientů". The
 * picker for that already exists in lab-core as `count`; the bug was that
 * nothing here called it. Each phrase lives in this file rather than at its
 * call site so the forms have one definition and the tests can pin it.
 *
 * Two things the picker alone does not settle, decided once, here:
 *
 * **Animacy.** "pacient" is masculine animate, so 2–4 takes "pacienti";
 * "odběr", "dokument" and "parametr" are inanimate and take "odběry",
 * "dokumenty", "parametry". One rule for all four would get half of them wrong.
 *
 * **The verb.** "nalezeno" is a neuter singular passive participle. It is only
 * correct over a genitive-plural quantity — "nalezeno 5 pacientů". With a
 * nominative subject it has to agree, giving "nalezen 1 pacient" and
 * "nalezeni 2 pacienti", which is a second three-form table to keep in step
 * with the first. So the two counted-patient phrases drop the participle and
 * stay a bare nominative noun phrase, which is what apps/CLAUDE.md asks Czech
 * copy in a label to be anyway. The phrases that kept a verb — "vypsal",
 * "porovnal", "spočítal" — agree with the agent doing the listing, not with
 * the count, so they are already correct at every number; there only the
 * object's form had to be fixed, and for those nouns the accusative the verb
 * governs is spelt the same as the nominative.
 */
import { count, plural } from "@bw/lab-core";

/** find_patient, more than one match: "3 pacienti v kartotéce". */
export function patientsInDirectory(n: number): string {
  return `${count(n, "pacient", "pacienti", "pacientů")} v kartotéce`;
}

/** cohort_query, at least one match: "3 pacienti ve výběru". */
export function patientsInCohort(n: number): string {
  return `${count(n, "pacient", "pacienti", "pacientů")} ve výběru`;
}

/**
 * search_documents, at least one hit: "nalezeno ve 3 dokumentech".
 *
 * Here "nalezeno" is correct at every count — there is no nominative subject
 * for it to disagree with, only a locative phrase — so it stays. What varies
 * besides the noun is the preposition: Czech vocalises "v" to "ve" before a
 * word starting with a consonant cluster, and 2–4 read aloud as "dvou",
 * "třech", "čtyřech", all of which take "ve". Five upwards ("pěti" … "deseti")
 * and one ("jednom") take "v". The search returns at most ten hits, so no
 * count that reaches here reads as "stu" or "tisíci".
 */
export function documentsMatched(n: number): string {
  return `nalezeno ${plural(n, `v ${n} dokumentu`, `ve ${n} dokumentech`, `v ${n} dokumentech`)}`;
}

/** get_document with no id: "vypsal 3 dokumenty". */
export function documentsListed(n: number): string {
  return `vypsal ${count(n, "dokument", "dokumenty", "dokumentů")}`;
}

/** list_analytes: "vypsal 13 parametrů". */
export function analytesListed(n: number): string {
  return `vypsal ${count(n, "parametr", "parametry", "parametrů")}`;
}

/** summarize_changes: "porovnal 4 odběry". */
export function drawsCompared(n: number): string {
  return `porovnal ${count(n, "odběr", "odběry", "odběrů")}`;
}

/**
 * computed_values: "spočítal 2 odvozené hodnoty".
 *
 * "hodnota" is feminine, and "spočítat" governs the accusative, so the
 * singular is "1 odvozenou hodnotu" rather than the nominative "hodnota".
 */
export function derivedComputed(n: number): string {
  return `spočítal ${count(n, "odvozenou hodnotu", "odvozené hodnoty", "odvozených hodnot")}`;
}
