/**
 * How a follow-up proposal is scored.
 *
 * Its own module because the answer grader and the tier-1 iteration harness
 * must score a chip the same way. A word list that exists twice stops being a
 * standard the moment one copy is edited — and this one gets edited, because
 * every failing proposal is an argument about where the line is.
 *
 * Deterministic on purpose, like the rest of this suite: a chip is one short
 * formulaic sentence, which is exactly the text a regex can judge honestly.
 * Nothing here asks a model what it thinks of another model's output.
 */

export interface FollowupExpect {
  /**
   * Must the turn end with proposals at all?
   *
   * `false` is the load-bearing one. A disambiguation question must have
   * nothing under it — three alternatives beside "který ze dvou Nováků?" is
   * how a doctor picks the wrong patient by accident.
   */
  present: boolean;
  /**
   * The turn showed numbers and drew no chart, so one proposal must offer one.
   * Conditional on the turn rather than on the case: if the model charted
   * anyway, the nudge would be redundant and is not required.
   */
  chartNudgeIfChartless?: boolean;
  /** At least one proposal must reach past the chart — documents, cohort, trend. */
  beyondChart?: boolean;
}

/**
 * What a proposal may not say — two lists, two different failures.
 *
 * `OUT_OF_SCOPE` is a promise the next turn cannot keep. None of the nine tools
 * orders, sends, prints or writes anything, so a chip offering to is a dead end
 * dressed as a feature.
 *
 * `NOT_DESCRIPTIVE` is the profile's own guardrail applied to the chips,
 * because a doctor reads them as the agent talking — they are. An answer that
 * refused to recommend, under a chip offering to, has recommended.
 *
 * The roster clause in `OUT_OF_SCOPE` came out of tier-1 iteration: steered at
 * the cohort, the model kept proposing "zobraz kartotéku pacientů" — which
 * reads like the most natural next click and is the one thing the nine tools
 * cannot do. `cohort_query` needs a parameter; there is no list-everyone call.
 * Asking who else has a falling ferritin passes, and should.
 *
 * Both are deliberately narrow. "Odběr" is not banned: "co se změnilo mezi
 * posledními dvěma odběry?" is the best proposal in the suite, and only
 * *ordering* one is out of scope. Same for a control: the word appears in the
 * documents, the offer to schedule one does not belong in a chip.
 */
export const OUT_OF_SCOPE =
  /objedn|odešl|odesl|pošli|e-?mail|vytiskn|tiskn|export|nahraj|upload|naplánuj|zavolej|telefon|sms|předepi|recept|zapiš do|ulož|smaž|uprav kart|kartotéku pacient|kartotéka pacient|seznam pacient|přehled pacient|všechny pacienty/i;

export const NOT_DESCRIPTIVE =
  /diagnóz|diferenciáln|léčb|léčen|terapi|medikac|doporuč|měl by|měla by|mělo by|je vhodné|je nutné|je třeba|indikac|indikov|prognóz|riziko|rizik|příčin|\bproč\b|kontroln|dispenzariz/i;

/** A chip offering the agent's least discoverable capability. */
export const CHART_NUDGE = /graf|vykresl|křivk/i;

/** Anything that is not another chart: the documents, the practice, the trend. */
export const BEYOND_CHART =
  /dokument|zpráv|nález|protokol|fyzioterap|kartotéc|kartotéce|pacient[ůy]|ostatní|dalších pacient|kdo dal|změnilo|srovnej|porovnej|vývoj|odvozen/i;

/** Latin-script Czech: a diacritic, or a word only Czech spells this way. */
export const CZECH =
  /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]|\b(jak|jake|jaky|ktere|ktery|co|kdy|kde|graf|ukaz|zobraz|porovnej|vypis|pacient|hodnoty|dokumentace)\b/i;

export const ENGLISH =
  /\b(the|and|show|please|compare|what|which|how|with|for|from|last|value|values|chart|patient|patients|document|documents)\b/i;

/**
 * Score one turn's proposals.
 *
 * `questions` is null when the event never arrived — a pass for a
 * clarification, a failure for an answer. The loop never emits an empty list,
 * so null and "nothing worth proposing" are the same state on purpose.
 */
export function judgeFollowups(
  e: FollowupExpect,
  questions: string[] | null,
  charted: boolean,
): string[] {
  const fails: string[] = [];

  if (!e.present) {
    if (questions) fails.push(`proposed follow-ups after a clarification: ${JSON.stringify(questions)}`);
    return fails;
  }
  if (!questions) return ["no followups event"];

  if (questions.length < 1 || questions.length > 3) fails.push(`${questions.length} proposals, want 1-3`);
  for (const q of questions) {
    if (!q.trim()) fails.push("an empty proposal");
    if (!CZECH.test(q) || ENGLISH.test(q)) fails.push(`not Czech: "${q}"`);
    const scope = q.match(OUT_OF_SCOPE);
    if (scope) fails.push(`outside the toolset ("${scope[0]}"): "${q}"`);
    const advice = q.match(NOT_DESCRIPTIVE);
    if (advice) fails.push(`not descriptive ("${advice[0]}"): "${q}"`);
  }
  if (e.chartNudgeIfChartless && !charted && !questions.some((q) => CHART_NUDGE.test(q))) {
    fails.push(`numbers without a chart, and no proposal offers one: ${JSON.stringify(questions)}`);
  }
  if (e.beyondChart && !questions.some((q) => BEYOND_CHART.test(q))) {
    fails.push(`every proposal is another chart: ${JSON.stringify(questions)}`);
  }
  return fails;
}
