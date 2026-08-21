/**
 * Turnstile-gated upload. One challenge mints a session covering a bounded
 * number of pages, so a multi-page report needs one CAPTCHA, not one per page.
 *
 * Pages are processed one at a time on purpose: a phone rendering a long
 * report at 220 DPI concurrently is the fastest way to run it out of memory,
 * and sequential processing also gives honest per-page progress.
 */
import { useEffect, useRef, useState } from "react";
import { ApiError, type Budget, extract, hasSession, startSession } from "../lib/api";
import { makeMeasurement, type LabReport, type Measurement } from "../lib/models";
import { normalizeMeasurement } from "../lib/normalize";
import { normKey, type Registry } from "../lib/registry";

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

/**
 * Union two independent reads of the same page.
 *
 * Agreement marks a row trustworthy; a differing value or a row only one model
 * saw is flagged for the verification tab. That last case is the important
 * one — it catches silent under-extraction, which a per-row confidence score
 * on a single read cannot see.
 */
function reconcile(reads: any[]): Measurement[] {
  const byKey = new Map<string, { m: Measurement; models: Set<string>; values: Set<string> }>();
  for (const read of reads) {
    for (const raw of read.measurements ?? []) {
      const key = normKey(raw.raw_analyte_name);
      const existing = byKey.get(key);
      if (existing) {
        existing.models.add(read.model);
        existing.values.add(raw.value_raw);
      } else {
        byKey.set(key, {
          m: makeMeasurement({
            rawAnalyteName: raw.raw_analyte_name,
            valueRaw: raw.value_raw,
            unitRaw: raw.unit_raw ?? "",
            refRangeRaw: raw.ref_range_raw ?? "",
            sourceSnippet: raw.source_snippet ?? "",
            confidence: raw.confidence ?? "high",
            extractedBy: read.model,
          }),
          models: new Set([read.model]),
          values: new Set([raw.value_raw]),
        });
      }
    }
  }

  const total = reads.length;
  const out: Measurement[] = [];
  for (const { m, models, values } of byKey.values()) {
    let disagreement: string | null = null;
    if (values.size > 1) disagreement = `modely přečetly různé hodnoty: ${[...values].join(" / ")}`;
    else if (total > 1 && models.size < total) disagreement = `řádek viděl jen ${[...models].join(", ")}`;
    out.push(normalizeMeasurement({ ...m, disagreement, escalated: total > 1 }));
  }
  return out;
}

export default function UploadPanel({ registry, frozen, maxPages, onReport, onBudget, onUnlock }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(hasSession());
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    try {
      // pdf.js is ~1.4 MB and only the upload path needs it, so it is pulled
      // in on first use rather than shipped in the landing bundle.
      const { findRowBox, loadPdf, pageAssets } = await import("../pdf/pdf");
      const doc = await loadPdf(file);
      const pageCount = Math.min(doc.numPages, maxPages);
      const measurements: Measurement[] = [];
      const pages = [];
      let reportDate: string | null = null;
      let labName: string | null = null;

      for (let p = 1; p <= pageCount; p++) {
        setProgress(`Zpracovávám stránku ${p} z ${pageCount}…`);
        const assets = await pageAssets(doc, p);
        const res = await extract(assets.imageBase64, assets.mediaType, assets.textLayer);
        onBudget(res.budget);

        for (const read of res.reads) {
          reportDate = reportDate ?? read.report_date ?? null;
          labName = labName ?? read.lab_name ?? null;
        }
        for (const m of reconcile(res.reads)) {
          measurements.push({
            ...m,
            sourcePage: p,
            canonicalId: registry.match(m.rawAnalyteName),
            bbox: findRowBox(assets.words, m.rawAnalyteName),
          });
        }
        pages.push({
          pageNum: p,
          imageUrl: assets.imageUrl,
          imageWidth: assets.imageWidth,
          imageHeight: assets.imageHeight,
        });
      }

      if (doc.numPages > maxPages) {
        setError(`Zpracovány první ${maxPages} strany z ${doc.numPages} — limit ukázky.`);
      }
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
      <div className="card">
        <h2>Zkusit vlastní PDF</h2>
        <p className="muted">Rozpočet dema na AI funkce je vyčerpán — nahrávání je dočasně vypnuté.</p>
      </div>
    );

  return (
    <div className="card">
      <h2>Zkusit vlastní PDF</h2>
      <p className="sub">
        Soubor se zpracuje ve vašem prohlížeči a nikam se neukládá — po zavření
        stránky po něm nezůstane stopa. Na server jdou jen obrázky stránek
        k přepisu. Limit ukázky: {maxPages} stran.
      </p>

      {!SITE_KEY && <p className="err">Turnstile není nakonfigurován (VITE_TURNSTILE_SITE_KEY).</p>}
      {!ready && <div ref={boxRef} />}

      {ready && (
        <input
          type="file" accept="application/pdf" disabled={progress !== null}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      )}
      {progress && <p className="muted" style={{ marginBottom: 0 }}>{progress}</p>}
      {error && <p className="err" style={{ marginBottom: 0 }}>{error}</p>}
    </div>
  );
}
