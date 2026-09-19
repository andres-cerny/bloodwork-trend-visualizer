/**
 * The mapping model's run, without a click.
 *
 * It used to take a button. Now it runs at the end of every upload for the
 * new report's unmatched names, and once on load for names never asked, and
 * the button that is left says "ask again". Three things this module decides,
 * so the screen does not have to and a test can:
 *
 *   - **who gets asked**: a name that is unmapped, could ever trend, and is
 *     not in the account's `aiAsked` record — including one being asked right
 *     now, which is how an upload's run and a load's run cannot double-ask;
 *   - **what is filed unasked**: `catalog`, `high`, and `canApplyUnasked` —
 *     the unit known to agree and neither interval, material nor magnitude
 *     disagreeing. The model's own word is not enough on its own, and the
 *     evidence is not enough without the model's word: "medium" with perfect
 *     evidence is a suggestion for a click. Name similarity is never counted
 *     — "S_Na" and "sodik" share no bigram, and the name is the one thing the
 *     model was asked because it knows;
 *   - **what is stored**: every answer, per printed name, so a reload does
 *     not spend again and what the model said is still on the card.
 *
 * The call is marked in memory before it goes out and rolled back if it
 * fails; the run itself never rejects. An upload has stored its report by
 * the time this runs, and a model that cannot be reached leaves the names
 * waiting in the tab, not the report unsaved.
 */
import { type Observed, type Registry, type UnmappedAnalyte, canApplyUnasked, scoreCandidate, trendable } from "@bw/lab-core";
import type { AiAsked, AiAskedEntry, AiMapAnswer, CatalogEntry, NameToMap } from "./api";

/** The one in-memory mark: this name's call is out. Never persisted. */
const asking = (at: string): AiAskedEntry => ({ decision: "unknown", canonicalId: null, confidence: "low", reason: "", model: "", at, asking: true });

/** Said on the card for a name the model was sent and did not answer. */
const NOT_ANSWERED = "Model tento název nezařadil.";

/** What is stored per reason: ten words in Czech, with room — the whole record shares one 64 kB settings blob. */
const REASON_MAX = 120;

/** Unmapped, could trend, and not asked before (or right now). */
export function namesToAsk(unmapped: UnmappedAnalyte[], asked: AiAsked): UnmappedAnalyte[] {
  return unmapped.filter((a) => trendable(a) && !asked[a.rawName]);
}

/** The record without `names` — what "Zeptat se znovu" does before it asks. */
export function withoutAsked(asked: AiAsked, names: string[]): AiAsked {
  const next = { ...asked };
  for (const n of names) delete next[n];
  return next;
}

/** The record as it may be saved: answers only, never a call in flight. */
export function persistable(asked: AiAsked): AiAsked {
  const out: AiAsked = {};
  for (const [k, v] of Object.entries(asked)) if (!v.asking) out[k] = v;
  return out;
}

export interface Judged {
  /** One entry per name that was asked, answered or not. */
  entries: AiAsked;
  /** Filed without a click, in the order the model answered. */
  applied: Array<{ rawName: string; canonicalId: string }>;
  /** Called "not blood": parked, and the tab says so. */
  parked: string[];
}

/**
 * The model's answer against the evidence: what to store, what to file.
 *
 * `applied` is the only line that matters for safety, and it is exactly
 * `decision === "catalog" && confidence === "high" && canApplyUnasked`. A
 * name the model did not answer is stored as `unknown` with a reason that
 * says so — it was asked, and the next load must not ask it again; the
 * button can.
 */
export function judge(answer: AiMapAnswer, names: UnmappedAnalyte[], registry: Registry, stats: Map<string, Observed>, at: string): Judged {
  const model = answer.model ?? "";
  const byName = new Map(answer.suggestions.map((s) => [s.rawName, s]));
  const entries: AiAsked = {};
  const applied: Judged["applied"] = [];
  const parked: string[] = [];
  for (const a of names) {
    const s = byName.get(a.rawName);
    if (!s) {
      entries[a.rawName] = { decision: "unknown", canonicalId: null, confidence: "low", reason: NOT_ANSWERED, model, at };
      continue;
    }
    const entry: AiAskedEntry = {
      decision: s.decision,
      canonicalId: s.decision === "catalog" ? s.canonicalId : null,
      confidence: s.confidence,
      reason: s.reason.slice(0, REASON_MAX),
      model,
      at,
    };
    if (s.decision === "new" && s.proposed) entry.proposed = s.proposed;
    if (s.decision === "not_blood") parked.push(a.rawName);
    if (s.decision === "catalog" && s.canonicalId && s.confidence === "high") {
      const def = registry.get(s.canonicalId);
      const candidate = def ? scoreCandidate(a, def, stats) : null;
      if (candidate && canApplyUnasked(candidate)) {
        entry.applied = true;
        applied.push({ rawName: a.rawName, canonicalId: s.canonicalId });
      }
    }
    entries[a.rawName] = entry;
  }
  return { entries, applied, parked };
}

export interface RunInput {
  /** The names this run is for — an upload's new report, or everything on load. Filtered here. */
  candidates: UnmappedAnalyte[];
  /** The account's record, read at the moment the names are chosen. */
  asked: () => AiAsked;
  registry: Registry;
  stats: Map<string, Observed>;
  ask: (names: NameToMap[], catalog: CatalogEntry[]) => Promise<AiMapAnswer>;
  /** ISO date for the record. */
  now?: () => string;
}

export interface RunEffects {
  /** Optimistic: these names are being asked. Synchronous, before the call. */
  mark: (rawNames: string[]) => void;
  /** The call failed: the names are not asked after all. */
  unmark: (rawNames: string[]) => void;
  /** The answer: store the entries, file what passed, say what was parked. One save. */
  commit: (judged: Judged) => void;
}

export interface RunOutcome {
  /** How many names went out; 0 means nothing was asked and nothing was spent. */
  asked: number;
  /** The call's failure, for the tab to say. Never thrown. */
  error: unknown | null;
}

/** Choose, mark, ask, judge, commit — or roll back. Never rejects. */
export async function runAiMapping(input: RunInput, effects: RunEffects): Promise<RunOutcome> {
  const names = namesToAsk(input.candidates, input.asked());
  if (names.length === 0) return { asked: 0, error: null };
  const rawNames = names.map((a) => a.rawName);
  effects.mark(rawNames);
  let answer: AiMapAnswer;
  try {
    const wire: NameToMap[] = names.map((a) => ({ rawName: a.rawName, unit: a.unitRaw, refRange: a.refRangeRaw, material: a.material }));
    const catalog: CatalogEntry[] = [...input.registry.analytes.values()].map((d) => ({ id: d.canonicalId, name: d.displayNameCs, unit: d.canonicalUnit }));
    answer = await input.ask(wire, catalog);
  } catch (e) {
    effects.unmark(rawNames);
    return { asked: names.length, error: e };
  }
  const at = (input.now ?? (() => new Date().toISOString().slice(0, 10)))();
  effects.commit(judge(answer, names, input.registry, input.stats, at));
  return { asked: names.length, error: null };
}

/** The in-flight mark, for the effect that writes it. */
export const askingEntry = asking;
