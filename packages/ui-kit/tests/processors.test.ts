/**
 * The privacy copy's one variable clause: who processes a page.
 *
 * Both apps used to name their processors as literal text, so two commands on
 * a deployment — a `GEMINI_API_KEY` secret and a `PHOTO_READERS` var — could
 * send page images of real medical records to a second vendor while the page
 * still named only the first (docs/security-review-gemini.md, finding 1). The
 * clause is rendered from `/api/status` instead, and the rule that makes that
 * safe is the one pinned hardest here: **not knowing must say more, never
 * less.**
 */
import { describe, expect, it } from "vitest";
import { processorPhrase, RETENTION_NOTE, sendsToGoogle } from "../src/processors";

describe("sendsToGoogle", () => {
  it("is true for the pairs that actually reach Google", () => {
    expect(sendsToGoogle("sonnet+gemini")).toBe(true);
    expect(sendsToGoogle("gemini+sonnet")).toBe(true);
  });

  it("is false for the Anthropic-only pair", () => {
    expect(sendsToGoogle("sonnet+haiku")).toBe(false);
  });

  // The whole point of the finding. A page that cannot reach /api/status is
  // in exactly the state where it knows least, and over-disclosure ages
  // safely where under-disclosure is a false promise about a medical record.
  it("claims the broader set while status is loading or unavailable", () => {
    expect(sendsToGoogle(null)).toBe(true);
    expect(sendsToGoogle(undefined)).toBe(true);
    expect(sendsToGoogle("")).toBe(true);
  });
});

describe("processorPhrase", () => {
  it("names both processors when the deployment uses both", () => {
    expect(processorPhrase("sonnet+gemini")).toBe(
      "na Anthropic API, u fotografií také na Google Gemini API",
    );
  });

  it("names only Anthropic when only Anthropic is configured", () => {
    expect(processorPhrase("sonnet+haiku")).toBe("na Anthropic API");
  });

  it("never narrows the claim on a value it does not understand", () => {
    for (const v of [null, undefined, "", "sonnet+opus"]) {
      expect(processorPhrase(v)).toContain("Google");
    }
  });
});

describe("RETENTION_NOTE", () => {
  // It read „data neukládají" — they do not store. Neither vendor publishes
  // that commitment; what both publish is that paid traffic is not trained
  // on, and both retain inputs briefly for abuse monitoring.
  it("claims training, not storage", () => {
    expect(RETENTION_NOTE).toContain("netrénuje");
    expect(RETENTION_NOTE).not.toMatch(/neuklád|neuchováv/);
  });
});
