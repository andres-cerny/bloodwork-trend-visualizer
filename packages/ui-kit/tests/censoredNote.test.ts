/**
 * The censored-results note, at every Czech numeral form.
 *
 * A trend whose only numeric point sits among „<1,0" results says so in prose,
 * and that prose counts the censored ones. It read „dalších 2 odběrů" — the
 * genitive plural, which Czech uses from five up, worn by a two. Both words in
 * the phrase decline, so getting the noun right and leaving the adjective
 * alone would have fixed half of it.
 */
import { describe, expect, it } from "vitest";
import { censoredNote } from "../src/Chart";

describe("censoredNote", () => {
  it("uses the singular at one, and omits the number", () => {
    expect(censoredNote(1)).toBe("další odběr");
  });

  it("uses the nominative plural at two, three and four", () => {
    expect(censoredNote(2)).toBe("další 2 odběry");
    expect(censoredNote(3)).toBe("další 3 odběry");
    expect(censoredNote(4)).toBe("další 4 odběry");
  });

  it("uses the genitive plural from five up", () => {
    expect(censoredNote(5)).toBe("dalších 5 odběrů");
    expect(censoredNote(11)).toBe("dalších 11 odběrů");
    expect(censoredNote(23)).toBe("dalších 23 odběrů");
  });

  // The bug itself, stated as a rule rather than as three examples: the
  // five-and-up form must never appear on a count that is not five and up.
  it("never wears the genitive form at two, three or four", () => {
    for (const n of [2, 3, 4]) {
      expect(censoredNote(n)).not.toMatch(/dalších|odběrů/);
    }
  });
});
