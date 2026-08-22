/**
 * The built app, driven in a real browser.
 *
 * Unit tests cover what the app computes; this covers what it *shows* — which
 * is where the worst defects in this project have lived. Two of them would
 * have passed every unit test in the suite:
 *
 *   - the source highlight pointed at the wrong row on a phone, because the
 *     image width was measured once and the layout changed afterwards;
 *   - the chart plotted a value the app had itself flagged as a misread.
 *
 * Both are asserted below, by measuring rendered geometry rather than by
 * reading state.
 *
 *   npm run test:e2e
 *
 * Needs Chromium. If Playwright cannot find one, run:
 *   npx playwright install chromium
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { DESKTOP, MOBILE, WIDE, startApp, type Harness } from "./lib/harness";

let app: Harness;

beforeAll(async () => {
  app = await startApp(Number(process.env.E2E_PORT ?? 4300));
}, 120_000);

afterAll(async () => {
  await app?.stop();
});

const open = (viewport: { width: number; height: number }) => app.open(viewport);

const tab = (page: Page, name: string) => page.getByRole("tab", { name });

/**
 * Playwright's own `expect(locator).toContainText()` is not available here —
 * these run under vitest, whose expect is chai. So read the text explicitly,
 * with a short poll so a re-render in flight does not read as a failure.
 */
async function textOf(page: Page, selector: string, timeoutMs = 4000): Promise<string> {
  const started = Date.now();
  for (;;) {
    const el = page.locator(selector).first();
    if ((await el.count()) > 0) {
      const text = (await el.innerText()).trim();
      if (text) return text;
    }
    if (Date.now() - started > timeoutMs) return "";
    await page.waitForTimeout(150);
  }
}

/**
 * Put one analyte's chart on screen.
 *
 * The trends tab opens empty by design, so this drives the real flow: open the
 * picker, type enough of the name to narrow the list, click the match.
 */
async function selectAnalyte(page: Page, pattern: RegExp) {
  await page.getByRole("button", { name: /Přidat analyt/ }).click();
  await page.waitForTimeout(150);
  const query = pattern.source.replace(/[\^$]/g, "").slice(0, 6);
  await page.getByLabel("Hledat analyt").fill(query);
  await page.waitForTimeout(150);
  const item = page.locator(".picker-item", { hasText: pattern }).first();
  if ((await item.count()) === 0) throw new Error(`no analyte matching ${pattern}`);
  await item.click();
  await page.waitForTimeout(350);
}

describe("the app loads and renders", () => {
  it("shows the demo data without a page error", async () => {
    const page = await open(DESKTOP);
    expect(await textOf(page, ".patient-bar")).toContain("Jan Ukázka");
    // The demo must be readable with no Worker at all — /api/status 404s under
    // `vite preview`, and that must degrade rather than break.
    expect((page as any).__errors).toEqual([]);
    await page.close();
  });

  it("never scrolls sideways, on a phone or a desktop", async () => {
    for (const vp of [MOBILE, DESKTOP]) {
      const page = await open(vp);
      for (const name of ["📈 Trendy", "📝 Souhrn změn", "🔍 Ověření", "🗂️ Přiřazení názvů"]) {
        await tab(page, name).click();
        await page.waitForTimeout(250);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${vp.width}px, ${name}`).toBeLessThanOrEqual(0);
      }
      await page.close();
    }
  });
});

describe("trends visualise correctly", () => {
  it("draws a chart with one point per numeric result", async () => {
    const page = await open(DESKTOP);
    await selectAnalyte(page, /Cholesterol celkový/);
    // Four demo reports, all with a numeric cholesterol.
    const dots = page.locator("svg circle[stroke-width]");
    expect(await dots.count()).toBeGreaterThanOrEqual(4);
    await page.close();
  });

  it("spaces points by date, not by index", async () => {
    // The ten demo draws sit 0…1526 days from the first. Even spacing would
    // put them at ninths; this asserts the real proportions.
    const page = await open(DESKTOP);
    await selectAnalyte(page, /Cholesterol celkový/);
    const xs = await page.evaluate(() => {
      const svg = document.querySelector("svg")!;
      return [...svg.querySelectorAll("circle")]
        .filter((c) => c.getAttribute("fill") !== "transparent")
        .map((c) => Number(c.getAttribute("cx")));
    });
    const span = xs[xs.length - 1] - xs[0];
    const frac = xs.map((x) => (x - xs[0]) / span);
    const days = [0, 217, 350, 483, 644, 798, 973, 1127, 1323, 1526];
    expect(xs.length, "one dot per draw").toBe(days.length);
    for (const [i, d] of days.entries()) {
      expect(Math.abs(frac[i] - d / 1526), `point ${i}`).toBeLessThan(0.02);
    }
    await page.close();
  });

  it("does NOT plot a reading it has flagged as a misread", async () => {
    // The demo contains glucose transcribed as 44,5 where the page prints
    // 4,45. Drawing it puts a number the app believes false onto the screen a
    // patient is shown.
    const page = await open(DESKTOP);
    await selectAnalyte(page, /Glukóza/);

    expect(await textOf(page, ".held-back")).toContain("44,5");
    const ys = await page.evaluate(() => {
      const svg = document.querySelector("svg")!;
      return [...svg.querySelectorAll("text")].map((t) => t.textContent ?? "");
    });
    expect(ys.join(" "), "44,5 must not appear on the chart").not.toContain("44,5");
    await page.close();
  });

  it("names every unconfirmed reading it does plot", async () => {
    const page = await open(DESKTOP);
    await selectAnalyte(page, /^ALT/);
    // ALT 0,61 was read two different ways; it is plotted but must say so.
    expect(await textOf(page, ".unconfirmed-note")).toContain("0,61");
    await page.close();
  });

  it("does not draw a chart for a single measurement", async () => {
    const page = await open(DESKTOP);
    await selectAnalyte(page, /CRP/);
    expect(await page.locator("svg").count()).toBe(0);
    expect(await textOf(page, ".single-point")).toContain("2,4");
    await page.close();
  });
});

describe("the chart answers a pointer", () => {
  it("shows a readout when the pointer is on the dot itself", async () => {
    /*
     * The defect this guards: the visible dot was painted over its own hit
     * target, and mouseenter does not bubble — so pointing straight at a
     * measurement did nothing and only the ring of empty space around it
     * responded. Hovering by coordinate, at the centre of the mark, is exactly
     * the case that failed.
     */
    const page = await open(DESKTOP);
    await selectAnalyte(page, /Cholesterol celkový/);
    const dot = page.locator("svg circle[stroke-width]").nth(4);
    const box = (await dot.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(250);

    // textContent, not innerText: the readout is SVG, and innerText is an
    // HTMLElement property — reading it here throws rather than returning "".
    const tip = ((await page.locator(".chart-tip").first().textContent()) ?? "").trim();
    expect(tip, "no readout at the dot centre").not.toBe("");
    // Date and value, so the reader knows which draw they are pointing at.
    expect(tip).toMatch(/\d{1,2}\. \d{1,2}\. \d{4}/);
    expect(tip).toMatch(/\d,\d/);
    await page.close();
  });
});

describe("verification points at the right place", () => {
  /**
   * Where the highlight sits within the page image, 0..1 down the page.
   *
   * Both boxes are read inside one evaluate. Reading them in two round-trips
   * lets a smooth scroll move the page between them, which produces a bogus
   * ratio and a test that fails for reasons that have nothing to do with the
   * app.
   */
  async function highlightPosition(page: Page) {
    // Let any in-flight smooth scroll settle first.
    await page.waitForTimeout(700);
    return page.evaluate(() => {
      const img = document.querySelector(".srcimg img")!.getBoundingClientRect();
      const hl = document.querySelector(".srcimg .hl")!.getBoundingClientRect();
      return (hl.y - img.y) / img.height;
    });
  }

  it("frames the same row on a phone as on a desktop", async () => {
    // The bug this replaces: the highlight was positioned by scaling a bbox by
    // an image width measured once on load. On a phone the pane reorders after
    // a row is selected, so the measurement went stale and the error grew down
    // the page — clicking S_ALT framed S_AST.
    const positions: Record<string, number[]> = {};
    for (const [label, vp] of [["desktop", DESKTOP], ["mobile", MOBILE]] as const) {
      const page = await open(vp);
      await tab(page, "🔍 Ověření").click();
      await page.waitForTimeout(300);
      positions[label] = [];
      for (const row of [1, 8, 16]) {
        await page.locator("tr.row-pick").nth(row).click();
        await page.waitForTimeout(500);
        positions[label].push(await highlightPosition(page));
      }
      await page.close();
    }
    for (let i = 0; i < positions.desktop.length; i++) {
      // A stale-measurement bug shows up as drift that grows with row index,
      // so the tolerance is deliberately tight.
      expect(
        Math.abs(positions.desktop[i] - positions.mobile[i]),
        `row ${i}: desktop ${positions.desktop[i]} vs mobile ${positions.mobile[i]}`,
      ).toBeLessThan(0.01);
    }
  });

  it("keeps the highlight aligned when the image is enlarged", async () => {
    const page = await open(DESKTOP);
    await tab(page, "🔍 Ověření").click();
    await page.waitForTimeout(300);
    await page.locator("tr.row-pick").nth(4).click();
    await page.waitForTimeout(400);
    const before = await highlightPosition(page);
    await page.locator(".srcimg img").click();
    await page.waitForTimeout(600);
    expect(Math.abs((await highlightPosition(page)) - before)).toBeLessThan(0.01);
    await page.close();
  });

  it("shows a magnified crop of the selected row on a phone", async () => {
    // Without it the source rows render ~5px tall and nothing can be verified.
    const page = await open(MOBILE);
    await tab(page, "🔍 Ověření").click();
    await page.waitForTimeout(300);
    await page.locator("tr.row-pick").nth(4).click();
    await page.waitForTimeout(500);
    const crop = await page.locator(".rowzoom-img").boundingBox();
    expect(crop, "no magnified row strip").not.toBeNull();
    // It must be a crop of the real page image, not re-rendered text — a
    // re-rendered strip would verify nothing.
    const bg = await page.locator(".rowzoom-img").evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain("/demo/pages/");
    await page.close();
  });
});

describe("the highlight frames the row without covering it", () => {
  /**
   * The defect this guards: the highlight was a 2px border with a red wash
   * inside it, and box-sizing put that border on the first and last pixel row
   * of the print while the wash sat over the digits — the value it pointed at
   * was the one thing it obscured.
   *
   * Asserted structurally, because "is the number readable" is not something a
   * DOM query can answer: the box must have no fill and no border of its own,
   * and its ring must be a shadow spread, which paints outside the box.
   */
  it("paints nothing inside the highlighted box", async () => {
    const page = await open(DESKTOP);
    await tab(page, "🔍 Ověření").click();
    await page.waitForTimeout(300);
    await page.locator("tr.row-pick").nth(4).click();
    await page.waitForTimeout(500);

    const style = await page.locator(".srcimg .hl").evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        background: s.backgroundColor,
        borderTop: s.borderTopWidth,
        borderBottom: s.borderBottomWidth,
        shadow: s.boxShadow,
      };
    });
    expect(style.background, "the row must not be tinted").toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(style.borderTop, "a border is drawn inside the box").toBe("0px");
    expect(style.borderBottom, "a border is drawn inside the box").toBe("0px");
    expect(style.shadow, "the ring must be an outside shadow").not.toBe("none");
    await page.close();
  });
});

describe("the document rail", () => {
  it("clears every report and can load the demo back", async () => {
    // Without this there was no way to get the sample patient off the screen,
    // so anyone trying their own PDF mixed it into a fictional person's.
    const page = await open(DESKTOP);
    await page.getByRole("button", { name: "Odebrat všechny reporty" }).click();
    await page.getByRole("button", { name: "Ano, odebrat vše" }).click();
    await page.waitForTimeout(300);

    expect(await textOf(page, ".patient-bar")).toContain("Žádný pacient");
    expect(await page.getByRole("tab").count(), "tabs lead nowhere with no data").toBe(0);

    await page.getByRole("button", { name: "Načíst ukázková data" }).first().click();
    await page.waitForTimeout(300);
    expect(await textOf(page, ".patient-bar")).toContain("Jan Ukázka");
    await page.close();
  });

  it("gives the reading area the rail's width at every desktop size", async () => {
    // The point of collapsing is the 316px, not hiding the contents: a rail
    // merely made invisible inside its own column leaves the table exactly as
    // narrow as it was.
    //
    // Measured at more than one width on purpose. This passed at 1200 while
    // being a complete no-op at 1920 — `.main` is capped, so above ~1636px the
    // rail vanished and the table stayed exactly as wide, the content just
    // sliding left into a doubled right margin. 1920 is the clinic
    // workstation this is written for, so it is the width that mattered most
    // and the only stock viewport that did not cover it.
    for (const vp of [DESKTOP, WIDE, { width: 1920, height: 1080 }]) {
      const p2 = await open(vp);
      const t2 = p2.locator("header button.drawer-toggle");
      const b2 = (await p2.locator(".main").boundingBox())!.width;
      await t2.click();
      await p2.waitForTimeout(400);
      const a2 = (await p2.locator(".main").boundingBox())!.width;
      expect(a2 - b2, `${vp.width}px: the reading area did not gain the rail's width`).toBeGreaterThan(
        300,
      );
      await p2.close();
    }

    const page = await open(DESKTOP);
    const toggle = page.locator("header button.drawer-toggle");
    expect(await toggle.getAttribute("aria-expanded"), "the rail starts open").toBe("true");
    const before = (await page.locator(".main").boundingBox())!.width;

    await toggle.click();
    await page.waitForTimeout(400);
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
    const after = (await page.locator(".main").boundingBox())!.width;
    expect(after - before, "the reading area did not get the rail's width").toBeGreaterThan(300);
    // Out of sight is not enough: it must also be out of the tab order and the
    // accessibility tree, or a keyboard reader still walks a rail that is not
    // on the screen.
    expect(await page.locator(".sidebar").isVisible()).toBe(false);
    expect(await page.locator("#rail").evaluate((el) => getComputedStyle(el).visibility)).toBe(
      "hidden",
    );

    // The choice survives a reload — it is a display preference, like the
    // theme, not a per-visit accident.
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".patient-bar");
    expect(await page.locator("header button.drawer-toggle").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect((await page.locator(".main").boundingBox())!.width).toBeCloseTo(after, 0);

    await page.locator("header button.drawer-toggle").click();
    await page.waitForTimeout(400);
    expect((await page.locator(".main").boundingBox())!.width).toBeCloseTo(before, 0);
    await page.close();
  });

  it("does not bring a drawer back after the window has been wide", async () => {
    // `drawer` is inert while the rail is a column, so an open drawer used to
    // survive a widen and reappear — already open, over the reading area,
    // unasked for — the moment the window narrowed again. A tablet rotation
    // was enough.
    const page = await open(MOBILE);
    await page.locator("header button.drawer-toggle").click();
    await page.waitForTimeout(300);
    expect(await page.locator(".sidebar.open").count(), "setup: drawer open").toBe(1);

    await page.setViewportSize(DESKTOP);
    await page.waitForTimeout(300);
    await page.setViewportSize(MOBILE);
    await page.waitForTimeout(400);

    expect(await page.locator(".sidebar.open").count(), "a drawer opened itself").toBe(0);
    expect(await page.locator(".scrim.open").count(), "a scrim with nothing behind it").toBe(0);
    expect(await page.locator("header button.drawer-toggle").getAttribute("aria-expanded")).toBe(
      "false",
    );
    await page.close();
  });

  it("still opens as a drawer on a phone, whatever the desktop was left as", async () => {
    // The two states are separate on purpose. A rail collapsed on a desktop
    // must not arrive on a phone as a drawer that refuses to open, and the
    // drawer must not come back as a collapsed desktop column.
    const page = await open(MOBILE);
    await page.evaluate(() => localStorage.setItem("bloodwork-rail", "collapsed"));
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".patient-bar");

    const toggle = page.locator("header button.drawer-toggle");
    expect(await toggle.getAttribute("aria-expanded"), "a phone starts with the drawer shut").toBe(
      "false",
    );
    await toggle.click();
    await page.waitForTimeout(400);
    expect(await page.locator(".sidebar.open").count(), "the drawer never opened").toBe(1);
    expect(await page.locator(".sidebar").isVisible()).toBe(true);
    expect(await toggle.getAttribute("aria-expanded")).toBe("true");

    // Escape still closes it, and still only it.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    expect(await page.locator(".sidebar.open").count()).toBe(0);
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
    await page.close();
  });

  it("keeps upload and the report list off the reading area", async () => {
    // They used to sit at the bottom of every tab, several thousand pixels
    // below the charts.
    const page = await open(DESKTOP);
    const railBox = await page.locator(".sidebar").boundingBox();
    const mainBox = await page.locator(".main").boundingBox();
    expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(mainBox!.x + 1);
    // The upload control itself is behind a challenge that may not have
    // rendered yet, so the invariant is asserted on what is always there: the
    // rail lists the loaded documents, and the reading area lists none of it.
    expect(await page.locator(".sidebar .reportlist li").count()).toBe(10);
    expect(await page.locator(".main .reportlist").count()).toBe(0);
    // Visible matches only. Every tab panel is mounted now, so a plain text
    // match also reads the hidden ones — and the chat's locked message says
    // "…v levém panelu Nahrát PDF", which is a pointer *to* the rail, not a
    // copy of it in the reading area. Same distinction the auditor draws with
    // checkVisibility().
    expect(
      await page.locator(".main").getByText("Nahrát PDF").filter({ visible: true }).count(),
    ).toBe(0);
    // The structural form of the same invariant, which prose cannot break.
    expect(await page.locator(".main .drop").count()).toBe(0);
    await page.close();
  });
});

describe("the summary points back at the source", () => {
  it("opens verification on the row an analyte was read from", async () => {
    const page = await open(DESKTOP);
    await tab(page, "📝 Souhrn změn").click();
    await page.waitForTimeout(300);
    await page.locator(".sum-row").first().click();
    await page.waitForTimeout(600);

    expect(await tab(page, "🔍 Ověření").getAttribute("aria-selected")).toBe("true");
    expect(await page.locator("tr.row-pick[aria-selected=true]").count()).toBe(1);
    expect(await page.locator(".srcimg .hl").count(), "no row framed on the page").toBe(1);
    await page.close();
  });
});

describe("a correction re-derives everything", () => {
  it("updates the flag, the review count and the chart", async () => {
    const page = await open(DESKTOP);
    await tab(page, "🔍 Ověření").click();
    await page.waitForTimeout(300);

    const countBefore = await page.locator("label", { hasText: "jen řádky k ověření" }).innerText();

    // Correct the deliberately misread glucose on the second report.
    await page.selectOption("#report", { index: 1 });
    await page.waitForTimeout(300);
    await page.locator("tr.row-pick").first().click();
    await page.waitForTimeout(300);
    await page.locator('input[aria-label="Opravit hodnotu"]').fill("4,45");
    await page.getByRole("button", { name: "Opravit" }).click();
    await page.waitForTimeout(400);

    const countAfter = await page.locator("label", { hasText: "jen řádky k ověření" }).innerText();
    expect(countAfter, "review count should drop after a correction").not.toBe(countBefore);

    // The withheld point must rejoin the series.
    await tab(page, "📈 Trendy").click();
    await selectAnalyte(page, /Glukóza/);
    expect(await page.locator(".held-back").count()).toBe(0);
    await page.close();
  });

  it("restores the original reading, and its warning, on undo", async () => {
    // Undo used to restore only the value, leaving a disputed row looking
    // clean and dropping it out of the review list.
    const page = await open(DESKTOP);
    await tab(page, "🔍 Ověření").click();
    await page.waitForTimeout(300);
    await page.locator("tr.row-pick").nth(4).click();
    await page.waitForTimeout(300);

    const chipBefore = await page.locator("tr[aria-selected=true] .chip").first().innerText();
    await page.locator('input[aria-label="Opravit hodnotu"]').fill("0,70");
    await page.getByRole("button", { name: "Opravit" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /Vrátit původní/ }).click();
    await page.waitForTimeout(400);

    expect(await page.locator("tr[aria-selected=true] .chip").first().innerText()).toBe(chipBefore);
    await page.close();
  });
});

describe("mapping leads with the decision", () => {
  const openMapping = async () => {
    const page = await open(DESKTOP);
    await tab(page, "🗂️ Přiřazení názvů").click();
    await page.waitForTimeout(400);
    return page;
  };

  const cardFor = (page: Page, rawName: string) =>
    page.locator(".map-card", { hasText: rawName }).first();

  it("shows where an unmapped value came from and what it would join", async () => {
    const page = await openMapping();
    const card = cardFor(page, "S_Homocystein tot.");
    expect(await card.locator(".cand-card.featured").innerText()).toContain("Homocystein");

    // Provenance is one click away rather than in front of the decision.
    await card.locator(".occ-details > summary").click();
    await page.waitForTimeout(250);
    const occ = await card.locator("table.occ").innerText();
    expect(occ).toContain("8. 2. 2022");
    expect(occ).toContain("10,6");
    await page.close();
  });

  it("shows the reference interval it ranked on", async () => {
    // The strongest signal in the scorer, and for a long time the only one
    // the screen did not render: the reader saw the ranking but not the
    // comparison it leaned on hardest.
    const page = await openMapping();
    const sig = cardFor(page, "S_Homocystein tot.").locator(".cand-card.featured .sig", {
      hasText: "Referenční rozmezí",
    });
    expect(await sig.count(), "no reference-interval row").toBe(1);
    expect(await sig.innerText()).toContain("5–15");
    expect(await sig.getAttribute("class")).toContain("sig-ok");
    await page.close();
  });

  it("refuses to promote a candidate the evidence contradicts", async () => {
    // U_Bílkovina is a urine protein; every candidate is a serum analyte with
    // a different unit. Promoting the least-bad of them put a filled accept
    // button on a mapping the algorithm had already rejected.
    const page = await openMapping();
    const card = cardFor(page, "U_Bílkovina");
    expect(await card.locator(".cand-card.featured").count(), "a contradicted candidate was promoted").toBe(0);
    expect(await card.locator(".no-lead").innerText()).toContain("Žádný návrh neobstál");

    // Still reachable, still marked, and the accept button is the quiet one.
    await card.getByRole("button", { name: /Další návrhy/ }).click();
    await page.waitForTimeout(250);
    const bad = card.locator(".cand-card.implausible").first();
    expect(await bad.count()).toBeGreaterThan(0);
    expect(await bad.innerText()).toContain("nedoporučujeme");
    const btn = bad.getByRole("button", { name: /Přiřadit/ });
    expect(await btn.innerText()).toContain("přesto");
    expect(await btn.getAttribute("class"), "the warned-against button must not be the accent one")
      .not.toContain("primary");
    await page.close();
  });

  it("can reach an analyte the suggester never offered", async () => {
    // The only options used to be the top three guesses. When the right
    // analyte was not among them there was no way to say so.
    const page = await openMapping();
    const card = cardFor(page, "U_Bílkovina");
    await card.getByRole("button", { name: "Vybrat jiný analyt…" }).click();
    await page.waitForTimeout(250);
    await page.getByLabel("Hledat analyt").fill("ferrit");
    await page.waitForTimeout(200);
    const item = page.locator(".picker-item", { hasText: "Ferritin" }).first();
    expect(await item.count(), "the full registry is not reachable").toBe(1);
    await item.click();
    await page.waitForTimeout(400);

    expect(await textOf(page, ".undo-banner")).toContain("Ferritin");
    expect(await page.locator(".map-card", { hasText: "U_Bílkovina" }).count()).toBe(0);
    await page.close();
  });

  it("puts an accepted mapping back on one click", async () => {
    // Accepting merges one analyte's history into another's, where it then
    // looks like it always belonged. Without a way back a misclick is
    // permanent for the session and invisible afterwards.
    const page = await openMapping();
    await cardFor(page, "S_Homocystein tot.")
      .locator(".cand-card.featured")
      .getByRole("button", { name: "Přiřadit" })
      .click();
    await page.waitForTimeout(400);
    expect(await page.locator(".map-card", { hasText: "S_Homocystein tot." }).count()).toBe(0);

    await page.getByRole("button", { name: "Vrátit zpět" }).click();
    await page.waitForTimeout(400);
    expect(
      await page.locator(".map-card", { hasText: "S_Homocystein tot." }).count(),
      "undo did not bring the analyte back",
    ).toBe(1);
    await page.close();
  });

  it("counts what is left to decide", async () => {
    const page = await openMapping();
    expect(await textOf(page, ".count-chip")).toContain("2");
    await cardFor(page, "U_Bílkovina").getByRole("button", { name: "Nechat nepřiřazené" }).click();
    await page.waitForTimeout(300);
    expect(await textOf(page, ".count-chip")).toContain("1");
    // innerText returns the text-transform: uppercase form of a section title.
    expect((await textOf(page, ".held-card summary")).toLowerCase()).toContain(
      "ponechané bez přiřazení (1)",
    );
    await page.close();
  });
});

/**
 * Changing tabs must not throw away what the reader has built up.
 *
 * Every panel used to be rendered as `tab === x && <Panel/>`, so switching
 * unmounted the previous one and took its state with it — the charts you had
 * opened, the conversation you were having, a correction typed but not saved.
 * The panels now stay mounted and are hidden instead.
 */
describe("work survives a tab switch", () => {
  it("keeps the opened charts when you leave the tab and come back", async () => {
    const page = await open(DESKTOP);
    await selectAnalyte(page, /Cholesterol celkový/);
    await selectAnalyte(page, /ALT/);
    expect(await page.locator(".trend-card").count(), "setup").toBe(2);

    for (const name of ["💬 Zeptat se", "🔍 Ověření", "📝 Souhrn změn"]) {
      await tab(page, name).click();
      await page.waitForTimeout(200);
    }
    await tab(page, "📈 Trendy").click();
    await page.waitForTimeout(300);

    expect(
      await page.locator(".trend-card").count(),
      "the charts were discarded by switching tabs",
    ).toBe(2);
    await page.close();
  });

  it("keeps them when a rail click jumps to verification", async () => {
    // Opening a report from the rail force-switches to Ověření, which used to
    // wipe the trends tab as a side effect of showing a source page.
    const page = await open(DESKTOP);
    await selectAnalyte(page, /Cholesterol celkový/);
    expect(await page.locator(".trend-card").count(), "setup").toBe(1);

    await page.locator(".reportlist .rl-main").first().click();
    await page.waitForTimeout(300);
    expect(await tab(page, "🔍 Ověření").getAttribute("aria-selected")).toBe("true");

    await tab(page, "📈 Trendy").click();
    await page.waitForTimeout(300);
    expect(await page.locator(".trend-card").count(), "rail click discarded the charts").toBe(1);
    await page.close();
  });

  it("hides the inactive panels rather than leaving them on screen", async () => {
    // The flip side: five mounted panels must not stack. `hidden` has to win
    // over anything the stylesheet says about display.
    const page = await open(DESKTOP);
    const visible = await page.evaluate(() =>
      [...document.querySelectorAll('[role="tabpanel"]')].filter((el) =>
        (el as HTMLElement).checkVisibility(),
      ).length,
    );
    expect(visible, "exactly one panel should be visible").toBe(1);
    await page.close();
  });
});
