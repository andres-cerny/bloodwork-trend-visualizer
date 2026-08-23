/**
 * The conversation as data, and the one function that grows it.
 *
 * Every turn — live from the worker, or replayed from a committed fixture —
 * reaches the screen through `applyEvent`. One code path means a fixture that
 * renders is proof the UI handles the event grammar, and a live turn that
 * renders differently is impossible rather than merely unlikely.
 *
 * A turn is a *block*, not a run of bubbles: the question, the steps the agent
 * took, what it said, the charts it named, its evidence and its proposals for
 * what to ask next. That is the unit the reader looks at, so it is the unit the
 * state holds.
 */

/** Sources arrive as an opaque registry; Sources.tsx owns their shape. */
import type { Source } from "./Sources";

/**
 * The events this app renders.
 *
 * Declared here rather than imported from the agent package: this app knows
 * the wire grammar, not the reasoning that produces it, and `@bw/agent-core`
 * is a server dependency that must never appear in an import graph the bundler
 * walks (tools/scripts/check-bundle.mjs). Every member is structurally
 * assignable from the agent's own `AgentEvent`, which is what lets the live
 * stream be fed straight into `applyEvent`.
 */
export type UiEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; id?: string; input?: unknown }
  | { type: "tool_result"; name: string; ok: boolean; summary: string; id?: string }
  | { type: "chart"; spec: unknown; series: unknown }
  | { type: "patient"; ref: string; fullName: string; birthDate: string }
  | { type: "sources"; sources: Array<{ n: number } & Record<string, unknown>> }
  | { type: "followups"; questions: string[] }
  | { type: "done"; usage?: unknown; model?: string }
  | { type: "error"; message: string };

export interface Step {
  name: string;
  /** Still running: the row is the agent's present tense. */
  pending: boolean;
  /** Once it answered, what it found — the server's own Czech. */
  summary?: string;
  ok?: boolean;
}

/**
 * The body of an answer, in arrival order.
 *
 * Steps, prose and charts interleave — the agent may say something, look
 * something else up, and then draw. Keeping arrival order is what makes the
 * transcript a record of the turn rather than a tidied-up version of it.
 */
export type Item =
  | { kind: "steps"; steps: Step[] }
  | { kind: "text"; text: string }
  | { kind: "chart"; spec: unknown; series: unknown };

export interface Block {
  id: number;
  question: string;
  items: Item[];
  sources: Source[];
  followups: string[];
  done: boolean;
  error?: string;
}

export interface Patient {
  ref: string;
  fullName: string;
  birthDate: string;
}

export interface Thread {
  blocks: Block[];
  /** Pinned by a `patient` event, never invented here. */
  patient: Patient | null;
  seq: number;
}

export const emptyThread = (): Thread => ({ blocks: [], patient: null, seq: 0 });

/** A question opens a block; everything after it lands inside that block. */
export function startTurn(t: Thread, question: string): Thread {
  return {
    ...t,
    seq: t.seq + 1,
    blocks: [
      ...t.blocks,
      { id: t.seq + 1, question, items: [], sources: [], followups: [], done: false },
    ],
  };
}

/** The answer as one string — what the API wants as history. */
export function answerText(b: Block): string {
  return b.items
    .filter((i): i is Extract<Item, { kind: "text" }> => i.kind === "text")
    .map((i) => i.text)
    .join("\n\n");
}

/** True while the turn is still arriving and has yet to say anything. */
export const awaitingFirstWord = (b: Block): boolean =>
  !b.items.some((i) => i.kind === "text" || i.kind === "chart");

function patchLast(t: Thread, patch: (b: Block) => Block): Thread {
  const i = t.blocks.length - 1;
  // Events before any question have nowhere to live. The server does not send
  // them; dropping them is still better than inventing a block for one.
  if (i < 0) return t;
  const blocks = t.blocks.slice();
  blocks[i] = patch(blocks[i]);
  return { ...t, blocks };
}

/**
 * Fold one event into the thread. Pure, so it is safe inside a React updater.
 *
 * The bug this shape exists to prevent: the old loop tracked "is a bubble
 * open?" in a mutable local read *inside* `setTurns`, and React applies
 * updaters after the loop has already moved on — so the first fragment after a
 * chart replaced the chart instead of opening a new paragraph. Here the same
 * decision is derived from the state being updated (does the last item end in
 * prose?), so there is no flag to read at the wrong time. A chart, a tool step
 * or a source registry closes the paragraph simply by being the last item.
 */
export function applyEvent(t: Thread, ev: UiEvent): Thread {
  switch (ev.type) {
    case "text":
      return patchLast(t, (b) => {
        const last = b.items[b.items.length - 1];
        if (last && last.kind === "text") {
          const items = b.items.slice();
          items[items.length - 1] = { kind: "text", text: last.text + ev.text };
          return { ...b, items };
        }
        return { ...b, items: [...b.items, { kind: "text", text: ev.text }] };
      });

    case "tool_start":
      // Showing the step is the point of streaming a tool-using turn: the agent
      // spends most of it not talking. Consecutive calls join one strip.
      return patchLast(t, (b) => {
        const step: Step = { name: ev.name, pending: true };
        const last = b.items[b.items.length - 1];
        if (last && last.kind === "steps") {
          const items = b.items.slice();
          items[items.length - 1] = { kind: "steps", steps: [...last.steps, step] };
          return { ...b, items };
        }
        return { ...b, items: [...b.items, { kind: "steps", steps: [step] }] };
      });

    case "tool_result":
      return patchLast(t, (b) => {
        const items = b.items.slice();
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it.kind !== "steps") continue;
          const k = lastPending(it.steps, ev.name);
          if (k === -1) continue;
          const steps = it.steps.slice();
          steps[k] = { name: steps[k].name, pending: false, summary: ev.summary, ok: ev.ok };
          items[i] = { kind: "steps", steps };
          return { ...b, items };
        }
        return b;
      });

    case "chart":
      return patchLast(t, (b) => ({
        ...b,
        items: [...b.items, { kind: "chart", spec: ev.spec, series: ev.series }],
      }));

    case "patient":
      // The server resolved who the conversation is about. Pin the ref; the
      // chip is what keeps a near-miss visible to the reader.
      return { ...t, patient: { ref: ev.ref, fullName: ev.fullName, birthDate: ev.birthDate } };

    case "sources":
      return patchLast(t, (b) => ({ ...b, sources: ev.sources as unknown as Source[] }));

    case "followups":
      return patchLast(t, (b) => ({ ...b, followups: ev.questions.slice(0, 3) }));

    case "error":
      return patchLast(t, (b) => ({ ...b, error: ev.message, done: true }));

    case "done":
      return patchLast(t, (b) => ({ ...b, done: true }));

    default:
      return t;
  }
}

/** The last still-running call of this tool — results arrive in order, mostly. */
function lastPending(steps: Step[], name: string): number {
  let any = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (!steps[i].pending) continue;
    if (steps[i].name === name) return i;
    if (any === -1) any = i;
  }
  return any;
}
