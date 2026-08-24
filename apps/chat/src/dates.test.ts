/**
 * The one date formatter, and the one thing it must not do.
 *
 * Three conventions used to be on screen at once — ISO in a rail title, Czech
 * spacing under it, the model's unspaced form in the prose — so the guard is
 * that `czDate` renders one shape and that `czDatesInText` changes nothing
 * except the spacing inside something that is actually a date.
 */
import { describe, expect, it } from "vitest";
import { czDate, czDatesInText } from "./dates";
import { foldExcerpt, openExcerpt } from "./Sources";

describe("czDate", () => {
  it("renders the registry's ISO as a Czech date", () => {
    expect(czDate("2023-02-14")).toBe("14. 2. 2023");
    expect(czDate("2026-02-24")).toBe("24. 2. 2026");
  });

  it("re-spaces a Czech date and leaves anything else alone", () => {
    expect(czDate("16.1.2024")).toBe("16. 1. 2024");
    expect(czDate("nar. 1963")).toBe("nar. 1963");
  });
});

describe("czDatesInText", () => {
  it("spaces every date in a sentence, including one before a full stop", () => {
    expect(czDatesInText("od 16.1.2024 do 19.5.2025.")).toBe(
      "od 16. 1. 2024 do 19. 5. 2025.",
    );
  });

  it("leaves a date that is already Czech exactly as it was", () => {
    const s = "8. 10. 2024 provedena artroskopická plastika LCA";
    expect(czDatesInText(s)).toBe(s);
  });

  it("does not touch numbers that are not dates", () => {
    for (const s of [
      "posilování zevních rotátorů s gumou (3×12)",
      "ortézu 0–90° na 4 týdny",
      "VAS 4/10 při elevaci, od 04/2025",
      "CK 2,61 → 5,1 µkat/l (ref. 0,4–3,2)",
      "roční objem 6 200 km",
    ])
      expect(czDatesInText(s)).toBe(s);
  });
});

describe("foldExcerpt", () => {
  const raw =
    "Ortopedie a fyzioterapie Podhájí s.r.o.\nPracoviště fyzioterapie\n" +
    "Záznam z fyzioterapie\nPacient:\nMichal Novák\nDatum narození:\n27.2.1988\n" +
    "Diagnóza: stav po plastice předního zkříženého vazu";

  it("closes a label up with its value, so the clinical line is inside the clamp", () => {
    expect(foldExcerpt(raw).split("\n")).toEqual([
      "Ortopedie a fyzioterapie Podhájí s.r.o.",
      "Pracoviště fyzioterapie",
      "Záznam z fyzioterapie",
      "Pacient: Michal Novák",
      "Datum narození: 27.2.1988",
      "Diagnóza: stav po plastice předního zkříženého vazu…",
    ]);
  });

  it("keeps every word of the quote, in order, unaltered", () => {
    const words = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");
    expect(words(foldExcerpt(raw).replace(/…$/, ""))).toBe(words(raw));
  });

  it("never re-spaces a date inside a quote", () => {
    // The prose formatter must not reach in here: this is the paper talking.
    expect(foldExcerpt(raw)).toContain("27.2.1988");
  });
});

describe("openExcerpt", () => {
  const withProse =
    "Ortopedie a fyzioterapie Podhájí s.r.o.\nPracoviště fyzioterapie\n" +
    "Záznam z fyzioterapie\nPacient:\nMichal Novák\nDatum narození:\n27.2.1988\n" +
    "Datum terapie:\n16.12.2024\nTerapeut:\nMgr. Petr Hlaváček\n" +
    "Diagnóza: stav po plastice předního zkříženého vazu";

  it("drops the letterhead and opens on the clinical line", () => {
    expect(openExcerpt(withProse, "Záznam z fyzioterapie")).toBe(
      "…Diagnóza: stav po plastice předního zkříženého vazu…",
    );
  });

  it("shows a contiguous run of the paper's own words, unaltered", () => {
    // The one rule the evidence panel cannot bend: what is displayed must be
    // in the payload, in that order, spelt that way. Only the start moves.
    const shown = openExcerpt(withProse, "Záznam z fyzioterapie").replace(/^…|…$/g, "");
    expect(foldExcerpt(withProse).replace(/…$/, "")).toContain(shown);
  });

  it("keeps a quote that starts with content exactly where it starts", () => {
    const prose = "Závěr: kompletní ruptura LCA.\nDoporučena artroskopie.";
    expect(openExcerpt(prose, "MR kolena")).toBe(prose);
  });

  it("falls back to the tail when the excerpt is stationery end to end", () => {
    // novak-dva's MR report: the registry's excerpt stops before the first
    // sentence of the finding, so there is no cited text to reach. Two
    // different last lines beat two identical letterheads.
    const allHeader =
      "Ortopedie a fyzioterapie Podhájí s.r.o.\nRadiodiagnostické pracoviště\n" +
      "MR pravého kolenního kloubu — popis\nPacient:\nMichal Novák\n" +
      "Datum narození:\n27.2.1988\nPopsal:\nMUDr. Eva Puchmertlová\n" +
      "Provedené vyšetření\nTechnika:";
    expect(openExcerpt(allHeader, "MR pravého kolenního kloubu — popis")).toBe(
      "…Provedené vyšetření\nTechnika:…",
    );
  });
});
