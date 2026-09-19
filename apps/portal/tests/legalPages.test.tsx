// @vitest-environment happy-dom
/**
 * The words a stranger reads first: the landing, the terms, the privacy page.
 *
 * Three things are pinned. That no page names a processor from memory — the
 * clause comes from /api/processors, so a deployment that sends photos to a
 * second vendor is disclosed by the deployment, not by whoever last edited
 * the copy (docs/security-review-gemini.md, finding 1); and that while the
 * request is loading or has failed, the page names more, never fewer. That
 * both legal pages carry the draft banner from one constant, so approving
 * the texts is one edit. And that the router reaches "/" logged out and
 * "/podminky" at all. Rendered into happy-dom because the processor clause
 * is a fetch and a state change, which static markup cannot show.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import LandingPage from "../src/ui/LandingPage";
import Privacy from "../src/ui/Privacy";
import TermsPage from "../src/ui/TermsPage";
import { ALLOWANCE, CONSENT_HEALTH, CONSENT_TERMS, DRAFT_NOTICE, LEGAL_DRAFT, OPERATOR } from "../src/ui/legal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UI = join(import.meta.dirname, "../src/ui");
const source = (file: string) => readFileSync(join(UI, file), "utf-8");

let host: HTMLDivElement;
let root: Root;

/** The fake worker: what /api/processors and the two logged-out questions answer. */
function fakeFetch(answers: { photoReaders?: string | null; processorsFail?: boolean }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://x").pathname;
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (path === "/api/processors") {
      if (answers.processorsFail) return json({ error: "down" }, 503);
      return json({ photoReaders: answers.photoReaders ?? null });
    }
    if (path === "/api/auth/demo") return json({ available: true });
    if (path === "/api/me") return json({ error: "unauthorized" }, 401);
    return json({ error: "not_found" }, 404);
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** Render, then let the effects' fetches settle. */
async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const text = () => host.textContent ?? "";

describe("no page names a processor from memory", () => {
  // The grep half: the literal names may appear in these files only inside
  // the ui-kit's clause, never as copy. `sendsToGoogle(` guards the one
  // sub-processor row that varies, and a match outside it is a promise the
  // deployment can falsify.
  it("the landing's source holds no vendor name", () => {
    const src = source("LandingPage.tsx");
    expect(src).not.toMatch(/Anthropic|Gemini|Google|Claude/);
    expect(src).toContain("processorPhrase(");
  });

  it("the privacy page's source names Google only under sendsToGoogle", () => {
    const src = source("Privacy.tsx");
    expect(src).toContain("processorPhrase(");
    expect(src).toContain("sendsToGoogle(");
    // Every "Google" in the JSX sits inside the guarded block: strip that
    // block and no "Google" may remain.
    const stripped = src.replace(/\{sendsToGoogle\(photoReaders\) && \([\s\S]*?\)\}/, "");
    // `\b`: the identifier sendsToGoogle is not a mention.
    expect(stripped).not.toMatch(/\bGoogle\b|Gemini/);
  });

  it("the landing names both readers when the deployment uses both", async () => {
    vi.stubGlobal("fetch", fakeFetch({ photoReaders: "sonnet+gemini" }));
    await render(<LandingPage onDone={() => {}} />);
    expect(text()).toContain("Anthropic API");
    expect(text()).toContain("Google Gemini API");
  });

  it("the landing names only Anthropic under the Anthropic-only pair", async () => {
    vi.stubGlobal("fetch", fakeFetch({ photoReaders: "sonnet+haiku" }));
    await render(<LandingPage onDone={() => {}} />);
    expect(text()).toContain("Anthropic API");
    expect(text()).not.toContain("Google");
  });

  it("the landing names more, not fewer, when /api/processors fails", async () => {
    vi.stubGlobal("fetch", fakeFetch({ processorsFail: true }));
    await render(<LandingPage onDone={() => {}} />);
    expect(text()).toContain("Google Gemini API");
  });

  it("the privacy page's sub-processor list follows the deployment", async () => {
    vi.stubGlobal("fetch", fakeFetch({ photoReaders: "sonnet+haiku" }));
    await render(<Privacy />);
    expect(text()).toContain("Anthropic");
    expect(text()).not.toContain("Google");

    act(() => root.unmount());
    root = createRoot(host);
    vi.stubGlobal("fetch", fakeFetch({ photoReaders: "sonnet+gemini" }));
    await render(<Privacy />);
    expect(text()).toContain("Google");
  });
});

describe("the draft banner", () => {
  it("is one constant, and both legal pages render it while it holds", async () => {
    expect(typeof LEGAL_DRAFT).toBe("boolean");
    expect(source("Privacy.tsx")).toContain("<DraftBanner />");
    expect(source("TermsPage.tsx")).toContain("<DraftBanner />");
    vi.stubGlobal("fetch", fakeFetch({}));
    await render(<Privacy />);
    expect(text().includes(DRAFT_NOTICE)).toBe(LEGAL_DRAFT);
    act(() => root.unmount());
    root = createRoot(host);
    await render(<TermsPage />);
    expect(text().includes(DRAFT_NOTICE)).toBe(LEGAL_DRAFT);
  });

  it("the operator is a placeholder until filled, and both pages render it", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    await render(<TermsPage />);
    expect(text()).toContain(OPERATOR.name);
    act(() => root.unmount());
    root = createRoot(host);
    await render(<Privacy />);
    expect(text()).toContain(OPERATOR.name);
  });
});

describe("the consent sentences", () => {
  it("are quoted on the privacy page as the legal basis", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    await render(<Privacy />);
    expect(text()).toContain(CONSENT_HEALTH);
    expect(text()).toContain("čl. 9 GDPR");
  });

  it("read as plain Czech: one sentence each, vykání, no exclamation", () => {
    for (const s of [CONSENT_HEALTH, CONSENT_TERMS]) {
      expect(s).not.toContain("!");
      expect(s.endsWith(".")).toBe(true);
      expect(s.startsWith("Souhlasím")).toBe(true);
    }
    expect(CONSENT_HEALTH).toContain("Zásady ochrany soukromí");
    expect(CONSENT_TERMS).toContain("Podmínkami užití");
  });
});

describe("the landing", () => {
  it("says what it is, what it is not, what is stored, who reads, what it costs — and the three ways in", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    await render(<LandingPage onDone={() => {}} />);
    const t = text();
    expect(t).toContain("není zdravotnický prostředek");
    expect(t).toContain("bez jména, bez rodného čísla");
    expect(t).toContain(`Prvních ${ALLOWANCE.free} dokumentů je zdarma`);
    expect(t).toContain("5 dokumentů za 49 Kč");
    expect(t).toContain("15 za 99 Kč");
    expect(t).not.toContain("!");
    expect(host.querySelector('a[href="/registrace"]')?.textContent).toBe("Registrovat");
    expect(host.querySelector('a[href="/prihlaseni"]')?.textContent).toBe("Přihlásit");
    expect(host.querySelector("button.linkish")?.textContent).toBe("Zobrazit demo pacienta");
    for (const href of ["/soukromi", "/podminky", "/napiste-nam"]) {
      expect(host.querySelector(`.legal-foot a[href="${href}"]`), href).not.toBeNull();
    }
  });

  it("hides the demo link when the deployment offers no demo", async () => {
    const f = fakeFetch({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
        if (new URL(url, "http://x").pathname === "/api/auth/demo") return new Response("{}", { status: 404 });
        return f(input);
      }),
    );
    await render(<LandingPage onDone={() => {}} />);
    expect(host.querySelector("button.linkish")).toBeNull();
  });
});

describe("the router", () => {
  it("renders the landing at / when nobody is logged in", async () => {
    history.replaceState(null, "", "/");
    vi.stubGlobal("fetch", fakeFetch({}));
    await render(<App />);
    expect(host.querySelector(".landing h1")?.textContent).toBe("Moje krev");
    expect(host.querySelector(".door form")).toBeNull();
  });

  it("renders the login form at /prihlaseni", async () => {
    history.replaceState(null, "", "/prihlaseni");
    vi.stubGlobal("fetch", fakeFetch({}));
    await render(<App />);
    expect(host.querySelector(".door form")).not.toBeNull();
    expect(host.querySelector('.door-foot a[href="/"]')).not.toBeNull();
  });

  it("renders the terms at /podminky", async () => {
    history.replaceState(null, "", "/podminky");
    vi.stubGlobal("fetch", fakeFetch({}));
    await render(<App />);
    expect(host.querySelector("h1")?.textContent).toBe("Podmínky užití");
    expect(host.querySelectorAll(".legal h2").length).toBe(12);
  });
});
