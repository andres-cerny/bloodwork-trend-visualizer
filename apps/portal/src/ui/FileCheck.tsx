/**
 * A file the checks want a second look at, before its review and before a
 * document is spent (lib/fileChecks.ts): long, several draw dates, not a lab
 * sheet, or a photo whose local reading failed. The person decides — every
 * reason here is a warning, never a refusal; the refusals never get this far.
 */
import type { PreparedFile } from "../lib/upload";
import { WARNING_COPY } from "../lib/fileChecks";

interface Props {
  prepared: PreparedFile;
  onSendAnyway: () => void;
  onCancel: () => void;
}

export default function FileCheck({ prepared, onSendAnyway, onCancel }: Props) {
  const warnings = prepared.warnings ?? [];
  const pages = prepared.pages.length;
  return (
    <section className="card photo-check" aria-labelledby="file-check-h">
      <div className="card-head">
        <div>
          <h2 id="file-check-h">Než soubor nahrajeme</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            {prepared.name} · {pages} {pages === 1 ? "strana" : pages < 5 ? "strany" : "stran"}
          </p>
        </div>
      </div>
      <ul className="photo-check-reasons">
        {warnings.map((w) => (
          <li key={w}>{WARNING_COPY[w]}</li>
        ))}
      </ul>
      <div className="review-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Zrušit
        </button>
        <button type="button" className="btn primary" onClick={onSendAnyway}>
          {warnings.includes("long") || warnings.includes("multi_date") ? "Ano, je to jeden report" : "Nahrát i tak"}
        </button>
      </div>
    </section>
  );
}
