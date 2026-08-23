/**
 * Canned conversations, replayed.
 *
 * A sidebar item that does nothing reads as broken, so the histories are real:
 * each is the SSE event log of one captured turn, committed as JSON, and
 * replayed through the same `applyEvent` a live turn uses. No session, no API
 * call, no waiting — and no second rendering path that could drift from the
 * live one.
 *
 * Synthetic patients only. Fixtures live in git and in dist, which is exactly
 * the rule that keeps the real record out of both.
 */
import { applyEvent, emptyThread, startTurn, type Thread, type UiEvent } from "./thread";

export interface Fixture {
  slug: string;
  title: string;
  tenant: string;
  turns: Array<{ user: string; events: UiEvent[] }>;
}

/**
 * Eager, because the whole set is 52 KB and a history that arrives one frame
 * after the click is a history that flickers. Vite inlines them into the
 * bundle; nothing is fetched.
 */
const FILES = import.meta.glob("./fixtures/*/*.json", { eager: true }) as Record<
  string,
  { default: Omit<Fixture, "slug"> }
>;

export const FIXTURES: Record<string, Fixture[]> = {};

for (const [path, mod] of Object.entries(FILES)) {
  const m = /\.\/fixtures\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!m) continue;
  const [, tenant, slug] = m;
  (FIXTURES[tenant] ??= []).push({ ...mod.default, slug, tenant });
}
// Stable order, so the rail does not reshuffle between builds.
for (const list of Object.values(FIXTURES)) list.sort((a, b) => a.slug.localeCompare(b.slug, "cs"));

export const findFixture = (tenant: string, slug: string): Fixture | null =>
  FIXTURES[tenant]?.find((f) => f.slug === slug) ?? null;

/**
 * Fold a fixture into a thread.
 *
 * `step` stops partway through the **last** turn — the mid-stream state, with
 * a tool step still running and the answer not yet written. Earlier turns are
 * always applied in full, so the paused turn has the context it had live.
 */
export function replay(fx: Fixture, step?: number | null): Thread {
  let t = emptyThread();
  fx.turns.forEach((turn, i) => {
    const last = i === fx.turns.length - 1;
    const events = last && step != null ? turn.events.slice(0, Math.max(0, step)) : turn.events;
    t = startTurn(t, turn.user);
    for (const ev of events) t = applyEvent(t, ev);
  });
  return t;
}

/** True when `step` cut the last turn short: the UI should look mid-flight. */
export function isPaused(fx: Fixture, step?: number | null): boolean {
  if (step == null) return false;
  const last = fx.turns[fx.turns.length - 1];
  return step < (last?.events.length ?? 0);
}
