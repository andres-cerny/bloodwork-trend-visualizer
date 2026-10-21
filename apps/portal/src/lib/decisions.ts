/**
 * The mapping decisions as the person sees them — no React, so a test can.
 *
 * Three screens read this module (docs/plans/model-loop.md, "still to build"):
 *
 *   - Trendy's unrecognised series: a reading no catalog entry claims gets its
 *     own series under the printed name (`buildTrends` `opts.unrecognised`),
 *     never one of the recognised parameters' series;
 *   - the "přidáno automaticky" marker: an entry the app added from the NČLP
 *     code table without a person (`VITE_AUTO_ENTRIES`), explained in words;
 *   - „Jak čteme názvy z laboratoří": every decision that shapes this
 *     account's trends — lab, printed name, unit → parameter, and who made it.
 */
import { type LabReport, type Trend, aliasKey, numericPoints } from "@bw/lab-core";
import type { AiAsked, AutoEntry, SavedAlias } from "./api";

/** The catalog id an auto entry is filed under. */
export const autoEntryId = (code: string) => `nclp_${code}`;

/**
 * An NČLP name without its system part: „Apolipoprotein AII (S; hmot. konc.
 * [g/l])" → „Apolipoprotein AII". The part in brackets is the code table's
 * own notation — specimen, kind of quantity, unit — which the app shows in
 * words elsewhere; as a heading on a phone it is noise. Only a final bracket
 * group holding a „;" is the system part; a name that is nothing else stays.
 */
export function friendlyNclpName(name: string): string {
  const s = (name ?? "").trim();
  if (!s.endsWith(")")) return s;
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ")") depth++;
    else if (s[i] === "(") {
      depth--;
      if (depth === 0) {
        const inner = s.slice(i + 1, -1);
        const head = s.slice(0, i).trim();
        return inner.includes(";") && head ? head : s;
      }
    }
  }
  return s;
}

/** The NČLP specimen in plain Czech. */
export function specimenCs(material: string | null | undefined): string | null {
  switch ((material ?? "").toLowerCase()) {
    case "s":
      return "sérum";
    case "p":
      return "plazma";
    case "b":
      return "krev";
    case "u":
      return "moč";
    case "du":
      return "moč za 24 hodin";
    default:
      return null;
  }
}

/** The printed names a trend's readings carry, in the order first seen. */
export function rawNamesOf(t: Trend): string[] {
  return [...new Set(t.points.map((p) => p.rawName))];
}

/**
 * The unrecognised series Trendy may show: built by `buildTrends` with
 * `opts.unrecognised`, kept only when it is `recognised: false`, holds at
 * least one number, and its printed name is one a mapping could put into a
 * trend (`keep`: unmapped, blood or unknown specimen, not parked by the model
 * as another material). Recognised series are dropped here on purpose: the
 * two kinds live in separate maps, so nothing that reads the recognised one —
 * Souhrn, AI konzultace — ever sees a reading without a parameter.
 */
export function unrecognisedOnly(all: Map<string, Trend>, keep: (rawName: string) => boolean): Map<string, Trend> {
  const out = new Map<string, Trend>();
  for (const [k, t] of all) {
    if (t.recognised !== false) continue;
    if (numericPoints(t).length === 0) continue;
    if (!rawNamesOf(t).some(keep)) continue;
    out.set(k, t);
  }
  return out;
}

/** One printed name as it stands in this account's reports. */
export interface NameScope {
  rawName: string;
  /** The report's lab, "" when it does not say. */
  lab: string;
  /** The printed unit, "" when none. */
  unit: string;
}

/** Every (lab, printed name, unit) filed under `canonicalId`, once each. */
export function rowsUnder(reports: LabReport[], canonicalId: string): NameScope[] {
  const seen = new Map<string, NameScope>();
  for (const r of reports) {
    for (const m of r.measurements) {
      if (m.canonicalId !== canonicalId) continue;
      const s = { rawName: m.rawAnalyteName, lab: r.labName ?? "", unit: m.unitRaw ?? "" };
      const k = aliasKey(s.lab || null, s.rawName, s.unit || null);
      if (!seen.has(k)) seen.set(k, s);
    }
  }
  return [...seen.values()];
}

/** Does a saved decision name any reading in these reports? Lab or unit "" is any. */
export function aliasApplies(a: Pick<SavedAlias, "lab" | "rawName" | "unit">, reports: LabReport[]): boolean {
  const want = aliasKey(a.lab || null, a.rawName, a.unit || null);
  return reports.some((r) => r.measurements.some((m) => aliasKey(a.lab ? r.labName : null, m.rawAnalyteName, a.unit ? m.unitRaw : null) === want));
}

/** Who made a decision, as the screen says it. */
export type Who = "you" | "auto" | "shared";

export const WHO_CS: Record<Who, string> = { you: "vaše rozhodnutí", auto: "automaticky", shared: "jiný uživatel" };

/**
 * One decision on the names screen.
 *
 * `where` says how it is withdrawn: `alias` is a row of the shared scoped
 * table (`/api/aliases`), `learned` a name this account filed by hand
 * (`settings.learned`), `ai` one the mapping model filed for this account
 * alone (`settings.aiAsked` … `applied`).
 */
export interface NameDecision extends NameScope {
  /** Null: „this name is not that parameter" — the row stays unrecognised. */
  canonicalId: string | null;
  who: Who;
  where: "alias" | "learned" | "ai";
  /** This account made it, so this account can take it back. */
  mine: boolean;
  code: string | null;
}

/** Where a name was first printed in these reports — lab and unit — or "" for both. */
export function firstScope(rawName: string, reports: LabReport[]): { lab: string; unit: string } {
  for (const r of reports) {
    const m = r.measurements.find((x) => x.rawAnalyteName === rawName);
    if (m) return { lab: r.labName ?? "", unit: m.unitRaw ?? "" };
  }
  return { lab: "", unit: "" };
}

/**
 * Every decision that shapes this account's trends, newest kind first:
 *
 *   - the shared scoped decisions that name one of its readings, and every
 *     one it made itself (even if no report names it any more — it is still
 *     its to take back);
 *   - the names it filed by hand, or the model filed for it, that are still
 *     filed that way and are not already listed as a scoped decision.
 *
 * Names filed under a parameter the person founded are left out: those have
 * their own list, with a delete that says what it does (MappingTab).
 */
export function nameDecisions(input: {
  reports: LabReport[];
  aliases: SavedAlias[];
  learned: Record<string, string[]>;
  aiAsked: AiAsked;
  isCustom: (canonicalId: string) => boolean;
}): NameDecision[] {
  const { reports, aliases, learned, aiAsked, isCustom } = input;
  const out: NameDecision[] = [];
  const covered = new Set<string>();
  for (const a of aliases) {
    if (!a.mine && !aliasApplies(a, reports)) continue;
    covered.add(a.rawName);
    out.push({
      rawName: a.rawName,
      lab: a.lab,
      unit: a.unit,
      canonicalId: a.canonicalId,
      who: a.source === "model" ? "auto" : a.mine ? "you" : "shared",
      where: "alias",
      mine: a.mine,
      code: a.code,
    });
  }
  const filed = (rawName: string, cid: string) => reports.some((r) => r.measurements.some((m) => m.rawAnalyteName === rawName && m.canonicalId === cid));
  for (const [cid, names] of Object.entries(learned)) {
    if (isCustom(cid)) continue;
    for (const rawName of names) {
      if (covered.has(rawName) || !filed(rawName, cid)) continue;
      covered.add(rawName);
      const ai = aiAsked[rawName];
      const byModel = !!ai?.applied && ai.canonicalId === cid;
      out.push({ rawName, ...firstScope(rawName, reports), canonicalId: cid, who: byModel ? "auto" : "you", where: byModel ? "ai" : "learned", mine: true, code: ai?.code ?? null });
    }
  }
  return out.sort((x, y) => x.lab.localeCompare(y.lab, "cs") || x.rawName.localeCompare(y.rawName, "cs"));
}

/** The decisions grouped by laboratory, a lab-less group last. */
export function byLab<T extends { lab: string }>(items: T[]): Array<{ lab: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const d of items) {
    const k = d.lab.trim();
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "cs")))
    .map(([lab, items]) => ({ lab, items }));
}

/** The auto-added entries this account's readings are filed under. */
export function autoEntriesInUse(entries: AutoEntry[], reports: LabReport[]): Array<{ entry: AutoEntry; rows: NameScope[] }> {
  return entries.map((entry) => ({ entry, rows: rowsUnder(reports, autoEntryId(entry.code)) })).filter((x) => x.rows.length > 0);
}

/** The list with this decision in it: one per (lab, name, unit), the new one replacing the old. */
export function withAlias(list: SavedAlias[], a: SavedAlias): SavedAlias[] {
  const k = aliasKey(a.lab || null, a.rawName, a.unit || null);
  return [...list.filter((x) => aliasKey(x.lab || null, x.rawName, x.unit || null) !== k), a];
}

/** The list without this account's decision for (lab, name, unit). */
export function withoutAlias(list: SavedAlias[], s: NameScope): SavedAlias[] {
  const k = aliasKey(s.lab || null, s.rawName, s.unit || null);
  return list.filter((x) => !(x.mine && aliasKey(x.lab || null, x.rawName, x.unit || null) === k));
}
