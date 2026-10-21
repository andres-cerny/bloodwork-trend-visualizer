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
import { type Judged, autoEntriesFrom, autoEntryDef, judge, judgeSecondOpinion, namesToAsk, persistable, runAiMapping, runSecondOpinion, scopeOf, sharedLessons, withoutAsked } from "../src/lib/aiMapping";

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

describe("sharedLessons (VITE_SHARE_AI_MAPPINGS)", () => {
  const judged = {
    entries: {},
    applied: [
      { rawName: "S_K", canonicalId: "draslik" },
      { rawName: "Můj test", canonicalId: "custom_abc" },
    ],
    parked: [],
  };
  const shipped = (id: string) => id !== "custom_abc";
  it("off by default: nothing is taught to every account", () => {
    expect(sharedLessons(judged, shipped, false)).toEqual([]);
  });
  it("on: only filings onto a shipped entry", () => {
    expect(sharedLessons(judged, shipped, true)).toEqual([{ rawName: "S_K", canonicalId: "draslik" }]);
  });
});

describe("judgeSecondOpinion (VITE_SECOND_OPINION)", () => {
  const weak = (rawName: string, unitRaw: string, listId: string) => ({
    analyte: { rawName, unitRaw, occurrences: [{ reportId: "r", date: null, valueRaw: "1", value: 1, page: 1 }], refRange: null, refRangeRaw: "", refRangeFrom: null, material: null, materialSource: null },
    listId,
    lab: "Stod",
    why: "unit" as const,
  });
  const reg = new Registry([def("glukoza", "Glukóza", "mmol/l"), def("sodik", "Sodík", "mmol/l"), def("draslik", "Draslík", "mmol/l")]);

  it("confirms when the model names the list's entry, unasked", () => {
    const [o] = judgeSecondOpinion(answer([sug({ rawName: "Glukóza", canonicalId: "glukoza", confidence: "medium" })]), [weak("Glukóza", "mmol/L", "glukoza")], reg, new Map());
    expect(o).toMatchObject({ verdict: "confirm", canonicalId: "glukoza", lab: "Stod", unit: "mmol/L" });
  });

  it("remaps only on 'high' with the evidence for the new entry", () => {
    const [o] = judgeSecondOpinion(answer([sug({ rawName: "X", canonicalId: "draslik" })]), [weak("X", "mmol/l", "sodik")], reg, new Map());
    expect(o).toMatchObject({ verdict: "remap", canonicalId: "draslik" });
    const [p] = judgeSecondOpinion(answer([sug({ rawName: "X", canonicalId: "draslik", confidence: "medium" })]), [weak("X", "mmol/l", "sodik")], reg, new Map());
    expect(p).toMatchObject({ verdict: "unmap", canonicalId: null });
  });

  it("takes the row off the list's entry on unknown / not blood — a person decides", () => {
    for (const d of ["unknown", "not_blood", "new"] as const) {
      const [o] = judgeSecondOpinion(answer([sug({ rawName: "Glukóza", decision: d })]), [weak("Glukóza", "arb.j.", "glukoza")], reg, new Map());
      expect(o.verdict).toBe("unmap");
    }
  });

  it("a name the model did not answer is skipped, not decided", () => {
    const [o] = judgeSecondOpinion(answer([]), [weak("Glukóza", "arb.j.", "glukoza")], reg, new Map());
    expect(o.verdict).toBe("skip");
  });
});

describe("runSecondOpinion", () => {
  const reg = () => new Registry([def("glukoza", "Glukóza", "mmol/l"), def("sodik", "Sodík", "mmol/l")]);
  const reports = [report("r1", [m("Glukóza", "1", "arb.j.", "", "glukoza"), m("S_Na", "140", "mmol/l", "", "sodik")])];

  it("asks only about the weak matches, saves each decision, and the registry applies it", async () => {
    const r = reg();
    const asked: string[] = [];
    const saved: string[] = [];
    const out = await runSecondOpinion(
      { reports, registry: r, stats: new Map(), ask: async (names) => (asked.push(...names.map((n) => n.rawName)), answer([sug({ rawName: "Glukóza", decision: "not_blood" })])) },
      { save: (o, model) => saved.push(`${o.rawName}|${o.unit}|${o.canonicalId}|${model}`) },
    );
    expect(asked).toEqual(["Glukóza"]);
    expect(saved).toEqual(["Glukóza|arb.j.|null|claude-haiku-4-5"]);
    expect(out.decided.map((o) => o.verdict)).toEqual(["unmap"]);
    expect(r.match("Glukóza", null, { lab: "Lab", unit: "arb.j." })).toBeNull();
    expect(r.match("Glukóza", null, { lab: "Lab", unit: "mmol/l" })).toBe("glukoza");
    // Decided once: the next run has nothing to ask.
    const again = await runSecondOpinion({ reports, registry: r, stats: new Map(), ask: async () => { throw new Error("must not ask"); } }, { save: () => undefined });
    expect(again.asked).toBe(0);
  });

  it("a failed call decides nothing", async () => {
    const r = reg();
    const out = await runSecondOpinion({ reports, registry: r, stats: new Map(), ask: async () => { throw new Error("down"); } }, { save: () => { throw new Error("must not save"); } });
    expect(out.error).toBeInstanceOf(Error);
    expect(r.match("Glukóza", null, { lab: "Lab", unit: "arb.j." })).toBe("glukoza");
  });
});

describe("scopeOf", () => {
  it("is the lab and unit of the name's first reading", () => {
    expect(scopeOf("S_Na", [report("r1", [m("S_Na", "140", "mmol/l", "", null)])])).toEqual({ lab: "Lab", unit: "mmol/l" });
    expect(scopeOf("nic", [])).toEqual({ lab: "", unit: "" });
  });
});

describe("autoEntriesFrom (VITE_AUTO_ENTRIES)", () => {
  const entry = (over: Record<string, unknown>) => ({ decision: "new", canonicalId: null, confidence: "high", reason: "", model: "claude-haiku-5-5", at: "2026-10-20", code: "01721", proposed: { id: "nclp_01721", displayNameCs: "Estron (S; látková konc. [pmol/l])", unit: "pmol/l", material: "s" }, ...over });
  const judged = (entries: Record<string, any>): Judged => ({ entries, applied: [], parked: [] });

  it("off: nothing is added", () => {
    expect(autoEntriesFrom(judged({ S_Estron: entry({}) }), false)).toEqual([]);
  });

  it("on: only a 'new' answer at 'high' that carries a code", () => {
    const out = autoEntriesFrom(
      judged({
        S_Estron: entry({}),
        Estron: entry({ confidence: "medium" }),
        Neznámé: entry({ code: undefined }),
        S_Na: entry({ decision: "catalog", canonicalId: "sodik" }),
        pH: entry({ code: "02656", proposed: { id: "nclp_02656", displayNameCs: "pH (U)", unit: "", material: "u" } }),
        Starý: entry({ code: "01111", proposed: { id: "nclp_01111", displayNameCs: "x", unit: "" } }),
      }),
      true,
    );
    expect(out).toEqual([{ code: "01721", canonicalId: "nclp_01721", nameCs: "Estron (S; látková konc. [pmol/l])", unit: "pmol/l", material: "s", rawName: "S_Estron", model: "claude-haiku-5-5" }]);
  });

  it("the entry the registry gets maps the founding name", () => {
    const r = new Registry([]);
    r.addAnalyte(autoEntryDef({ code: "01721", nameCs: "Estron", unit: "pmol/l", rawName: "S_Estron", material: "s" }));
    expect(r.match("S_Estron")).toBe("nclp_01721");
  });

  it("a bare founding name gets the row's specimen, so another specimen's name is refused", () => {
    // Round 7: an entry founded by a bare name took every specimen's name.
    const r = new Registry([]);
    r.addAnalyte(autoEntryDef({ code: "08170", nameCs: "Leptin (S)", unit: "µg/l", rawName: "Leptin", material: "s" }));
    expect(r.match("Leptin")).toBe("nclp_08170");
    expect(r.match("S_Leptin")).toBe("nclp_08170");
    expect(r.match("U_Leptin")).toBeNull();
  });
});

