/**
 * Stage 0 — everything measurable without spending anything.
 *
 *   npm run bench:stage0
 *
 * Three questions:
 *
 *  1. What is the floor? pdf.js load + text extraction + buildRows happen on
 *     every page no matter which model reads it. If the floor is already
 *     seconds, no arm can win.
 *  2. How big is each arm's request, exactly? `count_tokens` is free, so input
 *     size never has to be guessed or inferred from character counts.
 *  3. Is the prompt-cache annotation in worker/claude.ts inert? It marks the
 *     system block cacheable, but the comment there suspects the prefix sits
 *     under the 1024-token minimum. `count_tokens` settles it without a call.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { it } from "vitest";

import Anthropic from "@anthropic-ai/sdk";

import { parsePdf, realSamples, SCREEN_SUBSET } from "./corpus";
import { rowsIndexed, rowsPlain } from "./extract";
import { ITERATION_1, PRIMARY } from "./arms";
import { SYSTEM_EXTRACT_TEXT, TOOL } from "../worker/claude";

const OUT = "bench/results";

it("stage 0 — the free measurements", async () => {
  mkdirSync(OUT, { recursive: true });
  const rows: any[] = [];

  /* ---------------------------------------------------- 1. the parse floor */
  console.log("\n=== Stage 0.1 — client-side floor (no API) ===\n");
  console.log(
    "file".padEnd(24) + "pages  rows  text?  chars   load ms  parse ms  total ms",
  );

  let totalMs = 0;
  let totalPages = 0;
  for (const path of realSamples()) {
    const { doc, timing } = await parsePdf(path);
    const rowCount = doc.pages.reduce((n, p) => n + p.rows.length, 0);
    const chars = doc.pages.reduce((n, p) => n + p.textLength, 0);
    const allText = doc.pages.every((p) => p.hasTextLayer);
    const total = timing.loadMs + timing.pagesMs;
    totalMs += total;
    totalPages += timing.pageCount;

    console.log(
      doc.file.padEnd(24) +
        String(timing.pageCount).padStart(5) +
        String(rowCount).padStart(6) +
        (allText ? "  yes" : "   NO").padStart(7) +
        String(chars).padStart(7) +
        timing.loadMs.toFixed(0).padStart(9) +
        timing.pagesMs.toFixed(0).padStart(10) +
        total.toFixed(0).padStart(10),
    );

    rows.push({
      stage: "0.1",
      file: doc.file,
      pages: timing.pageCount,
      rowCount,
      chars,
      allPagesHaveText: allText,
      loadMs: timing.loadMs,
      parseMs: timing.pagesMs,
      totalMs: total,
    });
  }

  console.log(
    `\n  15 files / ${totalPages} pages parsed in ${totalMs.toFixed(0)} ms ` +
      `(${(totalMs / totalPages).toFixed(1)} ms/page).`,
  );
  console.log(
    `  A 10-file batch is ~${(totalMs / 15 * 10).toFixed(0)} ms of parsing — ` +
      `the floor every arm is measured against.`,
  );

  /* ------------------------------------------- 2. request size, exactly */
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  if (!key) {
    console.log("\n(no ANTHROPIC_API_KEY — skipping the free token counts)\n");
    writeFileSync(`${OUT}/stage0.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return;
  }

  console.log("\n=== Stage 0.2 — exact input tokens (count_tokens is free) ===\n");
  const client = new Anthropic({ apiKey: key, maxRetries: 2 });

  // One dense page from the screening subset — representative of the real cost.
  const { doc } = await parsePdf(`samples/${SCREEN_SUBSET[3]}`);
  const densest = [...doc.pages].sort((a, b) => b.rows.length - a.rows.length)[0];
  console.log(
    `probe page: ${densest.file} p${densest.pageNum}, ${densest.rows.length} rows\n`,
  );

  console.log("arm  anchor    input tokens   Δ vs A0   prompt chars");
  let baseTokens = 0;
  for (const arm of ITERATION_1) {
    const text = arm.anchor === "index" ? rowsIndexed(densest.rows) : rowsPlain(densest.rows);
    const counted = await client.messages.countTokens({
      model: PRIMARY,
      system: [{ type: "text", text: SYSTEM_EXTRACT_TEXT }],
      tools: [TOOL as any],
      messages: [{ role: "user", content: `Řádky vytištěné na stránce:\n\n${text}` }],
    });
    if (!baseTokens) baseTokens = counted.input_tokens;
    const delta = counted.input_tokens - baseTokens;
    console.log(
      arm.id.padEnd(5) +
        arm.anchor.padEnd(10) +
        String(counted.input_tokens).padStart(12) +
        (delta === 0 ? "        —" : (delta > 0 ? `+${delta}` : String(delta)).padStart(9)) +
        String(text.length).padStart(15),
    );
    rows.push({
      stage: "0.2",
      arm: arm.id,
      anchor: arm.anchor,
      inputTokens: counted.input_tokens,
      promptChars: text.length,
      probeFile: densest.file,
      probePage: densest.pageNum,
      probeRows: densest.rows.length,
    });
  }

  /* --------------------------------------- 3. is the cache annotation inert? */
  console.log("\n=== Stage 0.3 — is the prompt-cache breakpoint inert? ===\n");
  const prefix = await client.messages.countTokens({
    model: PRIMARY,
    system: [{ type: "text", text: SYSTEM_EXTRACT_TEXT }],
    tools: [TOOL as any],
    // The cacheable prefix is tools + system. An empty-ish user turn isolates it.
    messages: [{ role: "user", content: "." }],
  });
  const MIN_CACHEABLE = 1024;
  const inert = prefix.input_tokens < MIN_CACHEABLE;
  console.log(
    `  tools + system prefix = ${prefix.input_tokens} tokens ` +
      `(minimum cacheable is ${MIN_CACHEABLE})`,
  );
  console.log(
    inert
      ? `  → INERT. worker/claude.ts:170 suspected this; the cache_control\n` +
        `    annotation on the system block never engages, so every page of a\n` +
        `    report pays full input price and full prefix latency.`
      : `  → engages. Multi-page reports reuse the prefix.`,
  );
  rows.push({ stage: "0.3", prefixTokens: prefix.input_tokens, minCacheable: MIN_CACHEABLE, inert });

  writeFileSync(`${OUT}/stage0.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`\nwrote ${OUT}/stage0.jsonl\n`);
});
