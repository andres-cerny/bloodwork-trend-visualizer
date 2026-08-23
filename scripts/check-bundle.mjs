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
const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));

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
};

const appName = Object.keys(FORBIDDEN_BY_APP).find((n) => DIST.includes(`apps/${n}/`));
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
