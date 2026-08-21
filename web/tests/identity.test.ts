/**
 * The guard that stops two patients' results being drawn as one trend.
 *
 * The cases below are grouped by the direction of the mistake, because the two
 * directions are not equally bad. A false warning costs a click. A false pass
 * merges two people, and every number the app then shows — the trend, the
 * percent change, the summary sentence, the chat answer — is about nobody.
 */
import { describe, expect, it } from "vitest";
import {
  checkIdentity,
  compareIdentities,
  describeIdentity,
  distinctIdentities,
  normalizeName,
  normalizeRodneCislo,
} from "../src/lib/identity";
import type { LabReport } from "../src/lib/models";

const report = (patientName: string | null, patientId: string | null, id = "r"): LabReport => ({
  id,
  sourceFile: `${id}.pdf`,
  reportDate: "2024-03-01",
  labName: null,
  patientName,
  patientId,
  pages: [],
  measurements: [],
});

describe("rodné číslo normalization", () => {
  it("ignores the separator labs happen to print", () => {
    expect(normalizeRodneCislo("800101/0011")).toBe("8001010011");
    expect(normalizeRodneCislo("800101 / 0011")).toBe("8001010011");
    expect(normalizeRodneCislo("8001010011")).toBe("8001010011");
  });

  it("accepts the 9-digit form used before 1954", () => {
    expect(normalizeRodneCislo("450101/001")).toBe("450101001");
  });

  it("rejects anything that cannot be a rodné číslo", () => {
    // A misread that drops a digit must not be compared: as digits it would
    // differ from the real one and read as a different patient.
    expect(normalizeRodneCislo("800101/001")).toBe("800101001"); // 9 — legitimate
    expect(normalizeRodneCislo("80010100")).toBeNull(); // 8 — a misread
    expect(normalizeRodneCislo("N/A")).toBeNull();
    expect(normalizeRodneCislo("")).toBeNull();
    expect(normalizeRodneCislo(null)).toBeNull();
  });
});

describe("name normalization", () => {
  it("ignores diacritics, case and word order", () => {
    expect(normalizeName("Jan Novák")).toBe(normalizeName("NOVAK JAN"));
    expect(normalizeName("Tereza Dvořáková")).toBe(normalizeName("Dvorakova, Tereza"));
  });

  it("ignores titles", () => {
    expect(normalizeName("Ing. Jan Novák")).toBe(normalizeName("Jan Novák"));
    expect(normalizeName("MUDr. Petr Svoboda, CSc.")).toBe(normalizeName("Svoboda Petr"));
  });

  it("still tells two different people apart", () => {
    expect(normalizeName("Jan Novák")).not.toBe(normalizeName("Jana Nováková"));
  });

  it("returns null when nothing usable is left", () => {
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeName("---")).toBeNull();
    expect(normalizeName(null)).toBeNull();
  });
});

describe("comparing two identities", () => {
  it("lets the rodné číslo decide when both sides have one", () => {
    expect(
      compareIdentities({ name: "Jan Novák", id: "800101/0011" }, { name: "Jan Novák", id: "8001010011" }),
    ).toBe("same");
    expect(
      compareIdentities({ name: "Jan Novák", id: "800101/0011" }, { name: "Jan Novák", id: "800101/0022" }),
    ).toBe("different");
  });

  it("does not let a matching name overturn a differing rodné číslo", () => {
    // Two people can share a name; they cannot share a rodné číslo.
    expect(
      compareIdentities({ name: "Jan Novák", id: "800101/0011" }, { name: "Jan Novák", id: "750620/1234" }),
    ).toBe("different");
  });

  it("falls back to the name when one side has no usable id", () => {
    expect(compareIdentities({ name: "Jan Novák", id: null }, { name: "Novák Jan", id: "800101/0011" })).toBe("same");
    expect(compareIdentities({ name: "Jan Novák", id: null }, { name: "Petr Malý", id: "800101/0011" })).toBe(
      "different",
    );
  });

  it("says unknown rather than guessing when nothing lines up", () => {
    expect(compareIdentities({ name: null, id: "800101/0011" }, { name: "Jan Novák", id: null })).toBe("unknown");
    expect(compareIdentities({ name: null, id: null }, { name: "Jan Novák", id: "800101/0011" })).toBe("unknown");
  });
});

describe("checking an upload against what is loaded", () => {
  const loaded = [report("Jan Ukázka", "800101/0011", "demo-1")];

  it("passes silently when nothing is loaded yet", () => {
    expect(checkIdentity(report("Kdokoli", "990101/1111"), []).kind).toBe("ok");
  });

  it("passes silently for another draw from the same patient", () => {
    expect(checkIdentity(report("Ukázka Jan", "8001010011"), loaded).kind).toBe("ok");
  });

  it("stops a different rodné číslo, and says which field decided", () => {
    const c = checkIdentity(report("Petr Malý", "750620/1234"), loaded);
    expect(c.kind).toBe("mismatch");
    if (c.kind !== "mismatch") throw new Error("unreachable");
    expect(c.by).toBe("id");
    expect(c.incoming.id).toBe("750620/1234");
    expect(c.loaded.map(describeIdentity)).toEqual(["Jan Ukázka · 800101/0011"]);
  });

  it("stops a different name when neither side has a usable id", () => {
    const c = checkIdentity(report("Petr Malý", null), [report("Jan Ukázka", null, "demo-1")]);
    expect(c.kind).toBe("mismatch");
    if (c.kind !== "mismatch") throw new Error("unreachable");
    expect(c.by).toBe("name");
  });

  it("stops an upload it could not identify at all", () => {
    // The failure this exists for: a scan whose header did not transcribe.
    // Nothing was proven different, and that is exactly why it must be asked.
    const c = checkIdentity(report(null, null), loaded);
    expect(c.kind).toBe("unverifiable");
  });

  it("stops an upload when the loaded data has no identity to compare", () => {
    const c = checkIdentity(report("Petr Malý", "750620/1234"), [report(null, null, "demo-1")]);
    expect(c.kind).toBe("unverifiable");
  });

  it("stops merging on a partial identity that cannot be lined up", () => {
    // Incoming has only an id, loaded has only a name: no shared field, so no
    // conclusion — and therefore a question, not a silent merge.
    const c = checkIdentity(report(null, "750620/1234"), [report("Jan Ukázka", null, "demo-1")]);
    expect(c.kind).toBe("unverifiable");
  });

  it("does not ask again about a patient already accepted alongside another", () => {
    // After someone deliberately keeps two patients loaded, a third draw for
    // either of them is not news. Warning anyway is how a warning stops being
    // read.
    const mixed = [report("Jan Ukázka", "800101/0011", "demo-1"), report("Petr Malý", "750620/1234", "up-1")];
    expect(checkIdentity(report("Petr Malý", "750620/1234", "up-2"), mixed).kind).toBe("ok");
  });

  it("still warns about a third patient once two are loaded", () => {
    const mixed = [report("Jan Ukázka", "800101/0011", "demo-1"), report("Petr Malý", "750620/1234", "up-1")];
    const c = checkIdentity(report("Eva Nová", "915501/2222", "up-2"), mixed);
    expect(c.kind).toBe("mismatch");
    if (c.kind !== "mismatch") throw new Error("unreachable");
    expect(c.loaded).toHaveLength(2);
  });

  it("compares against every distinct identity, not just the first report", () => {
    // Two reports for the demo patient plus one for someone else: an upload
    // matching the *second* identity must still pass.
    const mixed = [
      report("Jan Ukázka", "800101/0011", "demo-1"),
      report("Jan Ukázka", "800101/0011", "demo-2"),
      report("Petr Malý", "750620/1234", "up-1"),
    ];
    expect(checkIdentity(report("Malý Petr", "7506201234", "up-2"), mixed).kind).toBe("ok");
  });
});

describe("listing who is loaded", () => {
  it("keeps name and rodné číslo paired, from the same report", () => {
    // The header used to find each field independently, which could pair one
    // patient's name with another's number.
    const mixed = [report(null, null, "a"), report("Petr Malý", "750620/1234", "b")];
    expect(distinctIdentities(mixed)).toEqual([{ name: "Petr Malý", id: "750620/1234" }]);
  });

  it("collapses repeated draws from one patient to one entry", () => {
    const same = [report("Jan Ukázka", "800101/0011", "a"), report("Jan Ukázka", "800101/0011", "b")];
    expect(distinctIdentities(same)).toHaveLength(1);
  });

  it("lists two patients as two, in load order", () => {
    const mixed = [report("Jan Ukázka", "800101/0011", "a"), report("Petr Malý", "750620/1234", "b")];
    expect(distinctIdentities(mixed).map((i) => i.name)).toEqual(["Jan Ukázka", "Petr Malý"]);
  });

  it("skips reports carrying no identity at all", () => {
    expect(distinctIdentities([report(null, null, "a")])).toEqual([]);
  });
});

describe("describing an identity for the dialog", () => {
  it("shows both parts when both are known", () => {
    expect(describeIdentity({ name: "Jan Ukázka", id: "800101/0011" })).toBe("Jan Ukázka · 800101/0011");
  });

  it("shows whichever part exists", () => {
    expect(describeIdentity({ name: "Jan Ukázka", id: null })).toBe("Jan Ukázka");
    expect(describeIdentity({ name: null, id: "800101/0011" })).toBe("800101/0011");
  });

  it("never renders an empty line", () => {
    expect(describeIdentity({ name: null, id: null })).toBe("neuvedeno");
    expect(describeIdentity({ name: "  ", id: "" })).toBe("neuvedeno");
  });
});
