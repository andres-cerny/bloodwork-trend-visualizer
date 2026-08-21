/**
 * Does this newly uploaded report belong to the patient already on screen?
 *
 * Trends are built by merging every loaded report into one series per analyte.
 * That is right for several draws from one patient and catastrophic across two
 * people: two patients' ALT plotted as one line is not a chart with a bug in
 * it, it is a clinical claim about someone that is not true. The app cannot
 * know whose PDF it was handed, so it compares identities and asks.
 *
 * Two rules shape everything below:
 *
 *   1. **Only refuse to compare when the data really cannot be compared.**
 *      A misread rodné číslo must not read as a different patient *or* as the
 *      same one — it falls through to the name, and then to "unverifiable".
 *   2. **Every uncertain outcome asks.** Silence is reserved for a positive
 *      match. An identity we could not read is a prompt, not a pass, because
 *      the cost of merging two people is far higher than the cost of a click.
 */
import type { LabReport } from "./models";

export interface Identity {
  name: string | null;
  id: string | null;
}

/**
 * Digits of a rodné číslo, or null if what we were given cannot be one.
 *
 * Labs print it as `800101/0011`, `800101 / 0011` or `8001010011`, so the
 * separator carries no meaning and is dropped. Length does carry meaning: a
 * rodné číslo is 9 digits (born before 1954) or 10. Anything else is a misread
 * or a placeholder like "N/A", and is rejected rather than compared — an OCR
 * slip that drops one digit would otherwise read as a different patient.
 */
export function normalizeRodneCislo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 9 || digits.length === 10 ? digits : null;
}

// Stripped before comparing: a report printing "Ing. Jan Novák" and one
// printing "Jan Novák" are the same person, and warning about it teaches the
// reader to click through the warning without reading it.
const TITLES = new Set([
  "mudr", "mvdr", "mgr", "ing", "bc", "phdr", "rndr", "judr", "paeddr",
  "csc", "drsc", "dis", "phd", "prof", "doc", "dr",
]);

/**
 * A name reduced to something two labs can be expected to agree on: no
 * diacritics, no case, no titles, and no word order — Czech reports print
 * "Novák Jan" as readily as "Jan Novák", so the tokens are sorted.
 */
export function normalizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tokens = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !TITLES.has(t));
  return tokens.length ? tokens.sort().join(" ") : null;
}

export function identityOf(report: LabReport): Identity {
  return { name: report.patientName ?? null, id: report.patientId ?? null };
}

/** Is this identity worth showing to a human? */
export function describeIdentity(i: Identity): string {
  const parts = [i.name?.trim(), i.id?.trim()].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(" · ") : "neuvedeno";
}

type Verdict = "same" | "different" | "unknown";

/**
 * Compare one identity against another.
 *
 * The rodné číslo decides when both sides have a usable one, because it is the
 * only identifier that distinguishes two people with the same name. The name
 * is the fallback, not a tie-breaker: an id that says "different" is not
 * overturned by a name that matches.
 */
export function compareIdentities(a: Identity, b: Identity): Verdict {
  const aId = normalizeRodneCislo(a.id);
  const bId = normalizeRodneCislo(b.id);
  if (aId && bId) return aId === bId ? "same" : "different";

  const aName = normalizeName(a.name);
  const bName = normalizeName(b.name);
  if (aName && bName) return aName === bName ? "same" : "different";

  return "unknown";
}

export type IdentityCheck =
  /** Nothing loaded yet, or a positive match — proceed without asking. */
  | { kind: "ok" }
  /** Identifiers we could read, and they disagree. */
  | { kind: "mismatch"; by: "id" | "name"; incoming: Identity; loaded: Identity[] }
  /** Nothing comparable on one side or the other. */
  | { kind: "unverifiable"; incoming: Identity; loaded: Identity[] };

/** An outcome that has to be put to the reader. Everything except a pass. */
export type IdentityWarning = Exclude<IdentityCheck, { kind: "ok" }>;

/**
 * Check an incoming report against everything already loaded.
 *
 * A match against *any* loaded identity passes. That matters once someone has
 * deliberately chosen to keep two patients loaded: asking again on every
 * subsequent upload for a patient they already accepted is nagging, and nagging
 * is how a warning stops being read.
 */
/**
 * Every distinct identity across the loaded reports, in load order.
 *
 * Distinctness is by the printed strings, not by `compareIdentities` — two
 * reports that print the same person differently are worth showing as the two
 * spellings they are, rather than silently collapsing to whichever came first.
 */
export function distinctIdentities(reports: LabReport[]): Identity[] {
  const out: Identity[] = [];
  for (const r of reports) {
    const i = identityOf(r);
    if (!i.name && !i.id) continue;
    if (!out.some((k) => k.name === i.name && k.id === i.id)) out.push(i);
  }
  return out;
}

export function checkIdentity(incoming: LabReport, loaded: LabReport[]): IdentityCheck {
  if (loaded.length === 0) return { kind: "ok" };

  const inc = identityOf(incoming);
  const known = distinctIdentities(loaded);
  if (known.length === 0) return { kind: "unverifiable", incoming: inc, loaded: [] };

  const verdicts = known.map((k) => compareIdentities(inc, k));
  if (verdicts.includes("same")) return { kind: "ok" };

  const differing = known.find((_, i) => verdicts[i] === "different");
  if (differing) {
    // Name the identifier that actually decided *that* comparison, so the
    // dialog can show the reader the two values it compared rather than
    // asserting a conclusion it cannot point at.
    const by =
      normalizeRodneCislo(inc.id) && normalizeRodneCislo(differing.id) ? "id" : "name";
    return { kind: "mismatch", by, incoming: inc, loaded: known };
  }
  return { kind: "unverifiable", incoming: inc, loaded: known };
}
