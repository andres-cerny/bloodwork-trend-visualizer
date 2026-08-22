/**
 * The opening card's prose. It is the first thing a doctor reads, it is
 * generated, and it is about a real person — so these tests pin the two
 * properties that make it safe to show at all: it never narrates a reading the
 * app has withheld, and it never puts a registry name anywhere Czech grammar
 * would demand an agreement this module cannot guarantee.
 */
import { describe, expect, it } from "vitest";
import { czSpan, patientOverview } from "../src/lib/patientSummary";
import type { Flag, LabReport } from "../src/lib/models";
import type { Trend, TrendPoint } from "../src/lib/trends";

const pt = (
  date: string,
  value: number | null,
  flag: Flag = "normal",
  extra: Partial<TrendPoint> = {},
): TrendPoint => ({
  date,
  value,
  unit: "µkat/l",
  flag,
  refLow: 0.17,
  refHigh: 0.78,
  valueRaw: String(value ?? ""),
  reportId: `r-${date}`,
  suspect: null,
  unconfirmed: null,
  ...extra,
});

const trend = (points: TrendPoint[], name = "ALT", unit = "µkat/l"): Trend => ({
  canonicalId: name.toLowerCase(),
  displayName: name,
  unit,
  points,
});

const map = (...ts: Trend[]): Map<string, Trend> =>
  new Map(ts.map((t) => [t.canonicalId, t]));

const report = (date: string | null, over: Partial<LabReport> = {}): LabReport => ({
  id: `rep-${date}`,
  sourceFile: "x.pdf",
  reportDate: date,
  labName: null,
  patientName: "Jan Ukázka",
  patientId: "800101/0006",
  pages: [],
  measurements: [],
  ...over,
});

/** The demo's ALT: a long climb whose final step is small. */
const altClimb = trend([
  pt("2022-02-08", 0.61),
  pt("2023-01-24", 0.75),
  pt("2025-03-11", 0.97, "high"),
  pt("2026-04-14", 1.02, "high"),
]);

const prose = (o: { sentences: string[] }) => o.sentences.join(" ");

describe("identity", () => {
  it("decodes the birth date and the age at the most recent draw", () => {
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(altClimb));
    expect(o.name).toBe("Jan Ukázka");
    expect(o.patientId).toBe("800101/0006");
    expect(o.birthDate).toBe("1980-01-01");
    expect(o.age).toBe(46);
    expect(o.idChecksumOk).toBe(true);
  });

  it("shows nothing rather than a placeholder when there is no rodné číslo", () => {
    // What an uploaded PDF looks like before anyone has told it who this is.
    const o = patientOverview(
      [report("2026-04-14", { patientName: null, patientId: null })],
      map(altClimb),
    );
    expect(o.name).toBeNull();
    expect(o.patientId).toBeNull();
    expect(o.birthDate).toBeNull();
    expect(o.age).toBeNull();
    expect(o.idChecksumOk).toBeNull();
    // And nothing invented in its place.
    expect(prose(o)).not.toContain("1980");
  });

  it("refuses to decode a rodné číslo that is not a date", () => {
    const o = patientOverview(
      [report("2026-04-14", { patientId: "999999/9999" })],
      map(altClimb),
    );
    expect(o.birthDate).toBeNull();
    expect(o.age).toBeNull();
  });

  it("reports a rodné číslo that fails its own check digit", () => {
    // Still decodes the date part — the digits are the digits — but says the
    // number does not agree with itself, which is how a misread reaches the
    // reader instead of being silently trusted.
    const o = patientOverview([report("2026-04-14", { patientId: "800101/0007" })], map(altClimb));
    expect(o.birthDate).toBe("1980-01-01");
    expect(o.idChecksumOk).toBe(false);
  });
});

describe("how long a patient", () => {
  it("counts distinct draw dates and the span between them", () => {
    const o = patientOverview(
      [report("2022-02-08"), report("2023-01-24"), report("2026-04-14")],
      map(altClimb),
    );
    expect(o.draws).toBe(3);
    expect(o.firstDraw).toBe("2022-02-08");
    expect(o.lastDraw).toBe("2026-04-14");
    expect(o.followUpDays).toBe(1526);
    expect(o.followUp).toBe("4 roky a 2 měsíce");
  });

  it("counts two reports from one day as one draw", () => {
    const a = report("2026-04-14");
    const b = { ...report("2026-04-14"), id: "rep-b" };
    expect(patientOverview([a, b], map(altClimb)).draws).toBe(1);
  });

  it("has no follow-up span with a single draw", () => {
    const o = patientOverview([report("2026-04-14")], map(altClimb));
    expect(o.followUp).toBeNull();
    expect(o.followUpDays).toBe(0);
  });
});

describe("czSpan", () => {
  it("agrees with Czech's three plural forms", () => {
    expect(czSpan("2022-02-08", "2026-04-14")).toBe("4 roky a 2 měsíce");
    expect(czSpan("2020-01-01", "2025-01-01")).toBe("5 let");
    expect(czSpan("2024-01-01", "2025-01-01")).toBe("1 rok");
    expect(czSpan("2024-01-01", "2024-03-01")).toBe("2 měsíce");
    expect(czSpan("2024-01-01", "2024-07-01")).toBe("6 měsíců");
    expect(czSpan("2024-01-01", "2024-01-04")).toBe("3 dny");
    expect(czSpan("2024-01-01", "2024-01-02")).toBe("1 den");
  });

  it("does not round a month up before it has passed", () => {
    // 30 days after 1 January is not "1 měsíc".
    expect(czSpan("2024-01-01", "2024-01-31")).toBe("30 dnů");
    expect(czSpan("2024-01-01", "2024-02-01")).toBe("1 měsíc");
  });

  it("returns null for a date it cannot read", () => {
    expect(czSpan("", "2024-01-01")).toBeNull();
  });
});

describe("the prose", () => {
  it("names what is out of range at the most recent draw", () => {
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(altClimb));
    expect(o.outNow).toEqual(["ALT"]);
    expect(o.sentences[0]).toContain("Mimo referenční rozmezí k poslednímu odběru 14. 4. 2026");
    expect(o.sentences[0]).toContain("ALT");
  });

  it("prefers the whole-series fact to the last-step fact", () => {
    // The point of the card. ALT's final step is about +5 %; the series it
    // sits at the end of is +67 %, and that is the arresting number.
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(altClimb));
    const text = prose(o);
    expect(text).toContain("+67 %");
    expect(text).toContain("0,61 → 1,02");
    expect(text).not.toContain("+5 %");
    expect(text).toContain("napříč celou sérií");
  });

  it("says what has come back inside its range", () => {
    const vitD = trend(
      [pt("2022-02-08", 52, "low"), pt("2026-04-14", 96, "normal")],
      "Vitamin D celkový",
      "nmol/l",
    );
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(vitD));
    expect(prose(o)).toContain("Zpět v referenčním rozmezí oproti prvnímu odběru");
    expect(prose(o)).toContain("Vitamin D celkový");
  });

  it("names a move back towards a range it has not reached yet", () => {
    const ferritin = trend(
      [pt("2022-02-08", 900, "high"), pt("2026-04-14", 600, "high")],
      "Ferritin",
      "µg/l",
    );
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(ferritin));
    expect(prose(o)).toContain("Pohyb zpět k rozmezí, zatím mimo ně");
  });

  it("describes a steady drift inside the range when nothing has left it", () => {
    const chol = trend(
      [pt("2022-02-08", 4.0), pt("2024-01-01", 4.6), pt("2026-04-14", 5.2)],
      "Cholesterol celkový",
      "mmol/l",
    );
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(chol));
    expect(o.outNow).toEqual([]);
    expect(o.sentences[0]).toContain("žádná hodnota mimo referenční rozmezí");
    expect(prose(o)).toContain("Nejvýraznější dlouhodobý posun v rámci rozmezí");
    expect(prose(o)).toContain("+30 %");
  });

  it("does not report a drift that bounced its way there", () => {
    // Same endpoints, arrived at by wandering. A percent change inside a wide
    // interval is assay noise unless the series actually drifted.
    const bouncing = trend(
      [pt("2022-02-08", 4.0), pt("2024-01-01", 6.5), pt("2026-04-14", 5.2)],
      "Cholesterol celkový",
      "mmol/l",
    );
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(bouncing));
    expect(prose(o)).not.toContain("dlouhodobý posun");
  });

  it("names the longest unbroken run out of range", () => {
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(
      trend(
        [
          pt("2022-02-08", 1.0, "high"),
          pt("2023-01-24", 1.1, "high"),
          pt("2025-03-11", 1.2, "high"),
          pt("2026-04-14", 1.3, "high"),
        ],
        "Triacylglyceroly",
        "mmol/l",
      ),
    ));
    expect(o.sentences[0]).toContain("Triacylglyceroly (4 odběry po sobě)");
    // Named once, not once in the list and again in a parenthetical.
    expect(o.sentences[0].split("Triacylglyceroly").length - 1).toBe(1);
  });

  it("caps the list and says how many it did not name", () => {
    const many = [1, 2, 3, 4, 5, 6].map((i) =>
      trend([pt("2022-02-08", i, "high"), pt("2026-04-14", i * 2, "high")], `Analyt ${i}`),
    );
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(...many));
    expect(o.outNow).toHaveLength(6);
    expect(o.sentences[0]).toContain("a další 2");
  });

  it("stays within three sentences", () => {
    const o = patientOverview(
      [report("2022-02-08"), report("2026-04-14")],
      map(
        altClimb,
        trend([pt("2022-02-08", 52, "low"), pt("2026-04-14", 96)], "Vitamin D celkový", "nmol/l"),
        trend([pt("2022-02-08", 4.0), pt("2026-04-14", 5.2)], "Cholesterol celkový", "mmol/l"),
      ),
    );
    expect(o.sentences.length).toBeLessThanOrEqual(3);
    expect(o.sentences.length).toBeGreaterThanOrEqual(2);
  });
});

describe("it never narrates a value the app has withheld", () => {
  /*
   * The defect this whole codebase is arranged against: glucose transcribed as
   * 44,5 where the page prints 4,45. It is kept out of the plotted series, and
   * it must be kept out of the described one too — narrating it in the opening
   * paragraph would be the same failure as drawing it, one screen earlier.
   *
   * Asserted here rather than trusted: patientOverview reads seriesShape, which
   * reads numericPoints, and none of those three links is checked by anything
   * else on this path.
   */
  const glc = (date: string, value: number, flag: Flag, suspect: string | null = null) =>
    pt(date, value, flag, { refLow: 3.9, refHigh: 5.6, suspect });

  /** The misread is the *most recent* draw — the case that reaches the card. */
  const withheldLast = trend(
    [
      glc("2022-02-08", 4.4, "normal"),
      glc("2024-01-01", 4.6, "normal"),
      glc("2026-04-14", 44.5, "high", "posunutá desetinná čárka"),
    ],
    "Glukóza",
    "mmol/l",
  );

  it("keeps a misread value out of the sentences entirely", () => {
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(withheldLast));
    const text = prose(o);
    expect(text).not.toContain("44,5");
    expect(text).not.toContain("44.5");
    // Nor the +911 % rise that including it would manufacture.
    expect(text).not.toMatch(/\+\d{3} %/);
    expect(text).not.toContain("Nárůst");
  });

  it("does not call a withheld reading out of range", () => {
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(withheldLast));
    expect(o.outNow).toEqual([]);
  });

  it("never issues an all-clear over a reading it withheld", () => {
    // The defect this replaces: the filtering that keeps a misread decimal out
    // of every number also turned a withheld abnormal result into "no value
    // outside the reference range" — an all-clear the app had no evidence for,
    // in the first paragraph on every tab. constraints.md is explicit that a
    // withheld reading is named on the card, not silently dropped.
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(withheldLast));
    expect(o.withheldNow).toEqual(["Glukóza"]);
    expect(o.sentences[0]).not.toContain("žádná hodnota mimo referenční rozmezí");
    expect(o.sentences[0]).toContain("žádná ověřená hodnota");
    expect(o.sentences[0]).toContain("k ověření: Glukóza");
    // The withheld number itself still never appears.
    expect(o.sentences.join(" ")).not.toContain("44,5");
  });

  it("names a withheld reading even when something else is out of range", () => {
    const o = patientOverview(
      [report("2022-02-08"), report("2026-04-14")],
      map(
        withheldLast,
        trend(
          [pt("2022-02-08", 1.0, "high"), pt("2026-04-14", 1.3, "high")],
          "Triacylglyceroly",
          "mmol/l",
        ),
      ),
    );
    expect(o.sentences[0]).toContain("Triacylglyceroly");
    expect(o.sentences[0]).toContain("k ověření: Glukóza");
  });

  it("measures the series from the first reading it believes", () => {
    // The misread sits at the *start*: including it would invert the sign of
    // the whole series, reporting a fall where the believed readings rise.
    const withheldFirst = trend(
      [
        glc("2022-02-08", 44.5, "high", "posunutá desetinná čárka"),
        glc("2024-01-01", 4.4, "normal"),
        glc("2026-04-14", 6.0, "high"),
      ],
      "Glukóza",
      "mmol/l",
    );
    const o = patientOverview([report("2022-02-08"), report("2026-04-14")], map(withheldFirst));
    const text = prose(o);
    expect(text).toContain("Nárůst");
    expect(text).toContain("+36 %");
    expect(text).toContain("(4,4 → 6");
    expect(text).not.toContain("44,5");
    expect(text).not.toContain("Pokles");
  });
});

describe("Czech agreement is a constraint, not a translation", () => {
  /*
   * The sentences are verbless, and registry names appear only in the
   * nominative as list items. Both halves matter: a verb would have to agree
   * with the analyte's gender ("cholesterol vzrostl" / "urea vzrostla" / "CRP
   * vzrostlo"), and a preposition would have to decline it ("u cholesterolu
   * celkového"). The registry carries neither gender nor a paradigm.
   */
  const mixed = () =>
    patientOverview(
      [report("2022-02-08"), report("2026-04-14")],
      map(
        // One of each gender, plus a plural, plus an indeclinable abbreviation.
        trend([pt("2022-02-08", 4.0, "high"), pt("2026-04-14", 6.0, "high")], "Cholesterol celkový", "mmol/l"),
        trend([pt("2022-02-08", 5.0, "high"), pt("2026-04-14", 9.0, "high")], "Urea", "mmol/l"),
        trend([pt("2022-02-08", 6.0, "high"), pt("2026-04-14", 12.0, "high")], "CRP", "mg/l"),
        trend([pt("2022-02-08", 1.4, "high"), pt("2026-04-14", 2.6, "high")], "Triacylglyceroly", "mmol/l"),
      ),
    );

  const VERBS = [
    "je", "jsou", "není", "nejsou", "byl", "byla", "bylo", "byly",
    "vzrostl", "vzrostla", "vzrostlo", "vzrostly",
    "klesl", "klesla", "kleslo", "klesly",
    "roste", "rostou", "klesá", "klesají", "stoupá", "stoupají",
    "zvýšil", "zvýšila", "zvýšilo", "snížil", "snížila", "snížilo",
    "zůstal", "zůstala", "zůstalo", "zůstává",
  ];

  /*
   * Every sentence template, not just the two `mixed()` happens to reach.
   *
   * The first version of these guards ran only over an all-high, all-rising
   * fixture, which emits sentences 1 and 2 — so a preposition or a verb in
   * "Zpět v referenčním rozmezí…", in "Nejvýraznější dlouhodobý posun…" or in
   * "Pohyb zpět k rozmezí…" passed untouched, and the third of those is the
   * one the live demo actually renders.
   */
  const T = (rows: Array<[string, number, Flag]>, name: string, unit = "mmol/l") =>
    trend(rows.map(([d, v, f]) => pt(d, v, f)), name, unit);
  const over = (...ts: Trend[]) =>
    patientOverview([report("2022-02-08"), report("2026-04-14")], map(...ts));

  const everyTemplate = (): string[] => [
    ...mixed().sentences,
    // sentence 3, "Zpět v referenčním rozmezí oproti prvnímu odběru"
    ...over(
      T([["2022-02-08", 20, "low"], ["2026-04-14", 96, "normal"]], "Vitamin D celkový", "nmol/l"),
    ).sentences,
    // sentence 3's other branch, "Pohyb zpět k rozmezí, zatím mimo ně"
    ...over(T([["2022-02-08", 9, "high"], ["2026-04-14", 6, "high"]], "Urea")).sentences,
    // the in-range drift branch, "Nejvýraznější dlouhodobý posun v rámci rozmezí"
    ...over(
      T(
        [["2022-02-08", 4.0, "normal"], ["2024-01-01", 4.6, "normal"], ["2026-04-14", 5.0, "normal"]],
        "Cholesterol celkový",
      ),
    ).sentences,
    // the falling-worse branch, "Pokles napříč celou sérií"
    ...over(T([["2022-02-08", 120, "low"], ["2026-04-14", 70, "low"]], "Hemoglobin", "g/l")).sentences,
    // the withheld clause
    ...over(
      trend(
        [
          pt("2022-02-08", 4.4, "normal", { refLow: 3.9, refHigh: 5.6 }),
          pt("2026-04-14", 44.5, "high", {
            refLow: 3.9,
            refHigh: 5.6,
            suspect: "posunutá desetinná čárka",
          }),
        ],
        "Glukóza",
        "mmol/l",
      ),
    ).sentences,
  ];

  it("reaches every sentence template", () => {
    // Guards that only cover the fixture that happens to be handy are how the
    // first pair of these passed while three templates went unchecked.
    const all = everyTemplate().join(" ");
    for (const marker of [
      "Mimo referenční rozmezí",
      "Nárůst napříč celou sérií",
      "Pokles napříč celou sérií",
      "Zpět v referenčním rozmezí",
      "Pohyb zpět k rozmezí",
      "Nejvýraznější dlouhodobý posun",
      "k ověření",
    ]) {
      expect(all, `template never rendered: ${marker}`).toContain(marker);
    }
  });

  it("uses no verb, so no analyte can disagree with it grammatically", () => {
    for (const s of everyTemplate()) {
      // Tokenised, not substring-matched: "Nejvýraznější" contains "je".
      const words = s.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
      for (const v of VERBS) expect(words, s).not.toContain(v);
    }
  });

  it("puts an analyte name only where the nominative is correct", () => {
    // A name may follow a colon, a comma, the list's "a", or an opening
    // bracket — every position in which the nominative is the right form. It
    // may never follow a preposition, which would govern a case this module
    // has no way to produce.
    const names = [
      "Cholesterol celkový", "Urea", "CRP", "Triacylglyceroly",
      "Vitamin D celkový", "Hemoglobin", "Glukóza",
    ];
    let seen = 0;
    for (const s of everyTemplate()) {
      for (const name of names) {
        for (let i = s.indexOf(name); i !== -1; i = s.indexOf(name, i + 1)) {
          seen++;
          const before = s.slice(0, i);
          // " a " with the space, not "a ": the latter is satisfied by any
          // word ending in -a, which is exactly what the prepositions "na"
          // and "za" do — so the guard admitted the two cases it existed to
          // catch.
          expect(before, `${name} in "${s}"`).toMatch(/(^|: |, |\(| a )$/);
        }
      }
    }
    expect(seen, "no analyte name reached the prose at all").toBeGreaterThan(0);
  });
});

describe("it describes the latest draw, not the last time it looked", () => {
  it("does not date a stale reading to the most recent draw", () => {
    // Vitamin D measured once in 2022, low, and never again. Reporting it as
    // "mimo referenční rozmezí k poslednímu odběru 14. 4. 2026" is a plainly
    // false sentence — nothing was measured that day. The demo hides this
    // because all ten of its reports carry all twenty-two analytes; a real
    // upload does not.
    const o = patientOverview(
      [report("2022-02-08"), report("2026-04-14")],
      map(
        trend(
          [pt("2022-02-08", 20, "low"), pt("2022-02-08", 20, "low")],
          "Vitamin D celkový",
          "nmol/l",
        ),
        trend(
          [pt("2022-02-08", 0.5, "normal"), pt("2026-04-14", 0.6, "normal")],
          "ALT",
          "µkat/l",
        ),
      ),
    );
    expect(o.outNow).not.toContain("Vitamin D celkový");
    expect(o.sentences[0]).not.toContain("Vitamin D celkový");
  });

  it("reports a worsening in both directions, not only the larger one", () => {
    // A haemoglobin falling out of range is the single worst thing this
    // paragraph could omit, and it was omitted whenever anything happened to
    // be rising by a larger percentage.
    const o = patientOverview(
      [report("2022-02-08"), report("2026-04-14")],
      map(
        trend([pt("2022-02-08", 0.58, "high"), pt("2026-04-14", 1.18, "high")], "GGT", "µkat/l"),
        trend([pt("2022-02-08", 120, "low"), pt("2026-04-14", 70, "low")], "Hemoglobin", "g/l"),
      ),
    );
    const text = o.sentences.join(" ");
    expect(text).toContain("GGT");
    expect(text, "the falling analyte never reached the prose").toContain("Hemoglobin");
    expect(text).toContain("Nárůst napříč celou sérií");
    expect(text).toContain("Pokles napříč celou sérií");
  });

  it("does not claim a series across two reports drawn the same day", () => {
    const o = patientOverview(
      [report("2026-04-14"), report("2026-04-14")],
      map(
        trend([pt("2026-04-14", 6.0, "high"), pt("2026-04-14", 6.2, "high")], "Cholesterol celkový"),
      ),
    );
    expect(o.draws).toBe(1);
    expect(o.sentences.join(" ")).not.toContain("napříč celou sérií");
  });
});

describe("it degrades rather than inventing", () => {
  it("says a single draw is a single draw instead of describing a change", () => {
    const single = trend([pt("2026-04-14", 1.02, "high")]);
    const o = patientOverview([report("2026-04-14")], map(single));
    expect(o.draws).toBe(1);
    expect(o.followUp).toBeNull();
    // The one thing that can be said about one draw is still said.
    expect(o.sentences[0]).toContain("Mimo referenční rozmezí");
    expect(o.sentences[0]).toContain("ALT");
    expect(o.sentences[1]).toBe("Zatím jediný odběr: popis vývoje až od druhého.");
    // And nothing that implies a comparison.
    expect(prose(o)).not.toContain("→");
    expect(prose(o)).not.toContain("%");
    expect(prose(o)).not.toContain("napříč celou sérií");
  });

  it("does not claim nothing changed when there was nothing to compare", () => {
    const single = trend([pt("2026-04-14", 0.4, "normal")]);
    const o = patientOverview([report("2026-04-14")], map(single));
    expect(prose(o)).not.toContain("beze změny");
    expect(o.sentences[1]).toContain("Zatím jediný odběr");
  });

  it("says so when several draws still share no comparable analyte", () => {
    const o = patientOverview(
      [report("2022-02-08"), report("2026-04-14")],
      map(trend([pt("2026-04-14", 0.4)])),
    );
    expect(o.sentences[1]).toBe("Zatím žádný parametr se dvěma porovnatelnými měřeními.");
  });

  it("survives a report with no date at all", () => {
    const o = patientOverview([report(null)], new Map());
    expect(o.draws).toBe(0);
    expect(o.firstDraw).toBeNull();
    expect(o.sentences).toEqual(["Zatím žádné datované měření."]);
  });

  it("survives no reports at all", () => {
    const o = patientOverview([], new Map());
    expect(o.name).toBeNull();
    expect(o.draws).toBe(0);
    expect(o.sentences).toEqual(["Zatím žádné datované měření."]);
  });
});
