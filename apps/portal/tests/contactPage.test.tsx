// @vitest-environment happy-dom
/**
 * „Napište nám": the third field. It is labelled by what a person knows —
 * the date of the draw, which is how the report list names a report — and
 * its hint says a report's id is fine too, since the „Napište nám" link on
 * a report row fills that in. Until 2026-09-19 the label said „Report" and
 * the hint said a date, which is a label and a hint disagreeing. Whatever
 * is typed posts as `reportId`: the worker resolves either.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ContactPage from "../src/ui/ContactPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let posted: Array<{ path: string; body: unknown }>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  posted = [];
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path === "/api/me") return new Response(JSON.stringify({ email: "audit@example.com", createdAt: "2026-09-01", demo: false }), { status: 200 });
    posted.push({ path, body: JSON.parse(init?.body as string) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const render = async (ui: ReactElement) => {
  await act(async () => root.render(ui));
  await act(async () => {});
};
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the report field", () => {
  it("is labelled by the date of the draw, with the hint saying a report's id does too", async () => {
    await render(<ContactPage />);
    const label = [...host.querySelectorAll("label")].find((l) => l.querySelector('input[type="text"]'))!;
    const words = label.childNodes[0].textContent!.trim();
    expect(words).toBe("Datum odběru (nepovinné)");
    expect(label.querySelector(".hint")!.textContent).toBe("Např. 2026-03-04, pokud se zpráva týká jednoho z vašich reportů. Id reportu z odkazu u reportu stačí také.");
    expect(host.textContent).not.toContain("Report (nepovinné)");
  });

  it("posts whatever was typed as reportId — a date or an id", async () => {
    await render(<ContactPage />);
    type(q<HTMLTextAreaElement>("textarea")!, "Druhá strana se nepřečetla.");
    type(q<HTMLInputElement>('input[type="text"]')!, "2026-03-04");
    await act(async () => {
      q<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(posted).toEqual([{ path: "/api/helpdesk", body: { text: "Druhá strana se nepřečetla.", reportId: "2026-03-04" } }]);
  });
});
