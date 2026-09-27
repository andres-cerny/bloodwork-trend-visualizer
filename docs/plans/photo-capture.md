# Plan: photo capture — good input before any model sees it

Drafted 2026-09-26 (session with Ondřej). A, B, C1–C3 and D1–D4 built; C4 measured and not shipped to the readers. **A photo should reach
the pipeline flat, sharp and recognisably a lab sheet — and when it is not,
the person is told why and may still send it.** Everything here runs in the
browser; nothing new leaves the device.

## Why now, when perspective correction was declined on 2026-09-08

`packages/lab-core/src/photo.ts` records the decision not to de-skew: both
deployed readers read all 133 simulated photos, every `angle` shot included,
with zero value errors. That still holds and this plan does not reopen it
*for the readers*. It reopens it for three other consumers, which did not
exist then:

1. **Identity detection on photos.** Today a photo gets no automatic boxes —
   the reader paints everything by hand. A local OCR test (below) finds ~95 %
   of identifiers on a frontal photo and **14 % on an angled one**.
2. **The Ověření highlight.** Photos have `bbox: null`
   (`apps/portal/src/lib/interpret.ts:132`), so the row a value came from is
   never shown. OCR rows give a box; a skewed page gives slanted rows and a
   box that covers its neighbours.
3. **Refusing hopeless input early.** A blurred, cut-off or non-lab picture
   today costs a document from the allowance and a model call before anyone
   learns it was useless.

## Measured already: Tesseract.js on the simulated photos (2026-09-26)

Scratchpad experiment, nothing committed. tesseract.js 7.0.0, LSTM,
`4.0.0_best_int`, `ces+eng`; ground truth = `findIdentity` on the source
PDF's text layer; 133 photos from `data/photos-sim/`, 241 identity items.

| Condition | Items found | Photos with every item |
|---|---|---|
| flat | 55/57 | 19/21 |
| dark | 55/57 | 19/21 |
| glare | 52/57 | 16/21 |
| crop | 11/11 | 4/4 |
| angle | **8/57** | **0/21** |

Excluding `angle`: rodné číslo 62/62, birth date 25/26, address 15/16, name
73/80. 16 false hits on 15 photos (3 were the right identifier with an OCR
typo). Download: ~3.3 MB gz for `ces` alone, ~6.2 MB for `ces+eng`; `ces`
alone scored 161 vs 164, so `ces` is enough. Speed: 1.7–3.9 s per page on an
M4 Max (`ces`); **a phone is unmeasured** and will be slower.

Two findings shape the design:

- **OCR words cannot go into `findIdentity` raw.** `buildRows` treats each
  item as a cell, so "Rodné číslo:" split into words loses its label. Recall
  went 109 → 164 → 183 of 241 as words were merged into phrases (gap under
  1.2× word height, line-y normalised) and a stray border glyph (a leading
  `i`/`l`/`|` before a capital) was dropped. The photo path needs its own
  adapter.
- **Skew is not tunable away.** `rotateAuto` moved angle from 8 to 10 of 57;
  greyscale/normalise gained nothing; a hard threshold lost the dark set.
  Only finding the page and flattening it fixes this.

## Principle: warn, rarely refuse

Ondřej, 2026-09-26: not too aggressive — worst case, not all of it gets
ingested. The two readers already keep false rows rare; the failure the app
actually has is showing too little. So every check has three outcomes:

| Outcome | When | What the person sees |
|---|---|---|
| **ok** | passes | nothing |
| **warn** | blurred, dark, glare, cut-off corner, strong tilt, probably not a lab sheet | the reason in one Czech sentence, "Vyfotit znovu" and "Nahrát i tak" |
| **refuse** | cannot decode; far too small to hold text; nearly uniform (lens cap, black frame) | the reason and "Vyfotit znovu" only |

Refuse is the short list above and grows only with a measured case where a
refused photo could never have produced a row.

## Invariants this plan must not break

- **Nothing leaves the browser before redaction.** OCR, page detection and
  the checks are local; model weights are downloaded *to* the device and
  self-hosted from the app's own assets, not a third-party CDN.
- **A photo never reads as "clean".** The rule in `apps/portal/src/lib/upload.ts`
  stays: the review screen for a photo keeps the pencil active and the
  per-page confirmation. OCR boxes are pre-drawn suggestions; zero OCR hits on
  a photo says "nic jsme nenašli — zkontrolujte ručně", never "nic tam není".
- **The readers' input does not change without a bench gate.** Flattening
  changes the pixels the readers see. It ships to the readers only if the
  photo bench shows no regression (0 value errors, no fewer rows) — otherwise
  the flat image is used for OCR and the highlight only, and the readers keep
  the original.
- **OCR never supplies a value.** It points (identity boxes, row boxes) and
  may warn; the numbers still come from the two readers through `reconcile`.
- **A wrong highlight is worse than none.** A row box is drawn only when the
  OCR row carries both the value and the name the readers returned.
- **Bundle.** OCR and page detection are lazy chunks loaded when a photo is
  chosen; a PDF-only visit downloads neither. `check:bundle` must say so.

## Phase A — the bad-photo corpus

The existing `data/photos-sim/` covers flat, angle, glare, dark, crop. It
lacks what a check must refuse or warn on.

**A1. Extend `tools/pipeline/scripts/simulate_photos.py`** (not `_fonts.py`)
with: `blur` (defocus), `motion` (shake), `tilt_hard` (~40°), `corner_cut`
(one page corner outside the frame), `tiny` (long edge ~600 px), `blown`
(a large clipped highlight), `table` (the page small on a busy background),
`screen` (a photo of a monitor, moiré). Each gets an expected outcome
(ok/warn/refuse) in `manifest.json`.

**A2. Not-a-lab-sheet set.** `data/not-lab/`, git-ignored, with a
`SOURCES.md` (URL, licence): public images of a receipt, an invoice, a
prescription, a medicine box, a handwritten note, a phone screenshot, a
landscape, a pet, a blank page. Expected outcome: **warn**. Plus the three
public lab sheets from `data/public-sheets/` (Slovak included) — expected
**ok**: a foreign lab is still a lab.

**A3. Real phone shots (Ondřej).** The simulated set is rendered, not
photographed: its `angle` may not have a background edge to detect. Ten real
shots of printed demo pages (not patient reports), per the A4 protocol in
[lab-adaptability](lab-adaptability.md), plus the new bad conditions.

**A4. Tie checks to outcomes already measured.** `tests/bench/results/adapt.jsonl`
holds per-photo reader results. Every threshold is calibrated so that
**no photo from which the readers returned every row is refused**, and warn
fires on as many as possible of the photos where they did not.

## Phase B — quality checks (pure functions, unit-tested)

In `packages/lab-core/src/photo.ts` beside the contrast stretch, over the
same greyscale buffer, no DOM:

| Check | Measure |
|---|---|
| sharpness | variance of the Laplacian |
| exposure | mean level, fraction clipped at 0 and 255 |
| glare | area of the largest connected clipped region |
| size | long edge in px after decode |
| uniformity | histogram spread (the refuse case) |

Output `{ outcome, reasons[] }`; the Czech sentences live in the app, not in
lab-core. Gate: A4's rule holds on the whole corpus.

## Phase C — find the page, flatten it

**C1. Choose the detector.** OpenCV.js (Canny → contours → largest
quadrilateral → `warpPerspective`) or a small TypeScript implementation of
the same steps. Measure both on the corpus: corner accuracy, time, gz size.
OpenCV.js is several MB; a hand-written quad finder is small but ours to
maintain. Decide by the numbers.

**C2. Outputs.** Four corners with a confidence, the flattened page at A4
aspect, and two more checks for Phase B's table: `page_found` and
`corner_cut`. Low confidence → keep the original, no warp, no warning about
it (a bad warp is worse than a tilted page).

**C3. Gate.** OCR recall on `angle` from 8/57 toward the flat level
(55/57); no regression on flat/dark/glare.

**C4. Readers (optional, paid gate).** Photo bench with flattened input:
Claude arms through subagents, one API gate run and Gemini proposed to
Ondřej with page count and USD first (rule from lab-adaptability). Ships to
the readers only on no regression; otherwise C stays OCR-and-highlight only.

### C1–C3 results (2026-09-26)

**C1, the detector.** `tests/bench/photo_page.ts` over 180 scored photos; truth
for `angle` is the simulator's own transform (`data/photos-bad/corners_angle.json`,
identical to the photo-highlight bench's byte-verified replay, 0.0 px apart).

| Finder | Correct | Angle corner error, original px | Time/photo | Download |
|---|---|---|---|---|
| `photoPage.ts` (own) | **180/180** | median 9.0, max 12.2 | 67 ms | **3.3 kB gz** |
| OpenCV.js 5 (Canny, largest 4-point contour) | 174/180 | median 6.6, max 8.2 | 25 ms | 3.7 MB gz |

OpenCV misses all six `corner_cut` shots. **Chosen: our own finder.** 9 px on a
3024 px photo is well inside what OCR needs; the download is 1,100× smaller.

**C3, identity recall** (`tests/bench/photo_ocr.ts` + `photo_ocr_score.ts`,
Tesseract `ces` 4.0.0_best_int, input as the browser has it: long edge 2576).
Flattening alone was not enough: 10 → 17 of 57 on `angle`, and even the
simulator's *exact* inverse transform reached only 19. What held the rest back
was the shadow every `angle` shot carries (down to 58 % brightness), which a
global contrast stretch cannot undo. `evenLight` (divide by the paper's own
brightness, estimated by a closing at 160 px) fixed it:

| Condition | orig | flat | flat + even light (**shipped**) |
|---|---|---|---|
| angle | 10/57 | 17/57 | **52/57** (16/21 photos complete) |
| flat | 49/57 | 49/57 | 53/57 |
| dark | 52/57 | 52/57 | 55/57 |
| glare | 52/57 | 52/57 | 52/57 |
| crop | 11/11 | 11/11 | 11/11 |
| tilt_hard | 8/17 | 15/17 | 16/17 |
| corner_cut | 10/17 | 16/17 | 16/17 |
| table | 15/17 | 15/17 | 15/17 |
| blown | 11/17 | 11/17 | 10/17 |
| screen | 9/17 | 0/17 | 7/17 |
| all | 229/394, 32 false hits | 240/394, 24 | **289/394, 20** |

Losses: blown −1, screen −2 (both conditions the quality checks already name);
blur, motion, tiny and micro stay at 0–1 — nothing to read, and they warn or
refuse before OCR runs. The 8/57 in the table above was measured at full
resolution without the stretch; at 2576 px it is 10/57. OCR ≈ 2.6 s/page on
an M4 Max with 8 in parallel. The readers still receive the unflattened
photo (C4 decides).

### C4 result (2026-09-26): not shipped to the readers

The candidate picture is the OCR one (flatten + `evenLight`, JPEG 85), per the
decision "same picture for OCR, readers and the highlight". `photo_dump.ts`
writes it for the 133 simulated photos as class `photo_flatlit`, same truth as
`photo`.

**Sonnet, tier 1** (17 Sonnet subagents, deployed `SYSTEM_EXTRACT` and `TOOL`
verbatim; three batches that opened other files or copied one page's answer
onto another were discarded and re-read under Read/Write-only isolation):

```
variant                pages truth  rows match  miss extra valERR
orig_sonnet_vision_dF    133  3585  3593  3585     0     8      0
sonnet_flatlit           133  3585  3589  3581     4     8      0
orig_gemini38_ultra      133  3585  3593  3583     2    10      0

pair                                   confirmed flagged UNCAUGHT
orig_gemini38_ultra+orig_sonnet_vision_dF   3583       5        0
orig_gemini38_ultra+sonnet_flatlit          3579      13        0
```

0 value errors. The 4 misses are one row — the second `25-hydroxyvitamin D`
line, whose name is not reprinted — on all four shots of one page, the
unwarped frontal one included: a reader habit this batch had, not the warp.

**Gemini, tier 2** (paid, run by the main session with Ondřej's approval:
133 calls, 0 failed, USD 1.7345, `tests/bench/photo-flat-spend-log.md`):

```
variant                pages truth  rows match  miss extra valERR
gemini_flatlit           133  3585  3598  3579     6    19      0
orig_gemini38_ultra      133  3585  3593  3583     2    10      0

pair                                   confirmed flagged UNCAUGHT
gemini_flatlit+sonnet_flatlit               3575      22        0
orig_gemini38_ultra+orig_sonnet_vision_dF   3583       5        0   (today)
```

**Verdict: fails the gate, so the readers keep the unflattened photo.**
There are still 0 value errors and 0 uncaught, but the flattened pair
matches 8 fewer rows and flags 22 for review instead of 5. Both readers lose
rows on the flattened picture: Gemini 4, Sonnet 4. Sonnet's four are a
reader habit on one page, frontal shot included. Gemini's are not explained
yet. The 2026-09-08 finding stands: the readers do not need de-skewing, and
`evenLight` plus the warp costs them a little. Flattening stays for OCR,
identity boxes and the highlight. The Decisions row for C4 is answered by
this measurement.

## Phase D — OCR in the browser

**D1.** Tesseract.js in a Web Worker, `ces` traineddata and wasm core
self-hosted under the portal's assets, lazy-loaded.

**D2. The photo adapter** — phrase merging, line-y normalisation, stray
border-glyph cleanup — as a pure function in lab-core, fed the experiment's
recorded OCR output as fixtures (with identities replaced) so it is tested in
plain node.

**D3. Identity pre-draw.** Photo → flatten → OCR → adapter → `findIdentity`
→ boxes on the review screen as suggestions. Invariant above holds. **Needs
Ondřej's yes**: it changes a rule recorded as "do not run detection on
photos"; that rule's reason (an empty result looking clean) is kept by the
copy, not by not running.

**D4. Is this a lab sheet.** A score over the OCR text: units (`mmol/l`,
`µmol/l`, `g/l`, `×10^9/l`), range patterns (`3,5–5,1`, `( 2,50 - 6,40 )`),
header words (`Výsledek`, `Ref. meze`, `Jednotka`, `Výsledok`), and several
rows of *name + number*. Low score → warn, never refuse. The backstop exists
already: a document whose pages return no rows can be given back
(`documents.released_at`); check it is applied automatically for that case.

**D5. Phone timing.** One mid-range Android and one iPhone, a page each,
before D3 ships. If a page takes more than a few seconds, OCR runs while the
person looks at the review screen, and the boxes appear when ready.

### D status (2026-09-26): built in the portal

- **D1.** `apps/portal/src/lib/ocr.ts`, reached only by `import("./ocr")`:
  tesseract.js's ESM build (18.7 kB gz chunk) in its own Web Worker, worker
  script, LSTM cores and `ces` 4.0.0_best_int copied into `dist/ocr/` by the
  `ocrAssets` Vite plugin (not committed; package-lock pins them).
  `check:bundle:portal` proves OCR is on neither the first load nor the PDF
  path, and fails when `ocr.ts` is imported statically (tried).
- **D2.** `ocrPhrases` and `identityFromOcr` in `packages/lab-core/src/photoOcr.ts`,
  tested on a fixture shaped like recorded Tesseract output with invented
  identities; boxes found on the flattened page are mapped back onto the
  photo (`mapBox`).
- **D3.** Suggestions on the review; pencil on, confirm required; "nic jsme
  nenašli — zkontrolujte ručně" for none; the privacy page's photo paragraph
  rewritten to match (**needs Ondřej's look — it is an approved legal text**).
- **D4.** `labSheetScore`, warn below 5 (calibration above). Photo verdict =
  pixel checks + `corner_cut` + `not_lab` (`withPageChecks`); `PhotoCheck.tsx`
  shows warn/refuse before the review. `photo_checks.ts`: every expected
  outcome met once the OCR score covers the blank sheet and non-lab pictures.
- **Open:** D5 phone timing. Find + warp + even light cost ≈ 260 ms on an M4
  Max on the main thread (Tesseract itself is in the worker); on a phone that
  may approach a second — move them into the worker if it shows.

## Phase E — the Ověření highlight on photos

Each photo row from the readers carries `source_snippet`
(`packages/extraction/src/extract.ts:203`). Match it against the adapter's
OCR rows on the **flattened** page: draw `bbox` only when the value and the
name both sit on one OCR row; otherwise `null`, as today. The stored page
image is then the flattened one, so the box lands on the pixels shown.
Gate: on the corpus, zero boxes on a wrong row; report how many rows get a
box. Which locator wins — OCR, reader coordinates, or numbered rows — is
measured first in `docs/plans/photo-highlight.md` (Phase E's research, on its own branch).

## Phase F — the guided camera

`.shoot` today is `<input capture>`, the phone's own camera — no overlay is
possible. Guided capture needs `getUserMedia` in the page:

- live video with an A4 frame; Phase C's detector on a downscaled frame
  several times a second; corners drawn red until the page is found, sharp
  and not cut, then green; auto-shoot after the frame holds green briefly;
- capture at the highest resolution available (`ImageCapture.takePhoto` where
  it exists, Chrome on Android; a video frame elsewhere, iOS Safari).
  **Measure the resolution on an iPhone first** — a video frame may be only
  1080p, ~160 dpi on A4, possibly too little for small print. If it is, the
  guided view only frames, and the native camera still takes the picture;
- the native camera and the gallery stay as fallbacks. Every photo, however
  it arrived, goes through B → C → D.

Tip in the upload copy, free today: iPhone Poznámky/Soubory "Naskenovat
dokument" and Google Drive's scan produce a flat PDF.

## Order and gates

A → B → C (C1–C3) → D → E → F. B alone is shippable (warnings only). C4 is
optional and paid. Each UI phase ends with the `portal-auditor` agent and
`npm run test:audit`.

## Decisions (Ondřej, 2026-09-26)

| Question | Answer |
|---|---|
| D3: pre-draw identity boxes on photos | **Yes.** Overrides the 2026-09-09 rule "do not run detection on photos"; the copy and per-page confirmation keep its reason |
| C4: flattened image to the readers | **Yes, after the retest** — retest run 2026-09-26 (USD 1.73): no gain, 8 fewer rows, 22 flagged vs 5, so **not shipped**; readers keep the original photo |
| C1: OpenCV.js vs own quad finder | Claude decides from C1's numbers |
| F: guided camera | Deferred. Checks and flattening cover any photo however taken; F is built only if real uploads show many blurred, cut-off or glare warnings — the three faults flattening cannot repair |

The Ověření highlight on photos (Phase E) is researched separately first:
`docs/plans/photo-highlight.md` (Phase E's research, on its own branch).
