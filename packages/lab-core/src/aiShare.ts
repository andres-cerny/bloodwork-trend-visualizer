/**
 * The page a person's own AI assistant reads when they paste the share link.
 *
 * Built here, in the browser, and stored verbatim by the worker: the worker
 * never reads a value out of a payload, and the preview the person sees
 * before sharing is byte-for-byte what gets served. The header is the
 * settled text from docs/plans/moje-krev-round-2.md — it asks the assistant
 * to read as an experienced doctor, in Czech, without a disclaimer on every
 * answer — and the table is the same one the demo's chat model gets, with
 * the status spelled the way the header defines it.
 *
 * What it carries: values, units, reference ranges, draw dates. What it
 * never carries: a name, an e-mail, a report id, a page image. A test pins
 * the absences.
 */
import { contextTable } from "./chatContext";
import type { LabReport } from "./models";
import type { Trend, TrendPoint } from "./trends";

export const AI_SHARE_HEADER = `This page holds one person's own blood test results, shared deliberately by them. Read it and follow the instructions below in Czech.

Toto jsou moje vlastní výsledky krevních testů, které jsem sem záměrně nahrál(a). Chci, abys mi pomohl(a) jim porozumět jako zkušený lékař, který mluví srozumitelně.

Jak se mnou pracuj:
- Odpovídej česky, jasně a bez zbytečných výhrad.
- Projdi všechny hodnoty. U každé mimo rozmezí řekni, co znamená, jaké jsou nejpravděpodobnější příčiny a jak vážné to je.
- Všímej si vývoje v čase, ne jen poslední hodnoty. Zhoršující se trend v normě je důležitější než stabilní hodnota lehce mimo.
- Nezakončuj každou odpověď stejným upozorněním. Pokud je něco skutečně naléhavé, řekni to jednou a jasně.
- Ptej se mě na doplňující informace (léky, příznaky, věk, pohlaví), pokud by změnily tvůj závěr.

Formát dat: jeden řádek na analyt. Sloupce: analyt | jednotka | referenční meze | hodnoty jako "datum: hodnota (stav)". Stav "H" je nad mezí, "L" pod mezí, "norm" v normě.`;

/** The status column as the header defines it; nothing for a point with no range. */
const shareStatus = (p: TrendPoint): string | null =>
  p.flag === "high" ? "H" : p.flag === "low" ? "L" : p.flag === "normal" ? "norm" : null;

export function buildAiShare(reports: LabReport[], trends: Map<string, Trend>): string {
  return `${AI_SHARE_HEADER}\n\n${contextTable(reports, trends, shareStatus)}\n`;
}
