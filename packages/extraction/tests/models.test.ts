/**
 * The request each reader model is sent, and what a reply that is not a
 * record does.
 *
 * Stubbed fetch, no key: the point is the request body. Sonnet 5.5 400s on a
 * forced tool and on `thinking: disabled`; Haiku 5.5 and Sonnet 5.5 400 on a
 * non-default temperature; Haiku 4.5 400s on `output_config.effort`. Each of
 * those is a production outage that only a live call would otherwise show.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { extractPage, extractPageText } from "../src/extract";
import { suggestCanonical } from "../src/map";
import { readerShape, recordInput, toolFor, UnusableReplyError } from "../src/models";
import { billedUsage } from "../src/gemini";
import { resolveReaderModel } from "../src/extract";

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function reply(model: string, over: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage,
    content: [
      {
        type: "tool_use",
        id: "tu_1",
        name: "record_lab_results",
        input: {
          report_date: null, report_date_raw: null, lab_name: null, patient_name: null, patient_id: null,
          measurements: [{ raw_analyte_name: "S_Glukóza", value_raw: "5,32", unit_raw: "mmol/l", ref_range_raw: "3,9 - 5,6", row_index: 0, confidence: "high" }],
        },
      },
    ],
    ...over,
  };
}

/** Stub fetch; return every request body sent and answer with `body(model)`. */
function stub(body: (model: string) => unknown) {
  const sent: any[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const req = JSON.parse(String(init.body));
    sent.push(req);
    return new Response(JSON.stringify(body(req.model)), { status: 200, headers: { "content-type": "application/json" } });
  });
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("readerShape", () => {
  it("keeps the deployed request byte for byte on Sonnet 5 and Haiku 4.5", () => {
    for (const m of ["claude-sonnet-5", "claude-haiku-4-5"]) {
      const s = readerShape(m, "record_lab_results");
      expect(s.tool_choice).toEqual({ type: "tool", name: "record_lab_results" });
      expect(s.extra).toEqual({});
      expect(s.nudge).toBeNull();
    }
  });

  it("never sends effort to Haiku 4.5, which rejects it", () => {
    expect(readerShape("claude-haiku-4-5", "t", { effort: "low" }).extra).toEqual({});
    expect(readerShape("claude-haiku-5-5", "t", { effort: "low" }).extra).toEqual({ output_config: { effort: "low" } });
  });

  it("Sonnet 5.5: auto + strict + a nudge, thinking off the only way it accepts", () => {
    const s = readerShape("claude-sonnet-5-5", "record_lab_results");
    expect(s.tool_choice).toEqual({ type: "auto" });
    expect(s.extra).toEqual({ thinking: { type: "between_tools" } });
    expect(s.nudge).toContain("record_lab_results");
    expect((toolFor("claude-sonnet-5-5", { name: "x" }) as any).strict).toBe(true);
    expect((toolFor("claude-haiku-5-5", { name: "x" }) as any).strict).toBeUndefined();
  });

  it("Haiku 5.5 keeps the forced tool (which skips its default thinking)", () => {
    const s = readerShape("claude-haiku-5-5", "record_lab_results");
    expect(s.tool_choice).toEqual({ type: "tool", name: "record_lab_results" });
    expect(s.extra).toEqual({});
  });

  it("Opus 5.5 cannot turn thinking off; it gets low effort and no forced tool", () => {
    const s = readerShape("claude-opus-5-5", "t");
    expect(s.tool_choice).toEqual({ type: "auto" });
    expect(s.extra).toEqual({ output_config: { effort: "low" } });
  });
});

describe("the request actually sent", () => {
  it("text path on Sonnet 5.5 carries no forced tool, no disabled thinking, no temperature", async () => {
    const sent = stub((m) => reply(m));
    const x = await extractPageText("k", "claude-sonnet-5-5", "0\tS_Glukóza | 5,32 | mmol/l");
    const req = sent[0];
    expect(req.tool_choice).toEqual({ type: "auto" });
    expect(req.thinking).toEqual({ type: "between_tools" });
    expect(req.temperature).toBeUndefined();
    expect(req.tools[0].strict).toBe(true);
    expect(req.messages.at(-1).role).toBe("user");
    expect(req.messages[0].content).toContain("record_lab_results");
    expect(x.measurements).toHaveLength(1);
  });

  it("text path on Sonnet 5 is unchanged: forced tool, no strict, no nudge", async () => {
    const sent = stub((m) => reply(m));
    await extractPageText("k", "claude-sonnet-5", "0\tS_Glukóza | 5,32 | mmol/l");
    const req = sent[0];
    expect(req.tool_choice).toEqual({ type: "tool", name: "record_lab_results" });
    expect(req.thinking).toBeUndefined();
    expect(req.tools[0].strict).toBeUndefined();
    expect(req.messages[0].content).not.toContain("Odpověz výhradně");
  });

  it("image path on Sonnet 5.5 adds the nudge as its own block after the instruction", async () => {
    const sent = stub((m) => reply(m));
    await extractPage("k", "claude-sonnet-5-5", "AAAA", "image/png", null);
    const blocks = sent[0].messages[0].content;
    expect(blocks.at(-1).text).toContain("record_lab_results");
    expect(sent[0].tool_choice).toEqual({ type: "auto" });
  });

  it("the mapping call follows the same shape", async () => {
    const sent = stub((m) => ({
      ...reply(m),
      content: [{ type: "tool_use", id: "t", name: "file_names", input: { suggestions: [] } }],
    }));
    await suggestCanonical("k", "claude-sonnet-5-5", [{ rawName: "S_Na", unit: "mmol/l", refRange: "", material: "s" }], [{ id: "sodik", name: "Sodík", unit: "mmol/l" }]);
    expect(sent[0].tool_choice).toEqual({ type: "auto" });
    expect(sent[0].tools[0].strict).toBe(true);
    await suggestCanonical("k", "claude-haiku-5-5", [{ rawName: "S_Na", unit: "mmol/l", refRange: "", material: "s" }], [{ id: "sodik", name: "Sodík", unit: "mmol/l" }]);
    expect(sent[1].tool_choice).toEqual({ type: "tool", name: "file_names" });
    // The catalog is the same on every batch: first, and cached (H12).
    const content = sent[1].messages[0].content;
    expect(content[0].text).toMatch(/^Katalog/);
    expect(content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(content[1].text).toContain('"S_Na"');
  });
});

describe("a reply that is not a record fails the read, billed", () => {
  const msg = (over: Record<string, unknown>) => reply("claude-sonnet-5-5", over) as any;
  const u = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };

  it("cut off at max_tokens — a partial page must not pass as a whole one", () => {
    expect(() => recordInput(msg({ stop_reason: "max_tokens" }), "m", u, "record_lab_results")).toThrow(UnusableReplyError);
  });

  it("declined", () => {
    expect(() => recordInput(msg({ stop_reason: "refusal", content: [] }), "m", u, "record_lab_results")).toThrow(/declined/);
  });

  it("no tool call, which auto allows", () => {
    expect(() =>
      recordInput(msg({ stop_reason: "end_turn", content: [{ type: "text", text: "Zde jsou výsledky…" }] }), "m", u, "record_lab_results"),
    ).toThrow(/no tool call/);
  });

  it("the Worker can still price it", async () => {
    stub((m) => reply(m, { stop_reason: "max_tokens" }));
    const err = await extractPageText("k", "claude-haiku-5-5", "0\tx").catch((e) => e);
    expect(err).toBeInstanceOf(UnusableReplyError);
    expect(billedUsage(err)).toEqual({ model: "claude-haiku-5-5", usage: u });
  });
});

describe("resolveReaderModel", () => {
  it("takes an allowed id and falls back on anything else", () => {
    expect(resolveReaderModel("claude-haiku-5-5", "claude-haiku-4-5")).toBe("claude-haiku-5-5");
    expect(resolveReaderModel(" claude-sonnet-5-5 ", "claude-sonnet-5")).toBe("claude-sonnet-5-5");
    expect(resolveReaderModel("claude-sonet-5-5", "claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(resolveReaderModel(undefined, "claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(resolveReaderModel("gpt-9", "claude-sonnet-5")).toBe("claude-sonnet-5");
  });
});
