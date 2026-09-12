/**
 * What a person tells their AI assistant about themselves, once, on the
 * AI konzultace tab: sex, an age band, height, weight, what they do for
 * exercise, what they take, what they have been diagnosed with, smoking,
 * alcohol, what they want the reading for, and a note. Stored on the
 * account (docs/plans/moje-krev-ai-context.md), rendered here into the
 * share page's "O mně" block and into the one-line summary the tab shows
 * once it is saved — so the form and the text cannot disagree, and nothing
 * in apps/portal composes a sentence of its own.
 *
 * Every field is optional. The block prints only what was answered; a
 * context with nothing answered prints nothing at all. Free text is trimmed,
 * flattened to one line and capped, so a runaway paste cannot bloat the
 * snapshot. No field here is an identity: no name, no date of birth, no
 * address — the age is a five-year band on purpose.
 */

/**
 * Ids are what is stored; labels are what the text says. Chip labels are in
 * running-text case — "Gilbertův syndrom" keeps its capital, "kreatin" does
 * not — and the form shows them through `capitalize`.
 */
export const AGE_BANDS = [
  ["u18", "do 18 let"],
  ["18-24", "18–24 let"],
  ["25-29", "25–29 let"],
  ["30-34", "30–34 let"],
  ["35-39", "35–39 let"],
  ["40-44", "40–44 let"],
  ["45-49", "45–49 let"],
  ["50-54", "50–54 let"],
  ["55-59", "55–59 let"],
  ["60-64", "60–64 let"],
  ["65+", "65 a více let"],
] as const;

export const MED_CHIPS = [
  ["creatine", "kreatin"],
  ["iron", "železo"],
  ["vitamin-d", "vitamin D"],
  ["protein", "protein"],
  ["contraception", "antikoncepce"],
  ["statins", "statiny"],
  ["thyroid-meds", "léky na štítnou žlázu"],
] as const;

export const DIAGNOSIS_CHIPS = [
  ["thyroid", "štítná žláza"],
  ["diabetes", "cukrovka"],
  ["hypertension", "vysoký tlak"],
  ["gilbert", "Gilbertův syndrom"],
  ["anemia", "anémie"],
] as const;

export const SEX_OPTIONS = [
  ["m", "Muž"],
  ["f", "Žena"],
] as const;

export const GOAL_OPTIONS = [
  ["performance", "Výkon"],
  ["health", "Zdraví"],
  ["both", "Výkon i zdraví"],
] as const;

export const SMOKING_OPTIONS = [
  ["no", "Ne"],
  ["sometimes", "Občas"],
  ["yes", "Ano"],
] as const;

export const ALCOHOL_OPTIONS = [
  ["no", "Ne"],
  ["sometimes", "Občas"],
  ["regularly", "Pravidelně"],
] as const;

export type AgeBand = (typeof AGE_BANDS)[number][0];
export type MedId = (typeof MED_CHIPS)[number][0];
export type DiagnosisId = (typeof DIAGNOSIS_CHIPS)[number][0];
export type ContextSex = (typeof SEX_OPTIONS)[number][0];
export type Goal = (typeof GOAL_OPTIONS)[number][0];
export type Smoking = (typeof SMOKING_OPTIONS)[number][0];
export type Alcohol = (typeof ALCOHOL_OPTIONS)[number][0];

export interface AiContext {
  sex?: ContextSex;
  ageBand?: AgeBand;
  heightCm?: number;
  weightKg?: number;
  /** One free line: what they do and how many hours a week. */
  activity?: string;
  goal?: Goal;
  meds?: MedId[];
  medsOther?: string;
  diagnoses?: DiagnosisId[];
  diagnosesOther?: string;
  smoking?: Smoking;
  alcohol?: Alcohol;
  note?: string;
}

/** The cap on each free-text field, in characters, after trimming. */
export const AI_CONTEXT_TEXT_MAX = 300;

/** Plausible bounds for the two numbers; outside them the field is dropped. */
export const HEIGHT_CM = [100, 250] as const;
export const WEIGHT_KG = [30, 250] as const;

const label = <T extends readonly (readonly [string, string])[]>(table: T, id: string | undefined): string | null => {
  const hit = table.find(([k]) => k === id);
  return hit ? hit[1] : null;
};

/** Trimmed, one line, capped; null when nothing is left. */
export function cleanText(s: string | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim().slice(0, AI_CONTEXT_TEXT_MAX).trim();
  return t ? t : null;
}

const cleanNumber = (n: number | undefined, [lo, hi]: readonly [number, number]): number | null =>
  typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;

const knownIds = <T extends readonly (readonly [string, string])[]>(table: T, ids: string[] | undefined): T[number][0][] => {
  const known = new Set<string>(table.map(([k]) => k));
  return (ids ?? []).filter((id, i, all) => known.has(id) && all.indexOf(id) === i) as T[number][0][];
};

/**
 * The context as it is stored: unknown ids dropped, numbers bounded, text
 * cleaned, empty fields absent. What the form saves goes through here, and
 * what the text prints is read from the result, so the two agree.
 */
export function normalizeAiContext(raw: AiContext | null | undefined): AiContext {
  const c = raw ?? {};
  const out: AiContext = {};
  if (label(SEX_OPTIONS, c.sex)) out.sex = c.sex;
  if (label(AGE_BANDS, c.ageBand)) out.ageBand = c.ageBand;
  const h = cleanNumber(c.heightCm, HEIGHT_CM);
  if (h !== null) out.heightCm = h;
  const w = cleanNumber(c.weightKg, WEIGHT_KG);
  if (w !== null) out.weightKg = w;
  const activity = cleanText(c.activity);
  if (activity) out.activity = activity;
  if (label(GOAL_OPTIONS, c.goal)) out.goal = c.goal;
  const meds = knownIds(MED_CHIPS, c.meds);
  if (meds.length) out.meds = meds;
  const medsOther = cleanText(c.medsOther);
  if (medsOther) out.medsOther = medsOther;
  const diagnoses = knownIds(DIAGNOSIS_CHIPS, c.diagnoses);
  if (diagnoses.length) out.diagnoses = diagnoses;
  const diagnosesOther = cleanText(c.diagnosesOther);
  if (diagnosesOther) out.diagnosesOther = diagnosesOther;
  if (label(SMOKING_OPTIONS, c.smoking)) out.smoking = c.smoking;
  if (label(ALCOHOL_OPTIONS, c.alcohol)) out.alcohol = c.alcohol;
  const note = cleanText(c.note);
  if (note) out.note = note;
  return out;
}

export const isEmptyAiContext = (raw: AiContext | null | undefined): boolean => Object.keys(normalizeAiContext(raw)).length === 0;

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** A chip's label as the form shows it: first letter up, the rest as written. */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "kreatin, vitamin D, hořčík" — chips in their labels, then the free line. */
function listLine<T extends readonly (readonly [string, string])[]>(table: T, ids: string[] | undefined, other: string | undefined): string | null {
  const parts = (ids ?? []).map((id) => label(table, id)).filter((l): l is string => l !== null);
  const extra = other ? [other] : [];
  const all = [...parts, ...extra];
  return all.length ? all.join(", ") : null;
}

/**
 * The block the share page carries after its header: "O mně:" and one line
 * per answered field, in the order the form asks. Null when nothing was
 * answered, so the page without a context is the page as it was.
 */
export function aiContextBlock(raw: AiContext | null | undefined): string | null {
  const c = normalizeAiContext(raw);
  const lines: string[] = [];
  const sex = label(SEX_OPTIONS, c.sex);
  if (sex) lines.push(`Pohlaví: ${lower(sex)}`);
  const age = label(AGE_BANDS, c.ageBand);
  if (age) lines.push(`Věk: ${age}`);
  if (c.heightCm !== undefined) lines.push(`Výška: ${c.heightCm} cm`);
  if (c.weightKg !== undefined) lines.push(`Váha: ${c.weightKg} kg`);
  if (c.activity) lines.push(`Pohyb: ${c.activity}`);
  const meds = listLine(MED_CHIPS, c.meds, c.medsOther);
  if (meds) lines.push(`Léky a doplňky: ${meds}`);
  const dx = listLine(DIAGNOSIS_CHIPS, c.diagnoses, c.diagnosesOther);
  if (dx) lines.push(`Diagnózy: ${dx}`);
  const smoking = label(SMOKING_OPTIONS, c.smoking);
  if (smoking) lines.push(`Kouření: ${lower(smoking)}`);
  const alcohol = label(ALCOHOL_OPTIONS, c.alcohol);
  if (alcohol) lines.push(`Alkohol: ${lower(alcohol)}`);
  const goal = label(GOAL_OPTIONS, c.goal);
  if (goal) lines.push(`Zajímá mě: ${lower(goal)}`);
  if (c.note) lines.push(`Poznámka: ${c.note}`);
  if (lines.length === 0) return null;
  return ["O mně:", ...lines.map((l) => `- ${l}`)].join("\n");
}

/**
 * The one line the tab shows once the context is saved, " · "-joined:
 * "Muž, 30–34 let · 178 cm, 76 kg · Silniční kolo 6–8 h týdně · Kreatin,
 * vitamin D · Kouření občas · Alkohol občas · Zajímá vás výkon i zdraví".
 * Null when nothing was answered.
 */
export function aiContextSummary(raw: AiContext | null | undefined): string | null {
  const c = normalizeAiContext(raw);
  const parts: string[] = [];
  const who = [label(SEX_OPTIONS, c.sex), label(AGE_BANDS, c.ageBand)].filter((x): x is string => x !== null);
  if (who.length) parts.push(who.join(", "));
  const body = [c.heightCm !== undefined ? `${c.heightCm} cm` : null, c.weightKg !== undefined ? `${c.weightKg} kg` : null].filter((x): x is string => x !== null);
  if (body.length) parts.push(body.join(", "));
  if (c.activity) parts.push(c.activity);
  const meds = listLine(MED_CHIPS, c.meds, c.medsOther);
  if (meds) parts.push(capitalize(meds));
  const dx = listLine(DIAGNOSIS_CHIPS, c.diagnoses, c.diagnosesOther);
  if (dx) parts.push(capitalize(dx));
  const smoking = label(SMOKING_OPTIONS, c.smoking);
  if (smoking && c.smoking !== "no") parts.push(`Kouření ${lower(smoking)}`);
  const alcohol = label(ALCOHOL_OPTIONS, c.alcohol);
  if (alcohol && c.alcohol !== "no") parts.push(`Alkohol ${lower(alcohol)}`);
  const goal = label(GOAL_OPTIONS, c.goal);
  if (goal) parts.push(`Zajímá vás ${lower(goal)}`);
  if (c.note) parts.push(`Poznámka: ${c.note}`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The one line the goal adds to the header's "Jak se mnou pracuj" list.
 * Written in the header's voice; nothing else in the settled header moves.
 */
export function goalSentence(goal: Goal | undefined): string | null {
  switch (goal) {
    case "performance":
      return "- Čti hodnoty jako hodnoty aktivního sportovce: u každé odchylky nejdřív zvaž, zda ji vysvětluje trénink, a řekni, co z ní plyne pro výkon.";
    case "health":
      return "- Čti hodnoty jako běžnou zdravotní kontrolu: zajímá mě, co z nich plyne pro moje zdraví.";
    case "both":
      return "- Čti hodnoty z obou stran — co z nich plyne pro zdraví a co pro sportovní výkon — a u odchylek zvaž, zda je vysvětluje trénink.";
    default:
      return null;
  }
}
