/**
 * The account's settings are one JSON blob, and PUT /api/settings replaces
 * the whole of it. Three things live in it — the learned synonyms, the
 * parameters the reader founded, and the AI context — and each is saved by a
 * different screen, so a save must carry the others along or erase them.
 * Every save goes through here.
 */
import type { Settings } from "./api";

export function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = { ...current, ...patch };
  // An explicit undefined clears the field rather than keeping the old one.
  for (const k of Object.keys(patch) as Array<keyof Settings>) if (patch[k] === undefined) delete next[k];
  return next;
}
