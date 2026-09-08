/**
 * One-off: move a stale source highlight onto its own printed row.
 *
 * On the 25.10.2024 SPADIA report, Ověření frames "Bilirubin celkový" for
 * "Bilirubin konjugovaný": the report was uploaded before `rowBoxFor` was
 * fixed, and the highlight box travels in the stored payload. The page's
 * text rows are not stored (the PDF never is), so nothing server-side can
 * re-run the match — but the owner's browser can read the report, move one
 * box one row down and write it back, keeping every Potvrdit/oprava on it.
 *
 * Run it from the logged-in tab, not from node: open moje-krev, press F12,
 * paste this whole file into the console, Enter. It prints what it found,
 * asks once, then PUTs the report. Reload Ověření to see the new frame.
 *
 * Nothing here is generic on purpose. The three constants below name the
 * report and the row; a different stale box is a different edit.
 */
(async () => {
  const REPORT_DATE = "2024-10-25";
  const LAB = /spadia/i;
  const WRONG = /bilirubin.*konjug/i; // the measurement whose box is stale
  const ABOVE = /bilirubin.*celk/i; // the row it is wrongly framing

  const reports = await (await fetch("/api/reports")).json();
  const report = reports.find((r) => r.reportDate === REPORT_DATE && LAB.test(r.labName ?? ""));
  if (!report) throw new Error(`No ${REPORT_DATE} SPADIA report in this account.`);

  const ms = report.measurements;
  const wrong = ms.find((m) => WRONG.test(m.rawAnalyteName));
  const above = ms.find((m) => ABOVE.test(m.rawAnalyteName));
  if (!wrong?.bbox || !above?.bbox) throw new Error("Could not find both bilirubin rows with boxes.");
  const [x0, y0, x1, y1] = wrong.bbox;
  console.log("konjugovaný now:", wrong.bbox, "celkový:", above.bbox, "page", wrong.pageNum);

  // The row pitch: the nearest stored box below "celkový" on the same page
  // that is not the stale one. If the stale box sits exactly on "celkový",
  // the next distinct box is two rows down, so the pitch is half the gap.
  const below = ms
    .filter((m) => m !== wrong && m.bbox && m.pageNum === above.pageNum && m.bbox[1] > above.bbox[1] + 1)
    .sort((a, b) => a.bbox[1] - b.bbox[1])[0];
  if (!below) throw new Error("No row below to measure the pitch from.");
  const stacked = Math.abs(y0 - above.bbox[1]) <= 1;
  const pitch = (below.bbox[1] - above.bbox[1]) / (stacked ? 2 : 1);
  const next = [x0, y0 + pitch, x1, y1 + pitch].map((v) => Math.round(v * 10) / 10);
  console.log("pitch", pitch, "→ konjugovaný becomes", next, "(next row below celkový starts at", below.bbox[1], ")");

  if (!confirm(`Move the "${wrong.rawAnalyteName}" frame down by ${pitch.toFixed(1)}px and save the report?`)) return;
  wrong.bbox = next;
  const res = await fetch(`/api/reports/${report.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  });
  console.log(res.ok ? "Saved. Reload Ověření." : `Save failed: ${res.status} ${await res.text()}`);
})();
