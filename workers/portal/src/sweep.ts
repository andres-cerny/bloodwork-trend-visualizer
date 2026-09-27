/**
 * Give back documents that will never be read.
 *
 * A document's slot is taken when the browser opens it and given back by
 * the browser when every page failed. Two cases never reach that call: the
 * tab closed (or the phone died) between the open and the first answer, and
 * a page whose answer was lost on the way. Either left the person one
 * document poorer for nothing, and nothing on the server would ever notice.
 *
 * Run from the cron trigger. An hour is long past any real read — a page
 * takes seconds to a minute — so a document opened that long ago with no
 * page read is abandoned, whatever its pages_sent says.
 */
import { SQL } from "./db";

export const ABANDONED_AFTER_MS = 60 * 60 * 1000;

export async function sweepAbandonedDocuments(db: D1Database, now = Date.now()): Promise<number> {
  const { results } = await db
    .prepare(SQL.sweepDocuments)
    .bind(new Date(now).toISOString(), new Date(now - ABANDONED_AFTER_MS).toISOString())
    .all<{ user_id: string; took_slot: number }>();
  let given = 0;
  for (const r of results ?? []) {
    if (!r.took_slot) continue;
    await db.prepare(SQL.giveBackDocument).bind(r.user_id).run();
    given++;
  }
  return given;
}
