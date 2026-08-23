/**
 * Session tokens gate every AI route, so the interesting cases here are the
 * rejections: a forged signature, a token signed with a different secret, and
 * one whose expiry has passed must all fail closed.
 */
import { describe, expect, it, vi } from "vitest";
import { mintSession, verifySession } from "../src/auth";

const SECRET = "test-secret-please-ignore";

describe("session tokens", () => {
  it("round-trips the claims it was minted with", async () => {
    const token = await mintSession(SECRET, 600, 12);
    const claims = await verifySession(SECRET, token);
    expect(claims).not.toBeNull();
    expect(claims!.pages).toBe(12);
    expect(claims!.sid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintSession(SECRET, 600, 12);
    expect(await verifySession("some-other-secret", token)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await mintSession(SECRET, 600, 1);
    const [payload, sig] = token.split(".");
    // Re-encode the claims with a much larger page allowance, keeping the
    // original signature — the forgery this scheme exists to stop.
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    claims.pages = 9999;
    const forged = btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifySession(SECRET, `${forged}.${sig}`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await mintSession(SECRET, 60, 12);
    expect(await verifySession(SECRET, token)).not.toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect(await verifySession(SECRET, token)).toBeNull();
    vi.useRealTimers();
  });

  it("rejects malformed input rather than throwing", async () => {
    for (const bad of [null, "", "no-dot", "a.b", "....", "%%%.%%%"]) {
      expect(await verifySession(SECRET, bad as string | null)).toBeNull();
    }
  });
});
