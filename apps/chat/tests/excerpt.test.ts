/**
 * The excerpt opener, against the corpus's own strings.
 *
 * These are not invented samples: every `excerpt` below is copied from
 * `src/fixtures/**`, because the two ways this can fail are both invisible to
 * a test written from imagination. JavaScript's `\b` is ASCII-only, so a rule
 * written as `\bústav\b` silently never fires; and Czech case folding on
 * „Vyhodnotil" / „Diagnóza" only matters when the strings carry diacritics.
 *
 * The invariant the last test pins is the one that matters most: what is shown
 * is a contiguous run of the excerpt's own lines. If a future rule starts
 * joining, reordering or rewriting lines, that test fails — which is the point,
 * because an evidence panel that edits its evidence is worse than one that
 * shows too much stationery.
 */
import { describe, expect, it } from "vitest";
import { openExcerpt } from "../src/excerpt";

const MR = [
  "Ortopedie a fyzioterapie Podhájí s.r.o.",
  "Radiodiagnostické pracoviště",
  "MR pravého kolenního kloubu — popis",
  "Pacient:",
  "Michal Novák",
  "Datum narození:",
  "27.2.1988",
  "Datum vyšetření:",
  "20.9.2024",
  "Popsal:",
  "MUDr. Eva Puchmertlová",
  "Provedené vyšetření",
  "Technika:",
].join("\n");

const FYZIO = [
  "Ortopedie a fyzioterapie Podhájí s.r.o.",
  "Pracoviště fyzioterapie",
  "Záznam z fyzioterapie",
  "Pacient:",
  "Michal Novák",
  "Datum narození:",
  "27.2.1988",
  "Datum terapie:",
  "16.12.2024",
  "Terapeut:",
  "Mgr. Petr Hlaváček",
  "Diagnóza: stav po plastice předního zkříženého vazu",
].join("\n");

const PROHLIDKA = [
  "Sportovní ambulance Vltavín s.r.o.",
  "Oddělení funkční diagnostiky",
  "Zpráva ze sportovní prohlídky",
  "Pacient:",
  "Tomáš Hrubý",
  "Datum narození:",
  "12.3.1994",
  "Datum vyšetření:",
  "27.2.2026",
  "Vyšetřil:",
  "MUDr. Pavla Hejduková",
  "Anamnéza",
  "RA: bez kardiovaskulární zátěže",
].join("\n");

const PASMA = [
  "Sportovní ambulance Vltavín s.r.o.",
  "Laboratoř zátěžové fyziologie",
  "Tréninková pásma",
  "Pacient:",
  "Tomáš Hrubý",
  "Datum narození:",
  "12.3.1994",
  "Datum protokolu:",
  "3.3.2026",
  "Vyhodnotil:",
  "MUDr. Pavla Hejduková",
  "Identifikace",
  "ID: p-hruby-1994",
  "Věk: 31 let",
  "Pohlaví: ",
].join("\n");

describe("openExcerpt", () => {
  it("opens at the finding, not at the letterhead", () => {
    expect(openExcerpt(FYZIO, "Záznam z fyzioterapie")).toBe(
      "…Diagnóza: stav po plastice předního zkříženého vazu…",
    );
    expect(openExcerpt(PROHLIDKA, "Zpráva ze sportovní prohlídky")).toBe(
      "…RA: bez kardiovaskulární zátěže…",
    );
  });

  it("skips the practice, the department, the title and the identity labels", () => {
    const shown = openExcerpt(PROHLIDKA, "Zpráva ze sportovní prohlídky");
    for (const gone of [
      "s.r.o.",
      "Oddělení funkční diagnostiky",
      "Zpráva ze sportovní prohlídky",
      "Pacient:",
      "Tomáš Hrubý",
      "Datum narození:",
      "Vyšetřil:",
      "Anamnéza",
    ])
      expect(shown).not.toContain(gone);
  });

  it("shows the tail when the excerpt is stationery end to end", () => {
    // The registry's excerpt stops before this sheet's first clinical
    // sentence. There is nothing substantive on this side of the wire, and
    // inventing it is the one thing this panel may not do.
    expect(openExcerpt(MR, "MR pravého kolenního kloubu — popis")).toBe(
      "…Provedené vyšetření\nTechnika:",
    );
    expect(openExcerpt(PASMA, "Tréninková pásma")).toBe("…Věk: 31 let\nPohlaví:");
  });

  it("marks a cut mid-sentence and leaves an open label alone", () => {
    expect(openExcerpt("Závěr: subakromiální imping")).toBe("Závěr: subakromiální imping…");
    expect(openExcerpt("Nález: bez patologie.")).toBe("Nález: bez patologie.");
    expect(openExcerpt("Technika:")).toBe("Technika:");
  });

  it("never opens on an empty excerpt or a one-line one", () => {
    expect(openExcerpt("")).toBe("");
    expect(openExcerpt("Ortopedie a fyzioterapie Podhájí s.r.o.")).toBe(
      "Ortopedie a fyzioterapie Podhájí s.r.o.",
    );
  });

  it("shows a contiguous run of the excerpt's own lines, unaltered", () => {
    for (const [text, title] of [
      [MR, "MR pravého kolenního kloubu — popis"],
      [FYZIO, "Záznam z fyzioterapie"],
      [PROHLIDKA, "Zpráva ze sportovní prohlídky"],
      [PASMA, "Tréninková pásma"],
    ] as const) {
      const shown = openExcerpt(text, title).replace(/^…/, "").replace(/…$/, "");
      const lines = text.replace(/\s+$/, "").split("\n");
      const run = lines.slice(lines.length - shown.split("\n").length).join("\n");
      expect(shown).toBe(run);
    }
  });

  it("matches Czech words a \\b-anchored rule would silently miss", () => {
    // `\bústav\b` and `\bpracoviště\b` never fire in JavaScript: `\b` is
    // ASCII-only, so there is no boundary between a space and „ú".
    const head = ["Ústav klinické biochemie", "Diagnóza: anémie."].join("\n");
    expect(openExcerpt(head)).toBe("…Diagnóza: anémie.");
  });
});
