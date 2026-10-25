/**
 * Moje krev's pipeline with every recommended switch ON vs everything OFF,
 * end to end after the reads (docs/plans/model-loop.md, round 7): interpret →
 * mapping (/api/map) → judge → shared lessons → auto entries → second opinion
 * → rematch, then a second account loading the same reports. Reads are the
 * stored ones (bench:adapt, portal_text.ts), so the paid part is the mapping
 * calls only. Label text, units and ranges only go to the model.
 *
 *   with-secrets bloodwork -- env PYTHON_BIN=.venv/bin/python npx vite-node --root . tests/bench/e2e_switches.ts
 *
 * ON  = text: Haiku 5.5 alone (TEXT_READERS=cheap, MODEL_SECOND=claude-haiku-5-5);
 *       photos: Sonnet 5.5 + Gemini (MODEL_PRIMARY=claude-sonnet-5-5);
 *       MODEL_MAP=claude-haiku-5-5, MAP_MODE=codes-retry, VITE_SECOND_OPINION,
 *       VITE_SHARE_AI_MAPPINGS, VITE_AUTO_ENTRIES.
 * OFF = text: Sonnet 5 + Haiku 4.5; photos: Sonnet 5 + Gemini; mapping: Haiku 4.5
 *       over the whole catalog; no sharing, no second opinion, no auto entries.
 *
 * What it looks for: a name asked twice (mapping and second opinion), two
 * saved decisions for one (lab, name, unit) that disagree, an auto entry the
 * second opinion then undoes, a second account that asks the model again for
 * a name the first one settled, and the model cost per upload.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mapByCodes, suggestCanonical, type CatalogEntry } from "@bw/extraction";
import { priceUsd } from "@bw/agent-core";
import { LabCodes, Registry, findUnmapped, findWeakMatches, observedStats, rematchReport, reviewOf, trendable, type LabCodeTable, type LabReport, type RawRead, type TextRow } from "@bw/lab-core";

import { autoEntriesFrom, autoEntryDef, judge, runSecondOpinion, scopeOf, sharedLessons } from "../../apps/portal/src/lib/aiMapping";
import { interpretPage } from "../../apps/portal/src/lib/interpret";
import { loadClass, PUBLIC_PDF_DIR } from "./corpora";
import { parsePdf } from "./corpus";

const R = dirname(fileURLToPath(import.meta.url));
const ROOT = join(R, "../..");
const KEY = process.env.ANTHROPIC_API_KEY!;
const defs = JSON.parse(readFileSync(join(ROOT, "apps/portal/public/registry.json"), "utf8"));
const codes = new LabCodes(JSON.parse(readFileSync(join(ROOT, "packages/lab-core/codes/lab-codes.index.json"), "utf8")) as LabCodeTable);

/* ---------------------------------------------------------------- pages */
interface Page { slug: string; text: boolean; rows: TextRow[]; lab: string }
const pages: Page[] = [];
for (const p of await loadClass("synthetic")) if (p.truth) pages.push({ slug: p.slug, text: p.kind === "text", rows: p.rows ?? [], lab: `Syntetická laboratoř ${p.slug}` });
for (const p of await loadClass("public")) if (!p.slug.startsWith("stod_")) pages.push({ slug: p.slug, text: false, rows: [], lab: "" });
const stodPdf = join(PUBLIC_PDF_DIR, "fetched/stod_p_loha_2_vzor_v_sledkov_ho_listu_f214.pdf");
if (existsSync(stodPdf)) {
  const { doc } = await parsePdf(stodPdf);
  for (const pg of doc.pages) if (pg.hasTextLayer && pg.pageNum <= 4) pages.push({ slug: `stod_p${pg.pageNum}`, text: true, rows: pg.rows, lab: "Stodská nemocnice" });
}

function read(arm: string, page: Page): (RawRead & { lab_name?: string | null }) | null {
  const pt = join(R, "results/portal_text", arm, `${page.slug}.json`);
  if (page.slug.startsWith("stod_")) return existsSync(pt) ? JSON.parse(readFileSync(pt, "utf8")) : null;
  const f = join(R, "results/adapt", arm, `${page.slug}.json`);
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, "utf8"));
  return j.call?.ok ? { model: j.call.model, measurements: j.call.extraction.measurements, lab_name: j.call.extraction.lab_name } : null;
}

/* ---------------------------------------------------------------- one account */
interface Store { aliases: Map<string, { id: string | null; source: string; code?: string | null }>; autos: Map<string, { code: string; nameCs: string; unit: string; rawName: string; material?: string }> }
const aliasKey = (lab: string, name: string, unit: string) => `${lab}|${name}|${unit}`;

function registryFor(store: Store): Registry {
  const reg = new Registry(JSON.parse(JSON.stringify(defs)));
  for (const a of store.autos.values()) reg.addAnalyte(autoEntryDef(a));
  for (const [k, v] of store.aliases) {
    const [lab, name, unit] = k.split("|");
    reg.addScopedAlias({ lab: lab || null, unit: unit || null }, name, v.id);
  }
  return reg;
}

async function account(on: boolean, store: Store, label: string) {
  const reg = registryFor(store);
  const stats = { mapCalls: 0, mapNames: 0, mapUsd: 0, mapMs: 0, soNames: 0, soUsd: 0, autos: 0, shared: 0, conflicts: [] as string[], doubleAsked: [] as string[], autoUndone: [] as string[] };
  // 1. Reads → reports, as the portal builds them.
  const reports: LabReport[] = [];
  for (const page of pages) {
    const arms = page.text ? (on ? ["haiku55"] : ["sonnet5", "haiku45"]) : on ? ["sonnet55", "gemini38_ultra"] : ["sonnet5", "gemini38_ultra"];
    const reads = arms.map((a) => read(a, page)).filter((r): r is NonNullable<typeof r> => !!r);
    if (!reads.length) continue;
    const lab = page.lab || reads.find((r) => r.lab_name)?.lab_name || page.slug;
    const res = interpretPage(reads.map((r) => ({ ...r, lab_name: lab })) as any, page.rows, 1, !page.text, (n, mat, scope) => reg.match(n, mat, scope), arms.length);
    // The page's rows ride on the report as the portal stores them, so a
    // bare name's material comes from its heading (materialOf) on every rematch.
    reports.push({ id: page.slug, sourceFile: `${page.slug}.pdf`, reportDate: "2026-10-01", labName: lab, patientName: null, patientId: null, pages: page.text ? [{ pageNum: 1, rows: page.rows }] : [], measurements: res.measurements } as unknown as LabReport);
  }
  let current = reports.map((r) => rematchReport(r, reg) ?? r);

  // 2. Mapping: the names the list left, that could trend.
  const names = findUnmapped(current).filter(trendable);
  const askedNames = new Set(names.map((n) => n.rawName));
  const catalog: CatalogEntry[] = [...reg.analytes.values()].map((d) => ({ id: d.canonicalId, name: d.displayNameCs, unit: d.canonicalUnit }));
  if (names.length) {
    const wire = names.map((a) => ({ rawName: a.rawName, unit: a.unitRaw, refRange: a.refRangeRaw, material: a.material }));
    const t0 = performance.now();
    const r = on ? await mapByCodes(KEY, "claude-haiku-5-5", wire, catalog, codes, "catalog+shortlist") : await suggestCanonical(KEY, "claude-haiku-4-5", wire, catalog);
    stats.mapMs = performance.now() - t0;
    stats.mapNames = names.length;
    stats.mapUsd = priceUsd(r.model, r.usage.inputTokens, r.usage.outputTokens, r.usage.cacheReadTokens, r.usage.cacheWriteTokens);
    const judged = judge({ suggestions: r.suggestions, model: r.model, budget: null as any }, names, reg, observedStats(current), "2026-10-21");
    const filed = [...judged.applied];
    if (on) {
      for (const a of autoEntriesFrom(judged, true)) {
        if (!store.autos.has(a.code)) store.autos.set(a.code, a);
        reg.addAnalyte(autoEntryDef(a));
        filed.push({ rawName: a.rawName, canonicalId: a.canonicalId });
        stats.autos++;
      }
      for (const { rawName, canonicalId } of sharedLessons(judged, (id) => !!reg.get(id), true)) {
        const s = scopeOf(rawName, current);
        const k = aliasKey(s.lab, rawName, s.unit);
        const prev = store.aliases.get(k);
        if (prev && prev.id !== canonicalId) stats.conflicts.push(`${k}: ${prev.id} vs ${canonicalId}`);
        if (!prev || prev.source !== "person") store.aliases.set(k, { id: canonicalId, source: "model", code: judged.entries[rawName]?.code ?? null });
        stats.shared++;
      }
    }
    for (const { rawName, canonicalId } of filed) reg.addSynonym(canonicalId, rawName);
    current = current.map((r) => rematchReport(r, reg) ?? r);
  }

  // 3. Second opinion on the list's weak matches.
  if (on) {
    const before = stats.mapUsd;
    const out = await runSecondOpinion(
      {
        reports: current,
        registry: reg,
        stats: observedStats(current),
        ask: async (n, c) => {
          for (const x of n) if (askedNames.has(x.rawName)) stats.doubleAsked.push(x.rawName);
          // purpose "second-opinion": the worker asks the catalog question whatever MAP_MODE says.
          const a = await suggestCanonical(KEY, "claude-haiku-5-5", n, c);
          stats.soUsd += priceUsd(a.model, a.usage.inputTokens, a.usage.outputTokens, a.usage.cacheReadTokens, a.usage.cacheWriteTokens);
          return { suggestions: a.suggestions, model: a.model, budget: null as any };
        },
      },
      {
        save: (o, model) => {
          if (process.env.DEBUG_SO) console.log(`    second opinion: ${o.rawName} [${o.unit}] list=${o.listId} → ${o.verdict} ${o.canonicalId ?? ""} (${o.said.decision}/${o.said.canonicalId ?? "-"}/${o.said.confidence})`);
          const k = aliasKey(o.lab ?? "", o.rawName, o.unit);
          const prev = store.aliases.get(k);
          if (prev && prev.id !== o.canonicalId) stats.conflicts.push(`${k}: ${prev.id} vs ${o.canonicalId} (second opinion)`);
          if (o.listId.startsWith("nclp_") && o.verdict !== "confirm") stats.autoUndone.push(`${o.rawName}: ${o.listId} → ${o.canonicalId}`);
          if (!prev || prev.source !== "person") store.aliases.set(k, { id: o.canonicalId, source: "model", code: o.said.code ?? null });
          void model;
        },
      },
    );
    stats.soNames = out.asked;
    void before;
    current = current.map((r) => rematchReport(r, reg) ?? r);
  }

  // 4. What the account now has.
  const rows = current.flatMap((r) => r.measurements);
  const mapped = rows.filter((m) => m.canonicalId).length;
  const asked = rows.filter((m) => reviewOf(m, () => null).level !== "ok").length;
  const stillUnmapped = findUnmapped(current).filter(trendable).length;
  const usd = stats.mapUsd + stats.soUsd;
  console.log(
    `${label.padEnd(24)} pages ${current.length} · rows ${rows.length} · mapped ${mapped} · rows asked about ${asked} · trendable names still unmapped ${stillUnmapped}` +
      ` | mapping: ${stats.mapNames} names, $${stats.mapUsd.toFixed(4)}, ${(stats.mapMs / 1000).toFixed(1)} s` +
      (on ? ` | second opinion: ${stats.soNames} names, $${stats.soUsd.toFixed(4)} | auto entries ${stats.autos} · shared lessons ${stats.shared}` : "") +
      ` | model $ per upload ${(usd / Math.max(1, current.length)).toFixed(4)}`,
  );
  for (const c of stats.conflicts) console.log("    CONFLICT", c);
  for (const d of stats.doubleAsked) console.log("    ASKED TWICE", d);
  for (const u of stats.autoUndone) console.log("    AUTO ENTRY UNDONE", u);
  return { current, stats };
}

const off = await account(false, { aliases: new Map(), autos: new Map() }, "OFF");
const shared: Store = { aliases: new Map(), autos: new Map() };
const onA = await account(true, shared, "ON, first account");
// A second account uploads the same reports: everything the first settled is shared.
const onB = await account(true, shared, "ON, second account");
const ids = (rs: LabReport[]) => new Map(rs.flatMap((r) => r.measurements.map((m, i) => [`${r.id}#${i}#${m.rawAnalyteName}`, m.canonicalId] as const)));
const a = ids(onA.current), b = ids(onB.current);
const differ = [...a].filter(([k, v]) => b.has(k) && b.get(k) !== v);
console.log(`\nsecond account: ${onB.stats.mapNames} names went to the model again (first: ${onA.stats.mapNames}); rows mapped differently from the first account: ${differ.length}`);
for (const [k, v] of differ.slice(0, 8)) console.log(`    ${k}: ${v} vs ${b.get(k)}`);
// ON vs OFF on the same rows (the same printed names): where the mapping differs.
// Keyed by page, printed name and value: a name printed twice (Glukóza under
// Sérum and under Moč) is two rows.
const rowKey = (r: LabReport, m: LabReport["measurements"][number]) => `${r.id}#${m.rawAnalyteName}#${m.valueRaw}`;
const offIds = new Map(off.current.flatMap((r) => r.measurements.map((m) => [rowKey(r, m), m.canonicalId] as const)));
const diffs = onA.current.flatMap((r) => r.measurements.map((m) => [rowKey(r, m), m.canonicalId] as const)).filter(([k, v]) => offIds.has(k) && offIds.get(k) !== v);
console.log(`ON vs OFF, same printed name, different entry: ${diffs.length}`);
for (const [k, v] of diffs.slice(0, 25)) console.log(`    ${k}: OFF ${offIds.get(k)} → ON ${v}`);

// Rows of chosen pages, to read what a difference above actually is.
for (const slug of (process.env.DEBUG_PAGES ?? "").split(",").filter(Boolean)) {
  for (const [label, acc] of [["OFF", off], ["ON", onA]] as const) {
    const r = acc.current.find((x) => x.id === slug);
    for (const m of r?.measurements ?? []) console.log(`  ${label} ${slug}: ${m.rawAnalyteName} [${m.unitRaw}] = ${m.valueRaw} → ${m.canonicalId}`);
  }
}

