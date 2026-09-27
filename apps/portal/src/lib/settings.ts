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

/**
 * A save refused because another tab saved first: the patch laid over what
 * the server holds now. The two maps (learned names, the model's record) are
 * merged key by key, so the other tab's names survive this tab's change; any
 * other field is this tab's patch, as it would have been.
 */
export function rebaseSettings(fresh: Settings, patch: Partial<Settings>): Settings {
  const next = mergeSettings(fresh, patch);
  if (patch.learned && fresh.learned) next.learned = { ...fresh.learned, ...patch.learned };
  if (patch.aiAsked && fresh.aiAsked) next.aiAsked = { ...fresh.aiAsked, ...patch.aiAsked };
  return next;
}
