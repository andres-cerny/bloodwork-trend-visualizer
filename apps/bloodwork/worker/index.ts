/**
 * The bloodwork app's shell: static assets, and a door to the two capability
 * workers.
 *
 * It holds no secrets and calls no API. Everything expensive lives behind a
 * service binding, which means the capability workers need no public origin and
 * there is no CORS to get wrong.
 *
 * The request object is forwarded rather than rebuilt, so the method, the
 * session header and the body stream all pass through — and the response is
 * returned unread, which is what lets the agent's SSE reach the browser
 * unbuffered.
 */
export interface Env {
  ASSETS: Fetcher;
  AGENT: Fetcher;
  EXTRACT: Fetcher;
}

/**
 * The one body this shell reads instead of forwarding.
 *
 * The extractor parses the whole request with `request.json()` and caps
 * nothing — `textLayer` and `rowsText` are truncated further down, the two
 * image fields are not — so a caller holding one Turnstile session could post
 * a body big enough to exhaust an isolate. The portal's shell already refuses
 * over this size (workers/portal/src/index.ts, MAX_EXTRACT_BYTES); the demo
 * path simply lacked it (docs/security-review-gemini.md, finding 3). Same
 * number, same error shape.
 *
 * Refused here rather than in the extractor because `handleExtract` spends the
 * session's page allowance *before* it reads the body: an oversize post that
 * got that far burned a page to be rejected.
 */
const MAX_EXTRACT_BYTES = 6 * 1024 * 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const target = url.pathname === "/api/chat" ? env.AGENT : env.EXTRACT;

    // Carried explicitly across the binding hop: gate/auth.ts passes it to
    // Turnstile as `remoteip`. It is optional there, so losing it degrades the
    // check rather than breaking it — which is exactly the kind of quiet loss
    // worth spending three lines to avoid.
    const ip = request.headers.get("cf-connecting-ip");

    if (url.pathname === "/api/extract" && request.method === "POST") {
      const body = await request.text();
      if (body.length > MAX_EXTRACT_BYTES) {
        return new Response(
          JSON.stringify({ error: "too_large", message: "Stránka je příliš velká." }),
          { status: 413, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      // Rebuilt rather than forwarded, because the body has been read. Only
      // this route: everything else — the agent's SSE above all — keeps the
      // untouched request and therefore the unbuffered stream.
      const capped = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      });
      if (ip) capped.headers.set("cf-connecting-ip", ip);
      return target.fetch(capped);
    }

    const forwarded = new Request(request);
    if (ip) forwarded.headers.set("cf-connecting-ip", ip);
    return target.fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;
