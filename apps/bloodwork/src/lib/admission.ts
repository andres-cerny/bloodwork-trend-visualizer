/**
 * The waiting room an upload sits in until we know whose it is.
 *
 * `identity.ts` in lab-core answers the question — is this the patient already
 * on screen? This file decides *when* that question can be asked, which is the
 * part the upload path made hard after the guard was first written.
 *
 * Two properties of the uploader shape everything here:
 *
 *   1. **A report is published while it is still being read**, once per page
 *      that lands, so `receive` is called many times for one document and each
 *      call carries a more complete version of it.
 *   2. **Pages land out of order, and up to 24 files run at once**, so the
 *      first publish of a document is not necessarily its first page, and more
 *      than one upload can be waiting on an answer at the same time.
 *
 * Together those rule out both of the obvious designs. Deciding on the first
 * publish would ask about every multi-page report whose page 2 happened to
 * land first, since the patient header is on page 1 — and a prompt that
 * appears when nothing is wrong is how a prompt stops being read. Deciding
 * only at the end would let a different patient's rows sit in the trend for
 * the twenty seconds the rest of the file takes, which is the whole bug.
 *
 * So the rule is by outcome, not by timing:
 *
 *   - **match** — admitted immediately, at whatever page proved it.
 *   - **mismatch** — asked immediately. Two identifiers that disagree is a
 *     conclusion; no later page can overturn it, and the rows are already
 *     wrong.
 *   - **unverifiable** — held silently until the document is finished. This is
 *     the "we could not read who this is" case, and it is the only one where
 *     waiting can actually change the answer: the header may be on a page that
 *     has not landed yet.
 *
 * A held report is not in `admitted`, so nothing merges it into a trend, puts
 * it in the document list, or counts it in the patient card. Its progress is
 * still visible — that is the upload panel's own job list, which is driven by
 * the queue rather than by this.
 */
import {
  checkIdentity,
  hasIdentity,
  identityOf,
  type IdentityWarning,
  type LabReport,
} from "@bw/lab-core";

/** What the reader may answer when asked about an upload. */
export type Answer =
  /** This is the patient now; everything loaded before it goes. */
  | "replace"
  /** Keep both. Deliberate, and the reason a later draw for either is silent. */
  | "add"
  /** It was the wrong file. Nothing about it is kept. */
  | "discard";

export interface Held {
  report: LabReport;
  /** Set by the uploader's final publish. Until then more pages may arrive. */
  done: boolean;
  /**
   * Why this is being asked about, or null while it is merely waiting for
   * more pages. Only a non-null warning puts a dialog on screen.
   */
  warning: IdentityWarning | null;
}

export interface Admission {
  /** Cleared to merge. Everything the app renders reads from this. */
  admitted: LabReport[];
  /** Waiting on more pages or on an answer, in arrival order. */
  held: Held[];
  /**
   * Ids the reader threw away.
   *
   * Discarding does not stop the upload — the remaining pages of that file are
   * already in flight and keep publishing for as long as it takes them to
   * land. Without this they would walk straight back into the waiting room and
   * ask the same question again, one page at a time.
   */
  discarded: string[];
}

export const EMPTY: Admission = { admitted: [], held: [], discarded: [] };

/**
 * Replace a report with a newer version of itself, or append it.
 *
 * By id, because a partial publish and its successor are the same document.
 * Appending instead would stack one report per page read.
 */
function upsert(list: LabReport[], report: LabReport): LabReport[] {
  const at = list.findIndex((r) => r.id === report.id);
  if (at < 0) return [...list, report];
  const next = [...list];
  next[at] = report;
  return next;
}

/**
 * Work out what can be decided now, and keep going until nothing changes.
 *
 * The loop matters: admitting one held report changes the set the *others* are
 * compared against. Two files for the same new patient dropped together should
 * cost one question, not two — the second matches the first the moment the
 * first is admitted.
 */
function settle(state: Admission): Admission {
  let { admitted, held } = state;
  const { discarded } = state;

  for (;;) {
    let promoted = false;
    const rest: Held[] = [];

    for (const h of held) {
      const check = checkIdentity(h.report, admitted);
      if (check.kind === "ok") {
        admitted = upsert(admitted, h.report);
        promoted = true;
        continue;
      }
      // "We could not tell" is worth waiting on only while pages are still
      // arriving, and only because a later page may carry the header. A
      // mismatch is already proven and is asked about at once.
      const wait = check.kind === "unverifiable" && !h.done;
      rest.push({ ...h, warning: wait ? null : check });
    }

    held = rest;
    if (!promoted) return { admitted, held, discarded };
  }
}

/**
 * Take one publish from the uploader.
 *
 * `done` is the uploader's final call for that document. Everything before it
 * is a partial, carrying however many pages have landed.
 */
export function receive(state: Admission, report: LabReport, done: boolean): Admission {
  // Already cleared: this is a later page of a document we have accepted, and
  // it must not be re-examined. Re-checking would ask again about a patient
  // the reader has already said yes to, and after "add anyway" it would ask
  // on every remaining page of the file.
  if (state.admitted.some((r) => r.id === report.id))
    return { ...state, admitted: upsert(state.admitted, report) };

  // Thrown away, and the rest of the file has not finished arriving.
  if (state.discarded.includes(report.id)) return state;

  const at = state.held.findIndex((h) => h.report.id === report.id);
  // `warning` is recomputed by `settle` for everything still held, so there is
  // nothing to carry over from the previous version of this report.
  const entry: Held = { report, done, warning: null };
  const held = at < 0 ? [...state.held, entry] : state.held.map((h, i) => (i === at ? entry : h));
  return settle({ ...state, held });
}

/**
 * The upload currently being asked about, if any.
 *
 * One at a time, in arrival order, even when several are waiting: three
 * dialogs stacked on top of each other is not three decisions, it is one
 * dismissal. Answering the first re-settles the rest, and an answer often
 * resolves them — after "replace", a second file for the same new patient
 * matches and never asks.
 */
export function pending(state: Admission): Held | null {
  return state.held.find((h) => h.warning !== null) ?? null;
}

/** Is this upload waiting only because we cannot yet read who it belongs to? */
export function isUnidentified(h: Held): boolean {
  return !hasIdentity(identityOf(h.report));
}

/**
 * Answer the question about one held report.
 *
 * The id is passed rather than assumed to be `pending()`, so an answer that
 * arrives after the state moved on is a no-op instead of applying to whichever
 * document took its place in the dialog.
 */
export function answer(state: Admission, id: string, choice: Answer): Admission {
  const at = state.held.findIndex((h) => h.report.id === id);
  if (at < 0) return state;
  const chosen = state.held[at];
  const rest = state.held.filter((_, i) => i !== at);

  if (choice === "discard")
    return settle({ ...state, held: rest, discarded: [...state.discarded, id] });

  // Replace empties the room first, so the answer is compared against nothing
  // and the reports still waiting are re-judged against the new patient rather
  // than against the one that was just dismissed.
  const base = choice === "replace" ? [] : state.admitted;
  return settle({ ...state, admitted: [...base, chosen.report], held: rest });
}

/**
 * Rewrite every report being held, loaded or waiting.
 *
 * Accepting a mapping rewrites `canonicalId` across everything, and a report
 * still waiting on an answer has to be rewritten with it: the decision was
 * made about the registry, not about one document, and a report admitted a
 * moment later would otherwise arrive carrying analyte names the reader had
 * already mapped.
 */
export function mapReports(state: Admission, fn: (r: LabReport) => LabReport): Admission {
  return {
    ...state,
    admitted: state.admitted.map(fn),
    held: state.held.map((h) => ({ ...h, report: fn(h.report) })),
  };
}

/**
 * Remove one loaded report.
 *
 * Only reaches `admitted`, because the rail lists nothing else — a waiting
 * report is removed by answering "Zahodit", which also stops the rest of its
 * pages coming back.
 */
export function remove(state: Admission, id: string): Admission {
  return { ...state, admitted: state.admitted.filter((r) => r.id !== id) };
}

/**
 * Drop everything, admitted and waiting alike. What "Vymazat vše" does.
 *
 * `discarded` survives, because the uploads it names are still in flight and
 * the reader's decision about them has not been undone by clearing the screen.
 */
export function clearAll(state: Admission): Admission {
  return { ...EMPTY, discarded: state.discarded };
}

/**
 * Load a set of reports directly, bypassing the guard. Demo data only.
 *
 * The demo set is shipped with the app rather than uploaded, so there is no
 * question to ask about it — and it is what the *first* upload is checked
 * against.
 */
export function preload(state: Admission, reports: LabReport[]): Admission {
  return { ...EMPTY, discarded: state.discarded, admitted: [...reports] };
}
