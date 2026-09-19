// @vitest-environment happy-dom
/**
 * The open door's form, driven the way a stranger drives it.
 *
 * The layout auditor proves the two moods sit inside the viewport; it never
 * ticks a box, submits, or reads what was posted. These are the rules the
 * form enforces before the worker does — both consents, the bot gate's
 * token — and the words it answers with, which are user-visible Czech copy
 * and pinned like any other. Rendered into a real DOM (happy-dom) because
 * every one of these is a click and a submit. The network is a stubbed
 * fetch that records what was posted.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Privacy from "../src/ui/Privacy";
import RegisterPage from "../src/ui/RegisterPage";
import VerifyMailPage from "../src/ui/VerifyMailPage";
import { CONSENT_HEALTH, CONSENT_TERMS, PRIVACY_PATH, TERMS_PATH } from "../src/ui/legal";
import { LOGIN_PATH } from "../src/ui/LandingPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let posted: Array<{ path: string; body: unknown }>;
let answer: { status: number; body: unknown };

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  posted = [];
  answer = { status: 200, body: { ok: true } };
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    posted.push({ path, body: JSON.parse(init?.body as string) });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const render = (ui: ReactElement) => act(() => root.render(ui));
const flush = () => act(async () => {});
const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
const text = () => document.body.textContent ?? "";

function typeEmail(value: string) {
  const input = q<HTMLInputElement>('input[type="email"]')!;
  act(() => {
    // React reads the value through its own tracker; setting the native
    // value alone is not an input.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const tick = (i: number) => act(() => document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[i].click());
const submit = async () => {
  await act(async () => {
    q<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
};

describe("RegisterPage — registrace", () => {
  it("asks for the address and the two consents, each linking to its text", () => {
    render(<RegisterPage mode="register" />);
    expect(q("h2")!.textContent).toBe("Registrace");
    const labels = [...document.querySelectorAll("label.check.consent")].map((l) => l.textContent?.replace(/\s+/g, " ").trim());
    expect(labels).toEqual([CONSENT_HEALTH, CONSENT_TERMS]);
    expect(q(`label.check.consent a[href="${PRIVACY_PATH}"]`)!.textContent).toBe("Zásady ochrany soukromí");
    expect(q(`label.check.consent a[href="${TERMS_PATH}"]`)!.textContent).toBe("Podmínkami užití");
    expect(q("button.primary")!.textContent).toBe("Poslat odkaz");
    // No site key: no widget frame either.
    expect(q(".door-turnstile")).toBeNull();
  });

  it("ticks the very sentence the privacy page quotes as the čl. 9 basis", async () => {
    // The privacy page says „souhlas, který dáváte při registraci zaškrtnutím
    // věty" and quotes CONSENT_HEALTH. The checkbox must show that sentence,
    // word for word — a shorter paraphrase beside the box is a consent to
    // something else.
    render(<RegisterPage mode="register" />);
    const ticked = q("label.check.consent")!.textContent!.replace(/\s+/g, " ").trim();
    act(() => root.unmount());
    root = createRoot(host);
    render(<Privacy />);
    await flush();
    const quoted = q("blockquote.legal-quote")!.textContent!.replace(/^„|“$/g, "");
    expect(ticked).toBe(quoted);
    expect(quoted).toBe(CONSENT_HEALTH);
  });

  it("ends on the same nav the login and the contact page end on: each link a box, a dot between", () => {
    // Inline links in a <p> are 21px tall and wrap into ragged lines at 360;
    // the door's foot is one nav, a column of link boxes with no dots — the
    // card never fits three in a row — and every door must be that nav, not
    // three spellings of it.
    const foot = () => q<HTMLElement>("nav.door-foot.legal-foot")!;
    const shape = () => ({
      label: foot().getAttribute("aria-label"),
      links: [...foot().querySelectorAll("a")].map((a) => a.textContent),
      dots: [...foot().querySelectorAll('span[aria-hidden="true"]')].map((s) => s.textContent),
    });
    render(<RegisterPage mode="register" />);
    expect(q("p.door-foot")).toBeNull();
    expect(shape()).toEqual({ label: "Další cesty", links: ["Přihlášení", "Zapomenuté heslo", "Co ukládáme, a co ne"], dots: [] });

    act(() => root.unmount());
    root = createRoot(host);
    render(<RegisterPage mode="forgot" />);
    expect(shape()).toEqual({ label: "Další cesty", links: ["Přihlášení", "Registrovat", "Co ukládáme, a co ne"], dots: [] });

    act(() => root.unmount());
    root = createRoot(host);
    render(<VerifyMailPage email="nova@example.com" />);
    expect(q("p.door-foot")).toBeNull();
    expect(shape()).toEqual({ label: "Další cesty", links: ["Přihlášení"], dots: [] });
  });

  it("links Přihlášení to the login form, not to the landing", () => {
    render(<RegisterPage mode="register" />);
    expect(q(`.door-foot a[href="${LOGIN_PATH}"]`)!.textContent).toBe("Přihlášení");
    expect(q('.door-foot a[href="/"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    render(<VerifyMailPage email="nova@example.com" />);
    expect(q(`a[href="${LOGIN_PATH}"]`)!.textContent).toBe("Přihlášení");
    expect(q('a[href="/"]')).toBeNull();
  });

  it("refuses to send without both consents, and posts nothing", async () => {
    render(<RegisterPage mode="register" />);
    typeEmail("nova@example.com");
    await submit();
    expect(text()).toContain("Zaškrtněte prosím oba souhlasy.");
    tick(0);
    await submit();
    expect(text()).toContain("Zaškrtněte prosím oba souhlasy.");
    expect(posted).toEqual([]);
  });

  it("with both ticked posts the address and consent, then says where the link went", async () => {
    render(<RegisterPage mode="register" />);
    typeEmail("nova@example.com");
    tick(0);
    tick(1);
    await submit();
    expect(posted).toEqual([{ path: "/api/auth/register", body: { email: "nova@example.com", consent: true } }]);
    expect(q(".sent")!.textContent).toBe("Poslali jsme odkaz na nova@example.com. Otevřete ho do 24 hodin.");
    expect(q("form")).toBeNull();
    expect(q(`a[href="${LOGIN_PATH}"]`)!.textContent).toBe("Přihlášení");
  });

  it("shows the worker's sentence on a refusal and keeps the form", async () => {
    answer = { status: 429, body: { error: "too_many", message: "Příliš mnoho žádostí o odkaz z této adresy. Zkuste to znovu za hodinu." } };
    render(<RegisterPage mode="register" />);
    typeEmail("nova@example.com");
    tick(0);
    tick(1);
    await submit();
    expect(q(".notice")!.textContent).toBe("Příliš mnoho žádostí o odkaz z této adresy. Zkuste to znovu za hodinu.");
    expect(q("form")).not.toBeNull();
    expect(q(".sent")).toBeNull();
  });
});

describe("RegisterPage — zapomenuté heslo", () => {
  it("asks for the address alone and posts to /api/auth/forgot", async () => {
    render(<RegisterPage mode="forgot" />);
    expect(q("h2")!.textContent).toBe("Zapomenuté heslo");
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    typeEmail("stara@example.com");
    await submit();
    expect(posted).toEqual([{ path: "/api/auth/forgot", body: { email: "stara@example.com" } }]);
    expect(q(".sent")!.textContent).toBe("Poslali jsme odkaz na stara@example.com. Otevřete ho do 24 hodin.");
  });
});

describe("the bot gate on the form", () => {
  interface FakeWidget {
    opts: Record<string, unknown>;
    resets: number;
  }
  let widget: FakeWidget;

  beforeEach(() => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
    widget = { opts: {}, resets: 0 };
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (_el: HTMLElement, opts: Record<string, unknown>) => {
        widget.opts = opts;
        return "w-1";
      },
      reset: () => {
        widget.resets += 1;
      },
    };
  });
  afterEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  it("renders the widget for the register action, waits for its token, posts it, and resets after a refusal", async () => {
    render(<RegisterPage mode="register" />);
    await flush();
    expect(q(".door-turnstile")).not.toBeNull();
    expect(widget.opts.action).toBe("portal-register");
    expect(widget.opts.sitekey).toBe("1x00000000000000000000AA");

    typeEmail("nova@example.com");
    tick(0);
    tick(1);
    await submit();
    expect(text()).toContain("Počkejte prosím na ověření, že nejste robot.");
    expect(posted).toEqual([]);

    act(() => (widget.opts.callback as (t: string) => void)("tok-1"));
    answer = { status: 403, body: { error: "turnstile_failed", message: "Ověření se nezdařilo. Zkuste to znovu." } };
    await submit();
    expect(posted).toEqual([{ path: "/api/auth/register", body: { email: "nova@example.com", consent: true, turnstile: "tok-1" } }]);
    expect(q(".notice")!.textContent).toBe("Ověření se nezdařilo. Zkuste to znovu.");
    // Spent: the widget was told to issue a new one, and the form waits for it.
    expect(widget.resets).toBe(1);
    await submit();
    expect(posted).toHaveLength(1);
    expect(text()).toContain("Počkejte prosím na ověření, že nejste robot.");
  });

  it("the forgot form asks for its own action", async () => {
    render(<RegisterPage mode="forgot" />);
    await flush();
    expect(widget.opts.action).toBe("portal-forgot");
  });
});
