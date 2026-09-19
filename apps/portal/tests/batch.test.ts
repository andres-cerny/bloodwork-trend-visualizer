/**
 * The first batch holds Souhrn; a later one does not.
 *
 * What Ondřej saw on his first login: several PDFs picked at once, Souhrn
 * opening on the first and rearranging itself as the others landed. The rule
 * that stops it lives in lib/batch.ts and is driven here the way the screen
 * drives it — a pick opens the batch, a stored report is committed and then
 * settled, a failed one is settled without a report — and what is counted is
 * how many times the screen switched. Once, after the last file; and on an
 * account that has reports, never held at all.
 */
import { describe, expect, it } from "vitest";
import { type Batch, NO_BATCH, holdsSummary, isRunning, pick, settle, waitingLine } from "../src/lib/batch";

/**
 * Portal.tsx, reduced to what the rule reads and writes: the report count,
 * the hold, and `hasData` — the strip and Souhrn are shown exactly when it is
 * true. `switches` counts its rises.
 */
function screen(reportsAtLogin: number) {
  let reports = reportsAtLogin;
  let held = false;
  let batch: Batch = NO_BATCH;
  let shown = reports > 0;
  const switches: number[] = [];
  const onBatch = (b: Batch) => {
    batch = b;
    held = holdsSummary(held, b, reports);
    const now = reports > 0 && !held;
    if (now && !shown) switches.push(reports);
    shown = now;
  };
  return {
    pick: (n: number) => onBatch(pick(batch, n)),
    /** A report stored: committed to the account, then the file settles — the order UploadFlow keeps. */
    stored: () => {
      reports += 1;
      onBatch(settle(batch));
    },
    /** A file that failed or was skipped: nothing stored, the file settles. */
    failed: () => onBatch(settle(batch)),
    get shown() {
      return shown;
    },
    get held() {
      return held;
    },
    get batch() {
      return batch;
    },
    switches,
  };
}

describe("the first batch", () => {
  it("of three: the screen switches once, after the third has settled", () => {
    const s = screen(0);
    s.pick(3);
    expect(s.held).toBe(true);
    s.stored();
    expect(s.shown, "one report in, still the upload screen").toBe(false);
    s.stored();
    expect(s.shown).toBe(false);
    s.stored();
    expect(s.shown).toBe(true);
    expect(s.held).toBe(false);
    // One rise, with all three reports in the account when it came.
    expect(s.switches).toEqual([3]);
  });

  it("with one failure among three: still one switch, after the third — a failure does not hold the others", () => {
    const s = screen(0);
    s.pick(3);
    s.stored();
    s.failed();
    expect(s.shown, "two settled, one to go").toBe(false);
    s.stored();
    expect(s.switches).toEqual([2]);
  });

  it("whose every file fails leaves the upload screen where it is", () => {
    const s = screen(0);
    s.pick(2);
    s.failed();
    s.failed();
    expect(s.held).toBe(false);
    expect(s.shown).toBe(false);
    expect(s.switches).toEqual([]);
  });

  it("grows by a file added while it runs, and waits for that one too", () => {
    const s = screen(0);
    s.pick(2);
    s.stored();
    s.pick(1);
    expect(s.batch).toEqual({ total: 3, settled: 1 });
    s.stored();
    expect(s.shown).toBe(false);
    s.stored();
    expect(s.switches).toEqual([3]);
  });

  it("of one file behaves as it always did: the switch comes when it settles", () => {
    const s = screen(0);
    s.pick(1);
    s.stored();
    expect(s.switches).toEqual([1]);
  });
});

describe("a later batch, into an account with reports", () => {
  it("never holds: the pages update as each document lands", () => {
    const s = screen(4);
    s.pick(3);
    expect(s.held).toBe(false);
    expect(s.shown).toBe(true);
    s.stored();
    expect(s.shown).toBe(true);
    s.failed();
    s.stored();
    expect(s.shown).toBe(true);
    expect(s.switches, "it was showing before and never stopped").toEqual([]);
  });
});

describe("the batch itself", () => {
  it("opens on a pick, closes on the last settle, and picking nothing changes nothing", () => {
    expect(isRunning(NO_BATCH)).toBe(false);
    expect(pick(NO_BATCH, 0)).toBe(NO_BATCH);
    const b = pick(NO_BATCH, 2);
    expect(b).toEqual({ total: 2, settled: 0 });
    expect(isRunning(b)).toBe(true);
    const one = settle(b);
    expect(one).toEqual({ total: 2, settled: 1 });
    expect(settle(one)).toEqual(NO_BATCH);
    // A settle with nothing running is not an error and opens nothing.
    expect(settle(NO_BATCH)).toEqual(NO_BATCH);
  });

  it("a pick after the batch closed is a new batch, not a continuation", () => {
    const closed = settle(pick(NO_BATCH, 1));
    expect(pick(closed, 2)).toEqual({ total: 2, settled: 0 });
  });
});

describe("the line under the queue", () => {
  it("names the count in the genitive, and a single file in the singular", () => {
    expect(waitingLine({ total: 3, settled: 1 })).toBe("Souhrn se otevře až po přečtení všech 3 souborů.");
    expect(waitingLine({ total: 5, settled: 0 })).toBe("Souhrn se otevře až po přečtení všech 5 souborů.");
    expect(waitingLine({ total: 1, settled: 0 })).toBe("Souhrn se otevře, až bude soubor přečten.");
  });
});
