/**
 * The canned conversations, and the replayer that puts them on screen.
 *
 * A sidebar entry that does nothing reads as broken, so the histories are real:
 * each is the SSE event log of a turn that actually happened, captured once and
 * committed. Replaying one costs no API call and no session — which is also why
 * the screenshot harness can drive every state deterministically.
 *
 * The replay runs the events through `applyEvent`, the same function the live
 * stream uses. That is the point of the exercise: a fixture that renders is
 * evidence the UI handles the event grammar, not evidence that a second,
 * parallel renderer agrees with itself.
 */
import {
  applyEvent,
  newCursor,
  startBlock,
  type Block,
  type ChatEvent,
  type Effects,
  type Patient,
} from "./events";

export interface Fixture {
  slug: string;
  title: string;
  tenant: string;
  turns: Array<{ user: string; events: ChatEvent[] }>;
}

/**
 * Eager, because a history has to appear the instant it is clicked — a dynamic
 * import would put a network round trip in front of a feature whose whole claim
 * is that it needs none. All six are ~52 KB together.
 */
const modules = import.meta.glob("./fixtures/*/*.json", { eager: true, import: "default" });

const ALL: Fixture[] = Object.entries(modules)
  .map(([path, data]) => {
    const slug = path.replace(/^.*\//, "").replace(/\.json$/, "");
    const fx = data as Omit<Fixture, "slug">;
    return { ...fx, slug };
  })
  .sort((a, b) => a.slug.localeCompare(b.slug));

export const fixturesFor = (tenant: string): Fixture[] =>
  ALL.filter((f) => f.tenant === tenant);

export const findFixture = (tenant: string, slug: string | null): Fixture | null =>
  (slug && ALL.find((f) => f.tenant === tenant && f.slug === slug)) || null;

export interface Replay {
  blocks: Block[];
  patient: Patient | null;
  /** The last turn was cut short by `&step=`: the UI should look mid-stream. */
  streaming: boolean;
  nextId: number;
}

/**
 * Fold a fixture into transcript state.
 *
 * `step` truncates the **last** turn only — earlier turns replay in full — so
 * `?fx=…&step=8` is a conversation caught in the middle of its newest answer,
 * which is exactly the state that is otherwise impossible to photograph.
 */
export function replayFixture(fx: Fixture, step: number | null, on: Effects = {}): Replay {
  const cur = newCursor();
  let blocks: Block[] = [];
  let patient: Patient | null = null;
  let streaming = false;

  const effects: Effects = {
    ...on,
    patient: (p) => {
      patient = p;
      on.patient?.(p);
    },
    // A replay spends nothing, so `done` must not go looking for a ledger.
    done: () => {},
  };

  fx.turns.forEach((turn, i) => {
    const last = i === fx.turns.length - 1;
    const events = last && step !== null ? turn.events.slice(0, Math.max(0, step)) : turn.events;
    if (last && step !== null && events.length < turn.events.length) streaming = true;
    blocks = startBlock(turn.user, cur)(blocks);
    for (const ev of events) blocks = applyEvent(ev, cur, effects)(blocks);
  });

  return { blocks, patient, streaming, nextId: cur.nextId };
}
