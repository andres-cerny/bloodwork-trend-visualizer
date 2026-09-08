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

const post = (path: string, body: string) =>
  new Request(`https://demo.test${path}`, { method: "POST", body });

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

/**
 * The extract body's ceiling.
 *
 * The extractor parses the whole request with `request.json()` and caps
 * nothing: `textLayer` and `rowsText` are truncated downstream, the two image
 * fields are not. The portal's shell already refuses over 6 MB with a 413
 * (workers/portal/src/index.ts), and the demo path simply lacked it
 * (docs/security-review-gemini.md, finding 3) — same number, same error shape.
 *
 * Refusing here rather than in the extractor is what makes it worth doing:
 * `handleExtract` spends the session's page allowance *before* it reads the
 * body, so an oversize post that got that far burned a page to be rejected.
 */
describe("the extract body cap", () => {
  const big = (mb: number) => "x".repeat(mb * 1024 * 1024);

  it("refuses a body over 6 MB without waking the extractor", async () => {
    const env = makeEnv();
    const res = await shell.fetch(post("/api/extract", big(7)), env);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large", message: "Stránka je příliš velká." });
    expect(env.seen).toEqual([]);
  });

  it("lets an ordinary page through with its session header intact", async () => {
    const env = makeEnv();
    const req = new Request("https://demo.test/api/extract", {
      method: "POST",
      headers: { "x-demo-session": "tok", "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify({ imageBase64: "AAAA" }),
    });
    const res = await shell.fetch(req, env);
    expect(env.seen).toEqual(["extract /api/extract"]);
    expect(res.headers.get("x-session")).toBe("tok");
    expect(res.headers.get("x-ip")).toBe("203.0.113.7");
  });

  it("caps nothing else — a chat turn is a stream, and must stay one", async () => {
    const env = makeEnv();
    const res = await shell.fetch(post("/api/chat", big(7)), env);
    expect(res.status).toBe(200);
    expect(env.seen).toEqual(["agent /api/chat"]);
  });
});
