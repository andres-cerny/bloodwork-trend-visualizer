/**
 * Find a parameter by name — the same control beside every table heading.
 *
 * Souhrn opens the chart with it; Ověření selects the printed row. A desktop
 * shows a field-shaped button, the magnifier and "Hledat parametr…" in the
 * placeholder's grey; a phone shows the magnifier alone, 44px square, the
 * way a search control looks on a phone (styles: .sum-search). Both open the
 * picker Trendy uses, which brings its own input and keyboard handling. The
 * wrapper is positioned so the picker (absolute, right: 0) hangs under the
 * control; at a card's right edge, 15px in from the viewport and at most
 * 86vw wide, it cannot leave the screen.
 */
import { useState } from "react";
import AnalytePicker, { type PickerOption } from "./AnalytePicker";

export default function SearchParam({
  options,
  onPick,
  label,
}: {
  options: PickerOption[];
  onPick: (id: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  if (options.length === 0) return null;
  return (
    <div className="sum-search">
      <button
        type="button"
        className="btn sum-search-btn"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="6.8" cy="6.8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M10.3 10.3 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <span className="sum-search-text">Hledat parametr…</span>
      </button>
      {open && (
        <AnalytePicker
          options={options}
          onPick={(id) => {
            setOpen(false);
            onPick(id);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
