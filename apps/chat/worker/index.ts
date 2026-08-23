/**
 * The chat app's shell: static assets, and a door to the agent.
 *
 * No EXTRACT binding, deliberately. This app cannot upload a PDF, so a route to
 * the extractor would be reach it has no use for.
 *
 * It holds no secrets and calls no API. The agent has no public origin, so
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
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    // Carried explicitly across the binding hop: gate/auth.ts passes it to
    // Turnstile as `remoteip`. It is optional there, so losing it degrades the
    // check rather than breaking it — which is exactly the kind of quiet loss
    // worth spending three lines to avoid.
    const forwarded = new Request(request);
    const ip = request.headers.get("cf-connecting-ip");
    if (ip) forwarded.headers.set("cf-connecting-ip", ip);
    return env.AGENT.fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;
