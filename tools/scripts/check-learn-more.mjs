#!/usr/bin/env node
/**
 * Prove every "O parametru" link still lands on a page.
 *
 * The map in packages/lab-core/src/learnMore.ts points at labtestsonline.cz,
 * a site the project does not control. A renamed or retired article there
 * turns a help link into a 404 on a patient's screen, and nothing offline can
 * notice. This fetches each distinct page once and fails on anything but 200.
 * It needs the network, so it is not part of `npm test`.
 *
 *   npm run check:links
 */
import { LEARN_MORE_BASE, LEARN_MORE_SLUGS } from "../../packages/lab-core/src/learnMore.ts";

const slugs = [...new Set(Object.values(LEARN_MORE_SLUGS))].sort();
const failures = [];

for (const slug of slugs) {
  const url = `${LEARN_MORE_BASE}${slug}.html`;
  let status;
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    status = res.status;
  } catch (err) {
    status = `error: ${err.message}`;
  }
  if (status !== 200) failures.push(`${status}\t${url}`);
}

const keys = Object.keys(LEARN_MORE_SLUGS).length;
if (failures.length) {
  console.error(`check:links — ${failures.length} of ${slugs.length} pages did not answer 200:`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`check:links — ${slugs.length} pages answer 200 for ${keys} parameters.`);
