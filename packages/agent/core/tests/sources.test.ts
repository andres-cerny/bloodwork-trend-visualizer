/**
 * One piece of evidence, one number.
 *
 * The rule earns a test because the turn that breaks it looks correct from
 * every side: get_trend walks a series, summarize_changes cites that series'
 * most recent value, both hand over the same located row, and the rail shows
 * the identical crop twice under two numbers. To a doctor that reads as two
 * independent confirmations of a value measured once.
 */
import { describe, expect, it } from "vitest";
import type { SourceInfo } from "@bw/agent-tools";
import { createSourceRegistry, sourceKey } from "../src/sources";

const row = (over: Partial<Extract<SourceInfo, { kind: "lab" }>> = {}): SourceInfo => ({
  kind: "lab",
  label: "ferritin 21 µg/l",
  date: "2026-02-24",
  lab: "Laboratoř Zelený Ostrov s.r.o.",
  reportId: "r6",
  page: 1,
  imageUrl: "/r6.png",
  bbox: [10, 20, 300, 34],
  pageW: 1240,
  pageH: 1754,
  ...over,
});

const doc = (over: Partial<Extract<SourceInfo, { kind: "document" }>> = {}): SourceInfo => ({
  kind: "document",
  label: "Zpráva ze sportovní prohlídky",
  date: "2026-02-27",
  documentId: "d1",
  title: "Zpráva ze sportovní prohlídky",
  excerpt: "VO₂max 64,8 ml/kg/min",
  imageUrl: "/d1.png",
  ...over,
});

describe("createSourceRegistry", () => {
  it("numbers from one, in registration order", () => {
    const { sources, cite } = createSourceRegistry();
    expect(cite(row())).toBe(1);
    expect(cite(row({ label: "ck 5,10 µkat/l", bbox: [10, 60, 300, 74] }))).toBe(2);
    expect(sources.map((s) => s.n)).toEqual([1, 2]);
  });

  it("gives the same row the same number twice", () => {
    const { sources, cite } = createSourceRegistry();
    expect(cite(row())).toBe(1);
    expect(cite(row({ label: "ck 5,10 µkat/l", bbox: [10, 60, 300, 74] }))).toBe(2);
    // summarize_changes cited the latest ferritin; get_trend walks into it.
    expect(cite(row())).toBe(1);
    expect(sources.length).toBe(2);
  });

  it("keeps two rows of one page apart when neither could be located", () => {
    // Both boxes null, same report, same page: only the label distinguishes
    // them, and collapsing them would put one card behind two values.
    const { sources, cite } = createSourceRegistry();
    expect(cite(row({ bbox: null, label: "ferritin 21 µg/l" }))).toBe(1);
    expect(cite(row({ bbox: null, label: "ck 5,10 µkat/l" }))).toBe(2);
    expect(sources.length).toBe(2);
  });

  it("keeps the same value on two different draws apart", () => {
    const { sources, cite } = createSourceRegistry();
    cite(row({ reportId: "r5", date: "2025-04-08" }));
    cite(row({ reportId: "r6" }));
    expect(sources.length).toBe(2);
  });

  it("treats two excerpts of one document as two quotations", () => {
    const { sources, cite } = createSourceRegistry();
    expect(cite(doc())).toBe(1);
    expect(cite(doc({ excerpt: "pásmo E doporučeno vynechat" }))).toBe(2);
    expect(cite(doc())).toBe(1);
    expect(sources.length).toBe(2);
  });

  it("stores the source exactly as it was handed over", () => {
    // The client renders the registry as sent; nothing here may normalise it.
    const { sources, cite } = createSourceRegistry();
    const s = row();
    cite(s);
    expect(sources[0]).toEqual({ n: 1, ...s });
  });
});

describe("sourceKey", () => {
  it("does not confuse a lab row with a document", () => {
    expect(sourceKey(row())).not.toBe(sourceKey(doc()));
  });

  it("changes when the box changes", () => {
    expect(sourceKey(row())).not.toBe(sourceKey(row({ bbox: [10, 20, 300, 35] })));
  });

  it("changes when the page changes", () => {
    expect(sourceKey(row())).not.toBe(sourceKey(row({ page: 2 })));
  });

  it("ignores what the rail only displays", () => {
    // The lab name and the page image are the same evidence described twice;
    // keying on them would split one row into two cards over a null.
    expect(sourceKey(row())).toBe(sourceKey(row({ lab: "", imageUrl: null })));
  });
});
