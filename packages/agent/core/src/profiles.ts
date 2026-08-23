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

/**
 * The line that separates the answer from the model's follow-up proposals.
 *
 * It lives here rather than in the loop because it is half of a prompt: the
 * loop only knows where to cut because this text told the model where to mark.
 *
 * At-signs are the one punctuation a Czech clinical answer never contains —
 * percent signs, angle brackets, square brackets and dashes all appear in
 * values, reference ranges and source markers, so any of those would eventually
 * eat a real sentence. ASCII and undiacriticised so the model reproduces it byte
 * for byte.
 */
export const FOLLOWUP_SENTINEL = "@@NAVAZUJICI@@";

/**
 * What to offer next.
 *
 * The demo's problem is not that the agent cannot draw a chart — it is that a
 * doctor has no way of learning it can. So the proposals are steered at the
 * agent's own unused range rather than at whatever is conversationally natural:
 * numbers with no chart under them, labs read without their documents, one
 * patient discussed while a whole practice sits behind cohort_query.
 *
 * Two limits are not stylistic. A proposal outside the nine tools is a promise
 * the next turn breaks, and a proposal phrased as a recommendation ("kontrola
 * za tři měsíce?") smuggles back exactly the advice the answer refused to give
 * — the chips are read as the agent talking, because they are. And after a
 * disambiguation question there are no proposals at all: the doctor has one
 * thing to answer, and offering three alternatives invites picking a patient by
 * accident.
 */
const FOLLOWUPS =
  " Až celou odpověď dokončíš, připoj na úplný konec samostatný řádek " +
  FOLLOWUP_SENTINEL +
  " a za něj JSON pole s jedním až třemi návrhy dalších dotazů, česky. " +
  "Každý návrh formuluj jako otázku nebo pokyn, který lékař může beze změny " +
  "odeslat jako další zprávu. Navrhuj tak, aby lékař poznal, co ještě umíš: " +
  "padla-li v odpovědi čísla bez grafu, navrhni graf; četl-li jsi jen měřené " +
  "hodnoty, navrhni dokumentaci pacienta; ukázal-li jsi vývoj, navrhni " +
  "srovnání s jiným parametrem nebo obdobím; mluvil-li jsi o jednom " +
  "pacientovi, navrhni dotaz přes celou kartotéku, ale vždy k jednomu " +
  "konkrétnímu parametru (například kterým dalším pacientům ten parametr " +
  "klesá) — vypsat kartotéku jako seznam neumíš. Návrh musí být " +
  "zodpověditelný tvými nástroji — vyhledání pacienta, kartotéka, dokumenty, " +
  "seznam parametrů, vývoj v čase, změny mezi odběry, graf, odvozené hodnoty " +
  "— a musí zůstat popisný: nikdy nenavrhuj diagnózu, léčbu, doporučení, " +
  "úvahy o příčinách ani objednání dalšího vyšetření, odběru či kontroly. " +
  "Nikdy nenavrhuj nic, co tvé nástroje neumí (objednání, odeslání, tisk, " +
  "zápis do karty). Ptáš-li se lékaře na upřesnění, například kterého ze " +
  "jmenovců myslí, řádek " +
  FOLLOWUP_SENTINEL +
  " nepřipojuj vůbec. Značku ani návrhy nikdy nezmiňuj v samotné odpovědi.";

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
      "propose_chart; graf nikdy nevyplňuj sám." +
      FOLLOWUPS,
    model: "claude-sonnet-5",
    maxTokens: 2000,
    tools: ["find_patient", "cohort_query", "search_documents", "get_document", "list_analytes", "get_trend", "summarize_changes", "propose_chart", "computed_values"],
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
