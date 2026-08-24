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
import { excerptLines, excerptStart, isBoilerplate, fold } from "../src/excerpt";

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
      // card's own title.
      expect(fold(first)).not.toMatch(/(^| )(s r o|a s)$/);
      expect(fold(first)).not.toBe(fold(doc.label));

      // Every line above the clamp is boilerplate — the clamp is as early as it
      // can be, so nothing clinical was skipped to reach it.
      for (const dropped of lines.slice(0, start)) {
        expect(isBoilerplate(dropped, doc.label)).toBe(true);
      }
    });
  }

  it("drops the whole header of the MR report and opens on the examination", () => {
    // The card the critic named: five lines of boilerplate before anything.
    const doc = docs.find((d) => d.label.startsWith("MR pravého kolenního kloubu"));
    expect(doc).toBeDefined();
    const lines = excerptLines(doc!.excerpt);
    expect(lines[excerptStart(lines, doc!.label)]).toBe("Provedené vyšetření");
  });

  it("opens the physiotherapy record on its diagnosis", () => {
    const doc = docs.find((d) => d.label === "Záznam z fyzioterapie");
    expect(doc).toBeDefined();
    const lines = excerptLines(doc!.excerpt);
    expect(lines[excerptStart(lines, doc!.label)]).toMatch(/^Diagnóza:/);
  });

  it("keeps the header when the clip contains nothing else", () => {
    // The operating protocol's excerpt runs out inside the header. Dropping
    // every line would leave an empty card, so the fields become the evidence
    // and only the letterhead, the theatre and the repeated title go.
    const doc = docs.find((d) => d.label.startsWith("Operační protokol"));
    expect(doc).toBeDefined();
    const lines = excerptLines(doc!.excerpt);
    const start = excerptStart(lines, doc!.label);
    expect(lines[start]).toMatch(/^Pacient:/);
    expect(start).toBeGreaterThan(0);
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
