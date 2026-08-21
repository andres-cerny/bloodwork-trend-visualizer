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
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist/assets";
const ENV_FILE = ".env";
const KEY = "VITE_TURNSTILE_SITE_KEY";

function fail(message) {
  console.error(`\n✗ bundle check failed\n\n${message}\n`);
  process.exit(1);
}

if (!existsSync(DIST)) fail(`No build found at ${DIST}. Run \`npm run build\` first.`);

const bundle = readdirSync(DIST)
  .filter((f) => f.endsWith(".js"))
  .map((f) => readFileSync(join(DIST, f), "utf-8"))
  .join("\n");

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
