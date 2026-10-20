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
import { type AnalyteDef, type LabReport, type Observed, type Registry, type UnmappedAnalyte, type WeakMatch, canApplyUnasked, findWeakMatches, scoreCandidate, trendable } from "@bw/lab-core";
import type { AiAsked, AiAskedEntry, AiMapAnswer, CatalogEntry, NameToMap } from "./api";

/** The one in-memory mark: this name's call is out. Never persisted. */
const asking = (at: string): AiAskedEntry => ({ decision: "unknown", canonicalId: null, confidence: "low", reason: "", model: "", at, asking: true });

/** Said on the card for a name the model was sent and did not answer. */
const NOT_ANSWERED = "Model tento název nezařadil.";

/** What is stored per reason: ten words in Czech, with room — the whole record shares one settings blob, capped by the worker (512 kB). */
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
    if (s.code) entry.code = s.code;
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

/**
 * Which of the model's filings become a lesson for every account.
 *
 * Off unless the build sets `VITE_SHARE_AI_MAPPINGS=1` (docs/plans/
 * model-loop.md, "Mapping design"): today a lesson for everyone takes a
 * person's click. On, the same bar as filing unasked — `catalog`, `high`,
 * `canApplyUnasked` (the unit known to agree, nothing contradicting) — and
 * only onto a shipped entry, never a parameter this account founded. The
 * lesson is taught under this account, so it can take it back exactly as a
 * click-taught one; and the next account with the same printed name never
 * reaches the model.
 */
export function sharedLessons(judged: Judged, isShipped: (canonicalId: string) => boolean, enabled: boolean): Judged["applied"] {
  return enabled ? judged.applied.filter((a) => isShipped(a.canonicalId)) : [];
}

/**
 * Where a filed name was printed: the lab and unit of its first reading, so
 * the shared lesson is the decision for that (lab, name, unit), not for the
 * name everywhere. Lab and unit "" when the reports do not say.
 */
export function scopeOf(rawName: string, reports: LabReport[]): { lab: string; unit: string } {
  for (const r of reports) {
    const m = r.measurements.find((x) => x.rawAnalyteName === rawName);
    if (m) return { lab: r.labName ?? "", unit: m.unitRaw ?? "" };
  }
  return { lab: "", unit: "" };
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

/**
 * A second opinion on a weak list match (`findWeakMatches`): the model is
 * asked about the printed name exactly as for an unknown one — it is not told
 * what the list chose, so it cannot simply agree — and its answer becomes a
 * scoped decision for (lab, printed name, unit):
 *
 *   confirm  the model names the list's entry: the match stands, and is
 *            saved so the name is never asked again;
 *   remap    the model names another entry with "high" and the unit/interval
 *            evidence for it holds (`canApplyUnasked`) — the same bar as
 *            filing an unknown name unasked;
 *   unmap    anything else (another entry without that evidence, "unknown",
 *            "new", "not blood"): the doubt is real, so the row leaves the
 *            list's entry and waits for a person in the mapping tab, with
 *            the model's answer beside it.
 *
 * Off unless the build sets `VITE_SECOND_OPINION=1`. docs/plans/model-loop.md,
 * round 4.
 */
export interface SecondOpinion {
  rawName: string;
  unit: string;
  lab: string | null;
  listId: string;
  /** `skip`: the model did not answer this name — nothing is saved, it is asked again later. */
  verdict: "confirm" | "remap" | "unmap" | "skip";
  /** The entry the row maps to after this: the list's, the model's, or none. */
  canonicalId: string | null;
  /** The model's answer, as it would be shown. */
  said: { decision: string; canonicalId: string | null; confidence: string; reason: string; code?: string | null };
}

export function judgeSecondOpinion(answer: AiMapAnswer, weak: WeakMatch[], registry: Registry, stats: Map<string, Observed>): SecondOpinion[] {
  const byName = new Map(answer.suggestions.map((s) => [s.rawName, s]));
  return weak.map((w) => {
    const s = byName.get(w.analyte.rawName);
    const base = { rawName: w.analyte.rawName, unit: w.analyte.unitRaw, lab: w.lab, listId: w.listId };
    if (!s) {
      // Not answered is not a verdict: keep the list's match, ask again later.
      return { ...base, verdict: "skip" as const, canonicalId: w.listId, said: { decision: "unknown", canonicalId: null, confidence: "low", reason: NOT_ANSWERED } };
    }
    const said = { decision: s.decision, canonicalId: s.decision === "catalog" ? s.canonicalId : null, confidence: s.confidence, reason: s.reason.slice(0, REASON_MAX), code: s.code ?? null };
    if (s.decision === "catalog" && s.canonicalId === w.listId) return { ...base, verdict: "confirm" as const, canonicalId: w.listId, said };
    if (s.decision === "catalog" && s.canonicalId && s.confidence === "high") {
      const def = registry.get(s.canonicalId);
      const c = def ? scoreCandidate(w.analyte, def, stats) : null;
      if (c && canApplyUnasked(c)) return { ...base, verdict: "remap" as const, canonicalId: s.canonicalId, said };
    }
    return { ...base, verdict: "unmap" as const, canonicalId: null, said };
  });
}

export interface SecondOpinionInput {
  reports: LabReport[];
  registry: Registry;
  stats: Map<string, Observed>;
  ask: (names: NameToMap[], catalog: CatalogEntry[]) => Promise<AiMapAnswer>;
}

export interface SecondOpinionEffects {
  /** Save one decision (shared `aliases`, source "model"). Best effort. */
  save: (o: SecondOpinion, model: string) => void;
}

/**
 * Find the weak list matches, ask once, judge, apply each decision to the
 * registry as a scoped alias and hand it to `save`. The caller then re-runs
 * `rematchReport`, which carries the decisions into stored reports. Never
 * rejects; a failed call decides nothing. Off unless `VITE_SECOND_OPINION=1`.
 */
export async function runSecondOpinion(input: SecondOpinionInput, effects: SecondOpinionEffects): Promise<{ asked: number; decided: SecondOpinion[]; error: unknown | null }> {
  const weak = findWeakMatches(input.reports, input.registry);
  if (weak.length === 0) return { asked: 0, decided: [], error: null };
  let answer: AiMapAnswer;
  try {
    const wire: NameToMap[] = weak.map((w) => ({ rawName: w.analyte.rawName, unit: w.analyte.unitRaw, refRange: w.analyte.refRangeRaw, material: w.analyte.material }));
    const catalog: CatalogEntry[] = [...input.registry.analytes.values()].map((d) => ({ id: d.canonicalId, name: d.displayNameCs, unit: d.canonicalUnit }));
    answer = await input.ask(wire, catalog);
  } catch (e) {
    return { asked: weak.length, decided: [], error: e };
  }
  const decided = judgeSecondOpinion(answer, weak, input.registry, input.stats).filter((o) => o.verdict !== "skip");
  for (const o of decided) {
    input.registry.addScopedAlias({ lab: o.lab, unit: o.unit }, o.rawName, o.canonicalId);
    effects.save(o, answer.model ?? "");
  }
  return { asked: weak.length, decided, error: null };
}

/**
 * A catalog entry the app may add without a person (`VITE_AUTO_ENTRIES=1`):
 * the mapping step answered "new" with an NČLP `code` at "high" — which the
 * extract worker gives only to an exact code-table hit (the printed unit and
 * specimen are the row's own) or a model pick it was sure of that passed the
 * specimen check. Round 6 measured no wrong "high" among 40 tests the catalog
 * lacks. docs/plans/model-loop.md.
 */
export interface AutoEntryProposal {
  code: string;
  canonicalId: string;
  nameCs: string;
  unit: string;
  rawName: string;
  model: string;
}

export function autoEntriesFrom(judged: Judged, enabled: boolean): AutoEntryProposal[] {
  if (!enabled) return [];
  const out: AutoEntryProposal[] = [];
  for (const [rawName, e] of Object.entries(judged.entries)) {
    if (e.decision !== "new" || e.confidence !== "high" || !e.code || !e.proposed) continue;
    if (!/^\d{5}$/.test(e.code)) continue;
    out.push({ code: e.code, canonicalId: `nclp_${e.code}`, nameCs: e.proposed.displayNameCs, unit: e.proposed.unit, rawName, model: e.model });
  }
  return out;
}

/** The registry entry for an auto-added code: its NČLP name, unit, and the printed name that founded it. */
export function autoEntryDef(e: { code: string; nameCs: string; unit: string; rawName: string }): AnalyteDef {
  return { canonicalId: `nclp_${e.code}`, displayNameCs: e.nameCs, synonyms: [e.rawName], canonicalUnit: e.unit, unitConversions: {} };
}

