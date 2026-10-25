/**
 * The compact form of the lab-code table, for a worker to bundle: see
 * tools/scripts/build-code-index.ts and docs/plans/lab-codes.md. Pure, so the
 * build script and the test that pins the shipped file share one definition.
 */
import type { AnalyteDef } from "./models";
import { LabCodes, type LabCodeRow, type LabCodeTable } from "./labCodes";

export function buildCodeIndex(table: LabCodeTable, catalog: Pick<AnalyteDef, "canonicalId" | "synonyms">[]): LabCodeTable {
  const codes = new LabCodes(table, { catalog });
  const keys = new Map<LabCodeRow, string[]>();
  for (const [k, rows] of codes.keyEntries()) for (const r of rows) (keys.get(r) ?? keys.set(r, []).get(r)!).push(k);
  return {
    schema: table.schema,
    source: table.source,
    rows: table.rows.map((r) => {
      const cs = r.names.cs ?? Object.values(r.names)[0];
      const row: LabCodeRow = {
        id: r.id,
        sys: r.sys,
        comp: r.comp,
        prop: r.prop,
        unit: r.unit,
        mat: r.mat,
        spec: r.spec,
        kind: r.kind,
        names: { cs: { name: cs.name, syn: [], ...(cs.method ? { method: cs.method } : {}) } },
        ...(r.loinc?.length ? { loinc: r.loinc } : {}),
        ...(r.catalog?.length ? { catalog: r.catalog } : {}),
        ...(r.methods?.length ? { methods: r.methods } : {}),
        keys: (keys.get(r) ?? []).sort(),
      };
      return row;
    }),
  };
}
