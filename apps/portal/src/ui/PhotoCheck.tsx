/**
 * A photo the checks warned on or refused, before its review
 * (docs/plans/photo-capture.md, "warn, rarely refuse").
 *
 * Warn: the reasons, "Vyfotit znovu" and "Nahrát i tak" — the readers keep
 * false rows rare, and the app's real failure is showing too little, so the
 * person decides. Refuse (cannot hold print at all: too few pixels, blank):
 * the reasons and "Vyfotit znovu" only; "Zrušit" drops the file without
 * sending anything.
 *
 * "Vyfotit znovu" is a file input inside its label, not a button that clicks
 * a hidden input elsewhere: the tap is then the browser's own user gesture on
 * any platform. `capture="environment"` opens the camera on a phone; a desktop
 * browser ignores it and opens the file dialog, which is what "again" means
 * there. The shown photo is the encoded page, so the person sees what failed.
 */
import type { PreparedFile } from "../lib/upload";
import { CHECK_HEADING, REASON_COPY, SCAN_TIP, WARN_NOTE } from "../lib/photoCopy";

interface Props {
  prepared: PreparedFile;
  /** A new photo was taken or chosen: this one is dropped, that one queued. */
  onRetake: (files: File[]) => void;
  /** Warn only: go on to the review with this photo. */
  onSendAnyway: () => void;
  onCancel: () => void;
}

export default function PhotoCheck({ prepared, onRetake, onSendAnyway, onCancel }: Props) {
  const verdict = prepared.photo!.verdict;
  const refuse = verdict.outcome === "refuse";
  const page = prepared.pages[0];
  return (
    <section className="card photo-check" aria-labelledby="photo-check-h">
      <div className="card-head">
        <div>
          <h2 id="photo-check-h">{refuse ? CHECK_HEADING.refuse : CHECK_HEADING.warn}</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            {prepared.name}
          </p>
        </div>
      </div>
      <ul className="photo-check-reasons">
        {verdict.reasons.map((r) => (
          <li key={r}>{REASON_COPY[r]}</li>
        ))}
      </ul>
      {!refuse && <p className="muted photo-check-note">{WARN_NOTE}</p>}
      <img className="photo-check-img" src={page.imageUrl} alt="Fotografie" />
      <p className="muted photo-check-note">{SCAN_TIP}</p>
      <div className="review-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Zrušit
        </button>
        {!refuse && (
          <button type="button" className="btn" onClick={onSendAnyway}>
            Nahrát i tak
          </button>
        )}
        <label className="btn primary photo-retake">
          Vyfotit znovu
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) onRetake(files);
            }}
          />
        </label>
      </div>
    </section>
  );
}
