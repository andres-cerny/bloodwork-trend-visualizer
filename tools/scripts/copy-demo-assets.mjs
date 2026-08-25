#!/usr/bin/env node
/**
 * Put the committed CSM page images into the portal's build.
 *
 * The scans are committed once, under the chat app, because that is the app
 * that first cited them. The portal renders the same documents and needs the
 * same pixels — but a second committed copy would be 13 MB of git holding two
 * truths about one image, and a symlink is not something every build step
 * follows. So the files are copied into `dist/` at build time: one source in
 * git, both deployments complete.
 *
 * Without this the portal's SPA fallback answers an <img> with index.html,
 * and the note's page scans degrade to their placeholder — which reads as
 * "this demo has no scans" rather than as a missing build step.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../apps/chat/public/demo/csm", import.meta.url));
const to = fileURLToPath(new URL("../../apps/portal/dist/demo/csm", import.meta.url));

if (!existsSync(from)) {
  console.error(`! demo assets not found at ${from} — the portal will show page placeholders.`);
  process.exit(0); // a missing corpus is not a build failure; a silent one would be
}
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`✓ CSM demo assets copied into the portal build`);
