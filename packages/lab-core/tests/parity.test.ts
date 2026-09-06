/**
 * TypeScript half of the cross-language parity check.
 *
 * These functions reimplement src/normalize.py so the browser can re-derive a
 * corrected value live. Two implementations of the same rules drift silently
 * unless something forces them together — so both this file and
 * tools/pipeline/tests/test_parity.py read tools/pipeline/tests/parity_cases.json, and a change made on one
 * side and not the other fails here.
 *
 * When a rule genuinely needs to change: edit the fixture first, then make
 * both implementations satisfy it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalizeUnit,
  computeFlag,
  materialPrefix,
  normKey,
  parseCzechNumber,
  parseRange,
  parseValue,
} from "@bw/lab-core";

const CASES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../tools/pipeline/tests/parity_cases.json"), "utf-8"),
) as {
  parse_czech_number: Array<[string, number | null]>;
  parse_value: Array<[string, number | null]>;
  canonicalize_unit: Array<[string, string]>;
  parse_range: Array<[string, [number | null, number | null, string | null]]>;
  compute_flag: Array<[number | null, number | null, number | null, string]>;
  material_prefix: Array<[string, string | null]>;
  norm_key: Array<[string, string]>;
};

describe("parity with src/normalize.py", () => {
  it("parseCzechNumber", () => {
    for (const [input, expected] of CASES.parse_czech_number) {
      expect(parseCzechNumber(input), `parseCzechNumber(${JSON.stringify(input)})`).toBe(expected);
    }
  });

  // Guard seen failing: "5,4 ↑" parsed as null before arrows joined "!"/"*"
  // as decoration (2026-09-06).
  it("parseValue", () => {
    for (const [input, expected] of CASES.parse_value) {
      expect(parseValue(input), `parseValue(${JSON.stringify(input)})`).toBe(expected);
    }
  });

  it("canonicalizeUnit", () => {
    for (const [input, expected] of CASES.canonicalize_unit) {
      expect(canonicalizeUnit(input), `canonicalizeUnit(${JSON.stringify(input)})`).toBe(expected);
    }
  });

  // Guard seen failing: "do 5,0", "nad 0,5", "≤ 5,00", "≥ 0,5" and
  // "0,5 až 1,5" all degraded to text before the word/symbol bounds landed
  // (2026-09-06).
  it("parseRange", () => {
    for (const [input, [low, high, text]] of CASES.parse_range) {
      expect(parseRange(input), `parseRange(${JSON.stringify(input)})`).toEqual({ low, high, text });
    }
  });

  it("computeFlag", () => {
    for (const [value, low, high, expected] of CASES.compute_flag) {
      expect(computeFlag(value, low, high), `computeFlag(${value}, ${low}, ${high})`).toBe(expected);
    }
  });

  // Guard seen failing: with the naive ^[a-z]{1,4}[-/_] widening, anti-TPO
  // came back as "anti" and S,P-glukóza as null (2026-09-06).
  it("materialPrefix", () => {
    for (const [input, expected] of CASES.material_prefix) {
      expect(materialPrefix(input), `materialPrefix(${JSON.stringify(input)})`).toBe(expected);
    }
  });

  it("normKey", () => {
    for (const [input, expected] of CASES.norm_key) {
      expect(normKey(input), `normKey(${JSON.stringify(input)})`).toBe(expected);
    }
  });

  it("covers every case in the shared fixture", () => {
    const total =
      CASES.parse_czech_number.length +
      CASES.parse_value.length +
      CASES.canonicalize_unit.length +
      CASES.parse_range.length +
      CASES.compute_flag.length +
      CASES.material_prefix.length +
      CASES.norm_key.length;
    // Matches the count tests/test_parity.py reports, so neither side can
    // quietly stop reading part of the fixture.
    expect(total).toBe(105);
  });
});
