/**
 * Turnstile-gated upload, living in the left rail: a drop target, a challenge
 * and honest per-page progress. One challenge mints a session covering a
 * bounded number of pages, so a multi-page report needs one CAPTCHA, not one
 * per page.
 *
 * Pages are processed one at a time on purpose: a phone rendering a long
 * report at 220 DPI concurrently is the fastest way to run it out of memory,
 * and sequential processing also gives honest per-page progress.
 */
import { useEffect, useRef, useState } from "react";
import { ApiError, type Budget, extract, hasSession, startSession } from "../lib/api";
import { type LabReport, type Measurement } from "../lib/models";
import { reconcile } from "../lib/reconcile";
import { type Registry } from "../lib/registry";
import { count, plural } from "../lib/czech";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => void };
    onTurnstileLoad?: () => void;
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

interface Props {
  registry: Registry;
  frozen: boolean;
  maxPages: number;
  onReport: (report: LabReport) => void;
  onBudget: (b: Budget) => void;
  onUnlock: () => void;
}

export default function UploadPanel({ registry, frozen, maxPages, onReport, onBudget, onUnlock }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(hasSession());
  // Structured rather than a sentence, so the rail can draw a real bar. A
  // spinner cannot say "page 7 of 12", and a 12-page report is a long wait.
  const [progress, setProgress] = useState<{ page: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Notes are outcomes worth mentioning (a page limit, a scanned page), not
  // failures — showing them in the error colour makes a working upload look
  // broken.
  const [notes, setNotes] = useState<string[]>([]);

  useEffect(() => {
    if (ready || !SITE_KEY || !boxRef.current) return;
    const el = boxRef.current;
    const render = () => {
      if (!window.turnstile || el.childElementCount > 0) return;
      window.turnstile.render(el, {
        sitekey: SITE_KEY,
        callback: async (token: string) => {
          try {
            await startSession(token);
            setReady(true);
            onUnlock();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "Ověření se nezdařilo.");
          }
        },
      });
    };
    if (window.turnstile) render();
    else {
      window.onTurnstileLoad = render;
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
      s.async = true;
      document.head.appendChild(s);
    }
  }, [ready, onUnlock]);

  async function handleFile(file: File) {
    setError(null);
    setNotes([]);
    try {
      // pdf.js is ~1.4 MB and only the upload path needs it, so it is pulled
      // in on first use rather than shipped in the landing bundle.
      const { isPrintedOnPage, loadPdf, pageAssets, rowBoxFor, rowsAsText } = await import("../pdf/pdf");
      const doc = await loadPdf(file);
      const pageCount = Math.min(doc.numPages, maxPages);
      const measurements: Measurement[] = [];
      const pages = [];
      let unverified = 0;
      let sawScan = false;
      let reportDate: string | null = null;
      let labName: string | null = null;

      const failedPages: number[] = [];

      for (let p = 1; p <= pageCount; p++) {
        setProgress({ page: p, total: pageCount });
        const assets = await pageAssets(doc, p);

        // Digital PDF: send the reconstructed rows, not the image. The model
        // assigns columns; the characters come from the file.
        let res;
        try {
          res = assets.hasTextLayer
            ? await extract(null, null, null, rowsAsText(assets.rows))
            : await extract(assets.imageBase64, assets.mediaType, assets.textLayer, null);
        } catch (e) {
          // A page that fails is skipped and reported, not allowed to sink the
          // whole report — same behaviour as the local pipeline. A refused
          // session or an exhausted budget is different: every later page
          // would fail identically, so stop.
          if (e instanceof ApiError && (e.code === "budget_exhausted" || e.code === "session_invalid")) {
            throw e;
          }
          failedPages.push(p);
          pages.push({
            pageNum: p,
            imageUrl: assets.imageUrl,
            imageWidth: assets.imageWidth,
            imageHeight: assets.imageHeight,
          });
          continue;
        }
        onBudget(res.budget);
        if (res.mode === "vision") sawScan = true;

        for (const read of res.reads) {
          reportDate = reportDate ?? read.report_date ?? null;
          labName = labName ?? read.lab_name ?? null;
        }
        for (const m of reconcile(res.reads)) {
          // Provenance: on the text path a transcribed value must literally
          // appear on the page. Anything that does not is a fabrication, and
          // it is flagged for review rather than allowed into a trend.
          let disagreement = m.disagreement;
          let confidence = m.confidence;
          if (assets.hasTextLayer && !isPrintedOnPage(m.valueRaw, assets.rows)) {
            disagreement = `hodnota "${m.valueRaw}" není na stránce vytištěna`;
            confidence = "low";
            unverified += 1;
          }
          measurements.push({
            ...m,
            sourcePage: p,
            confidence,
            disagreement,
            canonicalId: registry.match(m.rawAnalyteName),
            bbox: rowBoxFor(m.rawAnalyteName, assets.rows),
          });
        }
        pages.push({
          pageNum: p,
          imageUrl: assets.imageUrl,
          imageWidth: assets.imageWidth,
          imageHeight: assets.imageHeight,
        });
      }

      const out: string[] = [];
      if (doc.numPages > maxPages)
        out.push(
          `Zpracováno prvních ${count(maxPages, "strana", "strany", "stran")} ` +
            `z ${doc.numPages} — limit ukázky.`,
        );
      if (sawScan) out.push("Některé strany nemají textovou vrstvu (sken) — přepsány z obrázku.");
      if (failedPages.length)
        out.push(
          `Nepodařilo se přečíst ${count(failedPages.length, "stranu", "strany", "stran")} ` +
            `(${failedPages.join(", ")}) — ostatní jsou zpracované.`,
        );
      if (unverified)
        out.push(
          `${count(unverified, "hodnota", "hodnoty", "hodnot")} ` +
            `${plural(unverified, "nesouhlasí", "nesouhlasí", "nesouhlasí")} s textem na stránce ` +
            `— ${plural(unverified, "označena", "označeny", "označeno")} k ověření.`,
        );
      setNotes(out);
      onReport({
        id: `upload-${Date.now()}`,
        sourceFile: file.name,
        reportDate,
        labName,
        patientName: null,
        patientId: null,
        pages,
        measurements,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Nepodařilo se zpracovat PDF: ${e}`);
    } finally {
      setProgress(null);
    }
  }

  if (frozen)
    return (
      <p className="muted">
        Rozpočet ukázky na AI funkce je vyčerpán — nahrávání je dočasně vypnuté.
      </p>
    );

  // A missing site key is a deployment condition, not a user error. The old
  // copy printed the environment-variable name in red, which reads as a broken
  // app to anyone who is not the person who deployed it.
  if (!SITE_KEY)
    return (
      <p className="muted">
        Nahrávání vlastních PDF není v této ukázce zapnuté. Ukázková data fungují
        normálně.
      </p>
    );

  if (!ready)
    return (
      <>
        <p className="muted" style={{ margin: "0 0 8px" }}>
          Nejdřív krátké ověření, že nejste robot. Pak můžete nahrát PDF.
        </p>
        <div ref={boxRef} />
        {error && <p className="err" style={{ margin: "8px 0 0" }}>{error}</p>}
      </>
    );

  const busy = progress !== null;

  return (
    <>
      <label
        className={`drop${dragging ? " over" : ""}${busy ? " busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return;
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
      >
        <span className="drop-icon" aria-hidden="true">
          {busy ? "⏳" : "📄"}
        </span>
        <span className="drop-main">
          {busy ? `Zpracovávám stránku ${progress!.page} z ${progress!.total}…` : "Přetáhněte PDF sem"}
        </span>
        <span className="drop-sub">
          {busy ? "Nechte okno otevřené." : `nebo klepněte a vyberte · limit ukázky ${maxPages} stran`}
        </span>
        <input
          type="file"
          accept="application/pdf"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            // Clear it, or picking the same file twice in a row does nothing.
            e.target.value = "";
          }}
        />
      </label>

      {busy && (
        <div className="progressbar" style={{ marginTop: 8 }} role="progressbar"
             aria-valuenow={progress!.page} aria-valuemin={0} aria-valuemax={progress!.total}>
          <i style={{ width: `${(progress!.page / progress!.total) * 100}%` }} />
        </div>
      )}

      {(notes.length > 0 || error) && (
        <div className="runlog">
          {notes.map((n, i) => (
            <span className="line" key={i}>
              <span aria-hidden="true">•</span>
              <span>{n}</span>
            </span>
          ))}
          {error && (
            <span className="line err">
              <span aria-hidden="true">✕</span>
              <span>{error}</span>
            </span>
          )}
        </div>
      )}

      <p className="muted" style={{ margin: "9px 0 0" }}>
        PDF se čte ve vašem prohlížeči. Obrázky stránek —{" "}
        <strong>včetně hlavičky se jménem a rodným číslem</strong> — se posílají
        k přepisu na Anthropic API a nikde se neukládají.
      </p>
    </>
  );
}
