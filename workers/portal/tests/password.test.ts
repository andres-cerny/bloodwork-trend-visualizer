/**
 * The hash itself: a password verifies against its own record and nothing
 * else, and a record verifies at the count it was written with — which is
 * what lets PBKDF2_ITERATIONS rise without re-hashing anyone.
 */
import { describe, expect, it } from "vitest";
import { DUMMY_RECORD, PBKDF2_ITERATIONS, hashPassword, verifyPassword } from "../src/password";

describe("hashPassword / verifyPassword", () => {
  it("round-trips, and refuses everything that is not the password", async () => {
    const rec = await hashPassword("správné heslo 123");
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(rec.iters).toBe(PBKDF2_ITERATIONS);
    expect(await verifyPassword("správné heslo 123", rec)).toBe(true);
    expect(await verifyPassword("správné heslo 124", rec)).toBe(false);
    expect(await verifyPassword("", rec)).toBe(false);
  });

  it("salts per record: the same password twice is two different rows", async () => {
    const a = await hashPassword("stejné heslo");
    const b = await hashPassword("stejné heslo");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("verifies at the row's own count, not the current constant", async () => {
    const rec = await hashPassword("heslo heslo", 1000);
    expect(rec.iters).toBe(1000);
    expect(await verifyPassword("heslo heslo", rec)).toBe(true);
    expect(await verifyPassword("heslo heslo", { ...rec, iters: 1001 })).toBe(false);
    expect(await verifyPassword("heslo heslo", { ...rec, iters: PBKDF2_ITERATIONS })).toBe(false);
  });

  it("a malformed record verifies nothing", async () => {
    const rec = await hashPassword("heslo heslo");
    expect(await verifyPassword("heslo heslo", { ...rec, hash: rec.hash.slice(1) })).toBe(false);
    expect(await verifyPassword("heslo heslo", { ...rec, salt: "xyz" })).toBe(false);
    expect(await verifyPassword("heslo heslo", { ...rec, iters: 0 })).toBe(false);
  });

  it("the dummy record, which unknown e-mails are timed against, never matches", async () => {
    for (const p of ["", "0", "password", "0".repeat(64)]) {
      expect(await verifyPassword(p, DUMMY_RECORD)).toBe(false);
    }
  });
});
