// @vitest-environment happy-dom
/**
 * The "i" after a parameter's name, driven the way a reader drives it.
 *
 * The layout auditor proves the popover sits inside the viewport; it never
 * presses Escape, taps beside the box, or asks where focus went. These are
 * the behaviours a keyboard or screen-reader user depends on, and the one
 * rule the design leans on: a parameter without texts gets no button, not a
 * dead one. Rendered into a real DOM (happy-dom, this file only — the rest
 * of the project's tests are node), because every one of these is an event
 * and a focus change, which static markup cannot show.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AboutParam from "../src/ui/AboutParam";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ABOUT = { what: "Cukr v krvi, hlavní zdroj energie buněk.", usedFor: "Sleduje se při cukrovce." };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (ui: ReactElement) => act(() => root.render(ui));
const button = () => document.querySelector<HTMLButtonElement>(".about-btn");
const popover = () => document.querySelector<HTMLElement>(".about-pop");
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const press = (key: string) => act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));

describe("AboutParam", () => {
  it("is absent, not disabled, for a parameter without texts", () => {
    render(<AboutParam name="Vlastní parametr" about={undefined} />);
    expect(button()).toBeNull();
    render(<AboutParam name="Vlastní parametr" about={null} />);
    expect(button()).toBeNull();
    expect(document.querySelector("[disabled]")).toBeNull();
  });

  it("opens the two paragraphs under the name, and the button says which name", () => {
    render(<AboutParam name="Glukóza" about={ABOUT} />);
    const b = button()!;
    expect(b.getAttribute("aria-label")).toBe("O parametru Glukóza");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(popover()).toBeNull();
    click(b);
    const pop = popover()!;
    expect(b.getAttribute("aria-expanded")).toBe("true");
    expect(b.getAttribute("aria-controls")).toBe(pop.id);
    expect(pop.querySelector("h4")?.textContent).toBe("Glukóza");
    expect([...pop.querySelectorAll("p")].map((p) => p.textContent)).toEqual([ABOUT.what, ABOUT.usedFor]);
    // Focus moved into the box, so a screen reader reads on from the name.
    expect(document.activeElement).toBe(pop);
  });

  it("closes on the button again, with focus on the button", () => {
    render(<AboutParam name="Glukóza" about={ABOUT} />);
    click(button()!);
    expect(popover()).not.toBeNull();
    click(button()!);
    expect(popover()).toBeNull();
    expect(button()!.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button());
  });

  it("closes on Escape and returns focus to the button", () => {
    render(<AboutParam name="Glukóza" about={ABOUT} />);
    click(button()!);
    press("Escape");
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("closes on a tap outside, and leaves focus where the tap went", () => {
    render(
      <>
        <AboutParam name="Glukóza" about={ABOUT} />
        <button id="elsewhere">jinam</button>
      </>,
    );
    click(button()!);
    expect(popover()).not.toBeNull();
    // A tap inside the box is not outside.
    click(popover()!.querySelector("p")!);
    expect(popover()).not.toBeNull();
    const other = document.getElementById("elsewhere")!;
    click(other);
    expect(popover()).toBeNull();
    expect(document.activeElement).not.toBe(button());
  });

  it("keeps one open at a time, across two names", () => {
    render(
      <>
        <AboutParam name="Glukóza" about={ABOUT} />
        <AboutParam name="Urea" about={{ what: "Produkt rozkladu bílkovin.", usedFor: "Ukazatel funkce ledvin." }} />
      </>,
    );
    const [first, second] = [...document.querySelectorAll<HTMLButtonElement>(".about-btn")];
    click(first);
    expect(document.querySelectorAll(".about-pop")).toHaveLength(1);
    // Keyboard: Enter on the second button fires a click with no pointerdown
    // before it, so the outside-tap rule alone would leave both open.
    act(() => second.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const pops = document.querySelectorAll(".about-pop");
    expect(pops).toHaveLength(1);
    expect(pops[0].querySelector("h4")?.textContent).toBe("Urea");
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes when focus leaves it, without pulling focus back", () => {
    render(
      <>
        <AboutParam name="Glukóza" about={ABOUT} />
        <button id="next">další</button>
      </>,
    );
    click(button()!);
    const next = document.getElementById("next")!;
    act(() => next.focus());
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(next);
  });
});
