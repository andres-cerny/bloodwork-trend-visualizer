/**
 * Token discipline in the portal's two sheets (apps/CLAUDE.md): anything
 * here may use a token, nothing here may define one — and a signal colour
 * is reserved for meaning it.
 *
 * Read as text: these are rules about what the sheet says, not about what
 * a browser paints, and a grep is the whole proof.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../src");
const styles = readFileSync(join(SRC, "styles.css"), "utf-8");
const legacy = readFileSync(join(SRC, "legacy.css"), "utf-8");

/** Every rule for the selector, joined — a selector may be written twice, once per width. */
function rule(css: string, selector: string): string {
  const parts: string[] = [];
  for (let at = css.indexOf(`${selector} {`); at > -1; at = css.indexOf(`${selector} {`, at + 1)) parts.push(css.slice(at, css.indexOf("}", at)));
  expect(parts.length, `no rule for ${selector}`).toBeGreaterThan(0);
  return parts.join("\n");
}

describe("the scrim", () => {
  it("is drawn from --scrim in both sheets, never from a literal", () => {
    // The same literal sat in .sheet-back (the buy sheet) and .scrim (the
    // drawer) — and the same 42% near-black in both palettes, which over a
    // dark page veils nothing.
    expect(rule(styles, ".sheet-back")).toContain("var(--scrim)");
    expect(rule(legacy, ".scrim")).toContain("var(--scrim)");
    for (const css of [styles, legacy]) expect(css).not.toContain("rgba(15, 15, 12, 0.42)");
  });
});

describe("signal colours mean something", () => {
  it("the draft banner and the sheet's state line are not painted as errors", () => {
    // „Návrh — čeká na schválení provozovatele." and „Obchod zatím není
    // otevřený." are states, not failures; critical red is for a failure.
    for (const sel of [".legal-draft", ".sheet .sheet-state"]) {
      const r = rule(styles, sel);
      expect(r, sel).not.toContain("critical");
    }
  });

  it("the landing's notice and the sheet's failure line stay critical — those are errors", () => {
    expect(rule(styles, ".landing .notice")).toContain("--status-critical-soft");
    expect(rule(styles, ".sheet .notice")).toContain("--status-critical-soft");
  });
});
