/**
 * The two settings transitions behind "found a new parameter" and "delete it".
 *
 * Both touch two fields at once — the founded parameter itself and the learned
 * name filed under it — and PUT /api/settings replaces the whole blob, so
 * getting them out of the component keeps each change one write and one thing
 * to test. The screen renders; the shapes are decided here.
 *
 * A founded parameter's printed names are *not* stored on the parameter. They
 * go in `learned`, where every accepted mapping already lives, which is what
 * makes a second lab's spelling joining it the ordinary mapping path with no
 * code of its own.
 */
import type { CustomAnalyte } from "@bw/lab-core";

export interface ParamSettings {
  learned: Record<string, string[]>;
  customAnalytes: CustomAnalyte[];
}

/** The printed names filed under a parameter. */
export const namesUnder = (s: ParamSettings, canonicalId: string): string[] =>
  s.learned[canonicalId] ?? [];

/**
 * Found `c`, with `rawName` as its first printed name.
 *
 * Appended rather than prepended, and de-duplicated, so the order matches the
 * learned map's own contract: raw names in acceptance order.
 */
export function withNewParameter(
  s: ParamSettings,
  c: CustomAnalyte,
  rawName: string,
): ParamSettings {
  return {
    learned: {
      ...s.learned,
      [c.canonicalId]: [...namesUnder(s, c.canonicalId).filter((n) => n !== rawName), rawName],
    },
    customAnalytes: [...s.customAnalytes.filter((x) => x.canonicalId !== c.canonicalId), c],
  };
}

/**
 * Delete a founded parameter.
 *
 * The learned entry goes with it: the names filed under it have nowhere left
 * to point, and leaving them would have the next load teach the registry
 * synonyms for an id it no longer holds. The caller unmaps those names — this
 * only decides what the account stores.
 */
export function withoutParameter(s: ParamSettings, canonicalId: string): ParamSettings {
  const learned = { ...s.learned };
  delete learned[canonicalId];
  return {
    learned,
    customAnalytes: s.customAnalytes.filter((x) => x.canonicalId !== canonicalId),
  };
}
