/**
 * The upload flow, end to end, in a real browser and for nothing.
 *
 *   npm run test:upload
 *
 * `/api/extract`, `/api/session` and `/api/status` are stubbed, and the
 * Turnstile widget is replaced by a script that solves itself, so this suite
 * needs no key, no network and no money. What it does need is a bundle with a
 * site key baked in — without `VITE_TURNSTILE_SITE_KEY` the panel renders
 * "Nahrávání vlastních PDF není v této ukázce zapnuté" and there is nothing to
 * test — which is why the npm script builds its own.
 *
 * Three things are worth a browser, and nothing short of one proves them:
 *
 *  1. **A PDF takes the text path.** No page image leaves the tab; the request
 *     carries `rowsText` and the rows land in Ověření.
 *  2. **A photograph takes the image path**, as one page, at the long edge the
 *     resolution measurement settled on — and the JPEG's own header is read
 *     back out of the request to check it, because `photo.ts`'s unit tests can
 *     pin every pure function it owns and still not prove that a canvas ever
 *     ran.
 *  3. **A page read by one reader shows no confirmed row.** This is not a
 *     hypothetical: the app shipped it. `reconcile()` saw one read, found
 *     nothing to disagree with, and presented every row as cross-checked —
 *     which is the single most misleading thing this product can do, because
 *     "two independent readers agreed" is the whole claim. It is caught by
 *     `readersAttempted`, and this is the only test that watches it reach the
 *     screen.
 *
 * And one that is not about correctness but about not looking broken: HEIC.
 * Chrome cannot decode it, so an iPhone photo must fail *by name, with a
 * reason*, rather than vanishing.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page, Route } from "playwright";
import { MOBILE, DESKTOP, errorsOn, startApp, type Harness } from "./lib/harness";
import { heic, jpegSize, png } from "./lib/imageFixtures";

let app: Harness;

beforeAll(async () => {
  app = await startApp(Number(process.env.UPLOAD_PORT ?? 4302));
}, 180_000);

afterAll(async () => {
  await app?.stop();
});

const FIXTURES = "packages/lab-core/tests/fixtures";

/**
 * The digital-PDF fixture, and it is not `standard.pdf`.
 *
 * `pageAssets` routes to the text path only when the page carries at least 20
 * text runs clustering into 5 rows, and the smaller fixtures do not — dropping
 * `standard.pdf` in sends a page image, correctly. `slovak_grouped.pdf` is the
 * densest committed fixture and is unambiguously a digital sheet.
 */
const PDF = `${FIXTURES}/slovak_grouped.pdf`;

/* ------------------------------------------------------------- the stubs */

/** One page's worth of what a reader returns, in the Worker's `reads` shape. */
const read = (model: string, rows: Array<[string, string, string]>) => ({
  model,
  report_date: "2024-05-06",
  lab_name: "Zkušební laboratoř",
  measurements: rows.map(([name, value, unit], i) => ({
    raw_analyte_name: name,
    value_raw: value,
    unit_raw: unit,
    ref_range_raw: null,
    row_index: i,
    source_snippet: `${name} ${value} ${unit}`,
  })),
});

/**
 * Rows the fixture actually prints. They have to be: on the text path a value
 * that appears nowhere on the page is a fabrication, and the panel flags it —
 * which would put a review chip on every row and quietly void the assertions
 * below about which rows carry one.
 */
const ROWS: Array<[string, string, string]> = [
  ["Glukóza", "5,10", "mmol/l"],
  ["Kreatinín", "82", "µmol/l"],
];

interface Seen {
  imageBase64?: string;
  mediaType?: string;
  rowsText?: string | null;
  textLayer?: string | null;
}

/**
 * Answer the three API routes the app calls, and record every extract request.
 *
 * `readers` decides how many reads come back while `readersAttempted` stays at
 * two — which is exactly how a failed second read reaches the client.
 */
function stub(opts: { readers: 1 | 2 }) {
  const requests: Seen[] = [];
  const install = async (page: Page) => {
    // Stand in for the Turnstile widget rather than loading Cloudflare's
    // script: `useTurnstile` renders through `window.turnstile` if it is
    // already there, so the challenge never reaches the network.
    await page.addInitScript(() => {
      (window as any).turnstile = {
        render: (_el: HTMLElement, o: any) => setTimeout(() => o.callback("e2e-token"), 0),
      };
    });
    await page.route("**/api/session", (r: Route) =>
      r.fulfill({ json: { session: "e2e-session", maxPages: 12, ttlSeconds: 3600 } }),
    );
    await page.route("**/api/status*", (r: Route) =>
      r.fulfill({
        json: {
          budget: { spentUsd: 0, budgetUsd: 10, frozen: false, remainingUsd: 10 },
          maxPages: 12,
          crossCheck: true,
        },
      }),
    );
    await page.route("**/api/extract", async (r: Route) => {
      const body = r.request().postDataJSON() as Seen;
      requests.push(body);
      const reads = [read("sonnet", ROWS), read("gemini", ROWS)].slice(0, opts.readers);
      await r.fulfill({
        json: {
          reads,
          // The number *asked*, not the number that answered. This is the
          // field the single-reader defect turned on.
          readersAttempted: 2,
          mode: body.rowsText ? "text" : "vision",
          readers: "sonnet+gemini",
          costUsd: 0,
          budget: { spentUsd: 0, budgetUsd: 10, frozen: false, remainingUsd: 10 },
        },
      });
    });
  };
  return { install, requests };
}

/**
 * Open the app with the stubs in place and the challenge already solved.
 *
 * `attached`, not `visible`: on a phone the document rail is a drawer and the
 * drop target is off-screen until it is opened. A file input does not need to
 * be visible to receive files — and neither does a real drag-and-drop — so the
 * upload flow is testable at a phone width without first driving the drawer.
 */
async function openReady(viewport: { width: number; height: number }, s: ReturnType<typeof stub>) {
  const page = await app.open(viewport, { prepare: s.install });
  await page.waitForSelector("label.drop", { state: "attached", timeout: 15_000 });
  return page;
}

/** The verification tab, showing the report that was just uploaded rather than
 *  whichever demo report the picker defaulted to. */
async function openUploaded(page: Page) {
  await page.getByRole("tab", { name: /Ověření/ }).click();
  const id = await page
    .locator("#report option")
    .evaluateAll((os) => (os as HTMLOptionElement[]).find((o) => o.value.startsWith("upload-"))?.value ?? "");
  expect(id, "the uploaded report never reached the report picker").toBeTruthy();
  await page.selectOption("#report", id);
  return page.locator(".verify .table-pane table tbody");
}

/** Hand files to the picker. `accept` does not gate `setInputFiles`, which is
 *  the point: the browser will pass a HEIC through drag and drop too. */
async function pick(
  page: Page,
  files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
  selector = "label.drop input[type=file]",
) {
  await page.setInputFiles(selector, files);
}

/** Wait until every queued file has stopped moving. */
async function settled(page: Page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll("li.job").length > 0 &&
      document.querySelectorAll("li.job.queued, li.job.running").length === 0,
    undefined,
    { timeout: 30_000 },
  );
}

/* ----------------------------------------------------------------- tests */

describe("a digital PDF", () => {
  it("is read from its own text, and never sends a page image", async () => {
    const s = stub({ readers: 2 });
    const page = await openReady(DESKTOP, s);

    await pick(page, [
      { name: "slovak_grouped.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) },
    ]);
    await settled(page);

    expect(await page.locator("li.job.done").count()).toBe(1);
    expect(s.requests).toHaveLength(1);
    // The privacy claim, as a test: the characters came from the file, so the
    // page image stayed in the tab.
    expect(s.requests[0].rowsText).toBeTruthy();
    expect(s.requests[0].imageBase64).toBeFalsy();

    const table = await openUploaded(page);
    expect(await table.locator("tr").count()).toBe(ROWS.length);
    expect(await table.innerText()).toContain("Glukóza");
    // Two readers agreed and both values are printed, so nothing is asking for
    // review — which is what makes the single-reader case below mean something.
    expect(await table.locator(".chip.alert").count()).toBe(0);

    expect(errorsOn(page)).toEqual([]);
    await page.close();
  });
});

describe("a photograph", () => {
  it("is one page on the image path, downscaled to the long edge we measured", async () => {
    const s = stub({ readers: 2 });
    // The phone width, because this is the surface a photograph arrives from.
    const page = await openReady(MOBILE, s);

    await pick(page, [
      { name: "sheet.png", mimeType: "image/png", buffer: png(3000, 4000) },
    ]);
    await settled(page);

    expect(await page.locator("li.job.done").count()).toBe(1);
    // A photo is one page. Not two, and not one per anything.
    expect(s.requests).toHaveLength(1);
    const sent = s.requests[0];
    expect(sent.rowsText).toBeFalsy();
    expect(sent.mediaType).toBe("image/jpeg");
    expect(sent.imageBase64).toBeTruthy();

    // One encode, at 2576 px — the decision docs/lab-adaptability.md's
    // resolution measurement settled, read back out of the bytes that were
    // actually sent rather than trusted from the constant.
    const jpeg = Buffer.from(sent.imageBase64!, "base64");
    const { width, height } = jpegSize(jpeg);
    expect(Math.max(width, height)).toBe(2576);
    // Aspect kept: 3000x4000 is 3:4.
    expect(width / height).toBeCloseTo(0.75, 2);
    // And there is no second, full-resolution encode riding along.
    expect((sent as any).imageFullBase64).toBeUndefined();

    const table = await openUploaded(page);
    expect(await table.innerText()).toContain("Glukóza");

    expect(errorsOn(page)).toEqual([]);
    await page.close();
  });

  it("offers the rear camera on a phone, and on nothing else", async () => {
    const s = stub({ readers: 2 });
    // A touch context, because `.shoot` is revealed by `(pointer: coarse)` and
    // a desktop page would never see the rule.
    const page = await app.open(MOBILE, { prepare: s.install, context: { hasTouch: true, isMobile: true } });
    await page.waitForSelector("label.drop", { state: "attached", timeout: 15_000 });

    // The drawer holds the upload panel on a phone.
    if (!(await page.locator("label.drop").isVisible())) {
      await page.locator("button.drawer-toggle").first().click();
    }
    const camera = page.locator("label.shoot");
    await expect.poll(() => camera.isVisible()).toBe(true);
    const input = camera.locator("input[type=file]");
    expect(await input.getAttribute("capture")).toBe("environment");
    expect(await input.getAttribute("accept")).toBe("image/*");
    // One frame, so no `multiple`.
    expect(await input.getAttribute("multiple")).toBeNull();

    // And the picker beside it now takes photographs as well as PDFs.
    const accept = await page.getAttribute("label.drop input[type=file]", "accept");
    expect(accept).toContain("application/pdf");
    expect(accept).toContain("image/jpeg");
    expect(accept).toContain("image/heic");
    await page.close();
  });

  it("hides the camera where `capture` would do nothing", async () => {
    const s = stub({ readers: 2 });
    const page = await openReady(DESKTOP, s);
    // Present in the markup, out of the layout and out of the tab order.
    expect(await page.locator("label.shoot").count()).toBe(1);
    expect(await page.locator("label.shoot").isVisible()).toBe(false);
    await page.close();
  });
});

describe("a page only one reader answered for", () => {
  /**
   * The defect this project shipped once. Both stubs return the same rows;
   * only the *count* of reads differs, and that alone must turn every row from
   * confirmed into unconfirmed.
   */
  it("shows every row as unconfirmed, and spends no page image on the claim", async () => {
    const s = stub({ readers: 1 });
    const page = await openReady(DESKTOP, s);

    await pick(page, [
      { name: "slovak_grouped.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) },
    ]);
    await settled(page);

    const table = await openUploaded(page);
    expect(await table.locator("tr").count()).toBe(ROWS.length);
    // Every row, not merely one of them.
    expect(await table.locator("tr .chip.alert").count()).toBe(ROWS.length);
    expect(await table.innerText()).toContain("nepotvrzeno");

    expect(errorsOn(page)).toEqual([]);
    await page.close();
  });
});

describe("HEIC, which this browser cannot decode", () => {
  it("fails by name with a sentence naming JPEG, rather than silently", async () => {
    const s = stub({ readers: 2 });
    const page = await openReady(MOBILE, s);

    await pick(page, [{ name: "IMG_0042.HEIC", mimeType: "image/heic", buffer: heic() }]);
    await settled(page);

    const job = page.locator("li.job.failed");
    await expect.poll(() => job.count()).toBe(1);
    // `textContent`, because on a phone this list lives inside the closed
    // drawer and `innerText` reports nothing for an element with no layout.
    const text = (await job.textContent()) ?? "";
    expect(text).toContain("IMG_0042.HEIC");
    expect(text).toContain("HEIC");
    expect(text).toContain("JPEG");
    // Nothing was sent, so no page of the allowance was spent on it.
    expect(s.requests).toHaveLength(0);

    expect(errorsOn(page)).toEqual([]);
    await page.close();
  });
});
