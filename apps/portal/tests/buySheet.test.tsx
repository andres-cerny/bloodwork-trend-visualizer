// @vitest-environment happy-dom
/**
 * The buy sheet as a dialog: where focus goes when it opens, where it comes
 * back to when it closes, and that Tab stays inside while it is open —
 * `aria-modal` promises the last one, and a promise the DOM does not keep is
 * a screen reader announcing a dialog whose Tab key walks the page behind
 * it. And what the two Koupit buttons do once the worker has said the shop
 * is closed: nothing, disabled, under one muted sentence — a rule, not an
 * alert.
 *
 * Rendered into happy-dom because every one of these is a focus move or a
 * key; the copy itself is allowanceCopy.test.ts's.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BuySheet, { SHOP_CLOSED } from "../src/ui/BuySheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let answer: { status: number; body: unknown };

/** The chip's button and the sheet, wired the way Portal.tsx wires them. */
function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        Přikoupit
      </button>
      <BuySheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  answer = { status: 503, body: { error: "shop_closed", message: SHOP_CLOSED } };
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(answer.body), { status: answer.status }));
  act(() => root.render(<Host />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const opener = () => q<HTMLButtonElement>("#opener")!;
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const key = (el: Element, key: string, shiftKey = false) =>
  act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })));
const flush = () => act(async () => {});

async function open() {
  opener().focus();
  await click(opener());
  await flush();
  expect(q(".sheet"), "the sheet is open").not.toBeNull();
}

describe("focus", () => {
  it("lands on Zavřít when the sheet opens, and returns to Přikoupit on Escape", async () => {
    await open();
    expect(document.activeElement).toBe(q(".sheet-head button"));
    await key(document.activeElement!, "Escape");
    await flush();
    expect(q(".sheet")).toBeNull();
    expect(document.activeElement, "focus is back on the button that opened it").toBe(opener());
  });

  it("returns to Přikoupit after Zavřít, and after a tap outside", async () => {
    await open();
    await click(q(".sheet-head button")!);
    await flush();
    expect(document.activeElement).toBe(opener());

    await open();
    await click(q(".sheet-back")!);
    await flush();
    expect(q(".sheet")).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it("Tab from the last control wraps to the first, and Shift+Tab from the first to the last", async () => {
    await open();
    const controls = [...host.querySelectorAll<HTMLElement>(".sheet button:not(:disabled), .sheet a[href]")];
    expect(controls.length).toBeGreaterThanOrEqual(4);
    const first = controls[0];
    const last = controls[controls.length - 1];
    expect(first.textContent).toBe("Zavřít");
    expect(last.textContent).toBe("Proč přikoupit?");

    last.focus();
    await key(last, "Tab");
    expect(document.activeElement, "Tab off the end wraps to Zavřít").toBe(first);

    first.focus();
    await key(first, "Tab", true);
    expect(document.activeElement, "Shift+Tab off the start wraps to the link").toBe(last);
  });
});

describe("the two Koupit buttons", () => {
  it("are the sheet's primary action, full-size, not the small variant", async () => {
    await open();
    const buys = [...host.querySelectorAll<HTMLButtonElement>(".pack button")];
    expect(buys.map((b) => b.textContent)).toEqual(["Koupit za 49 Kč", "Koupit za 99 Kč"]);
    for (const b of buys) {
      expect(b.className.split(" "), b.textContent!).toContain("primary");
      expect(b.className.split(" "), b.textContent!).not.toContain("small");
    }
  });

  it("after the shop answers closed, both stay disabled under one muted state line, not an alert", async () => {
    await open();
    const [first, second] = [...host.querySelectorAll<HTMLButtonElement>(".pack button")];
    first.focus();
    await click(first);
    await flush();
    await flush();
    expect(first.disabled).toBe(true);
    expect(second.disabled).toBe(true);
    // The tapped button was disabled under the reader's focus; focus is not
    // dropped on the body, which the next Tab would leave the dialog from.
    expect(document.activeElement).toBe(q(".sheet-head button"));
    const line = q(".sheet .sheet-state")!;
    expect(line.textContent).toBe(SHOP_CLOSED);
    expect(line.getAttribute("role")).toBe("status");
    expect(q(".sheet .notice"), "the closed shop is not painted as an error").toBeNull();
    // Tab still stays inside: the disabled pair is skipped, the link wraps to Zavřít.
    const link = q<HTMLAnchorElement>(".sheet a[href]")!;
    link.focus();
    await key(link, "Tab");
    expect(document.activeElement).toBe(q(".sheet-head button"));
  });

  it("a failure that is not a rule keeps the buttons live and says so as an alert", async () => {
    answer = { status: 502, body: { error: "stripe_failed", message: "No such price" } };
    await open();
    const [first, second] = [...host.querySelectorAll<HTMLButtonElement>(".pack button")];
    await click(first);
    await flush();
    await flush();
    expect(first.disabled).toBe(false);
    expect(second.disabled).toBe(false);
    expect(q(".sheet .notice")!.getAttribute("role")).toBe("alert");
    expect(q(".sheet .sheet-state")).toBeNull();
  });
});
