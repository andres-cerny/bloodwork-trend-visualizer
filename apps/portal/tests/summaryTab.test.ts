/**
 * What Souhrn puts on a phone, asserted where the layout auditor cannot.
 *
 * The auditor reads boxes: it catches a clipped word or a covered button and
 * has never once cared what a sentence says. These are the strings the phone
 * layout depends on — a row's two lines, the fold's count, the per-row link
 * that stopped saying "Více" when the card's fold started — and the classes
 * the width rules key on. Rendered markup, not state: `sum-range` and
 * `sum-prev` exist at every width and `styles.css` decides which shows, so a
 * test that read React state would prove nothing about what a reader sees.
 *
 * The opening card splits the same way: a phone gets "Souhrn" and three
 * facts above one card per direction, a desktop keeps its single head. Both
 * heads ship at every width, so what is asserted here is that neither was
 * dropped and that the classes the width rules key on are still spelled the
 * way `styles.css` spells them.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type LabReport, type Measurement, buildTrends } from "@bw/lab-core";
import SummaryTab from "../src/ui/SummaryTab";

const LOW = 0.3;
const HIGH = 1.2;
/** name, older, newer — five that end above the range, three that stay in it. */
const PARAMS: Array<[string, string, string]> = [
  ["ALP", "1,00", "1,50"],
  ["GGT", "1,30", "1,60"],
  ["ALT", "1,40", "1,70"],
  ["AST", "1,50", "1,80"],
  ["Bilirubin", "1,60", "1,90"],
  ["Urea", "0,50", "0,60"],
  ["Kreatinin", "0,70", "0,80"],
  ["Sodík", "0,90", "1,00"],
];

const m = (name: string, raw: string): Measurement => {
  const value = Number(raw.replace(",", "."));
  return {
    rawAnalyteName: name,
    canonicalId: name,
    value,
    valueRaw: raw,
    unit: "µkat/l",
    unitRaw: "µkat/l",
    refRangeLow: LOW,
    refRangeHigh: HIGH,
    refRangeRaw: `${LOW}-${HIGH}`,
    refRangeText: null,
    flag: value > HIGH ? "high" : value < LOW ? "low" : "normal",
    sourcePage: 1,
    sourceSnippet: "",
    confidence: "high",
    extractedBy: "test",
    escalated: false,
    disagreement: null,
    corrected: false,
  } as unknown as Measurement;
};

const report = (id: string, date: string, which: 1 | 2): LabReport =>
  ({
    id,
    reportDate: date,
    labName: "Laboratoř",
    sourceFile: `${id}.pdf`,
    patientName: null,
    patientId: null,
    pages: [],
    measurements: PARAMS.map(([name, older, newer]) => m(name, which === 1 ? older : newer)),
  }) as unknown as LabReport;

const draw = (reports: LabReport[]) => {
  const trends = buildTrends(
    reports,
    (cid) => cid ?? "",
    () => null,
    () => null,
  );
  return renderToStaticMarkup(createElement(SummaryTab, { reports, trends }));
};

const reports = [report("r1", "2024-09-23", 1), report("r2", "2025-09-23", 2)];
const html = draw(reports);

/**
 * The same pair with one reading the app will not stand behind. `suspectFn`
 * is the third argument Portal.tsx fills from `reviewOf`, and a value it
 * withholds at the most recent draw is what raises the notice.
 */
const withheldHtml = renderToStaticMarkup(
  createElement(SummaryTab, {
    reports,
    trends: buildTrends(
      reports,
      (cid) => cid ?? "",
      (mm) => (mm.canonicalId === "ALP" ? "ověřit desetinnou čárku" : null),
      () => null,
    ),
  }),
);

describe("Souhrn on a phone", () => {
  it("gives a group row a range clause and a previous-draw line", () => {
    // The two spans styles.css shows below 820px and hides above it.
    expect(html).toContain('class="muted sum-range"');
    expect(html).toContain('class="muted sum-prev"');
    expect(html).toContain("rozmezí (0,3–1,2)");
    expect(html).toContain("předchozí měření");
  });

  it("keeps the desktop's clause in the markup beside them", () => {
    // Both readings ship; the width picks one. Drop this and the phone
    // layout silently becomes the only layout.
    expect(html).toContain('class="muted sum-clause"');
  });

  it("prints the previous draw as the lab printed it, with its date", () => {
    expect(html).toContain("předchozí měření 1,00 (23. 9. 2024)");
  });

  it("folds every list to two rows and counts what it holds back", () => {
    // Five worsen and land out of range (3 behind the fold); three stay in
    // range (1 behind it).
    expect(html).toContain("Více (3)");
    expect(html).toContain("Více (1)");
    expect(html).toContain('class="sum-moves folded"');
    expect(html).toContain('class="sum-table folded"');
    // aria-expanded and a real target, or the fold is a button that lies.
    expect(html).toMatch(/<button[^>]*class="btn linkish sum-fold"[^>]*aria-expanded="false"/);
    expect(html).toContain('aria-controls="sum-table-out"');
    expect(html).toContain('aria-controls="sum-moves-worse"');
  });

  it("draws the sketch inside the row's graf → link, above the word", () => {
    // The phone's picture is the desktop's `Sparkline`, not a second
    // drawing: one `.spark` svg per row in the Průběh cell and one in the
    // link, and styles.css shows one of them. Inside the button, so the
    // sketch and the word are one tap box.
    const rows = html.match(/<tr>(?:(?!<\/tr>).)*<\/tr>/gs)!.filter((r) => r.includes("sum-go"));
    expect(rows.length).toBe(8);
    for (const row of rows) {
      const link = row.match(/<button class="btn linkish sum-go"[^>]*>(.*?)<\/button>/s)![1];
      expect(link).toMatch(/^<span class="sum-sketch"><svg class="spark"[\s\S]*<\/svg><\/span><span>graf →<\/span>$/);
      expect((row.match(/<svg class="spark"/g) ?? []).length).toBe(2);
    }
  });

  it("does not say Více twice on one card", () => {
    // The per-row link opens the chart; the card's fold opens the list. When
    // both said "Více" they were the same word for two different things.
    expect(html).toContain("graf →");
    expect(html).not.toMatch(/>\s*Více\s*</);
  });
});

describe("a list with no tail", () => {
  it("shows no fold at all", () => {
    const two = reports.map((r) => ({ ...r, measurements: r.measurements.slice(0, 2) })) as LabReport[];
    const short = draw(two);
    expect(short).toContain("sum-moves");
    expect(short).not.toContain("sum-fold");
    expect(short).not.toContain("folded");
  });
});

describe("the opening card, split on a phone", () => {
  it("heads the phone's summary with Souhrn and three labelled facts", () => {
    expect(html).toContain('<div class="sum-overview"><h2>Souhrn</h2>');
    expect(html).toContain("<dt>Poslední měření:</dt><dd>23. 9. 2025</dd>");
    expect(html).toContain("<dt>Doba sledování:</dt><dd>1 rok</dd>");
    expect(html).toContain("<dt>Počet odběrů:</dt><dd>2</dd>");
  });

  it("keeps the desktop's head in the markup beside it", () => {
    // Both heads ship; the width picks one. Drop this and the phone layout
    // silently becomes the only layout — the same bargain `sum-clause` makes.
    expect(html).toContain("Na co se podívat nejdřív");
    expect(html).toContain('class="sub"');
  });

  it("keeps the withheld notice inside the Souhrn card, not beside it", () => {
    // On a phone `.sum-head` IS the Souhrn card. Outside it the notice would
    // float bare on the plane between two cards, which is where it sat
    // before the wrapper existed.
    const head = withheldHtml.indexOf('class="sum-head"');
    const note = withheldHtml.indexOf('class="held-back"');
    expect(head).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(head);
    // The wrapper closes on the notice's heels — nothing else joined it.
    expect(withheldHtml).toContain("přejít na Ověření</button>.</p></div>");
  });

  it("names the withheld parameter in the notice", () => {
    expect(withheldHtml).toContain("1 hodnota čeká na ověření: ALP");
  });

  it("marks the lead so the phone can strip its chrome and card the groups", () => {
    // styles.css keys the whole split on this class: `.sum-lead` loses its
    // box below 820px and `.sum-lead > .sum-groups > .sum-group` gains one.
    expect(html).toContain('<section class="card sum-lead">');
    expect(html).toContain('<div class="sum-group worse">');
  });

  it("cards the other direction too, when a value has come back", () => {
    // Every parameter in the fixture above rises, so it has no better group
    // at all. Read the same pair backwards and the values fall into range.
    const falling = draw([report("r1", "2024-09-23", 2), report("r2", "2025-09-23", 1)]);
    expect(falling).toContain('<section class="card sum-lead">');
    expect(falling).toContain('<div class="sum-group better">');
  });

  it("says — for a fact one report cannot support", () => {
    // A single draw has a date and a count but no span. The line stays, so
    // the block is three facts at every state rather than a shifting list.
    const one = draw([report("r1", "2024-09-23", 1)]);
    expect(one).toContain("<dt>Poslední měření:</dt><dd>23. 9. 2024</dd>");
    expect(one).toContain("<dt>Doba sledování:</dt><dd>—</dd>");
    expect(one).toContain("<dt>Počet odběrů:</dt><dd>1</dd>");
  });
});

/**
 * The first impression: an account with one report. `summarizeChanges`
 * needs two draws per parameter, so `records` is empty — and until
 * 2026-09-19 the whole „Mimo rozmezí / V rozmezí" block was skipped with
 * it, while the one report's Cholesterol sat out of range and Trendy said
 * so. One draw has no change to show; it has values, flags and ranges.
 */
describe("Souhrn with one report", () => {
  const ABOUT = { what: "Látka, kterou laboratoř měří.", usedFor: "Sleduje se při posouzení jater." };
  const single = [report("r1", "2024-09-23", 2)];
  const one = renderToStaticMarkup(
    createElement(SummaryTab, {
      reports: single,
      trends: buildTrends(single, (cid) => cid ?? "", () => null, () => null),
      aboutOf: () => ABOUT,
    }),
  );
  const namesIn = (block: string) => [...block.matchAll(/class="btn linkish sum-open sum-name"[^>]*>([^<]+)</g)].map((m) => m[1]);

  it("lists the report's rows, out of range first, in range after", () => {
    expect(one).not.toContain("Zatím není dost měření");
    expect(one).toContain('Mimo rozmezí <span class="n">5</span>');
    expect(one).toContain('V rozmezí <span class="n">3</span>');
    const outAt = one.indexOf('id="sum-table-out"');
    const inAt = one.indexOf('id="sum-table-in"');
    expect(outAt).toBeGreaterThan(-1);
    expect(inAt).toBeGreaterThan(outAt);
    // Furthest past its limit first — the order Trendy's shortcuts use.
    expect(namesIn(one.slice(outAt, inAt))).toEqual(["Bilirubin", "AST", "ALT", "GGT", "ALP"]);
    expect(namesIn(one.slice(inAt))).toEqual(["Kreatinin", "Sodík", "Urea"]);
  });

  it("shows each row's value, flag and printed range, and no change column", () => {
    expect(one).toContain("↑ nad rozmezím");
    expect(one).toContain("0,3–1,2");
    expect(one).toContain(">1,90<");
    expect(one).not.toContain("Změna od minule");
    expect(one).not.toContain("předchozí měření");
  });

  it("says the block is the one report's values, and that changes wait for a second draw", () => {
    expect(one).toContain("jediný odběr · 23. 9. 2024");
    expect(one).toContain("Zatím jeden odběr. Změny vůči rozmezí se ukážou po druhém.");
    expect(one).not.toContain("Jediný odběr —");
    expect(one).not.toContain("Žádný přesun vůči referenčnímu rozmezí");
  });

  it("keeps the i after every parameter name", () => {
    expect((one.match(/class="about-btn"/g) ?? []).length).toBe(8);
  });

  it("draws no sketch under one point, and keeps the link", () => {
    // One measurement is not a course; the desktop has no Průběh column
    // here and the phone gets no sketch in its place.
    expect(one).not.toContain("sum-sketch");
    expect(one).not.toContain('class="spark"');
    expect((one.match(/graf →/g) ?? []).length).toBe(8);
  });

  it("qualifies the all-clear when the out-of-range readings are the withheld ones", () => {
    // Every reading past its limit is one the app will not stand behind, so
    // the block is empty — and an empty block is not "all in range"
    // (docs/constraints.md: a filtered value is not a normal one).
    const out = new Set(["Bilirubin", "AST", "ALT", "GGT", "ALP"]);
    const withheldOne = renderToStaticMarkup(
      createElement(SummaryTab, {
        reports: single,
        trends: buildTrends(single, (cid) => cid ?? "", (mm) => (out.has(mm.canonicalId ?? "") ? "ověřit" : null), () => null),
      }),
    );
    expect(withheldOne).toContain('Mimo rozmezí <span class="n">0</span>');
    expect(withheldOne).toContain("všechny ověřené parametry jsou v rozmezí");
    expect(withheldOne).not.toContain("všechny parametry jsou v rozmezí");
    expect(withheldOne).toContain("na ověření");
  });

  it("changes nothing for two reports", () => {
    expect(html).toContain("Změna od minule");
    expect(html).not.toContain("jediný odběr");
    expect(html).not.toContain("Jediný odběr");
  });
});
