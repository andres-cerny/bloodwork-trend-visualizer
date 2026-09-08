/**
 * A photograph through Moje krev's upload, in a real browser and for nothing.
 *
 *   npm run test:upload:portal
 *
 * The account is faked by `lib/portalHarness.ts`; `/api/extract` and the two
 * write routes are stubbed here, so this needs no key, no network and no money.
 *
 * What only a browser can prove, and what this suite exists for:
 *
 *  1. **A photograph reaches the redaction review through the scan door.**
 *     Moje krev's whole promise is that a name and a rodné číslo are painted
 *     out before anything leaves the tab, and it finds them in the text layer.
 *     A photograph has none, so the honest thing is to say nothing was found
 *     *because nothing could be looked at* and hand the reader the pencil. The
 *     failure this pins is the quiet one: an empty `hits` rendered with the
 *     ordinary caption reads as "we looked, your page is clean", over a picture
 *     in which the header is perfectly legible.
 *  2. **It cannot be sent without the reader passing that step.** Cancelling
 *     the review sends nothing at all — no page image, no rows, no allowance
 *     spent — and the file is logged as skipped.
 *  3. **The two inputs.** `capture="environment"` opens the camera and, on
 *     several browsers, removes the gallery entirely, so one input cannot serve
 *     both. The camera is revealed by `(pointer: coarse)`, which means a touch
 *     context must show it and a desktop must not — a rule no unit test can
 *     see, because it lives in a media query.
 *  4. **A photograph is one page, at the long edge the resolution measurement
 *     settled on**, read back out of the JPEG that was actually sent.
 *
 * And one that is not about correctness but about not looking broken: HEIC.
 * Chrome cannot decode it, so an iPhone photo must fail by name, with a reason.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page, Route } from "playwright";
import { DESKTOP, MOBILE, errorsOn, type Harness } from "./lib/harness";
import { heic, jpegSize, png } from "./lib/imageFixtures";
import { startPortal } from "./lib/portalHarness";

let app: Harness;

beforeAll(async () => {
  app = await startPortal(Number(process.env.UPLOAD_PORTAL_PORT ?? 4304));
}, 180_000);

afterAll(async () => {
  await app?.stop();
});

/* ------------------------------------------------------------- the stubs */

const BUDGET = { spentUsd: 0.12, budgetUsd: 5, frozen: false, remainingUsd: 4.88, month: "2026-08" };

/** One page's worth of what a reader returns, in the Worker's `reads` shape. */
const read = (model: string) => ({
  model,
  report_date: "2024-05-06",
  lab_name: "Zkušební laboratoř",
  measurements: [
    { raw_analyte_name: "Glukóza", value_raw: "5,10", unit_raw: "mmol/l", ref_range_raw: null, row_index: 0, source_snippet: "Glukóza 5,10 mmol/l" },
  ],
});

interface Seen {
  imageBase64?: string;
  mediaType?: string;
  rowsText?: string | null;
}

/**
 * Answer the extractor and the two write routes, and record every extract
 * request — the recording is the assertion, because "nothing left the browser"
 * is a claim about requests that were never made.
 */
function stub() {
  const requests: Seen[] = [];
  const install = async (page: Page) => {
    await page.route("**/api/extract", async (r: Route) => {
      requests.push(JSON.parse(r.request().postData() ?? "{}") as Seen);
      await r.fulfill({ json: { reads: [read("sonnet"), read("gemini")], mode: "vision", readersAttempted: 2, costUsd: 0.004, budget: BUDGET } });
    });
    // A stored page answers with the route its image will be served from;
    // the fake account API acknowledges writes but does not mint one.
    await page.route("**/api/reports/*/*", (r: Route) =>
      r.fulfill({ json: { ok: true, imageUrl: "/api/pages/stored/1" } }),
    );
    await page.route("**/api/reports/*", (r: Route) =>
      r.request().method() === "PUT" ? r.fulfill({ json: { ok: true } }) : r.fallback(),
    );
  };
  return { requests, install };
}

/** The upload card lives on Reporty; the review replaces it in place. */
async function openUpload(viewport: { width: number; height: number }, s: ReturnType<typeof stub>, touch = false) {
  const page = await app.open(viewport, { prepare: s.install, context: touch ? { hasTouch: true, isMobile: true } : undefined });
  await page.getByRole("tab", { name: "Reporty", exact: true }).click();
  await page.waitForSelector("label.drop", { state: "attached", timeout: 15_000 });
  return page;
}

/** Hand files to a picker. `accept` does not gate `setInputFiles`, which is the
 *  point: a phone's file browser passes a HEIC through whatever it says. */
const pick = (page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>, selector = "label.drop input[type=file]") =>
  page.setInputFiles(selector, files);

const shot = (name = "IMG_0042.jpg") => ({ name, mimeType: "image/jpeg", buffer: png(3000, 4000) });

/** A born-digital sheet with a printed header, so the detector has something
 *  to find — the other half of the mixed selection below. */
const PDF = join(import.meta.dirname, "../../packages/lab-core/tests/fixtures/identity.pdf");
const sheet = () => ({ name: "vysledky.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });

/* ----------------------------------------------------------------- tests */

describe("a photograph at the redaction review", () => {
  it("is presented as found-nothing-because-nothing-to-look-at, and nothing has been sent", async () => {
    const s = stub();
    const page = await openUpload(MOBILE, s, true);

    await pick(page, [shot()]);
    await page.waitForSelector(".review-canvas img", { timeout: 20_000 });

    // The screen names what it is looking at, and it is not a sken.
    const caption = (await page.locator(".review-page figcaption").first().textContent()) ?? "";
    expect(caption).toContain("Fotografie");
    expect(caption).toContain("nic nenalezeno");
    expect(caption).toContain("začerněte ručně");
    expect(caption.toLowerCase()).not.toContain("sken");

    // No box was found, and none is claimed: nothing to dismiss, and the
    // drawing tool is already on because drawing is the only way to redact it.
    expect(await page.getByRole("button", { name: /^Začerněné pole/ }).count()).toBe(0);
    expect(await page.locator('button[aria-pressed="true"]').first().textContent()).toBe("Hotovo");

    // The reader has not confirmed, so the picture is still in the tab.
    expect(s.requests).toHaveLength(0);

    expect(errorsOn(page)).toEqual([]);
    await page.close();
  });

  it("cannot be sent by cancelling the look — no image, no rows, no page spent", async () => {
    const s = stub();
    const page = await openUpload(MOBILE, s, true);

    await pick(page, [shot()]);
    await page.waitForSelector(".review-canvas img", { timeout: 20_000 });
    await page.getByRole("button", { name: "Zrušit" }).click();

    await page.waitForSelector("li.job.skipped", { timeout: 10_000 });
    expect(s.requests).toHaveLength(0);
    // And the review is gone rather than merely hidden behind the queue.
    expect(await page.locator(".review-canvas").count()).toBe(0);

    expect(errorsOn(page)).toEqual([]);
    await page.close();
  });

  it("goes on the image path once confirmed, one page, at the long edge we measured", async () => {
    const s = stub();
    const page = await openUpload(MOBILE, s, true);

    await pick(page, [shot()]);
    await page.waitForSelector(".review-canvas img", { timeout: 20_000 });
    await page.getByRole("button", { name: "Ano, nahrát" }).click();

    await page.waitForSelector("li.job.done", { timeout: 30_000 });
    // One page. Not two, and not one per anything.
    expect(s.requests).toHaveLength(1);
    const sent = s.requests[0];
    expect(sent.rowsText).toBeFalsy();
    expect(sent.mediaType).toBe("image/jpeg");
    expect(sent.imageBase64).toBeTruthy();

    const { width, height } = jpegSize(Buffer.from(sent.imageBase64!, "base64"));
    expect(Math.max(width, height)).toBe(2576);
    expect(width / height).toBeCloseTo(0.75, 2);

    // And the note says what it costs the reader: no printed text to check
    // the numbers against, so they are checked by eye or not at all.
    const note = (await page.locator("li.job.done").textContent()) ?? "";
    expect(note).toContain("Fotografie nemá textovou vrstvu");
    expect(note).not.toContain("(sken)");

    expect(errorsOn(page)).toEqual([]);
    await page.close();
  });

  it("takes several at once, each through its own look", async () => {
    const s = stub();
    const page = await openUpload(MOBILE, s, true);

    await pick(page, [shot("IMG_0042.jpg"), shot("IMG_0043.jpg")]);
    await page.waitForSelector(".review-canvas img", { timeout: 20_000 });
    expect(await page.locator(".review .sub").first().textContent()).toContain("IMG_0042.jpg");
    await page.getByRole("button", { name: "Ano, nahrát" }).click();

    // The second opens its own review rather than riding on the first's.
    await page.waitForSelector(".review-canvas img", { timeout: 20_000 });
    await expect
      .poll(async () => (await page.locator(".review .sub").first().textContent()) ?? "", { timeout: 20_000 })
      .toContain("IMG_0043.jpg");
    await page.getByRole("button", { name: "Ano, nahrát" }).click();

    await expect.poll(() => page.locator("li.job.done").count(), { timeout: 30_000 }).toBe(2);
    expect(s.requests).toHaveLength(2);

    expect(errorsOn(page)).toEqual([]);
    await page.close();
  });
});

describe("a selection of both kinds at once", () => {
  /**
   * The two doors, side by side in one queue. A PDF's header is found and
   * boxed; a photograph's is not found at all and the reader is told so. Both
   * of those are correct, and the only way to see that the app tells them
   * apart is to hand it one of each in a single pick.
   */
  it("gives the PDF found boxes and the photograph the pencil", async () => {
    const s = stub();
    const page = await openUpload(MOBILE, s, true);

    await pick(page, [sheet(), shot()]);
    await page.waitForSelector(".review-canvas img", { timeout: 30_000 });

    // The PDF first, in the order they were picked: boxes found, and the
    // caption claims nothing about a missing text layer.
    await expect.poll(() => page.getByRole("button", { name: /^Začerněné pole/ }).count(), { timeout: 20_000 }).toBeGreaterThan(0);
    let caption = (await page.locator(".review-page figcaption").first().textContent()) ?? "";
    expect(caption).toContain("Strana 1");
    expect(caption).not.toContain("nic nenalezeno");
    await page.getByRole("button", { name: "Ano, nahrát" }).click();

    // Then the photograph, on the other branch entirely.
    await expect
      .poll(async () => (await page.locator(".review .sub").first().textContent()) ?? "", { timeout: 30_000 })
      .toContain("IMG_0042.jpg");
    caption = (await page.locator(".review-page figcaption").first().textContent()) ?? "";
    expect(caption).toContain("Fotografie");
    expect(caption).toContain("nic nenalezeno");
    expect(await page.getByRole("button", { name: /^Začerněné pole/ }).count()).toBe(0);
    await page.getByRole("button", { name: "Ano, nahrát" }).click();

    await expect.poll(() => page.locator("li.job.done").count(), { timeout: 40_000 }).toBe(2);
    // The PDF went by its printed rows, the photograph by its pixels — one
    // page each, and neither took the other's path.
    expect(s.requests).toHaveLength(2);
    expect(s.requests.filter((r) => r.rowsText)).toHaveLength(1);
    expect(s.requests.filter((r) => r.imageBase64)).toHaveLength(1);

    expect(errorsOn(page)).toEqual([]);
    await page.close();
  });
});

describe("the two inputs", () => {
  it("offers the rear camera on a phone, beside a picker that does not open one", async () => {
    const s = stub();
    // A touch context, because `.shoot` is revealed by `(pointer: coarse)` and
    // a desktop page would never see the rule.
    const page = await openUpload(MOBILE, s, true);

    const camera = page.locator("label.shoot");
    await expect.poll(() => camera.isVisible()).toBe(true);
    const shoot = camera.locator("input[type=file]");
    expect(await shoot.getAttribute("capture")).toBe("environment");
    expect(await shoot.getAttribute("accept")).toBe("image/*");
    // One frame, so no `multiple`.
    expect(await shoot.getAttribute("multiple")).toBeNull();
    // It is a target for a thumb, and the layout audit never sees it — the
    // audit runs without touch, so the media query hiding it is always true
    // there and this is the only place its size is looked at.
    const box = await camera.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(24);

    // The other half: the photo library and the file browser, and no
    // viewfinder — which is what the absence of `capture` buys.
    const picker = page.locator("label.drop input[type=file]");
    expect(await picker.getAttribute("capture")).toBeNull();
    expect(await picker.getAttribute("multiple")).not.toBeNull();
    const accept = (await picker.getAttribute("accept")) ?? "";
    expect(accept).toContain("application/pdf");
    expect(accept).toContain("image/jpeg");
    expect(accept).toContain("image/png");
    expect(accept).toContain("image/heic");

    await page.close();
  });

  it("hides the camera where `capture` would do nothing", async () => {
    const s = stub();
    const page = await openUpload(DESKTOP, s);
    // Present in the markup, out of the layout and out of the tab order —
    // a dead button that opens a file dialog labelled as a camera is worse
    // than no button.
    expect(await page.locator("label.shoot").count()).toBe(1);
    expect(await page.locator("label.shoot").isVisible()).toBe(false);
    await page.close();
  });
});

describe("HEIC, which this browser cannot decode", () => {
  it("fails by name with a sentence naming JPEG, rather than silently", async () => {
    const s = stub();
    const page = await openUpload(MOBILE, s, true);

    await pick(page, [{ name: "IMG_0099.HEIC", mimeType: "image/heic", buffer: heic() }]);

    const job = page.locator("li.job.failed");
    await expect.poll(() => job.count(), { timeout: 20_000 }).toBe(1);
    const text = (await job.textContent()) ?? "";
    expect(text).toContain("IMG_0099.HEIC");
    expect(text).toContain("HEIC");
    expect(text).toContain("JPEG");
    // Nothing was sent, so no page of the allowance was spent on it.
    expect(s.requests).toHaveLength(0);

    expect(errorsOn(page)).toEqual([]);
    await page.close();
  });
});
