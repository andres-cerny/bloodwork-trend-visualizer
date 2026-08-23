/**
 * The chat shell routes to one place, and that is the interesting part.
 *
 * It has no EXTRACT binding: this app cannot upload a PDF, so a route to the
 * extractor would be reach it has no use for. A test says so, because "we just
 * did not wire it" and "it must not be wired" look identical in a config.
 */
import { describe, expect, it } from "vitest";
import shell, { type Env } from "../index";

function makeEnv() {
  const seen: string[] = [];
  const stub = (label: string): Fetcher =>
    ({
      fetch: async (req: Request) => {
        seen.push(`${label} ${new URL(req.url).pathname}`);
        return new Response(label, {
          headers: { "x-session": req.headers.get("x-demo-session") ?? "" },
        });
      },
    }) as unknown as Fetcher;
  return { env: { ASSETS: stub("assets"), AGENT: stub("agent") } as Env, seen };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://chat.test${path}`, { headers });

describe("the chat shell", () => {
  it("serves the app from assets", async () => {
    const { env } = makeEnv();
    expect(await (await shell.fetch(get("/"), env)).text()).toBe("assets");
  });

  it("sends every API route to the agent", async () => {
    const { env, seen } = makeEnv();
    await shell.fetch(get("/api/chat"), env);
    await shell.fetch(get("/api/status"), env);
    expect(seen).toEqual(["agent /api/chat", "agent /api/status"]);
  });

  it("has no binding to the extractor", () => {
    const { env } = makeEnv();
    expect("EXTRACT" in env).toBe(false);
  });

  it("carries the session header to the agent", async () => {
    const { env } = makeEnv();
    const res = await shell.fetch(get("/api/chat", { "x-demo-session": "tok" }), env);
    expect(res.headers.get("x-session")).toBe("tok");
  });
});
