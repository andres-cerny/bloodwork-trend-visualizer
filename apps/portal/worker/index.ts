/**
 * The portal's shell: static assets, and a door to the agent.
 *
 * Identical posture to the chat shell, with even less reach used: the portal
 * only ever mints a session and reads /api/card/*. It holds no secrets and
 * calls no API; the agent has no public origin, so there is no CORS.
 *
 * The request is forwarded rather than rebuilt so the method and the session
 * header pass through untouched.
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
    // Turnstile as `remoteip`. Optional there, so losing it degrades the
    // check rather than breaking it — still worth the three lines.
    const forwarded = new Request(request);
    const ip = request.headers.get("cf-connecting-ip");
    if (ip) forwarded.headers.set("cf-connecting-ip", ip);
    return env.AGENT.fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;
