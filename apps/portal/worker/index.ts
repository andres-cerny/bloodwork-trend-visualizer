/**
 * Moje krev's shell: static assets, and a door to the portal API worker.
 *
 * Same shape as the bloodwork shell — it holds no secrets and calls no API;
 * the request is forwarded rather than rebuilt so the method, cookies and
 * body stream pass through untouched, and the response returns unread.
 */
export interface Env {
  ASSETS: Fetcher;
  PORTAL: Fetcher;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const forwarded = new Request(request);
    const ip = request.headers.get("cf-connecting-ip");
    if (ip) forwarded.headers.set("cf-connecting-ip", ip);
    return env.PORTAL.fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;
