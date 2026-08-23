/**
 * What a Turnstile token is allowed to prove.
 *
 * `success === true` was the whole check, and the gap it left was real rather
 * than theoretical: this widget registers production *and* localhost, a token
 * belongs to the widget rather than to the page, so a challenge solved on
 * localhost minted production sessions. Anyone able to run the app locally
 * could mint them.
 *
 * Every case below is one way to say no. The two that matter most are the
 * hostname mismatch and the empty allowlist — the first is the hole that was
 * open, the second is the misconfiguration that would silently reopen it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "../src/auth";
import { TURNSTILE_ACTION } from "../src/turnstile";

const PROD = "bloodwork-demo.andres-cerny.workers.dev";
const expected = { hostnames: [PROD], action: TURNSTILE_ACTION };

function siteverify(body: unknown, ok = true) {
  vi.stubGlobal("fetch", async () =>
    ok
      ? new Response(JSON.stringify(body), { status: 200 })
      : new Response("nope", { status: 500 }),
  );
}

afterEach(() => vi.unstubAllGlobals());

const verify = (over: Record<string, unknown> = {}, exp = expected) =>
  verifyTurnstile("secret", "tok", null, exp as never).catch(() => "threw");

describe("verifyTurnstile", () => {
  it("accepts a solved challenge from a hostname we serve, for this action", async () => {
    siteverify({ success: true, hostname: PROD, action: TURNSTILE_ACTION });
    expect(await verify()).toBe(true);
  });

  it("accepts the published testing key's canned response — dev only by construction", async () => {
    // The always-pass secret answers hostname "example.com" and no action; the
    // flag below is set by siteverify itself, only when the configured SECRET
    // is a testing key. Requiring the proofs anyway broke every dev session.
    siteverify({ success: true, hostname: "example.com", metadata: { result_with_testing_key: true } });
    expect(await verify()).toBe(true);
  });

  it("does not let the flag be claimed without success, nor its shape without the flag", async () => {
    siteverify({ success: false, metadata: { result_with_testing_key: true } });
    expect(await verify()).toBe(false);
    // Same canned shape, no flag: a real secret answered — the proofs apply.
    siteverify({ success: true, hostname: "example.com" });
    expect(await verify()).toBe(false);
  });

  it("refuses a token solved on localhost", async () => {
    // The actual hole. localhost is on the widget, so siteverify says success.
    siteverify({ success: true, hostname: "localhost", action: TURNSTILE_ACTION });
    expect(await verify()).toBe(false);
  });

  it("refuses a token replayed from another action", async () => {
    siteverify({ success: true, hostname: PROD, action: "some-other-form" });
    expect(await verify()).toBe(false);
  });

  it("refuses when the hostname allowlist is unset", async () => {
    // A missing allowlist is a misconfiguration. Reading it as "allow anything"
    // is how a guard stops guarding without anyone noticing.
    siteverify({ success: true, hostname: PROD, action: TURNSTILE_ACTION });
    expect(await verify({}, { hostnames: [], action: TURNSTILE_ACTION })).toBe(false);
    expect(await verify({}, { hostnames: ["", "  "], action: TURNSTILE_ACTION })).toBe(false);
  });

  it("refuses an unsolved challenge", async () => {
    siteverify({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verify()).toBe(false);
  });

  it("fails closed on a siteverify error, not open", async () => {
    siteverify({}, false);
    expect(await verify()).toBe(false);
    vi.stubGlobal("fetch", async () => { throw new Error("network down"); });
    expect(await verify()).toBe(false);
  });

  it("refuses an absent or oversized token without calling siteverify", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", async (...a: unknown[]) => {
      calls.push(a);
      return new Response(JSON.stringify({ success: true, hostname: PROD, action: TURNSTILE_ACTION }));
    });
    expect(await verifyTurnstile("s", "", null, expected)).toBe(false);
    expect(await verifyTurnstile("s", "x".repeat(2049), null, expected)).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
