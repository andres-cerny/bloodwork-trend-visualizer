/** The deployment may swap the model behind a profile; the client never can. */
import { describe, expect, it } from "vitest";
import { PROFILES, withModel } from "../src/profiles";

describe("withModel", () => {
  it("swaps to an allowed model and keeps prompt, tools and auth", () => {
    const p = withModel(PROFILES.clinical, "claude-sonnet-5-5");
    expect(p.model).toBe("claude-sonnet-5-5");
    expect(p.system).toBe(PROFILES.clinical.system);
    expect(p.tools).toEqual(PROFILES.clinical.tools);
    expect(PROFILES.clinical.model).toBe("claude-sonnet-5");
  });

  it("ignores an unset, unknown or misspelled id", () => {
    for (const asked of [undefined, "", "gpt-9", "claude-sonet-5-5"]) {
      expect(withModel(PROFILES.bloodwork, asked)).toBe(PROFILES.bloodwork);
    }
  });
});
