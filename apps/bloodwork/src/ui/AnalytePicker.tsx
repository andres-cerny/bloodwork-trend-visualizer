/**
 * Pick an analyte by typing, the way the Streamlit original did.
 *
 * A native <select> was wrong here for two reasons: with 20+ analytes you
 * cannot search it (typing only jumps to a first letter), and choosing from it
 * *replaced* what you were looking at instead of adding to it. This opens a
 * filtered list, matches without diacritics — "muzova" finds "Kyselina močová"
 * — and leaves the analytes already on screen alone.
 */
import { useEffect, useMemo, useRef, useState } from "react";

export interface PickerOption {
  id: string;
  label: string;
  /** Short suffix shown after the name: "mimo rozmezí", "čeká na ověření". */
  note?: string;
  outOfRange?: boolean;
}

/** Lowercase, diacritics stripped — a Czech name has to be findable without them. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function filterOptions(options: PickerOption[], query: string): PickerOption[] {
  const q = fold(query.trim());
  if (!q) return options;
  // Prefix matches first: typing "al" should offer ALT before Kyselina
  // močová, which merely contains the letters.
  const starts = options.filter((o) => fold(o.label).startsWith(q));
  const rest = options.filter((o) => !fold(o.label).startsWith(q) && fold(o.label).includes(q));
  return [...starts, ...rest];
}

interface Props {
  options: PickerOption[];
  onPick: (id: string) => void;
  onClose: () => void;
}

export default function AnalytePicker({ options, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => filterOptions(options, query), [options, query]);

  useEffect(() => {
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  useEffect(() => setCursor(0), [query]);

  return (
    <div className="picker" ref={boxRef} role="dialog" aria-label="Přidat parametr">
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="Hledat parametr…"
        aria-label="Hledat parametr"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") return onClose();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === "Enter" && shown[cursor]) {
            e.preventDefault();
            onPick(shown[cursor].id);
          }
        }}
      />
      <ul className="picker-list">
        {shown.map((o, i) => (
          <li key={o.id}>
            <button
              className={`picker-item${i === cursor ? " on" : ""}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => onPick(o.id)}
            >
              <span className="picker-name">{o.label}</span>
              {o.note && (
                <span className={o.outOfRange ? "chip alert" : "chip"}>{o.note}</span>
              )}
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="muted" style={{ padding: "8px 10px" }}>
            Nic neodpovídá „{query}“.
          </li>
        )}
      </ul>
    </div>
  );
}
