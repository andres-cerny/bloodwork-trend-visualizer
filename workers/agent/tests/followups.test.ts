/**
 * The follow-up tail, at the level the loop actually sees it.
 *
 * These sit beside routes.test.ts and use the same fake-stream harness idea —
 * a stubbed global fetch answering with Anthropic SSE frames — but they drive
 * `runAgent` directly, because the thing under test is where the deltas get
 * cut, and only a caller that chooses the delta boundaries can prove that the
 * cut survives them. routes.test.ts splits its text at a fixed offset; here the
 * split IS the test.
 *
 * The failure these exist to prevent is not "no chips". It is `@@NAV` appearing
 * mid-sentence in a doctor's answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent, PROFILES, FOLLOWUP_SENTINEL, parseFollowups, type AgentEvent } from "@bw/agent-core";
import { SessionSource } from "@bw/datasource";
import type { ToolContext } from "@bw/agent-tools";

/** One report, enough for a tool round-trip to have something to read. */
const REPORT = {
  id: "r-1",
  sourceFile: "r-1.pdf",
  reportDate: "2025-05-02",
  labName: "Laboratoř Test",
  patientName: "Karel Tester",
  patientId: null,
  pages: [],
  measurements: [
    {
      rawAnalyteName: "S_Hemoglobin", valueRaw: "150", unitRaw: "g/l",
      refRangeRaw: "(135-175)", sourceSnippet: "S_Hemoglobin 150", sourcePage: 1,
      confidence: "high", canonicalId: "hemoglobin", value: 150, unit: "g/l",
      refRangeLow: 135, refRangeHigh: 175, refRangeText: "135-175", flag: "normal",
      extractedBy: "test", escalated: false, disagreement: null, corrected: false, bbox: null,
    },
  ],
};

/**
 * An Anthropic stream whose text arrives in exactly these pieces.
 *
 * The whole point of the harness: `["Hb 150 g/l.\n\n@@NAV", "AZUJICI@@\n[\"…\"]"]`
 * is a boundary the real API is free to choose and the loop has to survive.
 */
function anthropicStream(pieces: string[], toolUse?: { name: string; input: unknown }) {
  const ev = (t: string, d: unknown) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
  const blocks: string[] = [];

  blocks.push(ev("message_start", {
    type: "message_start",
    message: {
      id: "msg_stream", type: "message", role: "assistant", model: "claude-sonnet-5",
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }));

  blocks.push(ev("content_block_start", {
    type: "content_block_start", index: 0, content_block: { type: "text", text: "" },
  }));
  for (const piece of pieces) {
    blocks.push(ev("content_block_delta", {
      type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece },
    }));
  }
  blocks.push(ev("content_block_stop", { type: "content_block_stop", index: 0 }));

  if (toolUse) {
    blocks.push(ev("content_block_start", {
      type: "content_block_start", index: 1,
      content_block: { type: "tool_use", id: "toolu_1", name: toolUse.name, input: {} },
    }));
    blocks.push(ev("content_block_delta", {
      type: "content_block_delta", index: 1,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(toolUse.input) },
    }));
    blocks.push(ev("content_block_stop", { type: "content_block_stop", index: 1 }));
  }

  blocks.push(ev("message_delta", {
    type: "message_delta",
    delta: { stop_reason: toolUse ? "tool_use" : "end_turn", stop_sequence: null },
    usage: { output_tokens: 50 },
  }));
  blocks.push(ev("message_stop", { type: "message_stop" }));

  return new Response(blocks.join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** Streams to hand out, in order; the last one repeats. */
let queue: Array<{ pieces: string[]; toolUse?: { name: string; input: unknown } }> = [];

beforeEach(() => {
  queue = [];
  vi.stubGlobal("fetch", async () => {
    const spec = queue.length > 1 ? queue.shift()! : queue[0] ?? { pieces: ["ok"] };
    return anthropicStream(spec.pieces, spec.toolUse);
  });
});
afterEach(() => vi.unstubAllGlobals());

async function turn(data?: ToolContext): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const ev of runAgent({
    apiKey: "sk-ant-test",
    profile: PROFILES.clinical,
    history: [{ role: "user", content: "Co se změnilo?" }],
    data: data ?? { source: new SessionSource([REPORT as never]) },
  })) {
    out.push(ev);
  }
  return out;
}

const textOf = (events: AgentEvent[]) =>
  events.filter((e): e is Extract<AgentEvent, { type: "text" }> => e.type === "text").map((e) => e.text).join("");

const followupsOf = (events: AgentEvent[]) =>
  events.find((e): e is Extract<AgentEvent, { type: "followups" }> => e.type === "followups");

describe("the follow-up tail", () => {
  it("survives a sentinel split across delta boundaries", async () => {
    queue = [{
      pieces: [
        "Hemoglobin je 150 g/l [1].",
        "\n\n@@NAV",
        "AZU",
        "JICI@@\n[\"Ukaž graf vývoje hemoglobinu.\", \"Co je v dokumentaci?\"]",
      ],
    }];
    const events = await turn();

    // Not one character of scaffolding reached the reader.
    expect(textOf(events)).toBe("Hemoglobin je 150 g/l [1].");
    expect(textOf(events)).not.toContain("@");
    expect(followupsOf(events)!.questions).toEqual([
      "Ukaž graf vývoje hemoglobinu.",
      "Co je v dokumentaci?",
    ]);
  });

  it("splits the sentinel at every offset there is, and never leaks one", async () => {
    const answer = "Ferritin klesl na 21 µg/l [1].";
    const tail = `\n\n${FOLLOWUP_SENTINEL}\n["Ukaž graf ferritinu v čase."]`;
    const whole = answer + tail;

    for (let cut = 1; cut < whole.length; cut++) {
      queue = [{ pieces: [whole.slice(0, cut), whole.slice(cut)] }];
      const events = await turn();
      expect(textOf(events), `cut at ${cut}`).toBe(answer);
      expect(followupsOf(events)!.questions, `cut at ${cut}`).toEqual([
        "Ukaž graf ferritinu v čase.",
      ]);
    }
  });

  it("emits nothing when the model proposed nothing", async () => {
    queue = [{ pieces: ["Hodnota není v dokumentaci.", " Nic dalšího tam není."] }];
    const events = await turn();

    expect(textOf(events)).toBe("Hodnota není v dokumentaci. Nic dalšího tam není.");
    expect(followupsOf(events)).toBeUndefined();
    expect(events.at(-1)!.type).toBe("done");
  });

  it("swallows a malformed tail instead of showing it", async () => {
    queue = [{
      pieces: ["Hemoglobin je 150 g/l.", `\n\n${FOLLOWUP_SENTINEL}\n["Ukaž graf`],
    }];
    const events = await turn();

    // Truncated JSON: no chips, and no half-written question under the answer.
    expect(textOf(events)).toBe("Hemoglobin je 150 g/l.");
    expect(followupsOf(events)).toBeUndefined();
    expect(events.at(-1)!.type).toBe("done");
  });

  it("flushes a false alarm — text that only looked like the sentinel", async () => {
    // "@@" starts the sentinel and then stops being it. Held, then released.
    queue = [{ pieces: ["Poznámka: adresa je @", "@ordinace.cz, kontakt platí."] }];
    const events = await turn();

    expect(textOf(events)).toBe("Poznámka: adresa je @@ordinace.cz, kontakt platí.");
    expect(followupsOf(events)).toBeUndefined();
  });

  it("flushes a held suffix that the stream simply ended on", async () => {
    // An answer whose last character begins the sentinel and never continues.
    queue = [{ pieces: ["Hodnota vzrostla o 10 %", " @"] }];
    const events = await turn();

    expect(textOf(events)).toBe("Hodnota vzrostla o 10 % @");
    expect(followupsOf(events)).toBeUndefined();
  });

  it("puts the chips after the sources and before done", async () => {
    queue = [
      { pieces: [""], toolUse: { name: "get_trend", input: { canonicalId: "hemoglobin" } } },
      { pieces: [`Hemoglobin 150 g/l [1].\n\n${FOLLOWUP_SENTINEL}\n["Ukaž graf hemoglobinu."]`] },
    ];
    const events = await turn();
    const types = events.map((e) => e.type);

    // The client draws the registry, then the chips, then stops the spinner.
    expect(types.slice(-3)).toEqual(["sources", "followups", "done"]);
  });

  it("drops a tail the model emitted before asking for a tool", async () => {
    queue = [
      {
        pieces: [`Podívám se.\n\n${FOLLOWUP_SENTINEL}\n["Předčasný návrh."]`],
        toolUse: { name: "list_analytes", input: {} },
      },
      { pieces: ["Hemoglobin 150 g/l."] },
    ];
    const events = await turn();

    // Proposals belong to a finished answer. One made mid-turn is scaffolding
    // out of place — dropped, and never streamed either way.
    expect(textOf(events)).toBe("Podívám se.Hemoglobin 150 g/l.");
    expect(followupsOf(events)).toBeUndefined();
  });

  it("caps at three and drops what is not a question", async () => {
    expect(parseFollowups('["a","b","c","d"]')).toEqual(["a", "b", "c"]);
    expect(parseFollowups('["a", 7, null, "b"]')).toEqual(["a", "b"]);
    expect(parseFollowups('["Ukaž graf.", "ukaž graf."]')).toEqual(["Ukaž graf."]);
    expect(parseFollowups('\n["  Ukaž graf.  "]\n')).toEqual(["Ukaž graf."]);
  });

  it("returns nothing for a tail that is not a list of questions", async () => {
    expect(parseFollowups("")).toEqual([]);
    expect(parseFollowups("Ukaž graf.")).toEqual([]);
    expect(parseFollowups('["a"')).toEqual([]);
    expect(parseFollowups(`["${"x".repeat(300)}"]`)).toEqual([]);
    // A stray citation marker in the tail is a number, not a question.
    expect(parseFollowups("Zdroj [1].")).toEqual([]);
  });

  it("takes the array out of a wrapper the model added around it", async () => {
    // Leniency with a limit: the questions are real, only the packaging is
    // wrong. Anything that does not yield strings still yields no chips.
    expect(parseFollowups('{"otazky": ["Ukaž graf."]}')).toEqual(["Ukaž graf."]);
    expect(parseFollowups('```json\n["Ukaž graf."]\n```')).toEqual(["Ukaž graf."]);
  });
});
