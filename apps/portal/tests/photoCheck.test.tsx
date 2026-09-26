/**
 * The screen a photo meets when the checks did not pass
 * (docs/plans/photo-capture.md, "warn, rarely refuse"): a warning offers
 * "Vyfotit znovu" and "Nahrát i tak"; a refusal offers only the first.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PhotoReason } from "@bw/lab-core/photo";
import PhotoCheck from "../src/ui/PhotoCheck";
import { CHECK_HEADING, REASON_COPY, photoCaption } from "../src/lib/photoCopy";
import type { PreparedFile } from "../src/lib/upload";

const page = { pageNum: 1, imageUrl: "blob:p", imageWidth: 100, imageHeight: 140, imageBase64: "", mediaType: "image/jpeg", textLayer: "", words: [], rows: [], hasTextLayer: false };
const shot = (outcome: "warn" | "refuse", reasons: PhotoReason[]): PreparedFile => ({
  name: "IMG_0042.jpg",
  kind: "photo",
  pages: [page as never],
  hits: [],
  scanPages: [1],
  truncated: 0,
  photo: { verdict: { outcome, reasons }, ocr: outcome === "refuse" ? "skipped" : "done" },
});
const draw = (p: PreparedFile) => renderToStaticMarkup(createElement(PhotoCheck, { prepared: p, onRetake: () => {}, onSendAnyway: () => {}, onCancel: () => {} }));

describe("PhotoCheck", () => {
  it("on a warning: every reason in Czech, 'Vyfotit znovu' and 'Nahrát i tak'", () => {
    const html = draw(shot("warn", ["blurred", "not_lab"]));
    expect(html).toContain(CHECK_HEADING.warn);
    expect(html).toContain(REASON_COPY.blurred);
    expect(html).toContain(REASON_COPY.not_lab);
    expect(html).toContain("Vyfotit znovu");
    expect(html).toContain("Nahrát i tak");
  });

  it("on a refusal: no way to send it", () => {
    const html = draw(shot("refuse", ["blank"]));
    expect(html).toContain(CHECK_HEADING.refuse);
    expect(html).toContain(REASON_COPY.blank);
    expect(html).toContain("Vyfotit znovu");
    expect(html).not.toContain("Nahrát i tak");
  });

  it("opens the camera on a phone and the file dialog elsewhere, from its own input", () => {
    const html = draw(shot("warn", ["glare"]));
    expect(html).toMatch(/<label class="btn primary photo-retake">Vyfotit znovu<input type="file" accept="image\/\*" capture="environment"/);
  });
});

describe("photo copy", () => {
  it("has one Czech sentence per reason code", () => {
    const codes: PhotoReason[] = ["too_small", "blank", "small", "blurred", "dark", "glare", "corner_cut", "not_lab"];
    for (const c of codes) expect(REASON_COPY[c]).toMatch(/^[A-ZČŘŠŽÚÝÁÉÍ].+\.$/);
  });

  it("captions a photo's review honestly for every OCR outcome", () => {
    expect(photoCaption(0, "done")).toBe("nic jsme nenašli — zkontrolujte ručně");
    expect(photoCaption(1, "done")).toContain("1 pole");
    expect(photoCaption(3, "done")).toContain("3 pole");
    expect(photoCaption(7, "done")).toContain("7 polí");
    // OCR that never ran or failed claims no search: "nic nenalezeno" would be false.
    expect(photoCaption(0, "failed")).toBe("fotku se nepodařilo přečíst — začerněte ručně");
    expect(photoCaption(0, "skipped")).toBe("začerněte ručně");
    expect(photoCaption(0, undefined)).not.toContain("nenalezeno");
  });
});
