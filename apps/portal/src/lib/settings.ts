/**
 * The account's settings are one JSON blob, and PUT /api/settings replaces
 * the whole of it. Two things live in it — the learned synonyms and the AI
 * context — and each is saved by a different screen, so a save must carry
 * the other along or erase it. Every save goes through here.
 */
import type { Settings } from "./api";

export function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = { ...current, ...patch };
  // An explicit undefined clears the field rather than keeping the old one.
  for (const k of Object.keys(patch) as Array<keyof Settings>) if (patch[k] === undefined) delete next[k];
  return next;
}
