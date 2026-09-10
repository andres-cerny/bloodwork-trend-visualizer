/**
 * PUT /api/settings replaces the blob: a save from one screen must carry the
 * other screen's field, or the first save of an AI context would erase the
 * learned synonyms and the next accepted mapping would erase the context.
 */
import { describe, expect, it } from "vitest";
import { mergeSettings } from "../src/lib/settings";

const learned = { glukoza: ["S_Glukóza"] };
const aiContext = { sex: "m" as const, ageBand: "30-34" as const };

describe("mergeSettings", () => {
  it("keeps the learned synonyms when the context is saved, and the context when a mapping is", () => {
    const a = mergeSettings({ learned }, { aiContext });
    expect(a).toEqual({ learned, aiContext });
    const b = mergeSettings(a, { learned: { ...learned, crp: ["S_CRP"] } });
    expect(b.aiContext).toEqual(aiContext);
    expect(b.learned).toEqual({ glukoza: ["S_Glukóza"], crp: ["S_CRP"] });
  });

  it("clears a field only when told to, and never touches the input", () => {
    const current = { learned, aiContext };
    const cleared = mergeSettings(current, { aiContext: undefined });
    expect(cleared).toEqual({ learned });
    expect("aiContext" in cleared).toBe(false);
    expect(current.aiContext).toEqual(aiContext);
    expect(JSON.stringify(cleared)).not.toContain("aiContext");
  });
});
