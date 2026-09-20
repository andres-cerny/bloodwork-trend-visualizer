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

describe("the privacy page says what the code does", () => {
  // Each sentence here has a counterpart in the worker: messages.user_agent
  // (helpdesk.ts, 200 chars), the events table (events.ts, 30 days, pruned
  // by watch.ts), the triage model at Workers AI (triage.ts), the four
  // Turnstile surfaces (signup.ts, index.ts, helpdesk.ts), and the answered
  // message's twelve months (watch.ts). A sentence that stops being true is
  // the bug report; a truth the page leaves out is one too.
  it("names the browser string kept with a help-desk message", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    await render(<Privacy />);
    expect(text()).toContain("označení prohlížeče (nejvýše 200 znaků)");
  });

  it("names the refusals table in what is stored and in how long", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    await render(<Privacy />);
    const t = text();
    expect(t).toContain("Záznamy o odmítnutích");
    for (const field of ["cesta", "stav", "kód chyby", "otisk účtu", "id požadavku"]) expect(t, field).toContain(field);
    expect(t).toContain("Záznam o odmítnutí — 30 dní, pak ho pravidelná kontrola maže.");
  });

  it("says a model at Cloudflare reads a help-desk message beside the account's refusals, and gets no value and no page", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    await render(<Privacy />);
    const t = text();
    expect(t).toContain("Workers AI");
    expect(t).toContain("spolu se záznamy o odmítnutích vašeho účtu");
    expect(t).toContain("nedostane žádnou hodnotu ani stránku");
  });

  it("names every surface Turnstile runs on", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    await render(<Privacy />);
    expect(text()).toContain("běží na registraci, přihlášení, zapomenutém heslu a na formuláři Napište nám bez přihlášení");
  });

  it("keeps the twelve months after an answer, which the scheduled check now enforces", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    await render(<Privacy />);
    expect(text()).toContain("Zpráva z Napište nám — do odpovědi a 12 měsíců po ní.");
  });

  it("names each processor's seat in its own bullet, and does not say Telegram is in the USA under SCCs", async () => {
    // „Všichni sídlí v USA; … standardní smluvní doložky" was false for
    // Telegram: Dubai, and no data-processing agreement — it carries only
    // the help-desk message the person wrote, never a value or a page. The
    // seat is stated where it is known, per processor, and the „Návrh:"
    // mark stays for Ondřej to check the list against his contracts.
    vi.stubGlobal("fetch", fakeFetch({ photoReaders: "anthropic+google" }));
    await render(<Privacy />);
    const t = text();
    expect(t).not.toContain("všichni sídlí v USA");
    const bulletOf = (name: string) => [...host.querySelectorAll("li")].find((li) => li.querySelector("strong")?.textContent === name);
    for (const name of ["Cloudflare", "Anthropic", "Google", "Resend", "Stripe"]) {
      const bullet = bulletOf(name);
      expect(bullet, name).toBeDefined();
      expect(bullet!.textContent, name).toContain("Sídlo: USA");
      expect(bullet!.textContent, name).toContain("standardní smluvní doložky");
    }
    const telegram = bulletOf("Telegram")!;
    expect(telegram.textContent).toContain("Sídlo: Spojené arabské emiráty");
    expect(telegram.textContent).not.toContain("USA");
    expect(telegram.textContent).not.toContain("smluvní doložky");
    expect(telegram.textContent).toContain("Dostane jen zprávu, kterou jste napsali");
    expect(telegram.textContent).toContain("žádné zdravotní údaje");
    expect(t).toContain("Návrh:");
  });
});

describe("Czech typography", () => {
  it("closes „ with “ in every prose quote of the legal texts — never with a straight \"", () => {
    // „služba" with a straight closer is a quote that opens Czech and closes
    // ASCII. Read as source, with JSX attributes stripped, because the rule
    // is about prose and an attribute value is not prose.
    for (const file of ["TermsPage.tsx", "Privacy.tsx", "legal.tsx"]) {
      const prose = source(file).replace(/=\s*"[^"]*"/g, "=…");
      const opens = [...prose.matchAll(/„/g)].length;
      const straightClosed = [...prose.matchAll(/„[^„“"\n]*"/g)].map((m) => m[0]);
      expect(straightClosed, `${file}: straight closers`).toEqual([]);
      if (opens > 0) expect([...prose.matchAll(/“/g)].length, `${file}: every „ has its “`).toBeGreaterThanOrEqual(opens);
    }
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

describe("the way back from a prose page", () => {
  it("is a nav at the top — a box, like the footer's links — on all three, not an inline link in a paragraph", async () => {
    // An inline <a> in a <p> is 21px tall: under the 24px floor the sweep
    // holds every link to, and exempt from it only because inline links in
    // prose are sized by their sentence. „← Moje krev" stands alone.
    for (const path of ["/podminky", "/soukromi", "/proc-prikoupit"]) {
      act(() => root.unmount());
      root = createRoot(host);
      history.replaceState(null, "", path);
      vi.stubGlobal("fetch", fakeFetch({}));
      await render(<App />);
      const head = host.querySelector<HTMLElement>("main > nav.legal-foot.legal-head");
      expect(head, `${path}: a head nav`).not.toBeNull();
      expect(head!.getAttribute("aria-label")).toBe("Zpět");
      expect([...head!.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["← Moje krev", "/"]]);
      expect(host.querySelector('main > p > a[href="/"]'), `${path}: no inline back link`).toBeNull();
      // Before the heading, where a way back belongs.
      expect(head!.compareDocumentPosition(host.querySelector("main h1")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});
