/**
 * The two-model union. The case that earns its keep is the third one: a row
 * only one model returned. That is how silent under-extraction is caught —
 * a model dropping most of a page and reporting what it did read with high
 * confidence looks perfect from a single read.
 */
import { describe, expect, it } from "vitest";
import { reconcile, type RawRead } from "../src/lib/reconcile";

const row = (name: string, value: string, unit = "mmol/l", ref = "(4,11-5,60)") => ({
  raw_analyte_name: name,
  value_raw: value,
  unit_raw: unit,
  ref_range_raw: ref,
  source_snippet: `${name} ${value}`,
  confidence: "high" as const,
});

const sonnet = (rows: any[]): RawRead => ({ model: "claude-sonnet-5", measurements: rows });
const opus = (rows: any[]): RawRead => ({ model: "claude-opus-4-8", measurements: rows });

describe("reconcile", () => {
  it("marks an agreed row clean", () => {
    const [m] = reconcile([sonnet([row("S_Glukóza", "5,32")]), opus([row("S_Glukóza", "5,32")])]);
    expect(m.disagreement).toBeNull();
    expect(m.value).toBe(5.32);
    expect(m.escalated).toBe(true);
  });

  it("flags a value the models read differently, naming both readings", () => {
    const [m] = reconcile([sonnet([row("S_Glukóza", "5,32")]), opus([row("S_Glukóza", "5,82")])]);
    expect(m.disagreement).toContain("5,32");
    expect(m.disagreement).toContain("5,82");
  });

  it("names the readings rather than the model that produced them", () => {
    // A model id means nothing to a clinician; the two numbers mean everything.
    const [m] = reconcile([sonnet([row("S_Glukóza", "5,32")]), opus([row("S_Glukóza", "5,82")])]);
    expect(m.disagreement).not.toContain("claude");
    expect(m.disagreement).not.toContain("opus");
  });

  it("flags a row only one model saw — the under-extraction case", () => {
    const rows = reconcile([
      sonnet([row("S_Glukóza", "5,32"), row("S_CRP", "<1,0", "mg/l", "(1,0-5,0)")]),
      opus([row("S_Glukóza", "5,32")]),
    ]);
    const crp = rows.find((r) => r.rawAnalyteName === "S_CRP")!;
    expect(crp.disagreement).toContain("jedno ze dvou čtení");
    const glu = rows.find((r) => r.rawAnalyteName === "S_Glukóza")!;
    expect(glu.disagreement).toBeNull();
  });

  it("treats differently-prefixed spellings as the same row", () => {
    // One model keeps the material prefix, the other drops it. Without
    // normalizing the key, both survive and each looks like the other model
    // missed it — two false flags instead of one clean row.
    const rows = reconcile([sonnet([row("S_Glukóza", "5,32")]), opus([row("Glukóza", "5,32")])]);
    expect(rows).toHaveLength(1);
    expect(rows[0].disagreement).toBeNull();
  });

  it("raises no disagreement when only one model ran", () => {
    const rows = reconcile([sonnet([row("S_Glukóza", "5,32"), row("S_CRP", "<1,0")])]);
    expect(rows.every((r) => r.disagreement === null)).toBe(true);
    expect(rows.every((r) => r.escalated === false)).toBe(true);
  });

  it("still derives values deterministically, not from the model", () => {
    const [m] = reconcile([sonnet([row("S_Glukóza", "1,97")])]);
    expect(m.value).toBe(1.97);
    expect(m.flag).toBe("low"); // 1,97 against (4,11-5,60)
  });

  it("never invents a number for a censored value", () => {
    const [m] = reconcile([sonnet([row("S_CRP", "<1,0", "mg/l", "(1,0-5,0)")])]);
    expect(m.value).toBeNull();
    expect(m.flag).toBe("unknown");
  });
});
