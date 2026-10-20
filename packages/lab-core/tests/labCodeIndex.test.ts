/**
 * The compact index a worker bundles must be current and must answer exactly
 * as the full table does (docs/plans/lab-codes.md, "Runtime").
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LabCodes, buildCodeIndex, type LabCodeTable } from "@bw/lab-core";

const ROOT = join(import.meta.dirname, "../../..");
const table = JSON.parse(readFileSync(join(ROOT, "packages/lab-core/codes/lab-codes.json"), "utf8")) as LabCodeTable;
const catalog = JSON.parse(readFileSync(join(ROOT, "apps/portal/public/registry.json"), "utf8"));
const shipped = JSON.parse(readFileSync(join(ROOT, "packages/lab-core/codes/lab-codes.index.json"), "utf8")) as LabCodeTable;

describe("compact lab-code index", () => {
  it("is current: rebuild with `npx vite-node --root . tools/scripts/build-code-index.ts`", () => {
    expect(JSON.stringify(shipped)).toBe(JSON.stringify(buildCodeIndex(table, catalog)));
  });

  it("looks up and shortlists exactly like the full table", () => {
    const full = new LabCodes(table, { catalog });
    const compact = new LabCodes(shipped);
    const cases: Array<[string, string, string | null]> = [
      ["S_Na", "mmol/l", null],
      ["Sodík", "mmol/l", null],
      ["B_Leukocyty", "10^9/l", null],
      ["Neutrofily %", "%", null],
      ["S_Cholesterol HDL", "mmol/l", null],
      ["Glukóza", "mmol/l", "u"],
      ["P_Protrombinový test", "s", null],
      ["S-Vitamin B12", "pg/ml", null],
    ];
    for (const [n, u, m] of cases) {
      expect(compact.lookup(n, u, m).map((h) => [h.row.id, h.score]), n).toEqual(full.lookup(n, u, m).map((h) => [h.row.id, h.score]));
      expect(compact.shortlist(n, u, m, 20).map((h) => h.row.id), n).toEqual(full.shortlist(n, u, m, 20).map((h) => h.row.id));
    }
  });
});
