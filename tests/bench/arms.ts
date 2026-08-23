/**
 * The arms under test. Data, not code, so a loop iteration adds a hypothesis
 * by appending here rather than by touching the runner.
 *
 * A0 is the deployed configuration and must stay byte-faithful to
 * worker/claude.ts — every other arm is read as a diff against it, so if A0
 * drifts the whole sweep loses its origin.
 *
 * Iteration 1 is the eight arms below. Iterations 2 and 3 append two arms
 * each, earned from what the previous iteration's data showed.
 */
import type { Arm } from "./extract";

export const PRIMARY = "claude-sonnet-5";
export const ESCALATION = "claude-opus-4-8";
export const CHEAP = "claude-haiku-4-5";

export const ITERATION_1: Arm[] = [
  {
    id: "A0",
    label: "deployed baseline",
    why:
      "Sonnet 5 + Opus 4.8, both on every page, effort default (high), no " +
      "thinking parameter, full source_snippet. What the demo does today.",
    readers: [{ model: PRIMARY }, { model: ESCALATION }],
    anchor: "snippet",
    escalation: "always",
  },
  {
    id: "A1",
    label: "effort: low",
    why:
      "Column assignment over rows that are already reconstructed is a " +
      "mechanical copy. If reasoning depth buys nothing, high effort is pure " +
      "latency.",
    readers: [
      { model: PRIMARY, effort: "low" },
      { model: ESCALATION, effort: "low" },
    ],
    anchor: "snippet",
    escalation: "always",
  },
  {
    id: "A2",
    label: "effort: low + thinking off",
    why:
      "Omitting `thinking` makes Sonnet 5 adaptive but leaves Opus 4.8 off, " +
      "so the two readers behave differently today by accident. `thought` in " +
      "the results says whether that is actually happening under a forced " +
      "tool_choice, rather than assuming it from the docs.",
    readers: [
      { model: PRIMARY, effort: "low", thinking: "disabled" },
      { model: ESCALATION, effort: "low", thinking: "disabled" },
    ],
    anchor: "snippet",
    escalation: "always",
  },
  {
    id: "A3",
    label: "row_index instead of source_snippet",
    why:
      "The deployed schema makes the model echo every printed row back. A " +
      "45-row page re-emits 45 rows for one line of display in VerifyTab. " +
      "The row came from the client; an integer index points at it exactly, " +
      "and output tokens are what latency is made of.",
    readers: [
      { model: PRIMARY, effort: "low", thinking: "disabled" },
      { model: ESCALATION, effort: "low", thinking: "disabled" },
    ],
    anchor: "index",
    escalation: "always",
  },
  {
    id: "A4",
    label: "single reader (Sonnet 5)",
    why:
      "Drops the cross-check entirely. The cheapest possible latency, and the " +
      "arm that says what the second opinion is actually worth.",
    readers: [{ model: PRIMARY, effort: "low", thinking: "disabled" }],
    anchor: "index",
    escalation: "always",
  },
  {
    id: "A5",
    label: "Sonnet 5 + Haiku 4.5 cross-check",
    why:
      "Keeps disagreement-flagging — the demo's most persuasive feature — " +
      "with a much faster second reader. docs/web-demo-plan.md already argues " +
      "a weaker second model degrades into 'more rows to review' rather than " +
      "into silent wrongness, which is exactly the trade being made here.",
    readers: [
      { model: PRIMARY, effort: "low", thinking: "disabled" },
      { model: CHEAP, effort: undefined, thinking: "disabled" },
    ],
    anchor: "index",
    escalation: "always",
  },
  {
    id: "A6",
    label: "escalate only on flag",
    why:
      "The Worker runs both readers on every page; the Python pipeline only " +
      "escalates flagged ones. Should cut the median page to one round-trip " +
      "at the cost of two on the dirty ones — better median, worse tail.",
    readers: [
      { model: PRIMARY, effort: "low", thinking: "disabled" },
      { model: ESCALATION, effort: "low", thinking: "disabled" },
    ],
    anchor: "index",
    escalation: "onFlag",
  },
];

/**
 * Docling is not an API arm — no model, no network, no per-page cost. It runs
 * as a separate engine in the runner and exists to answer one question the
 * Claude arms cannot: how far above the floor any of them sit.
 */
export const DOCLING_ARM = {
  id: "A7",
  label: "Docling (local, no model)",
  why:
    "Matches predicted table structure back onto the PDF's own text cells — " +
    "the same job the LLM does on the text path, with no model in it. Sets " +
    "the speed ceiling.",
};

/**
 * Iteration 2 — two arms, both earned from what iteration 1's numbers showed
 * rather than from what was predicted before the sweep started.
 *
 * The grid killed A1 and A2: `effort` and `thinking` moved latency by only
 * 2-6%, and every response came back with `think=no` anyway, because a forced
 * `tool_choice` already suppresses adaptive thinking. Two of the three
 * hypotheses the plan led with were simply wrong.
 *
 * What the same numbers pointed at instead: a dense page spends ~4,200 output
 * tokens at roughly 154 tokens/second. Latency is almost entirely the model
 * re-typing cells it was just handed. So both new arms attack output volume —
 * one by not sending pages that contain nothing, the other by not returning
 * text at all.
 *
 * A8 needs no API call to evaluate: which pages carry zero measurement rows is
 * already known from Stage 0, and what those pages cost is already known from
 * the grid. It is scored as an analysis, not run as an arm.
 */
export const ITERATION_2: Arm[] = [
  {
    id: "A9",
    label: "column map (integers only)",
    why:
      "The model returns which cell index holds name/value/unit/range and " +
      "which rows are measurements — no transcription at all. Output should " +
      "fall from ~4,200 tokens to a few hundred, and since no text comes back, " +
      "a fabricated value stops being detectable and becomes unrepresentable. " +
      "The real question is ragged rows, where a missing unit shifts the " +
      "columns; that is what `overrides` and the derived confidence test.",
    readers: [{ model: PRIMARY, effort: "low", thinking: "disabled" }],
    anchor: "index",
    mode: "columnMap",
    escalation: "always",
  },
  {
    id: "A9b",
    label: "column map on Haiku 4.5",
    why:
      "If the job really is four integers and a list of row numbers, it may " +
      "not need a frontier model at all. This is the arm that says whether " +
      "the column map moved the work into reach of the cheapest, fastest " +
      "reader available.",
    readers: [{ model: CHEAP, thinking: "disabled" }],
    anchor: "index",
    mode: "columnMap",
    escalation: "always",
  },
];
export const ITERATION_3: Arm[] = [];

export function allArms(): Arm[] {
  return [...ITERATION_1, ...ITERATION_2, ...ITERATION_3];
}

export function armById(id: string): Arm | undefined {
  return allArms().find((a) => a.id === id);
}
