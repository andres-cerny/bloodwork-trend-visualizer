/**
 * Light / dark / follow-the-system, in that cycle.
 *
 * Three states rather than two: a doctor on a machine set to dark expects the
 * app to arrive dark, and a two-way toggle has to pick a side at first paint
 * and will be wrong half the time. "Systém" is the default and stays the
 * default until someone chooses otherwise.
 *
 * The choice is the one thing this app does persist. It says nothing about a
 * patient — it is a display preference, and a theme that resets on every
 * reload is not a setting.
 */
import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const KEY = "bloodwork-theme";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "Systém", light: "Světlý", dark: "Tmavý" };
const GLYPH: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    // Private mode, or storage blocked entirely. The system theme is a fine
    // answer; it must not take the page down with it.
    return "system";
  }
}

export default function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(stored);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* preference just won't survive the reload */
    }
  }, [theme]);

  return (
    <button
      className="theme-switch"
      onClick={() => setTheme((t) => NEXT[t])}
      title={`Vzhled: ${LABEL[theme]} — klepnutím přepnete`}
      aria-label={`Vzhled: ${LABEL[theme]}. Přepnout na ${LABEL[NEXT[theme]]}.`}
    >
      <span aria-hidden="true">{GLYPH[theme]}</span>
      <span className="theme-label">{LABEL[theme]}</span>
    </button>
  );
}
