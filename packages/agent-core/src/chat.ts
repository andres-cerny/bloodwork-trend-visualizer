/**
 * Answering a question about a patient's results.
 *
 * Today this injects the already-normalised values as context. That is about to
 * change: once the agent can query a data source, the numbers come back through
 * tools instead — see the note on context injection in docs/constraints.md.
 * What does not change is the guarantee underneath: every number the model may
 * state was computed deterministically before it ever saw it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { clientFor, usageOf, type Usage } from "./client";

export const MODEL_CHAT = "claude-sonnet-5";

const SYSTEM_CHAT =
  "Jsi asistent, který pomáhá číst výsledky krevních testů. Odpovídej česky, " +
  "stručně a POUZE popisně. Máš k dispozici strukturovaná data níže — každé " +
  "číslo, které uvedeš, musí pocházet z těchto dat; nikdy žádné nedopočítávej " +
  "ani neodhaduj. Hodnoty a referenční meze už byly spočítány deterministicky, " +
  "ber je jako dané. Nestanovuj diagnózu, nedoporučuj léčbu a nespekuluj o " +
  "příčinách; popiš, co se v datech změnilo, a případně doporuč konzultaci " +
  "s lékařem. Pokud se ptají na něco, co v datech není, řekni to.";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Answer a question about the already-extracted data.
 *
 * The normalized values are injected as context rather than fetched through
 * tools: the dataset is small and already deterministic, so this keeps every
 * number the model can see traceable to the parsing layer.
 */
export async function chat(
  apiKey: string,
  dataContext: string,
  history: ChatTurn[],
): Promise<{ text: string; usage: Usage; model: string }> {
  const message = await clientFor(apiKey).messages.create({
    model: MODEL_CHAT,
    max_tokens: 1200,
    // The instructions are stable; the patient's data changes per session, so
    // the breakpoint sits between them.
    system: [
      { type: "text", text: SYSTEM_CHAT, cache_control: { type: "ephemeral" } },
      { type: "text", text: `=== DATA PACIENTA ===\n${dataContext}` },
    ],
    messages: history.slice(-12),
  });
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { text, usage: usageOf(message.usage), model: MODEL_CHAT };
}
