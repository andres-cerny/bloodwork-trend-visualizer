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
import RegisterPage from "../src/ui/RegisterPage";

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
    expect(labels).toEqual([
      "Souhlasím se zpracováním svých zdravotních údajů podle Zásad ochrany soukromí",
      "Souhlasím s Podmínkami užití",
    ]);
    expect(q('label.check.consent a[href="/soukromi"]')!.textContent).toBe("Zásad ochrany soukromí");
    expect(q('label.check.consent a[href="/podminky"]')!.textContent).toBe("Podmínkami užití");
    expect(q("button.primary")!.textContent).toBe("Poslat odkaz");
    // No site key: no widget frame either.
    expect(q(".door-turnstile")).toBeNull();
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
    expect(q('a[href="/"]')!.textContent).toBe("Přihlášení");
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
