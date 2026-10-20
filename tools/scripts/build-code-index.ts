/**
 * The compact lab-code index a worker bundles (docs/plans/lab-codes.md,
 * "Runtime"): every row of packages/lab-core/codes/lab-codes.json with only
 * what mapping needs — code, specimen, quantity, unit, the Czech name, LOINC,
 * catalog links — and its name keys already normalised (the catalog's
 * synonyms lent to linked rows included), so the worker builds no key index
 * at start.
 *
 *   npx vite-node --root . tools/scripts/build-code-index.ts
 *
 * Re-run whenever lab-codes.json or registry.json changes; a test pins that
 * the index is current.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCodeIndex } from "../../packages/lab-core/src/labCodeIndex";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const table = JSON.parse(readFileSync(join(ROOT, "packages/lab-core/codes/lab-codes.json"), "utf8"));
const catalog = JSON.parse(readFileSync(join(ROOT, "apps/portal/public/registry.json"), "utf8"));
const out = buildCodeIndex(table, catalog);
const text = JSON.stringify(out) + "\n";
writeFileSync(join(ROOT, "packages/lab-core/codes/lab-codes.index.json"), text);
console.log(`${out.rows.length} rows, ${(text.length / 1024).toFixed(0)} KiB`);
