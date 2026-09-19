/**
 * The mapping model's run, as it happens on its own after an upload and once
 * on load (docs/plans/multi-user.md, Goal 1).
 *
 * What is pinned: only `catalog` + `high` + the evidence gate is filed
 * without a click; every answer is stored so a reload does not ask again;
 * "ask again" is the one way to ask twice; a call that fails rolls its marks
 * back and never rejects — the upload that triggered it has already stored
 * the report, and the names simply wait in the tab; two runs racing for the
 * same names ask once.
 */
import { describe, expect, it } from "vitest";
import {
  type AnalyteDef,
  type LabReport,
  Registry,
  findUnmapped,
  makeMeasurement,
  normalizeMeasurement,
  observedStats,
} from "@bw/lab-core";
import type { AiAsked, AiMapAnswer, MapSuggestion } from "../src/lib/api";
import { type Judged, judge, namesToAsk, persistable, runAiMapping, withoutAsked } from "../src/lib/aiMapping";

const m = (name: string, value: string, unit: string, ref: string, cid: string | null) =>
  normalizeMeasurement(makeMeasurement({ rawAnalyteName: name, valueRaw: value, unitRaw: unit, refRangeRaw: ref, canonicalId: cid }));

const report = (id: string, ms: ReturnType<typeof m>[]): LabReport => ({
  id,
  sourceFile: `${id}.pdf`,
  reportDate: "2026-09-19",
  labName: "Lab",
  patientName: null,
  patientId: null,
  pages: [],
  measurements: ms,
});

const def = (id: string, name: string, unit: string, referenceRange?: [number, number]): AnalyteDef => ({
  canonicalId: id,
  displayNameCs: name,
  synonyms: [],
  canonicalUnit: unit,
  unitConversions: {},
  ...(referenceRange ? { referenceRange } : {}),
});

const REGISTRY = new Registry([
  def("sodik", "Sodík", "mmol/l", [137, 145]),
  def("draslik", "Draslík", "mmol/l", [3.5, 5.1]),
  def("ft4", "T4 volný (fT4)", "pmol/l", [12, 22]),
  def("glukoza", "Glukóza", "mmol/l", [4.1, 5.6]),
]);

/** Four unmapped blood names, one urine row, one word-valued row. */
const REPORTS = [
  report("r1", [
    m("S_Na", "140", "mmol/l", "134 - 148", null),
    m("S_K", "4,2", "mmol/l", "3,5 - 5,1", null),
    m("S_T4 celkový", "100", "nmol/l", "66,0 - 181,0", null),
    m("S_Glukosa", "95", "mg/dl", "70 - 100", null),
    m("U_pH", "6", "", "", null),
    m("S_HBsAg", "negativní", "", "", null),
  ]),
];

const sug = (over: Partial<MapSuggestion> & { rawName: string }): MapSuggestion => ({
  decision: "catalog",
  canonicalId: null,
  proposed: null,
  reason: "r",
  confidence: "high",
  ...over,
});

const answer = (suggestions: MapSuggestion[]): AiMapAnswer => ({
  suggestions,
  model: "claude-haiku-4-5",
  budget: { spentUsd: 0, budgetUsd: 5, frozen: false, remainingUsd: 5, month: "2026-09" },
});

const unmapped = () => findUnmapped(REPORTS);
const stats = () => observedStats(REPORTS);
const AT = "2026-09-19";

describe("namesToAsk", () => {
  it("asks only what is unmapped, trendable and never asked", () => {
    const names = namesToAsk(unmapped(), {}).map((a) => a.rawName);
    expect(names).toEqual(["S_Na", "S_K", "S_T4 celkový", "S_Glukosa"]);
    const asked: AiAsked = { S_Na: { decision: "catalog", canonicalId: "sodik", confidence: "high", reason: "", model: "", at: AT } };
    expect(namesToAsk(unmapped(), asked).map((a) => a.rawName)).toEqual(["S_K", "S_T4 celkový", "S_Glukosa"]);
  });

  it("treats a name being asked right now as asked — the dedupe between an upload and a load", () => {
    const asking: AiAsked = { S_Na: { decision: "unknown", canonicalId: null, confidence: "low", reason: "", model: "", at: AT, asking: true } };
    expect(namesToAsk(unmapped(), asking).map((a) => a.rawName)).not.toContain("S_Na");
  });
});

describe("judge", () => {
  const judged = () =>
    judge(
      answer([
        // Sodium: high, unit agrees, interval agrees — filed.
        sug({ rawName: "S_Na", canonicalId: "sodik", reason: "Na je sodík." }),
        // Potassium: the same evidence, but the model is only "medium" — shown, not filed.
        sug({ rawName: "S_K", canonicalId: "draslik", confidence: "medium", reason: "K je draslík." }),
        // Total T4 named as free T4: "high" but nmol/l is not pmol/l — the gate refuses it.
        sug({ rawName: "S_T4 celkový", canonicalId: "ft4", reason: "T4." }),
        // Glucose in mg/dl: the model did the right thing and said unknown.
        sug({ rawName: "S_Glukosa", decision: "unknown", confidence: "low", reason: "mg/dl není mmol/l." }),
      ]),
      unmapped().filter((a) => ["S_Na", "S_K", "S_T4 celkový", "S_Glukosa"].includes(a.rawName)),
      REGISTRY,
      stats(),
      AT,
    );

  it("files only catalog + high + the evidence gate", () => {
    const j = judged();
    expect(j.applied).toEqual([{ rawName: "S_Na", canonicalId: "sodik" }]);
    expect(j.entries.S_Na.applied).toBe(true);
    expect(j.entries.S_K.applied).toBeUndefined();
    expect(j.entries["S_T4 celkový"].applied).toBeUndefined();
  });

  it("stores every answer with decision, id, confidence, reason, model and date", () => {
    const j = judged();
    expect(j.entries.S_K).toEqual({ decision: "catalog", canonicalId: "draslik", confidence: "medium", reason: "K je draslík.", model: "claude-haiku-4-5", at: AT });
    expect(j.entries.S_Glukosa).toMatchObject({ decision: "unknown", canonicalId: null, confidence: "low", reason: "mg/dl není mmol/l." });
    expect(Object.keys(j.entries).sort()).toEqual(["S_Glukosa", "S_K", "S_Na", "S_T4 celkový"]);
  });

  it("records a name the model skipped as unknown, so it is not asked again on the next load", () => {
    const j = judge(answer([]), unmapped().filter((a) => a.rawName === "S_Na"), REGISTRY, stats(), AT);
    expect(j.entries.S_Na).toMatchObject({ decision: "unknown", canonicalId: null, confidence: "low" });
    expect(j.entries.S_Na.reason).not.toBe("");
    expect(j.applied).toEqual([]);
  });

  it("parks not_blood and keeps a new proposal for the founding form", () => {
    const j = judge(
      answer([
        sug({ rawName: "S_Na", decision: "not_blood", confidence: "high" }),
        sug({ rawName: "S_K", decision: "new", proposed: { id: "kalium", displayNameCs: "Kalium", unit: "mmol/l" } }),
      ]),
      unmapped().filter((a) => ["S_Na", "S_K"].includes(a.rawName)),
      REGISTRY,
      stats(),
      AT,
    );
    expect(j.parked).toEqual(["S_Na"]);
    expect(j.entries.S_K.proposed).toEqual({ id: "kalium", displayNameCs: "Kalium", unit: "mmol/l" });
    expect(j.applied).toEqual([]);
  });

  it("a catalog id the registry no longer holds is a suggestion nobody can click, never a mapping", () => {
    const j = judge(answer([sug({ rawName: "S_Na", canonicalId: "gone" })]), unmapped().filter((a) => a.rawName === "S_Na"), REGISTRY, stats(), AT);
    expect(j.applied).toEqual([]);
    expect(j.entries.S_Na.canonicalId).toBe("gone");
  });
});

/** A fake account: the record in memory, and what each effect was called with. */
function harness(asked: AiAsked = {}) {
  const ref = { current: asked };
  const calls = { ask: 0, marked: [] as string[][], unmarked: [] as string[][], committed: [] as Judged[] };
  const effects = {
    mark: (names: string[]) => {
      calls.marked.push(names);
      const next = { ...ref.current };
      for (const n of names) next[n] = { decision: "unknown", canonicalId: null, confidence: "low", reason: "", model: "", at: AT, asking: true };
      ref.current = next;
    },
    unmark: (names: string[]) => {
      calls.unmarked.push(names);
      const next = { ...ref.current };
      for (const n of names) delete next[n];
      ref.current = next;
    },
    commit: (j: Judged) => {
      calls.committed.push(j);
      ref.current = { ...ref.current, ...j.entries };
    },
  };
  return { ref, calls, effects };
}

const run = (h: ReturnType<typeof harness>, ask: (names: unknown[]) => Promise<AiMapAnswer>, candidates = unmapped()) =>
  runAiMapping(
    {
      candidates,
      asked: () => h.ref.current,
      registry: REGISTRY,
      stats: stats(),
      ask: (names) => {
        h.calls.ask += 1;
        return ask(names);
      },
      now: () => AT,
    },
    h.effects,
  );

describe("runAiMapping", () => {
  it("asks, files what passes, and stores the rest", async () => {
    const h = harness();
    const out = await run(h, async () => answer([sug({ rawName: "S_Na", canonicalId: "sodik" }), sug({ rawName: "S_K", canonicalId: "draslik", confidence: "medium" })]));
    expect(out).toEqual({ asked: 4, error: null });
    expect(h.calls.committed[0].applied).toEqual([{ rawName: "S_Na", canonicalId: "sodik" }]);
    expect(Object.keys(h.ref.current).sort()).toEqual(["S_Glukosa", "S_K", "S_Na", "S_T4 celkový"]);
    expect(Object.values(h.ref.current).some((e) => e.asking)).toBe(false);
  });

  it("does not ask again on load: every name already answered means no call at all", async () => {
    const h = harness();
    await run(h, async () => answer([sug({ rawName: "S_K", canonicalId: "draslik", confidence: "medium" })]));
    expect(h.calls.ask).toBe(1);
    const again = await run(h, async () => {
      throw new Error("must not be called");
    });
    expect(again).toEqual({ asked: 0, error: null });
    expect(h.calls.ask).toBe(1);
  });

  it("asks again after the button: the names are forgotten first, then asked", async () => {
    const h = harness();
    await run(h, async () => answer([sug({ rawName: "S_K", canonicalId: "draslik", confidence: "medium" })]));
    h.ref.current = withoutAsked(h.ref.current, ["S_K", "S_Na"]);
    expect(Object.keys(h.ref.current).sort()).toEqual(["S_Glukosa", "S_T4 celkový"]);
    const out = await run(h, async (names) => {
      expect((names as Array<{ rawName: string }>).map((n) => n.rawName)).toEqual(["S_Na", "S_K"]);
      return answer([sug({ rawName: "S_K", canonicalId: "draslik", confidence: "high", reason: "Podruhé." })]);
    });
    expect(out.asked).toBe(2);
    expect(h.calls.ask).toBe(2);
    expect(h.ref.current.S_K).toMatchObject({ confidence: "high", reason: "Podruhé.", applied: true });
  });

  it("never rejects when /api/map throws: the marks roll back, nothing is committed, the names wait", async () => {
    const h = harness();
    const out = await run(h, async () => {
      throw new Error("502");
    });
    expect(out.asked).toBe(4);
    expect(out.error).toBeInstanceOf(Error);
    expect(h.calls.marked).toEqual([["S_Na", "S_K", "S_T4 celkový", "S_Glukosa"]]);
    expect(h.calls.unmarked).toEqual([["S_Na", "S_K", "S_T4 celkový", "S_Glukosa"]]);
    expect(h.calls.committed).toEqual([]);
    expect(h.ref.current).toEqual({});
    // And they are asked next time, because nothing says they were.
    expect(namesToAsk(unmapped(), h.ref.current)).toHaveLength(4);
  });

  it("two runs racing for the same names ask once — the mark is written before the call", async () => {
    const h = harness();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = run(h, async () => {
      await gate;
      return answer([sug({ rawName: "S_Na", canonicalId: "sodik" })]);
    });
    // The load's run arrives while the upload's is still out.
    const fast = await run(h, async () => answer([]));
    expect(fast).toEqual({ asked: 0, error: null });
    release();
    await slow;
    expect(h.calls.ask).toBe(1);
    expect(h.calls.committed).toHaveLength(1);
  });

  it("two documents of one batch sharing a name ask it once — the second run asks only what is its own", async () => {
    // Portal's storeAndMap runs the model per stored report, for that
    // report's names; two sheets from one laboratory print the same names.
    // The first report's call is still out when the second report lands.
    const first = report("r1", [m("S_Na", "140", "mmol/l", "134 - 148", null), m("S_K", "4,2", "mmol/l", "3,5 - 5,1", null)]);
    const second = report("r2", [m("S_Na", "141", "mmol/l", "134 - 148", null), m("S_Glukosa", "95", "mg/dl", "70 - 100", null)]);
    const h = harness();
    const sent: string[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const firstRun = run(
      h,
      async (names) => {
        sent.push((names as Array<{ rawName: string }>).map((n) => n.rawName));
        await gate;
        return answer([sug({ rawName: "S_Na", canonicalId: "sodik" })]);
      },
      findUnmapped([first]),
    );
    const secondRun = await run(
      h,
      async (names) => {
        sent.push((names as Array<{ rawName: string }>).map((n) => n.rawName));
        return answer([]);
      },
      findUnmapped([first, second]).filter((a) => ["S_Na", "S_Glukosa"].includes(a.rawName)),
    );
    expect(secondRun.asked, "the shared name is in flight; only the new one goes").toBe(1);
    release();
    await firstRun;
    expect(sent).toEqual([["S_Na", "S_K"], ["S_Glukosa"]]);
    expect(h.calls.ask).toBe(2);
    // Every name has one entry and S_Na's is the first run's answer.
    expect(Object.keys(h.ref.current).sort()).toEqual(["S_Glukosa", "S_K", "S_Na"]);
    expect(h.ref.current.S_Na).toMatchObject({ canonicalId: "sodik", applied: true });
  });
});

describe("persistable", () => {
  it("strips the in-flight marks, so a name mid-call is never saved as answered", () => {
    const h = harness();
    h.effects.mark(["S_Na"]);
    h.effects.commit({ entries: { S_K: { decision: "unknown", canonicalId: null, confidence: "low", reason: "x", model: "m", at: AT } }, applied: [], parked: [] });
    expect(Object.keys(persistable(h.ref.current))).toEqual(["S_K"]);
  });
});
