/**
 * The excerpt clamp, run against the strings the demo actually ships.
 *
 * Two things are being pinned here, and they pull in opposite directions:
 *
 * 1. The clamp works — every document card in every fixture opens on something
 *    a clinician would call the document, not on the practice's letterhead.
 * 2. The clamp is only a clamp — the words that survive it are the server's,
 *    in the server's order, with only whitespace touched.
 *
 * Written against the fixture files rather than against invented strings on
 * purpose: the first implementation of this passed a hand-written test suite
 * and matched nothing at all on the real data, because the word tests used
 * `\b` and Czech header lines end in diacritics.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { excerptLines, excerptStart, hasInternalRef, isBoilerplate, fold } from "../src/excerpt";

/* ------------------------------------------------------------------ *
 * The fixtures
 * ------------------------------------------------------------------ */

interface DocSource {
  file: string;
  n: number;
  label: string;
  excerpt: string;
}

function documentSources(): DocSource[] {
  const root = join(__dirname, "..", "src", "fixtures");
  const out: DocSource[] = [];
  for (const tenant of readdirSync(root)) {
    for (const name of readdirSync(join(root, tenant))) {
      const fx = JSON.parse(readFileSync(join(root, tenant, name), "utf8"));
      for (const turn of fx.turns ?? []) {
        for (const event of turn.events ?? []) {
          const sources = event.sources ?? event.data?.sources;
          if (!Array.isArray(sources)) continue;
          for (const s of sources) {
            if (s.kind === "document" && s.excerpt) {
              out.push({ file: `${tenant}/${name}`, n: s.n, label: s.label, excerpt: s.excerpt });
            }
          }
        }
      }
    }
  }
  return out;
}

const docs = documentSources();

/** Every letter, digit and punctuation mark, with all whitespace removed. */
const glyphs = (s: string) => s.replace(/\s+/g, "");

describe("the fixtures still contain document citations", () => {
  it("finds the excerpts this suite exists to check", () => {
    // A rename of `excerpt` or of the fixture shape would otherwise turn every
    // test below into a vacuous pass over an empty list.
    expect(docs.length).toBeGreaterThanOrEqual(6);
  });
});

describe("the clamp never rewrites the document", () => {
  for (const doc of docs) {
    it(`keeps every surviving glyph of ${doc.file} [${doc.n}]`, () => {
      const lines = excerptLines(doc.excerpt);
      const shown = lines.slice(excerptStart(lines, doc.label));
      // Whitespace is the only thing this touches: strip it from both sides and
      // what is shown must appear verbatim, in order, inside the original.
      expect(glyphs(doc.excerpt)).toContain(glyphs(shown.join("")));
      // …and it must be the *tail* of it, so nothing was reordered and nothing
      // was dropped from the middle.
      expect(glyphs(doc.excerpt).endsWith(glyphs(shown.join("")))).toBe(true);
    });
  }
});

describe("the clamp starts at the document, not at the letterhead", () => {
  for (const doc of docs) {
    it(`opens ${doc.file} [${doc.n}] on something worth reading`, () => {
      const lines = excerptLines(doc.excerpt);
      const start = excerptStart(lines, doc.label);
      const first = lines[start];

      // Never the practice's name, never the department, never a repeat of the
      // card's own title. (A clip that held nothing but the header clamps past
      // its own last line and shows nothing at all — that case is below.)
      if (first !== undefined) {
        expect(fold(first)).not.toMatch(/(^| )(s r o|a s)$/);
        expect(fold(first)).not.toBe(fold(doc.label));
      }

      // Every line above the clamp is boilerplate — the clamp is as early as it
      // can be, so nothing clinical was skipped to reach it.
      lines.slice(0, start).forEach((dropped, i) => {
        expect(isBoilerplate(dropped, doc.label, lines[i + 1])).toBe(true);
      });
    });
  }

  it("shows nothing on the MR report, whose clip ends at a colon", () => {
    // The card the critic named twice. Five lines of boilerplate, and then the
    // only thing the clip reached of the document itself is „Provedené
    // vyšetření / Technika:" — a section named and a field whose value never
    // arrived. Shown, it promises the technique and delivers a colon.
    const doc = docs.find((d) => d.label.startsWith("MR pravého kolenního kloubu"));
    expect(doc).toBeDefined();
    const lines = excerptLines(doc!.excerpt);
    expect(lines.slice(-2)).toEqual(["Provedené vyšetření", "Technika:"]);
    expect(excerptStart(lines, doc!.label)).toBe(lines.length);
  });

  it("keeps the same shape of heading when the value did arrive", () => {
    // „Anamnéza / RA: bez kardiovaskulární zátěže" is the sports report's
    // opening, and it is the rule's own counter-example: a heading over a key
    // that carries its value is a passage, and the clamp stops there.
    const doc = docs.find((d) => d.label === "Zpráva ze sportovní prohlídky");
    expect(doc).toBeDefined();
    const lines = excerptLines(doc!.excerpt);
    expect(lines[excerptStart(lines, doc!.label)]).toBe("Anamnéza");
  });

  it("opens the physiotherapy record on its diagnosis", () => {
    const doc = docs.find((d) => d.label === "Záznam z fyzioterapie");
    expect(doc).toBeDefined();
    const lines = excerptLines(doc!.excerpt);
    expect(lines[excerptStart(lines, doc!.label)]).toMatch(/^Diagnóza:/);
  });

  it("shows nothing at all when the clip contains nothing but the header", () => {
    // The operating protocol's excerpt runs out inside the header: letterhead,
    // theatre, repeated title, then „Pacient / Datum narození / Datum výkonu /
    // Operatér". Those four lines prove which patient, never which passage, so
    // the card carries its title, its date and its page link and quotes
    // nothing. An empty excerpt is the honest one.
    const doc = docs.find((d) => d.label.startsWith("Operační protokol"));
    expect(doc).toBeDefined();
    const lines = excerptLines(doc!.excerpt);
    expect(lines.length).toBeGreaterThan(0);
    expect(excerptStart(lines, doc!.label)).toBe(lines.length);
  });

  it("does not open the training zones on their identification block", () => {
    // „Identifikace" has no colon, so nothing but the heading rule keeps it
    // from reading as prose — and reading as prose is how „ID: p-hruby-1994"
    // reached the screen.
    const doc = docs.find((d) => d.label === "Tréninková pásma");
    expect(doc).toBeDefined();
    const lines = excerptLines(doc!.excerpt);
    expect(lines).toContain("Identifikace");
    expect(excerptStart(lines, doc!.label)).toBe(lines.length);
  });
});

describe("a field whose value the clip never reached", () => {
  it("is not what an excerpt opens on", () => {
    expect(isBoilerplate("Technika:", "MR pravého kolenního kloubu — popis")).toBe(true);
    expect(isBoilerplate("Technika: MR 1,5 T, sekvence PD", "X")).toBe(false);
  });

  it("takes the section title above it, which promised nothing else", () => {
    expect(isBoilerplate("Provedené vyšetření", "X", "Technika:")).toBe(true);
    // The same title over a line that says something stays.
    expect(isBoilerplate("Provedené vyšetření", "X", "Technika: MR 1,5 T")).toBe(false);
    expect(isBoilerplate("Provedené vyšetření", "X", "Kloub bez výpotku")).toBe(false);
  });

  it("does not take a finding that happens to sit above one", () => {
    // The rule's whole cost: a line clamped away is a passage the reader loses.
    // A sentence is not a section title, so it survives whatever follows it.
    expect(isBoilerplate("Kloub je stabilní", "X", "Doporučení:")).toBe(false);
    expect(isBoilerplate("Kloub je stabilní, bez výpotku", "X", "Doporučení:")).toBe(false);
    expect(isBoilerplate("Bez patologického nálezu", "X", "Doporučení:")).toBe(false);
  });

  it("leaves the MR card with no excerpt rather than a promise", () => {
    // End to end, on the string the fixture actually ships.
    const excerpt =
      "Ortopedie a fyzioterapie Podhájí s.r.o.\nRadiodiagnostické pracoviště\n" +
      "MR pravého kolenního kloubu — popis\nPacient:\nMichal Novák\n" +
      "Datum narození:\n27.2.1988\nDatum vyšetření:\n20.9.2024\nPopsal:\n" +
      "MUDr. Eva Puchmertlová\nProvedené vyšetření\nTechnika:";
    const doc = docs.find((d) => d.label.startsWith("MR pravého kolenního kloubu"));
    expect(doc!.excerpt).toBe(excerpt);
    const lines = excerptLines(excerpt);
    expect(lines.slice(excerptStart(lines, "MR pravého kolenního kloubu — popis"))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The identifier that must never render
 * ------------------------------------------------------------------ */

describe("the internal patient ref never reaches the screen", () => {
  // The real line, from the real fixture — not a hand-written stand-in.
  const idLine = () => {
    const doc = docs.find((d) => d.label === "Tréninková pásma");
    expect(doc).toBeDefined();
    const line = excerptLines(doc!.excerpt).find((l) => l.startsWith("ID:"));
    expect(line).toBe("ID: p-hruby-1994");
    return line!;
  };

  it("recognises the ref in the fixture's own identification line", () => {
    expect(hasInternalRef(idLine())).toBe(true);
  });

  it("clamps past it even when the line above is prose", () => {
    // The classifier and the guard must not share a failure mode: put the ref
    // under a heading no rule here recognises, so nothing but the guard is
    // left to catch it.
    const lines = ["Závěr", idLine(), "Pásma stanovena podle TF."];
    expect(excerptStart(lines, "Tréninková pásma")).toBe(2);
  });

  it("clamps past the last of several, not the first", () => {
    const lines = ["Závěr", idLine(), "Kontrola", "Dle protokolu p-hruby-1994."];
    expect(excerptStart(lines, "Tréninková pásma")).toBe(4);
  });

  it("leaves every fixture excerpt free of one", () => {
    for (const doc of docs) {
      const lines = excerptLines(doc.excerpt);
      for (const shown of lines.slice(excerptStart(lines, doc.label))) {
        expect(hasInternalRef(shown)).toBe(false);
      }
    }
  });

  it("does not fire on Czech prose that merely contains a hyphen", () => {
    // The guard clamps text away, so a false positive costs the reader a
    // passage. „p-" has to start a token to count.
    expect(hasInternalRef("Kloub je stabilní, bez výpotku")).toBe(false);
    expect(hasInternalRef("Doporučena kontrola za 6–8 týdnů")).toBe(false);
    expect(hasInternalRef("Hodnota pH 7,38 — bez odchylky")).toBe(false);
  });
});

describe("whitespace, and only whitespace, is collapsed", () => {
  it("rejoins a header key to the value the extractor put on the next line", () => {
    const lines = excerptLines("Pacient:\nMichal Novák\nDatum narození:\n27.2.1988");
    expect(lines).toEqual(["Pacient: Michal Novák", "Datum narození: 27.2.1988"]);
  });

  it("leaves a key with no value of its own alone", () => {
    // „Technika:" is where one fixture's clip ends. Swallowing the next line
    // into it when there is no next line, or when the next line is itself a
    // key, would invent a header field.
    expect(excerptLines("Technika:")).toEqual(["Technika:"]);
    expect(excerptLines("Technika:\nPopsal:")).toEqual(["Technika:", "Popsal:"]);
  });

  it("does not join two lines of prose", () => {
    const prose = "Kloub je stabilní\nbez známek výpotku";
    expect(excerptLines(prose)).toEqual(["Kloub je stabilní", "bez známek výpotku"]);
  });
});

/* ------------------------------------------------------------------ *
 * The trap
 * ------------------------------------------------------------------ */

describe("Czech word tests, which ASCII word boundaries cannot do", () => {
  const department = "Oddělení funkční diagnostiky";

  it("recognises a department line that ends in a diacritic", () => {
    expect(isBoilerplate(department, "Zpráva ze sportovní prohlídky")).toBe(true);
  });

  it("proves why: \\b does not fire after „í", () => {
    // This is the regex the first attempt shipped. It matches nothing, because
    // `í` is not an ASCII word character, so /\boddělení\b/ requires a boundary
    // at a position that has one only if the surrounding characters differ in
    // word-ness — and here they do not.
    expect(/\boddělení\b/i.test(department)).toBe(false);
    // Folded first, the same test means what it reads as.
    expect(/\boddeleni\b/.test(fold(department))).toBe(true);
  });

  it("folds every department word the fixtures use", () => {
    for (const line of [
      "Radiodiagnostické pracoviště",
      "Pracoviště fyzioterapie",
      "Ortopedické oddělení — operační sál",
      "Laboratoř zátěžové fyziologie",
      "Oddělení funkční diagnostiky",
    ]) {
      expect(isBoilerplate(line, "něco jiného")).toBe(true);
    }
  });

  it("does not mistake a finding that mentions a place for a department line", () => {
    // A colon makes it a statement about the patient, not a letterhead line.
    expect(isBoilerplate("Doporučení: kontrola v ambulanci za 6 týdnů", "X")).toBe(false);
    expect(isBoilerplate("Kloub je stabilní, bez výpotku", "X")).toBe(false);
  });
});
