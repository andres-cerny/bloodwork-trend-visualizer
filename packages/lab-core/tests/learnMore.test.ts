/**
 * The "O parametru" map is hand-curated, so the two ways it rots are a key
 * that no longer names a parameter the app can show, and a slug that is not
 * shaped like one of theirs. Both are checkable offline; whether the pages
 * still exist is checked by tools/scripts/check-learn-more.mjs, which needs
 * the network and so stays out of `npm test`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DERIVED, LEARN_MORE_SLUGS, learnMoreUrl } from "@bw/lab-core";

const registry = JSON.parse(
  readFileSync(new URL("../../../apps/bloodwork/public/demo/registry.json", import.meta.url), "utf-8"),
) as { canonicalId: string }[];

const knownIds = new Set([
  ...registry.map((a) => a.canonicalId),
  ...DERIVED.map((d) => d.id),
]);

describe("LEARN_MORE_SLUGS", () => {
  it("only names parameters the app can put on a trend card", () => {
    const unknown = Object.keys(LEARN_MORE_SLUGS).filter((id) => !knownIds.has(id));
    expect(unknown).toEqual([]);
  });

  it("holds slugs, not URLs or titles", () => {
    for (const slug of Object.values(LEARN_MORE_SLUGS)) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("covers the routine panel a patient actually opens", () => {
    for (const id of ["glukoza", "kreatinin", "alt", "hemoglobin", "tsh", "cholesterol", "crp"]) {
      expect(LEARN_MORE_SLUGS[id], id).toBeDefined();
    }
  });
});

describe("learnMoreUrl", () => {
  it("builds the page URL from the slug", () => {
    expect(learnMoreUrl("urea")).toBe("https://www.labtestsonline.cz/mocovina.html");
  });

  it("is undefined, not a search page, for a parameter without an article", () => {
    expect(learnMoreUrl("hemolyza_index")).toBeUndefined();
    expect(learnMoreUrl("no_such_parameter")).toBeUndefined();
  });

  it("sends a derived value to the page for the panel it comes from", () => {
    expect(learnMoreUrl("derived:non_hdl")).toBe("https://www.labtestsonline.cz/lipidovy-profil.html");
  });
});
