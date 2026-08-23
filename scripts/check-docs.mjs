#!/usr/bin/env node
/**
 * Refuse documentation that contradicts the code.
 *
 * "Update the docs on every push" produces rubber stamps. What is actually
 * wanted is docs that *cannot lie*, and most of the lying here was checkable:
 * before this existed, README.md said the web demo's second reader was Opus
 * 4.8 (it is Haiku 4.5), docs/deploy.md gave MAX_PAGES_PER_SESSION as 12 (it is
 * 100, having been 40 in between), and docs/extraction-speed.md — the most
 * current document in the repo — was linked from nothing.
 *
 * Four checks:
 *
 *   1. Constant anchors. A doc that states a number the code also states must
 *      agree with it.
 *   2. Link integrity. Every relative markdown link resolves.
 *   3. Orphans. Markdown nothing links to, which is how bench/PLAN.md rotted.
 *   4. Length budgets on CLAUDE.md, with a target well under the ceiling so a
 *      file that trips it does not trip again next week.
 *
 *   npm run docs:check
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname, relative, resolve } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Root CLAUDE.md routes and does not teach; regional files state local rules. */
const CEILING = 60;
const WARN = 50;
/**
 * What a fix must reach, not what it must clear. Trimming 61 lines to 59 is not
 * a fix, it is scheduling the same work again — every push pays for it.
 */
const TARGET = 42;

const problems = [];
const warnings = [];

const read = (p) => readFileSync(join(ROOT, p), "utf-8");
const exists = (p) => existsSync(join(ROOT, p));

function walk(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (/(^|\/)(node_modules|\.git|dist|\.venv|\.venv-mac|\.wrangler|__pycache__|\.pytest_cache|data|samples)(\/|$)/.test(rel)) continue;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith(".md")) out.push(rel);
  }
  return out;
}

const docs = walk(".").filter((d) => !d.startsWith("docs/archive/"));

/* ---------------------------------------------------------- 1. constants */

/**
 * Each anchor names a value the code owns and a pattern that finds a doc's
 * claim about it. The claim is only checked where a doc makes one — silence is
 * fine, contradiction is not.
 */
function wranglerVar(file, name) {
  const m = read(file).match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`));
  return m?.[1];
}
function tsConst(file, name) {
  const m = read(file).match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m?.[1];
}

const ANCHORS = [
  {
    what: "MAX_PAGES_PER_SESSION",
    truth: () => wranglerVar("workers/extract/wrangler.jsonc", "MAX_PAGES_PER_SESSION"),
    claim: /MAX_PAGES_PER_SESSION[^.\n]*?\(?default\s*`?(\d+)`?/gi,
  },
  {
    what: "BUDGET_USD_LIMIT",
    truth: () => wranglerVar("workers/extract/wrangler.jsonc", "BUDGET_USD_LIMIT"),
    claim: /BUDGET_USD_LIMIT[^.\n]*?\(?default\s*`?\$?(\d+)`?/gi,
  },
  {
    what: "the second extraction model",
    truth: () => tsConst("packages/extraction/src/extract.ts", "MODEL_ESCALATION"),
    // Docs name the model in prose ("Sonnet 5 + Opus 4.8", "drops the Opus
    // cross-check"), so the claim is any model name appearing near the words
    // that mean "the second one". Matching prose is looser than matching a
    // constant, and it is the only form the claim actually takes.
    claim: /(?:cross-check(?:ing)?|second read(?:er)?|escalation)[^.\n]{0,60}?\b(Opus|Haiku|Sonnet)\b|\b(Opus|Haiku|Sonnet)\b[^.\n]{0,40}?cross-check/gi,
    pick: (m) => m[1] ?? m[2],
    normalise: (s) => s.toLowerCase(),
  },
];

for (const a of ANCHORS) {
  const truth = a.truth();
  if (truth === undefined) {
    problems.push(`anchor "${a.what}": could not read the value from the code`);
    continue;
  }
  const norm = a.normalise ?? ((s) => s);
  for (const doc of docs) {
    const text = read(doc);
    for (const m of text.matchAll(a.claim)) {
      const claimed = (a.pick ?? ((x) => x[1]))(m);
      if (claimed === undefined) continue;
      if (!norm(truth).includes(norm(claimed))) {
        problems.push(`${doc}: says ${a.what} is "${claimed}", but the code says "${truth}"`);
      }
    }
  }
}

/* ------------------------------------------------------------- 2. links */

const LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const linkedTo = new Set();

for (const doc of docs) {
  for (const m of read(doc).matchAll(LINK)) {
    const href = m[1].split("#")[0].trim();
    if (!href || /^(https?:|mailto:)/.test(href)) continue;
    const target = href.startsWith("/")
      ? href.slice(1)
      : relative(ROOT, resolve(ROOT, dirname(doc), href));
    if (!exists(target)) {
      problems.push(`${doc}: link to "${href}" does not resolve`);
    } else {
      linkedTo.add(target.replace(/\/$/, ""));
    }
  }
}

/* ----------------------------------------------------------- 3. orphans */

/**
 * Entry points by nature: nothing links to them because nothing needs to.
 * A skill is reached by invoking its name, a CLAUDE.md by being near the file
 * being edited, and a CONTEXT.md is its own directory's contract.
 */
const ROOTS = new Set(["README.md", "CLAUDE.md"]);
const isEntryPoint = (d) =>
  ROOTS.has(d) || d.endsWith("CLAUDE.md") || d.endsWith("SKILL.md") || d.endsWith("CONTEXT.md");
const citedInCode = new Set();
function scanSource(dir) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (/(^|\/)(node_modules|\.git|dist|\.venv|\.venv-mac|\.wrangler|__pycache__|data|samples)(\/|$)/.test(rel)) continue;
    if (e.isDirectory()) scanSource(rel);
    else if (/\.(ts|tsx|py|mjs|json|jsonc|yml)$/.test(e.name)) {
      for (const m of read(rel).matchAll(/[\w./-]+\.md/g)) citedInCode.add(m[0]);
    }
  }
}
scanSource(".");

for (const doc of docs) {
  if (isEntryPoint(doc)) continue;
  const cited = [...citedInCode].some((c) => doc.endsWith(c));
  if (!linkedTo.has(doc) && !cited) {
    warnings.push(`${doc}: nothing links to it — is it still current?`);
  }
}

/* ---------------------------------------------------------- 4. budgets */

for (const doc of docs.filter((d) => d.endsWith("CLAUDE.md"))) {
  const lines = read(doc).split("\n").length;
  if (lines > CEILING) {
    problems.push(
      `${doc}: ${lines} lines, over the ${CEILING}-line ceiling.\n` +
        `      Bring it to ${TARGET} or fewer, not to ${CEILING - 1} — move the` +
        ` argument into docs/\n      and leave a rule plus a link, or split the region.`,
    );
  } else if (lines > WARN) {
    warnings.push(`${doc}: ${lines} lines, approaching the ${CEILING}-line ceiling (target ${TARGET}).`);
  }
}

/* ------------------------------------------------------------- report */

for (const w of warnings) console.warn(`! ${w}`);

if (problems.length) {
  console.error(`\n✗ docs:check found ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("");
  process.exit(1);
}

console.log(`✓ ${docs.length} markdown files: constants agree, links resolve, budgets kept`);
