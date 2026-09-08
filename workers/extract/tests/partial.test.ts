/**
 * The row scanner: rows out of a tool input that is still being written.
 *
 * The fault it guards against is a fragment boundary in the wrong place — a
 * row split mid-string, a brace inside a name, a page whose measurements
 * array is not the first key — any of which would emit a half row or none.
 */
import { describe, expect, it } from "vitest";
import { createRowScanner } from "@bw/extraction";

const page = {
  report_date: "2025-08-15",
  report_date_raw: "15.8.2025",
  lab_name: "SPADIA {LAB}",
  patient_name: null,
  patient_id: null,
  measurements: [
    { raw_analyte_name: "S_Glukóza", value_raw: "5,4", unit_raw: "mmol/l", ref_range_raw: "3,9 - 5,6", row_index: 12, confidence: "high" },
    { raw_analyte_name: "S_Urea [BUN]", value_raw: "6,1", unit_raw: "mmol/l", ref_range_raw: "(2,8-8,0)", row_index: 13, confidence: "high" },
    { raw_analyte_name: "S_Bilirubin \"celkový\"", value_raw: "<3", unit_raw: "µmol/l", ref_range_raw: "", row_index: 14, confidence: "low" },
  ],
};
const text = JSON.stringify(page);

function feedInPieces(size: number): unknown[] {
  const rows: unknown[] = [];
  const scanner = createRowScanner((r) => rows.push(r));
  for (let i = 0; i < text.length; i += size) scanner.feed(text.slice(i, i + size));
  expect(scanner.count).toBe(rows.length);
  return rows;
}

describe("createRowScanner", () => {
  it("emits each row once, in order, however the text is split", () => {
    for (const size of [1, 2, 3, 7, 40, 1000]) {
      expect(feedInPieces(size)).toEqual(page.measurements);
    }
  });

  it("ignores braces inside strings and an object outside the measurements array", () => {
    const rows: unknown[] = [];
    const scanner = createRowScanner((r) => rows.push(r));
    scanner.feed('{"meta": {"x": "{not a row}"}, "measurements": [{"raw_analyte_name": "A", "value_raw": "1"}');
    expect(rows).toEqual([{ raw_analyte_name: "A", value_raw: "1" }]);
    scanner.feed(', {"raw_analyte_name": "B", "value_raw": "2"}], "after": {"y": 1}}');
    expect(rows).toHaveLength(2);
  });

  it("emits nothing for a page with no measurements", () => {
    const rows: unknown[] = [];
    const scanner = createRowScanner((r) => rows.push(r));
    scanner.feed('{"report_date": null, "measurements": []}');
    expect(rows).toEqual([]);
  });
});
