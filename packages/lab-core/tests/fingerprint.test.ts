/**
 * The fingerprint is the one thing that lets a file be refused before it
 * costs anything, so it has to be exactly stable and exactly discriminating:
 * the same bytes, twice, one string; one bit different, another string.
 *
 * The content match is the weaker guess and its edges matter more than its
 * middle: a report without a date must match nothing (two undated reports
 * are not "the same date"), and the report being replaced must not be
 * counted as a duplicate of itself.
 */
import { describe, expect, it } from "vitest";
import { describeReport, fingerprintBytes, isFingerprint, sameFile, sameIssue, type LabReport } from "@bw/lab-core";

const report = (id: string, reportDate: string | null, labName: string | null, fingerprint?: string): LabReport => ({
  id, sourceFile: `${id}.pdf`, reportDate, labName, patientName: null, patientId: null, pages: [], measurements: [], ...(fingerprint ? { fingerprint } : {}),
});

describe("fingerprintBytes", () => {
  it("is the same for the same bytes and different for different bytes", async () => {
    const a = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);
    const again = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);
    const other = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 4]);
    const fa = await fingerprintBytes(a);
    expect(fa).toBe(await fingerprintBytes(again));
    expect(fa).toBe(await fingerprintBytes(a.buffer));
    expect(fa).not.toBe(await fingerprintBytes(other));
    expect(isFingerprint(fa)).toBe(true);
    // A fixed vector, so the format cannot drift: SHA-256 of the empty input.
    expect(await fingerprintBytes(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("accepts only 64 lowercase hex characters", () => {
    expect(isFingerprint("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855")).toBe(false);
    expect(isFingerprint("e3b0")).toBe(false);
    expect(isFingerprint(null)).toBe(false);
  });
});

describe("sameFile", () => {
  it("finds the report carrying the fingerprint, and nothing without one", () => {
    const fp = "a".repeat(64);
    const reports = [report("r-1", "2024-10-25", "SPADIA LAB"), report("r-2", "2024-11-01", "SPADIA LAB", fp)];
    expect(sameFile(reports, fp)?.id).toBe("r-2");
    expect(sameFile(reports, "b".repeat(64))).toBeNull();
    expect(sameFile([], fp)).toBeNull();
  });
});

describe("sameIssue", () => {
  const reports = [report("r-1", "2024-10-25", "SPADIA LAB"), report("r-2", "2024-11-01", "SPADIA LAB"), report("r-3", null, "SPADIA LAB")];

  it("matches the same date and laboratory, laboratory spelling folded", () => {
    expect(sameIssue(reports, "2024-10-25", "SPADIA LAB")?.id).toBe("r-1");
    expect(sameIssue(reports, "2024-10-25", " spadia  lab ")?.id).toBe("r-1");
  });

  it("does not match a different date, a different laboratory, or an unknown", () => {
    expect(sameIssue(reports, "2024-10-26", "SPADIA LAB")).toBeNull();
    expect(sameIssue(reports, "2024-10-25", "synlab")).toBeNull();
    expect(sameIssue(reports, null, "SPADIA LAB")).toBeNull();
    expect(sameIssue(reports, "2024-10-25", null)).toBeNull();
  });

  it("leaves out the report being replaced", () => {
    expect(sameIssue(reports, "2024-10-25", "SPADIA LAB", "r-1")).toBeNull();
  });
});

describe("describeReport", () => {
  it("names a report by its Czech date and laboratory", () => {
    expect(describeReport(report("r", "2024-10-25", "SPADIA LAB"))).toBe("25. 10. 2024, SPADIA LAB");
    expect(describeReport(report("r", "2024-10-25", null))).toBe("25. 10. 2024");
    expect(describeReport(report("r", null, null))).toBe("bez data");
  });
});
