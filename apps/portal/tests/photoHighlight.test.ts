/**
 * The Ověření highlight on photos (docs/plans/photo-capture.md, Phase E):
 * a photo's rows get a frame from its own OCR rows, carried to the photo as a
 * quadrilateral — and nothing the OCR read ever leaves the browser.
 *
 * The OCR rows here carry a word no reader returns (`OCRONLY…`): it stands for
 * everything Tesseract read off the unredacted photo — an identity line, the
 * lab's address — and it must appear in no request and no stored report.
 * The api module is replaced: this is a test of what is sent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LabReport } from "@bw/lab-core";
import type { RedactedPage } from "@bw/lab-core/pdf";
import { homography, type PhotoRowSource } from "@bw/lab-core/photo";

const sent: unknown[] = [];

vi.mock("../src/lib/api", () => ({
  putReport: async (report: LabReport) => {
    sent.push(structuredClone(report));
    return { ok: true };
  },
  putPage: async (reportId: string, pageNum: number, ...rest: unknown[]) => {
    sent.push({ putPage: [reportId, pageNum, ...rest.filter((r) => !(r instanceof Blob))] });
    return { ok: true, imageUrl: `/api/reports/${reportId}/${pageNum}` };
  },
  releaseDocument: async () => ({ ok: true, allowance: { free: 5, purchased: 0, used: 0, remaining: 5 } }),
  openDocument: async () => ({ ok: true, allowance: { free: 5, purchased: 0, used: 1, remaining: 4 } }),
  extractPage: async (body: unknown) => {
    sent.push({ extract: body });
    return {
      readersAttempted: 1,
      reads: [
        {
          model: "a",
          report_date: "2026-09-20",
          lab_name: null,
          measurements: [
            { raw_analyte_name: "Draslík", value_raw: "4,2", unit_raw: "mmol/l", ref_range_raw: "", confidence: "high" },
            { raw_analyte_name: "Hořčík", value_raw: "0,9", unit_raw: "mmol/l", ref_range_raw: "", confidence: "high" },
          ],
        },
      ],
    };
  },
  isFatalApiError: () => false,
}));

import { interpretPage } from "../src/lib/interpret";
import { extractReport, storeReport, type PreparedFile } from "../src/lib/upload";

const rows: PhotoRowSource["rows"] = [
  { text: "OCRONLYNAME Ukázka Pacient", box: [100, 40, 900, 70] },
  { text: "Sodík 140 mmol/l OCRONLYWORD", box: [100, 100, 1060, 130] },
  { text: "Draslík 4,2 mmol/l OCRONLYWORD", box: [100, 152, 1060, 182] },
];
const toPhoto = homography([[0, 0], [1200, 0], [1200, 1700], [0, 1700]], [[40, 30], [1240, 60], [1230, 1750], [30, 1740]]);

const photoPage = {
  pageNum: 1,
  imageUrl: "data:image/jpeg;base64,AAAA",
  imageWidth: 1300,
  imageHeight: 1800,
  imageBase64: "AAAA",
  mediaType: "image/jpeg",
  blob: new Blob(["jpeg"], { type: "image/jpeg" }),
  textLayer: "",
  words: [],
  rows: [],
  hasTextLayer: false,
} as unknown as RedactedPage;

const prepared = (src: PhotoRowSource | undefined): PreparedFile => ({
  name: "IMG_0001.jpg",
  kind: "photo",
  pages: [photoPage],
  hits: [],
  scanPages: [1],
  truncated: 0,
  photo: { verdict: { outcome: "ok", reasons: [] } as never, ocr: "done", rows: src },
});

const registry = { match: () => null } as never;
const read = (n: string, v: string) => ({
  model: "a",
  measurements: [{ raw_analyte_name: n, value_raw: v, unit_raw: "", ref_range_raw: "", confidence: "high" as const }],
});

beforeEach(() => {
  sent.length = 0;
});

describe("interpretPage on a photo", () => {
  it("frames the row that carries the read's name and value, as a quad with its bounds", () => {
    const out = interpretPage([read("Draslík", "4,2")], [], 1, true, () => null, 1, { rows, toPhoto, twoSheets: false });
    const m = out.measurements[0];
    expect(m.quad).toHaveLength(4);
    const xs = m.quad!.map((p) => p[0]);
    const ys = m.quad!.map((p) => p[1]);
    expect(m.bbox).toEqual([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  });

  it("gives no frame where no OCR row carries both, and none at all on two sheets", () => {
    expect(interpretPage([read("Hořčík", "0,9")], [], 1, true, () => null, 1, { rows, toPhoto, twoSheets: false }).measurements[0].bbox).toBeNull();
    const two = interpretPage([read("Draslík", "4,2")], [], 1, true, () => null, 1, { rows, toPhoto, twoSheets: true }).measurements[0];
    expect(two.bbox).toBeNull();
    expect(two.quad).toBeUndefined();
  });

  it("leaves a scanned PDF page as it was: no OCR rows, no frame", () => {
    const m = interpretPage([read("Draslík", "4,2")], [], 1, true, () => null, 1).measurements[0];
    expect(m.bbox).toBeNull();
    expect(m.quad).toBeUndefined();
  });
});

describe("a photo's OCR text never leaves the browser", () => {
  it("is in no request and no stored report — only the numeric frame is", async () => {
    const { report } = await extractReport("r-1", prepared({ rows, toPhoto, twoSheets: false }), [photoPage], registry, () => {});
    const stored = await storeReport(report, [photoPage]);

    const potassium = stored.measurements.find((m) => m.rawAnalyteName === "Draslík")!;
    expect(potassium.quad).toHaveLength(4);
    expect(potassium.bbox).not.toBeNull();

    const wire = JSON.stringify(sent);
    expect(wire).not.toContain("OCRONLY");
    expect(wire).not.toContain("Ukázka");
    // The quad itself is numbers only.
    for (const p of potassium.quad!) for (const c of p) expect(typeof c).toBe("number");
  });
});
