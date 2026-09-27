/**
 * The hourly give-back: a document opened long ago with nothing read is
 * abandoned (the tab closed after the open, an answer lost), and its slot
 * goes back — unless it never took one, as a demo visitor's does not.
 */
import { describe, expect, it } from "vitest";
import { SQL } from "../src/db";
import { ABANDONED_AFTER_MS, sweepAbandonedDocuments } from "../src/sweep";

interface Doc {
  id: string;
  user_id: string;
  created_at: string;
  pages_read: number;
  released_at: string | null;
  took_slot: number;
}

function fakeD1(docs: Doc[], used: Map<string, number>): D1Database {
  const make = (sql: string, a: unknown[]): unknown => ({
    bind: (...v: unknown[]) => make(sql, v),
    async all() {
      if (sql !== SQL.sweepDocuments) throw new Error(sql);
      const out = [];
      for (const d of docs) {
        if (d.pages_read === 0 && d.released_at === null && d.created_at < (a[1] as string)) {
          d.released_at = a[0] as string;
          out.push({ user_id: d.user_id, took_slot: d.took_slot });
        }
      }
      return { results: out };
    },
    async run() {
      if (sql !== SQL.giveBackDocument) throw new Error(sql);
      const n = used.get(a[0] as string) ?? 0;
      if (n > 0) used.set(a[0] as string, n - 1);
      return { meta: { changes: n > 0 ? 1 : 0 } };
    },
  });
  return { prepare: (sql: string) => make(sql, []) } as unknown as D1Database;
}

const NOW = Date.parse("2026-09-27T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("sweeping abandoned documents", () => {
  it("gives back an old unread document, and leaves a read, a fresh, a released and a demo one", async () => {
    const docs: Doc[] = [
      { id: "old", user_id: "u", created_at: ago(ABANDONED_AFTER_MS + 1000), pages_read: 0, released_at: null, took_slot: 1 },
      { id: "read", user_id: "u", created_at: ago(ABANDONED_AFTER_MS * 5), pages_read: 2, released_at: null, took_slot: 1 },
      { id: "fresh", user_id: "u", created_at: ago(60_000), pages_read: 0, released_at: null, took_slot: 1 },
      { id: "gone", user_id: "u", created_at: ago(ABANDONED_AFTER_MS * 5), pages_read: 0, released_at: "x", took_slot: 1 },
      { id: "demo", user_id: "owner", created_at: ago(ABANDONED_AFTER_MS * 5), pages_read: 0, released_at: null, took_slot: 0 },
    ];
    const used = new Map([["u", 3], ["owner", 2]]);
    expect(await sweepAbandonedDocuments(fakeD1(docs, used), NOW)).toBe(1);
    expect(used.get("u")).toBe(2);
    expect(used.get("owner")).toBe(2);
    expect(docs.find((d) => d.id === "old")!.released_at).not.toBeNull();
    expect(docs.find((d) => d.id === "fresh")!.released_at).toBeNull();
    // A second run finds nothing left to give.
    expect(await sweepAbandonedDocuments(fakeD1(docs, used), NOW)).toBe(0);
  });
});
