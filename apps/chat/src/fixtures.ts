/**
 * The canned conversations, bundled.
 *
 * A fixture is the SSE event log of a turn that really happened, captured once
 * against synthetic patients and committed. It is replayed through the same
 * `applyEvent` a live turn goes through — which is why a fixture that renders
 * is evidence the UI handles the event grammar, and not merely evidence that
 * someone wrote convincing JSON.
 *
 * Eagerly globbed: 52 kB of JSON, and a sidebar that has to wait on a dynamic
 * import before it can list its own contents is a sidebar that flashes empty.
 */
import type { AgentEvent } from "@bw/agent-core/events";

export interface FixtureTurn {
  user: string;
  events: AgentEvent[];
}

export interface Fixture {
  /** From the filename — this is what `?fx=` names. */
  slug: string;
  title: string;
  tenant: string;
  turns: FixtureTurn[];
}

const modules = import.meta.glob<{ default: Omit<Fixture, "slug"> }>(
  "./fixtures/*/*.json",
  { eager: true },
);

/** Fixtures by tenant, in filename order so the sidebar is stable. */
export const FIXTURES: Record<string, Fixture[]> = {};

for (const [path, mod] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
  const slug = path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
  const fx: Fixture = { slug, ...mod.default };
  (FIXTURES[fx.tenant] ??= []).push(fx);
}

/** Unknown tenant or unknown slug is not an error — it is the empty state. */
export function findFixture(tenant: string, slug: string | null): Fixture | null {
  if (!slug) return null;
  return FIXTURES[tenant]?.find((f) => f.slug === slug) ?? null;
}
