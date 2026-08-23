/**
 * Motion, asked rather than assumed.
 *
 * Three places in this app move the page for the reader: opening a mobile
 * „Zdroje" disclosure, focusing an evidence card from a `[n]`, and following a
 * live answer down the thread. CSS can be told to stop animating with one
 * `prefers-reduced-motion` block; `scrollIntoView({ behavior: "smooth" })`
 * cannot — it is a script argument, and it keeps scrolling smoothly for a
 * reader who has asked the whole system not to. This is that argument.
 *
 * Read per call, not cached: the setting is a system toggle, and a reader who
 * flips it mid-session should not have to reload.
 */
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}
