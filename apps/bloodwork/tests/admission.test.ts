/**
 * The waiting room, tested through the shapes the uploader actually produces.
 *
 * Every case here is a sequence of publishes, because that is the thing that
 * broke the original guard: it was written when a report arrived once, and the
 * uploader now publishes a partial per page, out of order, for up to 24 files
 * at a time. The bugs live in the timing, not in the comparison — the
 * comparison has its own tests in lab-core.
 */
import { describe, expect, it } from "vitest";
import type { LabReport } from "@bw/lab-core";
import {
  type Admission,
  answer,
  clearAll,
  EMPTY,
  isUnidentified,
  pending,
  preload,
  receive,
} from "../src/lib/admission";

const report = (id: string, name: string | null, rc: string | null): LabReport => ({
  id,
  sourceFile: `${id}.pdf`,
  reportDate: "2024-03-01",
  labName: null,
  patientName: name,
  patientId: rc,
  pages: [],
  measurements: [],
});

const DEMO = report("demo-1", "Jan Ukázka", "800101/0011");
const demoLoaded = () => preload(EMPTY, [DEMO]);

const names = (s: Admission) => s.admitted.map((r) => r.id);

describe("an upload for the patient already on screen", () => {
  it("is admitted with no question, on the page that proves it", () => {
    const s = receive(demoLoaded(), report("up-1", "Ukázka Jan", "8001010011"), false);
    expect(pending(s)).toBeNull();
    expect(names(s)).toEqual(["demo-1", "up-1"]);
  });

  it("keeps replacing itself as later pages land, without asking again", () => {
    let s = receive(demoLoaded(), report("up-1", "Jan Ukázka", "800101/0011"), false);
    const full = { ...report("up-1", "Jan Ukázka", "800101/0011"), sourceFile: "final.pdf" };
    s = receive(s, full, true);
    expect(names(s)).toEqual(["demo-1", "up-1"]);
    expect(s.admitted[1].sourceFile).toBe("final.pdf");
    expect(pending(s)).toBeNull();
  });
});

describe("the first upload into an empty session", () => {
  it("is admitted, because there is nobody to contradict it", () => {
    const s = receive(EMPTY, report("up-1", "Petr Malý", "750620/1234"), false);
    expect(pending(s)).toBeNull();
    expect(names(s)).toEqual(["up-1"]);
  });
});

describe("a page that landed before the one carrying the header", () => {
  it("waits in silence rather than asking about a report it has not read", () => {
    // The prompt this avoids: pages land out of order, so the first publish of
    // a perfectly ordinary report is routinely one with no patient on it.
    const s = receive(demoLoaded(), report("up-1", null, null), false);
    expect(pending(s)).toBeNull();
    expect(names(s)).toEqual(["demo-1"]);
    expect(s.held).toHaveLength(1);
    expect(isUnidentified(s.held[0])).toBe(true);
  });

  it("is admitted silently once the header page lands and matches", () => {
    let s = receive(demoLoaded(), report("up-1", null, null), false);
    s = receive(s, report("up-1", "Jan Ukázka", "800101/0011"), false);
    expect(pending(s)).toBeNull();
    expect(names(s)).toEqual(["demo-1", "up-1"]);
  });

  it("is asked about only once the document is finished and still unreadable", () => {
    let s = receive(demoLoaded(), report("up-1", null, null), false);
    expect(pending(s)).toBeNull();
    s = receive(s, report("up-1", null, null), true);
    expect(pending(s)?.warning?.kind).toBe("unverifiable");
    expect(names(s)).toEqual(["demo-1"]);
  });
});

describe("a different patient", () => {
  it("is asked about at once, without waiting for the rest of the file", () => {
    // The bug the guard exists for: the rows are already wrong, so waiting
    // twenty seconds for the last page means twenty seconds of a trend line
    // drawn through two people.
    const s = receive(demoLoaded(), report("up-1", "Petr Malý", "750620/1234"), false);
    const p = pending(s);
    expect(p?.warning?.kind).toBe("mismatch");
    expect(names(s)).toEqual(["demo-1"]);
  });

  it("stays out of the loaded set while the question is open", () => {
    let s = receive(demoLoaded(), report("up-1", "Petr Malý", "750620/1234"), false);
    s = receive(s, report("up-1", "Petr Malý", "750620/1234"), true);
    expect(names(s)).toEqual(["demo-1"]);
    expect(pending(s)?.report.id).toBe("up-1");
  });
});

describe("the three answers", () => {
  const asked = () => receive(demoLoaded(), report("up-1", "Petr Malý", "750620/1234"), true);

  it("replace leaves only the new patient loaded", () => {
    const s = answer(asked(), "up-1", "replace");
    expect(names(s)).toEqual(["up-1"]);
    expect(pending(s)).toBeNull();
  });

  it("add anyway keeps both", () => {
    const s = answer(asked(), "up-1", "add");
    expect(names(s)).toEqual(["demo-1", "up-1"]);
    expect(pending(s)).toBeNull();
  });

  it("discard keeps neither the report nor the question", () => {
    const s = answer(asked(), "up-1", "discard");
    expect(names(s)).toEqual(["demo-1"]);
    expect(s.held).toEqual([]);
    expect(pending(s)).toBeNull();
  });

  it("ignores an answer for a report that is no longer waiting", () => {
    // The dialog and the queue run at different speeds; an answer that arrives
    // late must not land on whatever document took its place.
    const s = answer(asked(), "up-9", "replace");
    expect(names(s)).toEqual(["demo-1"]);
    expect(pending(s)?.report.id).toBe("up-1");
  });
});

describe("after an answer, the file keeps arriving", () => {
  it("does not ask again about a patient that was added anyway", () => {
    // Every remaining page of an accepted file publishes again. Re-checking
    // would put the same dialog back up once per page.
    let s = answer(receive(demoLoaded(), report("up-1", "Petr Malý", "750620/1234"), false), "up-1", "add");
    s = receive(s, report("up-1", "Petr Malý", "750620/1234"), true);
    expect(pending(s)).toBeNull();
    expect(names(s)).toEqual(["demo-1", "up-1"]);
  });

  it("does not resurrect a discarded file page by page", () => {
    let s = answer(receive(demoLoaded(), report("up-1", "Petr Malý", "750620/1234"), false), "up-1", "discard");
    s = receive(s, report("up-1", "Petr Malý", "750620/1234"), false);
    s = receive(s, report("up-1", "Petr Malý", "750620/1234"), true);
    expect(pending(s)).toBeNull();
    expect(names(s)).toEqual(["demo-1"]);
    expect(s.held).toEqual([]);
  });

  it("keeps a discard in force across Vymazat vše", () => {
    let s = answer(receive(demoLoaded(), report("up-1", "Petr Malý", "750620/1234"), true), "up-1", "discard");
    s = clearAll(s);
    s = receive(s, report("up-1", "Petr Malý", "750620/1234"), true);
    expect(names(s)).toEqual([]);
    expect(pending(s)).toBeNull();
  });
});

describe("several files dropped at once", () => {
  it("asks once for two files belonging to the same new patient", () => {
    // 24 files run concurrently. Two draws for one new patient must not cost
    // two identical questions — answering the first settles the second.
    let s = receive(demoLoaded(), report("up-1", "Petr Malý", "750620/1234"), true);
    s = receive(s, report("up-2", "Malý Petr", "7506201234"), true);
    expect(s.held).toHaveLength(2);
    expect(pending(s)?.report.id).toBe("up-1");

    s = answer(s, "up-1", "replace");
    expect(pending(s)).toBeNull();
    expect(names(s)).toEqual(["up-1", "up-2"]);
  });

  it("asks about a third patient one dialog at a time, in arrival order", () => {
    let s = receive(demoLoaded(), report("up-1", "Petr Malý", "750620/1234"), true);
    s = receive(s, report("up-2", "Eva Nová", "915501/2222"), true);
    expect(pending(s)?.report.id).toBe("up-1");

    s = answer(s, "up-1", "add");
    expect(pending(s)?.report.id).toBe("up-2");

    s = answer(s, "up-2", "discard");
    expect(pending(s)).toBeNull();
    expect(names(s)).toEqual(["demo-1", "up-1"]);
  });

  it("re-judges the ones still waiting against the patient just accepted", () => {
    // "Replace" empties the room. A file that was a mismatch against the demo
    // patient may be a match against the one that replaced it.
    let s = receive(demoLoaded(), report("up-1", "Petr Malý", "750620/1234"), true);
    s = receive(s, report("up-2", null, null), true);
    expect(pending(s)?.report.id).toBe("up-1");

    s = answer(s, "up-1", "replace");
    // up-2 could not be identified, so it is still a question — but now it is
    // asked against Petr Malý rather than against Jan Ukázka.
    const p = pending(s);
    expect(p?.report.id).toBe("up-2");
    expect(p?.warning?.kind).toBe("unverifiable");
    if (p?.warning?.kind !== "unverifiable") throw new Error("unreachable");
    expect(p.warning.loaded.map((i) => i.name)).toEqual(["Petr Malý"]);
  });
});

describe("clearing everything", () => {
  it("drops the loaded reports and the open questions alike", () => {
    const s = clearAll(receive(demoLoaded(), report("up-1", "Petr Malý", "750620/1234"), true));
    expect(names(s)).toEqual([]);
    expect(s.held).toEqual([]);
    expect(pending(s)).toBeNull();
  });
});

describe("restoring the demo data", () => {
  it("loads it without asking, because it was not uploaded", () => {
    const s = preload(EMPTY, [DEMO]);
    expect(names(s)).toEqual(["demo-1"]);
    expect(pending(s)).toBeNull();
  });
});
