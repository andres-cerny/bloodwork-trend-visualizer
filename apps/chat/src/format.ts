/**
 * Display formatting, and nothing else.
 *
 * The server labels evidence and summarises tool calls in Czech but writes
 * dates as ISO — „Odběr 2023-02-14", „otevřel Zpráva ze sportovní prohlídky
 * (2026-02-27)". ISO is right on the wire and wrong on screen: a doctor reads
 * 14. 2. 2023. Only the rendering changes here; the text is otherwise passed
 * through exactly as it arrived.
 */

const ISO = /(\d{4})-(\d{2})-(\d{2})/g;

export const czDate = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}`
    : iso;

/** Every ISO date inside a sentence, rewritten in place. */
export const czDates = (text: string): string =>
  text.replace(ISO, (_, y, m, d) => `${Number(d)}. ${Number(m)}. ${y}`);
