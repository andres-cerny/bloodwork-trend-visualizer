/**
 * The two blocks that switch the app to dark must stay identical.
 *
 * One applies when the system asks for dark, the other when the reader forces
 * it with the theme switch. They are separate CSS rules — there is no way to
 * merge a media query with a plain selector — so the failure mode is a token
 * added to one and forgotten in the other: the switch then produces a *nearly*
 * dark page with, say, a white table header, and only on machines whose system
 * theme is light. This makes that loud instead.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("../src/styles.css", import.meta.url)),
  "utf-8",
);

/** The declarations inside the rule whose selector line matches. */
function block(startPattern: RegExp): string {
  const at = css.search(startPattern);
  expect(at, `no rule matching ${startPattern}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

const decls = (s: string) =>
  [...s.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => `${m[1]}: ${m[2].trim()}`).sort();

describe("dark theme", () => {
  const systemDark = decls(block(/:root:not\(\[data-theme="light"\]\)/));
  const forcedDark = decls(block(/:root\[data-theme="dark"\]/));

  it("applies the same tokens whether dark comes from the system or the switch", () => {
    expect(forcedDark).toEqual(systemDark);
  });

  it("covers every token the light palette defines", () => {
    // A token defined for light but never overridden keeps its light value in
    // dark mode — which is how a page ends up with black text on black.
    const light = decls(block(/^:root \{/m))
      .map((d) => d.split(":")[0])
      .filter((n) => !n.startsWith("--dk-"));
    const covered = new Set(systemDark.map((d) => d.split(":")[0]));
    // Geometry tokens (radii, rail width) are not colours and never change.
    const colourish = light.filter((n) =>
      /(plane|surface|ink|accent|grid|border|series|status|band|chip|shadow|csm)/.test(n),
    );
    expect(colourish.filter((n) => !covered.has(n))).toEqual([]);
  });
});

describe("tenant layer", () => {
  const names = (s: string) => decls(s).map((d) => d.split(":")[0]);

  it("a tenant overrides exactly the tokens the default layer defines", () => {
    // A token added to the defaults and forgotten in a tenant block keeps the
    // neutral accent only for that tenant — the un-branded twin of the
    // nearly-dark page the dark test exists for.
    const defaults = names(block(/^:root \{\s*\n\s*--tenant-accent/m));
    const csm = names(block(/:root\[data-tenant="csm"\]/));
    expect(csm).toEqual(defaults);
  });

  it("no tenant token leaks into the dark blocks", () => {
    // The dark blocks' :root selectors would beat the tenant selector in the
    // cascade and quietly un-brand dark mode — the layer comment says why.
    const systemDark = names(block(/:root:not\(\[data-theme="light"\]\)/));
    const forcedDark = names(block(/:root\[data-theme="dark"\]/));
    expect([...systemDark, ...forcedDark].filter((n) => n.startsWith("--tenant-"))).toEqual([]);
  });
});
