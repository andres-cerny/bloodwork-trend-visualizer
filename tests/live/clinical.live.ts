/**
 * The clinical agent end to end, against the real Claude API.
 *
 * This is the demo minute, executed: "dej mi souhrn Tomáše Hrubého" must
 * resolve the patient, bind the turn, read real tools and answer in cited
 * Czech — one ask, no second turn. The corpus is the committed synthetic
 * sport practice; the directory is stubbed over it (PatientLookup is an
 * interface for exactly this), so the only thing not real here is D1.
 *
 * Costs real money — a few cents for the file. LIVE_MAX-style discipline:
 * it prints what it spent, and asserts an order-of-magnitude ceiling.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { PROFILES, priceUsd, runAgent } from "@bw/agent-core";
import type { AgentEvent } from "@bw/agent-core";
import { SessionSource, normalizeName, type PatientLookup, type PatientRef } from "@bw/datasource";
import type { ToolContext } from "@bw/agent-tools";
import type { LabReport } from "@bw/lab-core";

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = JSON.parse(
  readFileSync(join(here, "../../apps/chat/public/demo/sport/reports.json"), "utf8"),
) as Array<LabReport & { patientRef: string }>;

/** The practice's roster, straight from the corpus. */
const PATIENTS: PatientRef[] = [...new Map(
  CORPUS.map((r) => [
    r.patientRef,
    {
      id: r.patientRef,
      fullName: r.patientName ?? r.patientRef,
      // The slug carries the birth year (p-hruby-1994); the stub needs no more.
      birthDate: `${r.patientRef.match(/(\d{4})$/)?.[1] ?? "1990"}-01-01`,
      sex: "m" as const,
      note: "",
    },
  ]),
).values()];

const directory: PatientLookup = {
  async findPatients(query: string) {
    const tokens = normalizeName(query).split(" ").filter(Boolean);
    return PATIENTS.filter((p) => {
      const norm = normalizeName(p.fullName);
      return tokens.every((t) => norm.includes(t));
    });
  },
  async getPatient(id: string) {
    return PATIENTS.find((p) => p.id === id) ?? null;
  },
  async cohort() {
    return [];
  },
};

function contextFor(): ToolContext {
  const ctx: ToolContext = { source: null, directory };
  ctx.bind = (ref: string) => {
    ctx.source = new SessionSource(CORPUS.filter((r) => r.patientRef === ref));
    // An empty store, not an absent one: this practice simply has no prose
    // documents yet, which is a real answer — the worker binds the same pair.
    ctx.documents = {
      listDocuments: async () => [],
      searchDocuments: async () => [],
      getDocument: async () => null,
    };
  };
  return ctx;
}

const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
let spentUsd = 0;

async function ask(question: string) {
  const events: AgentEvent[] = [];
  let answer = "";
  for await (const ev of runAgent({
    apiKey,
    profile: PROFILES.clinical,
    history: [{ role: "user", content: question }],
    data: contextFor(),
  })) {
    events.push(ev);
    if (ev.type === "text") answer += ev.text;
    if (ev.type === "done") {
      spentUsd += priceUsd(
        ev.model,
        ev.usage.inputTokens,
        ev.usage.outputTokens,
        ev.usage.cacheReadTokens,
        ev.usage.cacheWriteTokens,
      );
    }
  }
  return { events, answer };
}

describe.skipIf(!apiKey)("the clinical agent, live", () => {
  it("resolves, binds and summarizes in one ask, with real citations", async () => {
    const { events, answer } = await ask("Dej mi souhrn Tomáše Hrubého.");

    const pin = events.find((e) => e.type === "patient");
    expect(pin).toMatchObject({ ref: "p-hruby-1994" });

    // The summary happened in this turn: some lab tool ran after find_patient.
    const toolsUsed = events.filter((e) => e.type === "tool_start").map((e) => e.name);
    expect(toolsUsed[0]).toBe("find_patient");
    expect(toolsUsed.length).toBeGreaterThan(1);

    expect(answer.length).toBeGreaterThan(80);

    // Every [n] the model wrote must point at a registered source. A marker
    // with no source is an invented citation — the exact thing this exists
    // to catch.
    const src = events.find((e) => e.type === "sources");
    const registered = new Set((src?.sources ?? []).map((s) => s.n));
    const markers = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    for (const n of markers) expect(registered).toContain(n);
  }, 120_000);

  it("says an absent patient is absent, and pins nobody", async () => {
    const { events, answer } = await ask("Jaké hodnoty má Pavel Skočdopole?");

    expect(events.find((e) => e.type === "patient")).toBeUndefined();
    expect(answer.toLowerCase()).toMatch(/není|nenaš|nemá|neexistuje|nefiguruje|neevidujeme|kartotéce/);
    // And nothing was answered about anyone: no lab tool may have succeeded.
    const okLab = events.some(
      (e) => e.type === "tool_result" && e.ok && e.name !== "find_patient",
    );
    expect(okLab).toBe(false);
  }, 120_000);
});

afterAll(() => {
  if (spentUsd > 0) console.log(`clinical.live spent ~$${spentUsd.toFixed(4)}`);
  // Order-of-magnitude guard: two turns of a chat profile, not an eval sweep.
  expect(spentUsd).toBeLessThan(0.5);
});
