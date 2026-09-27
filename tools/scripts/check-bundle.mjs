#!/usr/bin/env node
/**
 * Refuse to deploy a bundle whose configuration silently went missing.
 *
 * The failure this exists to catch: VITE_TURNSTILE_SITE_KEY was set in the
 * repo-root `.env`, exactly where docs/deploy.md says to put it, but Vite's
 * envDir defaulted to `root` ("web") and never read the file. The build
 * succeeded. The app rendered "Nahrávání vlastních PDF není v této ukázce
 * zapnuté", which reads as a deliberate setting rather than a broken one — so
 * a keyless build would have been deployed with nothing anywhere saying so.
 *
 * The envDir bug is fixed. This guard is for the next one: any future change
 * to the build that stops the key reaching the bundle now fails here instead
 * of shipping quietly.
 *
 *   node scripts/check-bundle.mjs        # run standalone
 *   npm run deploy                       # runs automatically
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 *   node scripts/check-bundle.mjs <dist-dir> [--key NAME]
 *
 * The dist directory is an argument because there are two apps now, and each
 * gets its own invocation from its own deploy script.
 */
const args = process.argv.slice(2);
const DIST = args.find((a) => !a.startsWith("--")) ?? "apps/bloodwork/dist";
const keyFlag = args.indexOf("--key");
const KEY = keyFlag === -1 ? "VITE_TURNSTILE_SITE_KEY" : args[keyFlag + 1];
// Anchored to this file rather than to cwd: run through `npm -w`, the working
// directory is the workspace, and a cwd-relative .env would be the wrong file
// — or no file, which this script reports as "not configured".
const ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));

function fail(message) {
  console.error(`\n✗ bundle check failed\n\n${message}\n`);
  process.exit(1);
}

if (!existsSync(DIST) || !statSync(DIST).isDirectory())
  fail(`No build found at ${DIST}. Run \`npm run build\` first.`);

/** Every emitted script, wherever Vite put it — assetsDir is configurable. */
function scripts(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return scripts(full);
    return /\.m?js$/.test(e.name) ? [full] : [];
  });
}

const bundle = scripts(DIST)
  .map((f) => readFileSync(f, "utf-8"))
  .join("\n");


/**
 * The Anthropic SDK must never reach the browser.
 *
 * It nearly did. api-client needs `readSse` to read the agent's stream, and
 * importing it from @bw/agent-core's barrel pulled the whole agent — the tool
 * loop, the toolset, and the SDK — into the SPA, taking the bundle from 217 kB
 * to 387 kB. Nothing failed; it just got 170 kB heavier and shipped a server's
 * dependencies to every visitor.
 *
 * The fix was an ./events subpath. This is the guard that says so out loud if
 * anyone re-crosses the boundary, because the symptom is only a number nobody
 * is watching.
 */
const SERVER_ONLY = [
  ["@anthropic-ai/sdk", /anthropic-ai\/sdk|new Anthropic\(/],
  ["the agent tool loop", /Agent nedospěl k odpovědi/],
];

/**
 * Code a given app must not contain at all.
 *
 * The chat app renders; it does not reason. It answers about a patient without
 * holding a line of lab code, because every number it shows arrived through the
 * agent from the deterministic layer. That is what will let the data source
 * move from the browser to a doctor's database without the client changing —
 * and it is invisible until someone imports lab-core "just for a type" and the
 * boundary is gone with nothing failing.
 */
const FORBIDDEN_BY_APP = {
  chat: [
    ["lab domain code", /normalizeMeasurement|buildTrends|parseCzechNumber|suggestMappings/],
    ["pdf.js", /pdfjs|GlobalWorkerOptions/],
  ],
  // The pitch portal (apps/csm-portal) is the purest renderer of the three: read-only card data from
  // the worker, no AI, no upload. Same boundary, plus the agent's stream
  // reader has no business here — a portal that starts talking to the chat
  // route has grown a capability nobody granted it.
  "csm-portal": [
    ["lab domain code", /normalizeMeasurement|buildTrends|parseCzechNumber|suggestMappings/],
    ["pdf.js", /pdfjs|GlobalWorkerOptions/],
    ["the chat route", /\/api\/chat/],
  ],
};

// By directory name, and never by substring of another app's: `apps/portal/`
// is Moje krev and `apps/csm-portal/` the pitch. The rule above was keyed
// `portal` when the pitch app still had that name, and after the rename it
// silently guarded the wrong app — forbidding Moje krev its lazy pdf.js while
// the pitch app went unchecked.
const appName = ["bloodwork", "chat", "csm-portal", "portal"].find((n) => DIST.replace(/\\/g, "/").includes(`apps/${n}/`));
for (const [what, pattern] of FORBIDDEN_BY_APP[appName] ?? []) {
  if (pattern.test(bundle)) {
    fail(
      `${what} is in the ${appName} app's bundle.\n\n` +
        `This app renders; it does not reason. Every number it shows came\n` +
        `through the agent from the deterministic layer, and importing the\n` +
        `domain directly removes the boundary that makes that true.`,
    );
  }
}

for (const [what, pattern] of SERVER_ONLY) {
  if (pattern.test(bundle)) {
    fail(
      `${what} is in the browser bundle.\n\n` +
        `Server-only code reached the SPA, almost certainly through a package\n` +
        `barrel that re-exports it. Import the narrow subpath instead — for the\n` +
        `stream reader that is "@bw/agent-core/events", not "@bw/agent-core".`,
    );
  }
}

/**
 * Moje krev (apps/portal): OCR is a lazy chunk a PDF-only visit never loads.
 *
 * A photo is read locally by Tesseract (docs/plans/photo-capture.md, D1): a
 * worker script, a wasm core and the Czech traineddata (~6 MB), plus the
 * tesseract.js loader in the app's own JS. None of it may reach someone who
 * only uploads PDFs — which it would, silently, the day `lib/ocr.ts` is
 * imported statically instead of through `import("./ocr")`.
 *
 * The rule is checked on the built module graph, not on source text: every
 * chunk the page loads up front (index.html's script and modulepreloads, and
 * their static imports) and every chunk the PDF path loads (the pdf.js chunk
 * and its static imports) must be free of tesseract; and a tesseract chunk must
 * exist, so the check cannot pass by the OCR having gone missing altogether.
 */
function moduleGraph(dir) {
  const html = readFileSync(join(dir, "index.html"), "utf-8");
  const entries = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="\/?([^"]+\.js)"/g)].map((m) => m[1]);
  const all = scripts(dir).map((f) => f.slice(dir.length + 1));
  const code = new Map(all.map((f) => [f, readFileSync(join(dir, f), "utf-8")]));
  /** Static imports only: `import … from "./x.js"`, `import "./x.js"`, `export … from`. Never `import("./x.js")`. */
  const staticDeps = (f) => {
    const src = code.get(f) ?? "";
    const base = f.includes("/") ? f.slice(0, f.lastIndexOf("/") + 1) : "";
    return [...src.matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]*?from\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g)].map((m) =>
      join(base, m[1]).replace(/\\/g, "/"),
    );
  };
  const closure = (roots) => {
    const seen = new Set();
    const stack = [...roots];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f) || !code.has(f)) continue;
      seen.add(f);
      stack.push(...staticDeps(f));
    }
    return seen;
  };
  return { entries, code, closure };
}

if (appName === "portal") {
  const OCR = /tesseract/i;
  const { entries, code, closure } = moduleGraph(DIST);
  if (!entries.length) fail(`No entry script found in ${DIST}/index.html.`);
  const ocrChunks = [...code].filter(([, src]) => OCR.test(src)).map(([f]) => f);
  if (!ocrChunks.length)
    fail(`No OCR chunk in the Moje krev build.\n\nThe photo path's local Tesseract (apps/portal/src/lib/ocr.ts) is missing,\nso this check would pass without checking anything.`);
  const pdfChunks = [...code].filter(([, src]) => /GlobalWorkerOptions/.test(src)).map(([f]) => f);
  for (const [path, roots] of [["the first page load", entries], ["the PDF path", pdfChunks]]) {
    const leaked = [...closure(roots)].filter((f) => OCR.test(code.get(f)));
    if (leaked.length)
      fail(
        `OCR is loaded on ${path} of Moje krev: ${leaked.join(", ")}.\n\n` +
          `Tesseract must stay a lazy chunk that only a photo loads — reach it\n` +
          `through \`await import("./ocr")\`, never a static import.`,
      );
  }
  for (const f of ["ocr/worker.min.js", "ocr/lang/ces.traineddata.gz", "ocr/core/tesseract-core-simd-lstm.wasm.js"])
    if (!existsSync(join(DIST, f))) fail(`${f} is not in the Moje krev build: OCR would fall back to nothing (self-hosted only, no CDN).`);
  console.log(`✓ Moje krev: OCR only in lazy chunk(s) ${ocrChunks.join(", ")}; not on first load or the PDF path`);
}

// Read the key straight from the file rather than from process.env: the whole
// point is to check that what is written there reaches the build, and reading
// it via the environment would test a different thing.
let configured = null;
if (existsSync(ENV_FILE)) {
  const line = readFileSync(ENV_FILE, "utf-8")
    .split("\n")
    .find((l) => l.trim().startsWith(`${KEY}=`));
  if (line) configured = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

if (!configured) {
  console.log(
    `\n! ${KEY} is not set in ${ENV_FILE}.\n` +
      `  The demo will deploy read-only: the pre-baked data works, and upload\n` +
      `  and chat will show "not enabled in this demo". Deploying anyway.\n`,
  );
  process.exit(0);
}

if (!bundle.includes(configured)) {
  fail(
    `${KEY} is set in ${ENV_FILE} but is NOT in the built bundle.\n\n` +
      `The build would deploy with upload and chat silently disabled.\n` +
      `Most likely cause: Vite is not reading the repo-root .env — check\n` +
      `\`envDir\` in vite.config.ts, which must point at the repo root, not\n` +
      `at \`root\` ("web").`,
  );
}

console.log(`✓ ${KEY} present in the built bundle`);
