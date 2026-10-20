/**
 * Mapping through the NČLP table: a lookup hit needs no model; the model only
 * ever picks from the shortlist it was shown; its pick must agree with the
 * printed specimen. Stubbed fetch, real compact index.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LabCodes, type LabCodeTable } from "@bw/lab-core";

import { mapByCodes, specimenAgrees } from "../src/codeMap";

const codes = new LabCodes(JSON.parse(readFileSync(join(import.meta.dirname, "../../lab-core/codes/lab-codes.index.json"), "utf8")) as LabCodeTable);
const catalog = [
  { id: "sodik", name: "Sodík", unit: "mmol/l" },
  { id: "glukoza", name: "Glukóza", unit: "mmol/l" },
  { id: "cystatin_c", name: "Cystatin C", unit: "mg/l" },
];
const name = (rawName: string, unit = "mmol/l", material: string | null = null) => ({ rawName, unit, refRange: "", material });

function stub(pick: (body: any) => Record<string, unknown>) {
  const sent: any[] = [];
  vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push(body);
    return new Response(
      JSON.stringify({
        id: "m", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null,
        usage: { input_tokens: 500, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        content: [{ type: "tool_use", id: "t", name: "pick_code", input: pick(body) }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  return sent;
}
afterEach(() => vi.unstubAllGlobals());

describe("mapByCodes", () => {
  it("a lookup hit linked to one catalog entry maps with no model call", async () => {
    const sent = stub(() => ({ code: "unknown", confidence: "low", reason: "" }));
    const r = await mapByCodes("k", "claude-haiku-5-5", [name("S_Na"), name("Sodík")], catalog, codes);
    expect(sent).toHaveLength(0);
    expect(r.suggestions.map((s) => [s.decision, s.canonicalId, s.confidence, s.code])).toEqual([
      ["catalog", "sodik", "high", "02503"],
      ["catalog", "sodik", "high", "02503"],
    ]);
  });

  it("a hit the client's catalog does not link is a 'new' proposal carrying its code", async () => {
    stub(() => ({ code: "unknown", confidence: "low", reason: "" }));
    const r = await mapByCodes("k", "claude-haiku-5-5", [name("S_Cystatin C", "mg/l")], catalog.slice(0, 2), codes);
    expect(r.suggestions[0]).toMatchObject({ decision: "new", code: "09511" });
    expect(r.suggestions[0].proposed?.id).toBe("nclp_09511");
  });

  it("no hit: the model picks from the shortlist — enum of its codes + unknown, nothing else", async () => {
    const sent = stub((body) => {
      const enumCodes = body.tools[0].input_schema.properties.code.enum as string[];
      return { code: enumCodes[0], confidence: "high", reason: "r" };
    });
    const r = await mapByCodes("k", "claude-haiku-5-5", [name("Natrémie sérová")], catalog, codes, "shortlist");
    expect(sent).toHaveLength(1);
    const e = sent[0].tools[0].input_schema.properties.code.enum as string[];
    expect(e).toHaveLength(21);
    expect(e.at(-1)).toBe("unknown");
    expect(sent[0].system).toContain("NČLP");
    expect(JSON.stringify(sent[0].messages)).not.toContain("Katalog");
    expect(r.suggestions[0].code).toBe(e[0]);
  });

  it("default step: the lookup's leftovers go to today's whole-catalog call, and get a code where the entry links one", async () => {
    const sent: any[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sent.push(body);
      return new Response(
        JSON.stringify({
          id: "m", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null,
          usage: { input_tokens: 500, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          content: [{ type: "tool_use", id: "t", name: "file_names", input: { suggestions: [{ raw_name: "Natrémie sérová", decision: "catalog", canonical_id: "sodik", new_id: null, new_name_cs: null, new_unit: null, reason: "r", confidence: "high" }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const r = await mapByCodes("k", "claude-haiku-5-5", [name("S_Na"), name("Natrémie sérová")], catalog, codes);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0].messages)).toContain("Natrémie sérová");
    expect(JSON.stringify(sent[0].messages)).not.toContain('"S_Na"');
    expect(r.suggestions.map((s) => [s.canonicalId, s.code])).toEqual([["sodik", "02503"], ["sodik", "02503"]]);
  });

  it("an unlinked exact hit is 'high' only with codes-retry and the model agreeing", async () => {
    const two = catalog.slice(0, 2);
    // The stub answers the catalog call with nothing and a pick with `pickCode`.
    let pickCode = "09511";
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const tool = body.tools[0].name as string;
      const input = tool === "file_names" ? { suggestions: [] } : { code: pickCode, confidence: "high", reason: "r" };
      return new Response(
        JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: "tool_use", id: "t", name: tool, input }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const plain = await mapByCodes("k", "claude-haiku-5-5", [name("S_Cystatin C", "mg/l")], two, codes);
    expect(plain.suggestions[0]).toMatchObject({ decision: "new", code: "09511", confidence: "medium" });
    const agreed = await mapByCodes("k", "claude-haiku-5-5", [name("S_Cystatin C", "mg/l")], two, codes, "catalog+shortlist");
    expect(agreed.suggestions[0]).toMatchObject({ decision: "new", code: "09511", confidence: "high" });
    pickCode = "08241"; // the plasma row: not the same code
    const other = await mapByCodes("k", "claude-haiku-5-5", [name("S_Cystatin C", "mg/l")], two, codes, "catalog+shortlist");
    expect(other.suggestions[0].confidence).toBe("medium");
    const loose = await mapByCodes("k", "claude-haiku-5-5", [name("Cystatin C", "")], two, codes, "catalog+shortlist");
    expect(loose.suggestions[0].confidence).toBe("medium");
  });

  it("an unlinked hit is only a draft: a catalog answer for the same name wins", async () => {
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: "tool_use", id: "t", name: "file_names", input: { suggestions: [{ raw_name: "S_Cystatin C", decision: "catalog", canonical_id: "sodik", new_id: null, new_name_cs: null, new_unit: null, reason: "r", confidence: "high" }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const r = await mapByCodes("k", "claude-haiku-5-5", [name("S_Cystatin C", "mg/l")], catalog.slice(0, 2), codes);
    expect(r.suggestions[0]).toMatchObject({ decision: "catalog", canonicalId: "sodik" });
  });

  it("catalog+shortlist: only the catalog call's 'unknown' answers get the shortlist", async () => {
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const tool = body.tools[0].name as string;
      sent.push(tool);
      const input =
        tool === "file_names"
          ? { suggestions: [{ raw_name: "Natrémie sérová", decision: "unknown", canonical_id: null, new_id: null, new_name_cs: null, new_unit: null, reason: "?", confidence: "low" }, { raw_name: "Kalémie", decision: "catalog", canonical_id: "sodik", new_id: null, new_name_cs: null, new_unit: null, reason: "r", confidence: "medium" }] }
          : { code: (body.tools[0].input_schema.properties.code.enum as string[])[0], confidence: "medium", reason: "r" };
      return new Response(
        JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: "tool_use", id: "t", name: tool, input }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const r = await mapByCodes("k", "claude-haiku-5-5", [name("Natrémie sérová"), name("Kalémie")], catalog, codes, "catalog+shortlist");
    expect(sent).toEqual(["file_names", "pick_code"]);
    expect(r.suggestions[0].code).toBeTruthy();
    expect(r.suggestions[1]).toMatchObject({ decision: "catalog", canonicalId: "sodik" });
  });

  it("a code outside the shortlist is read as unknown", async () => {
    stub(() => ({ code: "99999", confidence: "high", reason: "" }));
    const r = await mapByCodes("k", "claude-haiku-5-5", [name("Natrémie sérová")], catalog, codes, "shortlist");
    expect(r.suggestions[0]).toMatchObject({ decision: "unknown", code: null });
  });

  it("a pick whose specimen contradicts the printed prefix drops to 'low'", async () => {
    // The model picks a serum row from the shortlist for a name printed B_ (whole blood).
    stub((body) => ({ code: (body.tools[0].input_schema.properties.code.enum as string[]).find((c) => codes.byId(c)?.mat === "s"), confidence: "high", reason: "r" }));
    const r = await mapByCodes("k", "claude-haiku-5-5", [name("B_Glykémie žilní")], catalog, codes, "shortlist");
    expect(r.suggestions[0].code).toBeTruthy();
    expect(codes.byId(r.suggestions[0].code!)!.mat).toBe("s");
    expect(r.suggestions[0].confidence).toBe("low");
  });
});

describe("specimenAgrees", () => {
  it("compares only a prefix it can read", () => {
    const row = codes.byId("01898")!; // S glucose
    expect(specimenAgrees("S_Glukóza", row)).toBe(true);
    expect(specimenAgrees("B_Glukóza", row)).toBe(false);
    expect(specimenAgrees("Glukóza", row)).toBe(true);
    expect(specimenAgrees("X_Glukóza", row)).toBe(false); // punctate: the table has no such rows
    expect(specimenAgrees("PE_Hořčík v ery", row)).toBe(false);
    expect(specimenAgrees("xxx_Glukóza", row)).toBe(true); // unreadable prefix: no evidence
  });
});
