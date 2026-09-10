/**
 * A Worker entry module may export its handler and nothing else.
 *
 * workerd reads *every* named export of the module named by `main` as a
 * service or a handler. A helper left on that surface is not dead weight, it is
 * a startup error:
 *
 *   service core:user:bloodwork-extract: Uncaught TypeError: Incorrect type for
 *   map entry 'DEFAULT_PHOTO_READERS': the provided value is not of type
 *   'function or ExportedHandler'.
 *
 * `wrangler deploy` does not reject it and production serves fine, so the only
 * thing that ever notices is `wrangler dev` — which means the whole cost of the
 * mistake lands on whoever next tries to run the worker locally. Hence a test:
 * the export surface is checked in `npm test`, where it is free and loud.
 *
 * Type-only exports (`export interface Env`) are erased before workerd sees the
 * module and are therefore invisible here — which is exactly right, they are
 * not runtime exports. A Durable Object class *is* a legitimate named export,
 * so the allowance is read from each config's own `durable_objects` bindings
 * rather than hard-coded: declare the DO and the guard widens with you.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const SKIP = /(^|\/)(node_modules|\.git|dist|\.wrangler|\.venv|\.venv-mac|__pycache__|data|samples)(\/|$)/;

function findConfigs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir === "." ? e.name : `${dir}/${e.name}`;
    if (SKIP.test(rel)) continue;
    // An agent's worktree is a whole second checkout of this repo; sweeping
    // into it would test that copy's files under this copy's name.
    if (rel.startsWith(".claude/worktrees/")) continue;
    if (e.isDirectory()) findConfigs(rel, out);
    else if (e.name === "wrangler.jsonc") out.push(rel);
  }
  return out;
}

/** JSONC minus its comments, with string literals left intact. */
function stripComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && !(src[j] === '"' && src[j - 1] !== "\\")) j++;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** One entry module, and everything workerd is allowed to find on it. */
type Entry = { entry: string; allowed: Set<string>; configs: string[] };

const entries = new Map<string, Entry>();
for (const config of findConfigs(".")) {
  const src = stripComments(readFileSync(join(ROOT, config), "utf-8"));
  const main = src.match(/"main"\s*:\s*"([^"]+)"/)?.[1];
  if (!main) continue;
  // Two configs may deploy the same code under different names — extract is
  // deployed once for the demo and once for the portal — so the entry, not the
  // config, is the unit under test.
  const entry = relative(ROOT, resolve(ROOT, dirname(config), main)).replaceAll("\\", "/");
  const record = entries.get(entry) ?? { entry, allowed: new Set(["default"]), configs: [] };
  record.configs.push(config);
  for (const m of src.matchAll(/"class_name"\s*:\s*"([^"]+)"/g)) record.allowed.add(m[1]);
  entries.set(entry, record);
}

describe("Worker entry modules", () => {
  it("finds every wrangler.jsonc in the repo", () => {
    // A guard that silently stops finding its subjects passes forever.
    expect(entries.size).toBeGreaterThanOrEqual(6);
  });

  for (const { entry, allowed, configs } of entries.values()) {
    it(`${entry} exports only ${[...allowed].join(", ")}`, async () => {
      // Imported by a computed path on purpose: a literal would pull the
      // worker's program into this project's typecheck, and worker code is
      // typed against @cloudflare/workers-types, which collides with the node
      // and DOM types this project holds.
      const path = pathToFileURL(join(ROOT, entry)).href;
      const module: Record<string, unknown> = await import(/* @vite-ignore */ path);
      const found = Object.keys(module).sort();

      expect(
        found.filter((name) => !allowed.has(name)),
        `${entry} is the \`main\` of ${configs.join(", ")}. workerd reads each of ` +
          `its named exports as a service or handler, so anything but ` +
          `${[...allowed].join(", ")} makes \`wrangler dev\` refuse to start. ` +
          `Move helpers into a sibling module and import them.`,
      ).toEqual([]);

      expect(typeof module.default, `${entry} exports no default handler`).toBe("object");
    });
  }
});
