/**
 * The two-model union. The case that earns its keep is the third one: a row
 * only one model returned. That is how silent under-extraction is caught —
 * a model dropping most of a page and reporting what it did read with high
 * confidence looks perfect from a single read.
 */
import { describe, expect, it } from "vitest";
import { reconcile, reviewOf, SECOND_READ_FAILED, type RawRead } from "@bw/lab-core";

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
const gemini = (rows: any[]): RawRead => ({ model: "gemini-3.8-flash", measurements: rows });

/** No curated interval, so `reviewOf` falls back to the printed one. */
const noCuratedRange = () => null;

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

  it("raises no disagreement when only one model was ever asked", () => {
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

/**
 * The silent single reader.
 *
 * Two readers were asked and one answered. There is no second value to differ
 * from and no row only one reader saw, so before `expected` existed reconcile
 * found nothing to say and handed back a page of confirmed rows — the app's
 * strongest claim, made about the one page with the least behind it.
 *
 * Guard seen failing: with `expected` dropped from the call these four
 * assertions fail and the reviewOf one returns level "ok".
 */
describe("a page read by one reader when two were asked", () => {
  it("flags every row, not just the ones that look odd", () => {
    const rows = reconcile([sonnet([row("S_Glukóza", "5,32"), row("S_CRP", "<1,0")])], {
      expected: 2,
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.disagreement)).toEqual([SECOND_READ_FAILED, SECOND_READ_FAILED]);
    // The cross-check was attempted; it just did not land.
    expect(rows.every((r) => r.escalated)).toBe(true);
  });

  it("reaches the screen as unconfirmed, which is the whole point", () => {
    const [m] = reconcile([sonnet([row("S_Glukóza", "5,32")])], { expected: 2 });
    const review = reviewOf(m, noCuratedRange);
    expect(review.level).toBe("unconfirmed");
    // The stored fact stays in the measurement for the bench and the logs;
    // the reader is told what to do, not that a second read failed.
    expect(m.disagreement).toBe(SECOND_READ_FAILED);
    expect(review.reason).toMatch(/^Touto hodnotou si nejsme jistí\./);
    expect(review.reason).not.toContain("čtení");
  });

  it("says nothing when both readers answered", () => {
    const rows = reconcile([sonnet([row("S_Glukóza", "5,32")]), gemini([row("Glukóza", "5,32")])], {
      expected: 2,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].disagreement).toBeNull();
  });

  it("has nothing to flag when both readers failed", () => {
    // Zero reads is not a page of confirmed rows either — it is no page. The
    // Worker turns this into a 502 rather than an empty success.
    expect(reconcile([], { expected: 2 })).toEqual([]);
  });

  it("cannot be talked into believing more readers answered than did", () => {
    // A caller that under-reports `expected` must not erase a real single-read
    // flag; a caller that over-reports it must not manufacture one.
    const rows = reconcile([sonnet([row("S_Glukóza", "5,32")]), gemini([row("S_CRP", "<1,0")])], {
      expected: 1,
    });
    expect(rows.map((r) => r.disagreement)).toEqual([
      "řádek našlo jen jedno ze dvou čtení",
      "řádek našlo jen jedno ze dvou čtení",
    ]);
  });
});

/**
 * Two providers, one union. `reconcile` keys on the normalized analyte name and
 * on the printed values — never on which program produced them — so a
 * Sonnet+Gemini page and a Sonnet+Haiku page are reconciled identically.
 */
describe("the two providers are indistinguishable to reconcile", () => {
  it("confirms an agreement across vendors exactly as within one", () => {
    const cross = reconcile([sonnet([row("S_Glukóza", "5,32")]), gemini([row("Glukóza", "5,32")])]);
    const same = reconcile([sonnet([row("S_Glukóza", "5,32")]), opus([row("Glukóza", "5,32")])]);
    expect(cross[0].disagreement).toBeNull();
    expect(same[0].disagreement).toBeNull();
    expect(cross[0].value).toBe(same[0].value);
  });

  it("names the two readings, not the two vendors, when they differ", () => {
    // A model id tells a clinician nothing; two numbers side by side tell them
    // exactly what to check on the page.
    const [m] = reconcile([sonnet([row("S_Glukóza", "5,32")]), gemini([row("S_Glukóza", "5,82")])]);
    expect(m.disagreement).toBe("dvě nezávislá čtení se liší: 5,32 / 5,82");
    expect(m.disagreement).not.toMatch(/gemini|claude/i);
  });

  it("does not count the lab's own marker as a second reading", () => {
    // One reader copies the "!" beside the number, the other leaves it out.
    // Seen live 2026-09-12: "7,4 ! / 7,4", a doubt nobody could resolve
    // because both readings were right.
    const [m] = reconcile([sonnet([row("S_PIIINP", "7,4 !")]), gemini([row("S_PIIINP", "7,4")])]);
    expect(m.disagreement).toBeNull();
    const [n] = reconcile([sonnet([row("S_PIIINP", "7,4 *")]), gemini([row("S_PIIINP", "7,3")])]);
    expect(n.disagreement).toBe("dvě nezávislá čtení se liší: 7,4 / 7,3");
  });

  it("flags a row only one vendor returned", () => {
    const rows = reconcile([
      sonnet([row("S_Glukóza", "5,32"), row("S_CRP", "<1,0")]),
      gemini([row("S_Glukóza", "5,32")]),
    ]);
    expect(rows.find((r) => r.rawAnalyteName === "S_CRP")?.disagreement).toBe(
      "řádek našlo jen jedno ze dvou čtení",
    );
  });
});

// A page can print the same name twice — Glukóza under Sérum and again under
// Moč (mixed_material.pdf). Keyed on the name alone, the two rows collapsed
// into one measurement carrying a false "two readings differ" flag, and the
// urine row was gone before the material check could refuse it. When one read
// returns a name more than once, the rows are told apart by their row index.
//
// Guard seen failing 2026-09-06: both tests got one row, with the disagreement
// "dvě nezávislá čtení se liší: 5,4 / 0,3".
describe("the same name printed twice on one page", () => {
  const at = (name: string, value: string, index: number, ref: string) => ({ ...row(name, value, "mmol/l", ref), row_index: index });

  it("keeps two rows a single read returned under one name apart", () => {
    const rows = reconcile([sonnet([at("Glukóza", "5,4", 1, "3,9 - 5,6"), at("Glukóza", "0,3", 4, "0 - 0,8")])]);
    expect(rows.map((r) => [r.rowIndex, r.valueRaw, r.disagreement])).toEqual([
      [1, "5,4", null],
      [4, "0,3", null],
    ]);
  });

  it("pairs the two reads row by row, whatever order they came in", () => {
    const rows = reconcile([
      sonnet([at("Glukóza", "5,4", 1, "3,9 - 5,6"), at("Glukóza", "0,3", 4, "0 - 0,8")]),
      opus([at("Glukóza", "0,3", 4, "0 - 0,8"), at("Glukóza", "5,4", 1, "3,9 - 5,6")]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.disagreement === null)).toBe(true);
  });

  it("does not split a name that appears once per read over a differing index", () => {
    // Two readers numbering the same row differently is the case
    // repairRowIndex exists for; a unique name must not become two rows.
    const rows = reconcile([sonnet([at("S_Glukóza", "5,32", 3, "(4,11-5,60)")]), opus([at("Glukóza", "5,32", 4, "(4,11-5,60)")])]);
    expect(rows).toHaveLength(1);
    expect(rows[0].disagreement).toBeNull();
  });
});
