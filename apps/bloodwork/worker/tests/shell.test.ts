/**
 * The app shell decides one thing: which door a request goes through.
 *
 * It used to be implicit — one Worker held the assets and every route, so
 * "falls through to assets" and "is an API route" were the same if-statement.
 * With the capabilities behind service bindings the routing is a real decision,
 * and a wrong one is quiet: /api/chat sent to the extractor 404s, and an asset
 * sent to a capability worker 404s too. Neither looks like a routing bug.
 */
import { describe, expect, it } from "vitest";
import shell, { type Env } from "../index";

function makeEnv(): Env & { seen: string[] } {
  const seen: string[] = [];
  const stub = (label: string): Fetcher =>
    ({
      fetch: async (req: Request) => {
        seen.push(`${label} ${new URL(req.url).pathname}`);
        return new Response(label, {
          headers: { "x-session": req.headers.get("x-demo-session") ?? "", "x-ip": req.headers.get("cf-connecting-ip") ?? "" },
        });
      },
    }) as unknown as Fetcher;
  return { ASSETS: stub("assets"), AGENT: stub("agent"), EXTRACT: stub("extract"), seen };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://demo.test${path}`, { headers });

describe("the app shell", () => {
  it("serves anything that is not an API route from assets", async () => {
    const env = makeEnv();
    expect(await (await shell.fetch(get("/"), env)).text()).toBe("assets");
    expect(await (await shell.fetch(get("/trendy"), env)).text()).toBe("assets");
  });

  it("sends chat to the agent and everything else API to the extractor", async () => {
    const env = makeEnv();
    await shell.fetch(get("/api/chat"), env);
    await shell.fetch(get("/api/extract"), env);
    await shell.fetch(get("/api/session"), env);
    await shell.fetch(get("/api/status"), env);
    expect(env.seen).toEqual([
      "agent /api/chat",
      "extract /api/extract",
      "extract /api/session",
      "extract /api/status",
    ]);
  });

  it("carries the session header across the binding hop", async () => {
    const env = makeEnv();
    const res = await shell.fetch(get("/api/chat", { "x-demo-session": "tok" }), env);
    // Forwarding the Request rather than rebuilding it is what keeps this true
    // for the body stream as well, which is what lets SSE through unbuffered.
    expect(res.headers.get("x-session")).toBe("tok");
  });

  it("carries the caller's IP, which Turnstile checks as remoteip", async () => {
    const env = makeEnv();
    const res = await shell.fetch(get("/api/session", { "cf-connecting-ip": "203.0.113.7" }), env);
    expect(res.headers.get("x-ip")).toBe("203.0.113.7");
  });
});
