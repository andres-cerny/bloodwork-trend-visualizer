/**
 * One event grammar, one place that applies it.
 *
 * A live turn and a canned replay differ only in where the events come from —
 * the network or a JSON file in the bundle. They must not differ in what the
 * events *mean*, or a fixture that renders proves nothing about the live path.
 * So `applyEvent` is the only code that turns an `AgentEvent` into transcript
 * state, and both callers go through it.
 *
 * The shape of that function is not incidental. It takes the mutable cursor
 * (`opened`, `answer`) and returns a *pure* updater, because the ordering bug
 * this cost a session to find lives exactly there: React applies a state
 * updater after the event loop has already moved on, so a flag read inside the
 * updater is read too late. Reading it here — synchronously, at enqueue time —
 * is what keeps the first text fragment after a tool or a chart opening a new
 * bubble instead of replacing the chart.
 */
import type { Source } from "./Sources";

/**
 * What the client understands, structurally compatible with `AgentEvent` in
 * @bw/agent-core/events. Restated rather than imported: the chat bundle must
 * not gain a dependency on the agent package (check-bundle guards the barrel),
 * and every member here is assignable from its counterpart there, so the live
 * generator's events type-check straight into `applyEvent`.
 */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; id?: string; name: string; input?: unknown }
  | { type: "tool_result"; id?: string; name?: string; ok: boolean; summary: string }
  | { type: "chart"; spec: unknown; series: unknown }
  | { type: "patient"; ref: string; fullName: string; birthDate: string }
  | { type: "sources"; sources: unknown }
  | { type: "followups"; questions: string[] }
  | { type: "done"; usage?: unknown; model?: string }
  | { type: "error"; message: string };

export interface Patient {
  ref: string;
  fullName: string;
  birthDate: string;
}

/** A tool the agent reached for, and how it went. */
export interface Step {
  name: string;
  pending: boolean;
  ok?: boolean;
  summary?: string;
}

/** The answer's body: prose the model streamed, and charts the server filled. */
export type Part =
  | { kind: "text"; text: string }
  | { kind: "chart"; chart: { spec: unknown; series: unknown } };

/**
 * One question and everything the turn produced for it.
 *
 * Grouping by question rather than keeping a flat message list is what lets the
 * evidence rail say *which* answer it is showing, and what lets a `[n]` in one
 * answer address its own registry rather than the newest one.
 */
export interface Block {
  id: number;
  question: string;
  steps: Step[];
  parts: Part[];
  sources: Source[];
  followups: string[];
}

/** Mutable between events of one turn; never read inside a state updater. */
export interface Cursor {
  opened: boolean;
  answer: string;
  nextId: number;
}

export const newCursor = (nextId = 1): Cursor => ({ opened: false, answer: "", nextId });

/** Side effects that belong to the app, not to the transcript. */
export interface Effects {
  patient?: (p: Patient) => void;
  error?: (message: string) => void;
  done?: () => void;
}

type Updater = (blocks: Block[]) => Block[];

const editLast = (blocks: Block[], fn: (b: Block) => Block): Block[] =>
  blocks.length === 0 ? blocks : [...blocks.slice(0, -1), fn(blocks[blocks.length - 1])];

/** A new question opens a block and starts the cursor over. */
export function startBlock(question: string, cur: Cursor): Updater {
  const id = cur.nextId++;
  cur.opened = false;
  cur.answer = "";
  return (blocks) => [
    ...blocks,
    { id, question, steps: [], parts: [], sources: [], followups: [] },
  ];
}

export function applyEvent(ev: ChatEvent, cur: Cursor, on: Effects = {}): Updater {
  switch (ev.type) {
    case "text": {
      cur.answer += ev.text;
      // Decided NOW, not inside the updater. React applies updaters after this
      // loop has already flipped `opened`, and reading the mutable flag at
      // apply time made the first fragment after a chart replace the chart
      // instead of opening a new bubble.
      const replaceLast = cur.opened;
      const text = cur.answer;
      cur.opened = true;
      return (blocks) =>
        editLast(blocks, (b) => ({
          ...b,
          parts: [
            ...(replaceLast ? b.parts.slice(0, -1) : b.parts),
            { kind: "text", text },
          ],
        }));
    }

    case "tool_start": {
      // The next text opens a NEW bubble, so the accumulator starts over —
      // reusing it repainted everything said before the tool into the new one.
      cur.opened = false;
      cur.answer = "";
      const name = ev.name;
      return (blocks) =>
        editLast(blocks, (b) => ({ ...b, steps: [...b.steps, { name, pending: true }] }));
    }

    case "tool_result": {
      const { ok, summary } = ev;
      return (blocks) =>
        editLast(blocks, (b) => {
          // findLastIndex needs ES2023; this targets ES2022 and the array is a
          // turn's tool calls, not a dataset.
          let i = -1;
          for (let k = b.steps.length - 1; k >= 0; k--) {
            if (b.steps[k].pending) {
              i = k;
              break;
            }
          }
          if (i === -1) return b;
          const steps = [...b.steps];
          steps[i] = { ...steps[i], pending: false, ok, summary };
          return { ...b, steps };
        });
    }

    case "chart": {
      cur.opened = false;
      cur.answer = "";
      const chart = { spec: ev.spec, series: ev.series };
      return (blocks) =>
        editLast(blocks, (b) => ({ ...b, parts: [...b.parts, { kind: "chart", chart }] }));
    }

    case "sources": {
      cur.opened = false;
      cur.answer = "";
      const sources = (ev.sources ?? []) as Source[];
      return (blocks) => editLast(blocks, (b) => ({ ...b, sources }));
    }

    case "followups": {
      const questions = ev.questions ?? [];
      return (blocks) => editLast(blocks, (b) => ({ ...b, followups: questions }));
    }

    case "patient": {
      // The server resolved who the conversation is about. Pin the ref; the
      // chip is what keeps a near-miss visible.
      on.patient?.({ ref: ev.ref, fullName: ev.fullName, birthDate: ev.birthDate });
      return (blocks) => blocks;
    }

    case "error": {
      on.error?.(ev.message);
      return (blocks) => blocks;
    }

    case "done": {
      on.done?.();
      return (blocks) => blocks;
    }

    default:
      return (blocks) => blocks;
  }
}
