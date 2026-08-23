/**
 * Who the agent is on this request.
 *
 * The apps name a profile; they never send a prompt. That is the rule that
 * keeps one shared backend from becoming two backends sharing a file, and it is
 * also a security boundary — a client that can send a system prompt can delete
 * every guardrail below by sending a different one.
 *
 * A profile fixes the prompt, the model, and the auth policy. The policy is
 * data rather than a branch in the guard because the two capabilities cost
 * different things: an extraction request spends a page from a session's
 * allowance, an agent turn spends a message. Asking one guard to understand
 * both is how it grows a special case per caller.
 */

export type ProfileName = "bloodwork" | "clinical";

export interface AuthPolicy {
  /** Must a Turnstile-derived session back this call? */
  turnstile: boolean;
  /** What a single call consumes from the session's allowance. */
  unit: "page" | "message";
  limit: number;
}

export interface Profile {
  name: ProfileName;
  system: string;
  model: string;
  maxTokens: number;
  /** Tools the model may call. Empty means context-injection only. */
  tools: string[];
  auth: AuthPolicy;
}

/**
 * The guardrail both profiles share.
 *
 * "Describe, do not diagnose" is not politeness — it is the line that keeps a
 * demo over real lab values from being a medical device. Every number the model
 * may state has already been computed deterministically, so it has nothing left
 * to work out and no reason to estimate.
 */
const DESCRIPTIVE =
  "Odpovídej česky, stručně a POUZE popisně. Každé číslo, které uvedeš, musí " +
  "pocházet z poskytnutých dat; nikdy žádné nedopočítávej ani neodhaduj. " +
  "Hodnoty a referenční meze už byly spočítány deterministicky, ber je jako " +
  "dané. Nestanovuj diagnózu, nedoporučuj léčbu a nespekuluj o příčinách; " +
  "popiš, co se v datech změnilo, a případně doporuč konzultaci s lékařem. " +
  "Pokud se ptají na něco, co v datech není, řekni to.";

/**
 * The clinical variant reads the same except for its audience: the reader IS
 * a clinician, so "poraďte se s lékařem" would be absurd — the closing move
 * is naming what the data cannot say, not referring them onward. Everything
 * else — described not diagnosed, no number the tools did not return — is
 * identical on purpose: one guardrail, two audiences.
 */
const DESCRIPTIVE_CLINICIAN =
  "Odpovídej česky, stručně a POUZE popisně. Čtenářem je lékař. Každé číslo, " +
  "které uvedeš, musí pocházet z výsledků nástrojů; nikdy žádné nedopočítávej " +
  "ani neodhaduj. Hodnoty a referenční meze už byly spočítány deterministicky, " +
  "ber je jako dané. Nestanovuj diagnózu ani nenavrhuj léčbu — popiš, co je v " +
  "dokumentaci, a co v ní chybí, řekni výslovně.";

export const PROFILES: Record<ProfileName, Profile> = {
  /**
   * The bloodwork app's chat: the reader is looking at the data, and the whole
   * dataset is small and already on the page, so it is injected as context.
   */
  bloodwork: {
    name: "bloodwork",
    system: "Jsi asistent, který pomáhá číst výsledky krevních testů. " + DESCRIPTIVE,
    model: "claude-sonnet-5",
    maxTokens: 1200,
    tools: [],
    auth: { turnstile: true, unit: "message", limit: 40 },
  },

  /**
   * The clinical agent: the reader is not looking at anything, so it has to go
   * and get the data. Same guardrails, different reach — and the tools are
   * named here rather than sent by the client, so the client cannot widen them.
   */
  clinical: {
    name: "clinical",
    system:
      "Jsi klinický asistent ordinace. Máš nástroje, kterými si vyhledáš data " +
      "pacienta — použij je, než odpovíš, a neodpovídej z paměti. " +
      "Není-li vybraný pacient, vyhledej ho nástrojem find_patient podle " +
      "jména z otázky. Při více shodách vypiš nalezené s roky narození a " +
      "zeptej se, kterého lékař myslí; nikdy nevybírej sám. Na otázku o " +
      "pacientovi, který v kartotéce není, odpověz, že tam není. " +
      "Pacient má dva druhy záznamů: měřené hodnoty (nástroje list_analytes, " +
      "get_trend, summarize_changes) a dokumentaci v próze (search_documents, " +
      "get_document). Z dokumentů cituj, co v nich stojí; číslo, které je jen " +
      "v dokumentu, uváděj jako citaci dokumentu, nikdy je nepřepočítávej. " +
      "Výsledky nástrojů obsahují u hodnot pole src — číslo zdroje. Když " +
      "hodnotu uvedeš v odpovědi, připoj za ni [src], např. [2]. Čísla zdrojů " +
      "nikdy nevymýšlej; hodnota bez src se uvádí bez značky. " +
      DESCRIPTIVE_CLINICIAN +
      " Když má odpověď smysl doprovodit grafem, navrhni ho nástrojem " +
      "propose_chart; graf nikdy nevyplňuj sám.",
    model: "claude-sonnet-5",
    maxTokens: 2000,
    tools: ["find_patient", "search_documents", "get_document", "list_analytes", "get_trend", "summarize_changes", "propose_chart", "computed_values"],
    auth: { turnstile: true, unit: "message", limit: 40 },
  },
};

/**
 * Resolve a name the client sent.
 *
 * Returns null rather than falling back to a default: an unknown profile is a
 * bug or an attack, and quietly serving the clinical agent to either is worse
 * than refusing.
 */
export function resolveProfile(name: unknown): Profile | null {
  return typeof name === "string" && name in PROFILES
    ? PROFILES[name as ProfileName]
    : null;
}
