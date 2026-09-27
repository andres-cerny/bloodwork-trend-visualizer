/**
 * One parameter, two units: whether a reading can be put in the parameter's
 * canonical unit, and what it is there.
 *
 * A foreign or private lab prints a creatinine as 0,9 mg/dl where a Czech one
 * prints 80 µmol/l. Plotted on one axis under one label, that is a 99 % drop
 * that never happened. The factors are declared per analyte in the registry
 * (`unitConversions`, tools/pipeline/scripts/seed_registry.py); a unit with no
 * factor is not converted by guesswork — the reading stays out of the series
 * and the trend says so (`Trend.otherUnits`).
 */
import type { AnalyteDef } from "./models";

export type UnitDef = Pick<AnalyteDef, "canonicalUnit" | "unitConversions">;

const fold = (u: string) => u.trim().toLowerCase();

/**
 * The factor from `unit` to the canonical unit: 1 for the canonical unit
 * itself (spelled in any case — "mg/dL" is "mg/dl"), the declared factor for
 * a known other unit, null for a unit nothing converts. A missing unit is
 * taken as the canonical one: a lab that prints the unit once in a column
 * header leaves the cell empty.
 */
export function unitFactor(def: UnitDef, unit: string | null | undefined): number | null {
  if (unit === null || unit === undefined || unit.trim() === "") return 1;
  const u = fold(unit);
  if (u === fold(def.canonicalUnit)) return 1;
  for (const [k, f] of Object.entries(def.unitConversions ?? {})) if (fold(k) === u) return f;
  return null;
}

/** Round a converted number to what a lab would print — no 79,58000000001. */
export const roundConverted = (x: number): number => Number(x.toPrecision(4));

/**
 * A reading in the canonical unit, or null when it cannot be put there.
 * `from` is set when a conversion happened, for the sentence in Ověření.
 */
export function inCanonicalUnit(
  m: { value: number | null; unit: string | null; refRangeLow: number | null; refRangeHigh: number | null },
  def: UnitDef,
): { value: number | null; refLow: number | null; refHigh: number | null; unit: string; from: { value: number | null; unit: string } | null } | null {
  const f = unitFactor(def, m.unit);
  if (f === null) return null;
  const conv = (x: number | null) => (x === null ? null : f === 1 ? x : roundConverted(x * f));
  const converted = f !== 1;
  return {
    value: conv(m.value),
    refLow: conv(m.refRangeLow),
    refHigh: conv(m.refRangeHigh),
    unit: def.canonicalUnit,
    from: converted ? { value: m.value, unit: m.unit ?? "" } : null,
  };
}
