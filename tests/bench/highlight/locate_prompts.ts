/**
 * The locate asks for arms C, G, M (docs/plans/photo-highlight.md).
 *
 * A separate pass after reading, never a change to the deployed reading call:
 * the reader has already returned its rows (name, value, unit, the printed row
 * as it read it), and this call is asked only *where* each one is printed.
 *
 * The same text goes to a Claude subagent (tier 1, free) and would go to
 * Gemini (tier 2, paid, after approval), so the two arms differ in the model
 * and nothing else. Subagents receive it verbatim through the task file
 * `subagent_dump.ts` writes, never a paraphrase.
 */

/** Arm C / G: a box per row, in the Gemini-native convention. */
export const LOCATE_BOX = `Na fotografii je stránka laboratorní zprávy. Čtečka z ní už přečetla řádky výsledků; seznam je níže (index, název, hodnota, jednotka a řádek tak, jak ho čtečka přečetla).

Tvůj úkol je jen najít, KDE na fotografii je každý z těchto řádků vytištěn. Nic nepřepisuj a hodnoty neopravuj.

Pro každý řádek vrať obdélník, který obepíná celý vytištěný řádek (od názvu vyšetření po poslední údaj téhož řádku), ve formátu box_2d = [ymin, xmin, ymax, xmax], souřadnice normalizované na 0–1000 vzhledem k celé fotografii (0,0 je levý horní roh).

Chybný obdélník je horší než žádný: člověk podle něj kontroluje hodnotu a rámeček na sousedním řádku by chybu zakryl. Pokud si nejsi jistý, na kterém řádku hodnota je (řádek nenajdeš, je nečitelný, nebo by mohl být na dvou místech), vrať pro něj box_2d: null.

Odpověz pouze JSON polem, jeden prvek na každý řádek seznamu, ve stejném pořadí:
[{"i": 0, "box_2d": [ymin, xmin, ymax, xmax]}, {"i": 1, "box_2d": null}, ...]`;

/** Arm M: set-of-marks. The OCR rows are drawn and numbered on the image. */
export const LOCATE_MARK = `Na fotografii je stránka laboratorní zprávy. Na obrázek jsou zakresleny tenké obdélníky kolem řádků textu, které našlo OCR; každý má vlevo od sebe číslo. Čtečka ze stránky už přečetla řádky výsledků; seznam je níže (index, název, hodnota, jednotka a řádek tak, jak ho čtečka přečetla).

Tvůj úkol je jen určit, ve kterém očíslovaném obdélníku je každý z těchto řádků vytištěn. Nic nepřepisuj a hodnoty neopravuj.

Vyber obdélník, ve kterém leží hodnota daného řádku i jeho název. Chybné číslo je horší než žádné: člověk podle rámečku kontroluje hodnotu a rámeček na sousedním řádku by chybu zakryl. Pokud žádný obdélník nesedí, řádek je rozdělen do více obdélníků, nebo si nejsi jistý, vrať pro něj mark: null.

Odpověz pouze JSON polem, jeden prvek na každý řádek seznamu, ve stejném pořadí:
[{"i": 0, "mark": 12}, {"i": 1, "mark": null}, ...]`;

/** The row list both asks append, one line per reader row. */
export function rowList(rows: Array<{ raw_analyte_name?: string; value_raw?: string; unit_raw?: string; source_snippet?: string }>): string {
  return rows
    .map((r, i) => JSON.stringify({ i, name: r.raw_analyte_name ?? "", value: r.value_raw ?? "", unit: r.unit_raw ?? "", printed: r.source_snippet ?? "" }))
    .join("\n");
}
