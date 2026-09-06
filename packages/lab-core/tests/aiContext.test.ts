/**
 * The "O mně" block and the summary line: only what was answered, in the
 * form's order, with unknown ids dropped, numbers bounded and free text
 * cleaned — and nothing invented, so the block carries only what the person
 * typed. The share builder must be byte-identical without a context.
 */
import { describe, expect, it } from "vitest";
import {
  AI_CONTEXT_TEXT_MAX,
  AI_SHARE_HEADER,
  aiContextBlock,
  aiContextSummary,
  aiShareHeader,
  buildAiShare,
  buildTrends,
  goalSentence,
  isEmptyAiContext,
  makeMeasurement,
  normalizeAiContext,
  normalizeMeasurement,
  type AiContext,
  type LabReport,
} from "@bw/lab-core";

const full: AiContext = {
  sex: "m",
  ageBand: "30-34",
  heightCm: 178,
  weightKg: 76,
  activity: "Silniční kolo 6–8 h týdně, 2× posilovna",
  goal: "both",
  meds: ["creatine", "vitamin-d"],
  medsOther: "hořčík",
  diagnoses: ["gilbert"],
  diagnosesOther: "",
  smoking: "no",
  alcohol: "sometimes",
  note: "Odběr byl den po závodě.",
};

describe("aiContextBlock", () => {
  it("prints one line per answered field, in the form's order", () => {
    expect(aiContextBlock(full)).toBe(
      [
        "O mně:",
        "- Pohlaví: muž",
        "- Věk: 30–34 let",
        "- Výška: 178 cm",
        "- Váha: 76 kg",
        "- Pohyb: Silniční kolo 6–8 h týdně, 2× posilovna",
        "- Léky a doplňky: kreatin, vitamin D, hořčík",
        "- Diagnózy: Gilbertův syndrom",
        "- Kouření: ne",
        "- Alkohol: občas",
        "- Zajímá mě: výkon i zdraví",
        "- Poznámka: Odběr byl den po závodě.",
      ].join("\n"),
    );
  });

  it("prints nothing for an empty field, and nothing at all for an empty context", () => {
    expect(aiContextBlock({ sex: "f", note: "  " })).toBe("O mně:\n- Pohlaví: žena");
    expect(aiContextBlock({})).toBeNull();
    expect(aiContextBlock(null)).toBeNull();
    expect(aiContextBlock({ meds: [], activity: "", heightCm: NaN })).toBeNull();
    expect(isEmptyAiContext({ meds: [], note: "\n" })).toBe(true);
    expect(isEmptyAiContext({ ageBand: "65+" })).toBe(false);
  });

  it("drops what it does not know and bounds what it does", () => {
    const c = normalizeAiContext({
      sex: "x" as never,
      ageBand: "1990" as never,
      heightCm: 17.8,
      weightKg: 760,
      meds: ["creatine", "cocaine" as never, "creatine"],
      diagnoses: ["nope" as never],
      smoking: "daily" as never,
    });
    expect(c).toEqual({ meds: ["creatine"] });
    expect(normalizeAiContext({ heightCm: 178.4, weightKg: 75.6 })).toEqual({ heightCm: 178, weightKg: 76 });
  });

  it("flattens and caps free text", () => {
    const long = "a".repeat(AI_CONTEXT_TEXT_MAX + 50);
    const c = normalizeAiContext({ note: `  první\n\n  řádek\t druhý  `, activity: long });
    expect(c.note).toBe("první řádek druhý");
    expect(c.activity).toHaveLength(AI_CONTEXT_TEXT_MAX);
    expect(aiContextBlock(c)!.split("\n")).toHaveLength(3);
  });

  it("carries only what the person typed — nothing from outside the context", () => {
    const block = aiContextBlock({ note: "Jsem Jan Novák, jan@example.com", ageBand: "40-44" })!;
    // Whatever they wrote is theirs to send; the builder adds no other field.
    expect(block).toBe("O mně:\n- Věk: 40–44 let\n- Poznámka: Jsem Jan Novák, jan@example.com");
  });
});

describe("aiContextSummary", () => {
  it("is the tab's one line, with the separators the mockup shows", () => {
    expect(aiContextSummary(full)).toBe(
      "Muž, 30–34 let · 178 cm, 76 kg · Silniční kolo 6–8 h týdně, 2× posilovna · Kreatin, vitamin D, hořčík · Gilbertův syndrom · Alkohol občas · Zajímá vás výkon i zdraví · Poznámka: Odběr byl den po závodě.",
    );
  });

  it("leaves out a 'no' for smoking and alcohol, and is null when empty", () => {
    expect(aiContextSummary({ smoking: "no", alcohol: "no" })).toBeNull();
    expect(aiContextSummary({ smoking: "yes", alcohol: "regularly" })).toBe("Kouření ano · Alkohol pravidelně");
    expect(aiContextSummary({ weightKg: 80 })).toBe("80 kg");
    expect(aiContextSummary({})).toBeNull();
  });
});

describe("buildAiShare with a context", () => {
  const m = (name: string, value: string, cid: string) =>
    normalizeMeasurement(makeMeasurement({ rawAnalyteName: name, valueRaw: value, unitRaw: "mmol/l", refRangeRaw: "(4,11-5,60)", canonicalId: cid }));
  const reports: LabReport[] = [
    { id: "r1", sourceFile: "a.pdf", reportDate: "2025-08-13", labName: "Lab", patientName: null, patientId: null, pages: [], measurements: [m("S_Glukóza", "6,10", "glukoza")] },
  ];
  const trends = () => buildTrends(reports, (c) => c);

  it("is byte-identical to the page without a context when nothing was answered", () => {
    const plain = buildAiShare(reports, trends());
    expect(buildAiShare(reports, trends(), null)).toBe(plain);
    expect(buildAiShare(reports, trends(), {})).toBe(plain);
    expect(buildAiShare(reports, trends(), { note: " ", meds: [] })).toBe(plain);
    expect(plain.startsWith(AI_SHARE_HEADER + "\n\n")).toBe(true);
    expect(plain).not.toContain("O mně");
  });

  it("puts the goal's line into the header's list and the block before the table", () => {
    const s = buildAiShare(reports, trends(), full);
    const header = aiShareHeader(full);
    expect(header).toContain(`${goalSentence("both")}\n\nFormát dat:`);
    expect(header.replace(`\n${goalSentence("both")}`, "")).toBe(AI_SHARE_HEADER);
    expect(s.startsWith(header + "\n\nO mně:\n")).toBe(true);
    expect(s.indexOf("O mně:")).toBeLessThan(s.indexOf("Počet reportů: 1"));
    expect(s).toContain("- Pohyb: Silniční kolo 6–8 h týdně, 2× posilovna\n");
    expect(s.endsWith("\n")).toBe(true);
  });

  it("adds no goal line without a goal, and a different one per goal", () => {
    expect(aiShareHeader({ sex: "f" })).toBe(AI_SHARE_HEADER);
    expect(goalSentence(undefined)).toBeNull();
    expect(new Set([goalSentence("performance"), goalSentence("health"), goalSentence("both")]).size).toBe(3);
    for (const g of ["performance", "health", "both"] as const) expect(goalSentence(g)!.startsWith("- ")).toBe(true);
  });
});
