// @vitest-environment happy-dom
/**
 * The bot gate when Cloudflare's script never arrives — blocked by an
 * extension, or the person is offline. With a site key the form needs a
 * token and the box under it stays empty: until 2026-09-19 that box was a
 * fixed 65px of nothing, and the form's only word about it was the refusal
 * on submit. The hook now knows it has waited too long, and the box says
 * one sentence in muted ink. The sweep's stub renders a child at once, so
 * the same eight seconds never elapse there.
 *
 * Fake timers, because eight seconds is the point and no test waits them.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PORTAL_TURNSTILE_ACTIONS } from "@bw/gate/turnstile";
import { Door, TurnstileBox } from "../src/ui/Door";
import { TURNSTILE_FAILED, TURNSTILE_WAIT_MS, useTurnstile } from "../src/lib/turnstile";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function Form({ enabled = true }: { enabled?: boolean }) {
  const gate = useTurnstile(PORTAL_TURNSTILE_ACTIONS.login, enabled);
  return (
    <Door>
      <TurnstileBox gate={gate} />
      <output>{String(gate.failed)}</output>
    </Door>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll("script").forEach((s) => s.remove());
  delete (window as unknown as { turnstile?: unknown }).turnstile;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const render = (ui: ReactElement) => act(() => root.render(ui));
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const elapse = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("the gate with no widget", () => {
  it("reserves no height before the widget renders", () => {
    render(<Form />);
    const box = q(".door-turnstile")!;
    expect(box).not.toBeNull();
    // Nothing inline forces a size; the sheet sets none either (tokens.test.ts).
    expect(box.getAttribute("style")).toBeNull();
    expect(box.childElementCount).toBe(0);
  });

  it("says the check did not load after eight seconds without a render, in muted ink", () => {
    render(<Form />);
    expect(q("output")!.textContent).toBe("false");
    elapse(TURNSTILE_WAIT_MS - 1);
    expect(q("output")!.textContent).toBe("false");
    expect(q(".door-turnstile-failed")).toBeNull();
    elapse(1);
    expect(q("output")!.textContent).toBe("true");
    const line = q(".door-turnstile-failed")!;
    expect(line.textContent).toBe(TURNSTILE_FAILED);
    expect(TURNSTILE_FAILED).toBe("Ověření, že nejste robot, se nenačetlo. Načtěte prosím stránku znovu.");
    expect(line.classList.contains("hint"), "muted, not a notice").toBe(true);
    expect(line.classList.contains("notice")).toBe(false);
  });

  it("stays quiet when the widget rendered in time — the sweep's stub renders a child at once", () => {
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (el: HTMLElement) => {
        el.appendChild(document.createElement("div"));
        return "w";
      },
      reset: () => {},
    };
    render(<Form />);
    expect(q(".door-turnstile")!.childElementCount).toBe(1);
    elapse(TURNSTILE_WAIT_MS * 2);
    expect(q("output")!.textContent).toBe("false");
    expect(q(".door-turnstile-failed")).toBeNull();
  });

  it("stays quiet when the script arrives late but before the deadline", () => {
    render(<Form />);
    elapse(TURNSTILE_WAIT_MS / 2);
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (el: HTMLElement) => {
        el.appendChild(document.createElement("div"));
        return "w";
      },
      reset: () => {},
    };
    act(() => window.onTurnstileLoad?.());
    elapse(TURNSTILE_WAIT_MS);
    expect(q("output")!.textContent).toBe("false");
  });

  it("does nothing at all when the gate is not enabled for this reader", () => {
    render(<Form enabled={false} />);
    expect(q(".door-turnstile")).toBeNull();
    elapse(TURNSTILE_WAIT_MS * 2);
    expect(q("output")!.textContent).toBe("false");
  });
});
