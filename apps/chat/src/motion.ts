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

/**
 * One box moves, and it is the one the reader is reading in.
 *
 * `scrollIntoView` walks every scrollable ancestor, and the shell is one: it is
 * `height: 100dvh; overflow: hidden`, which stops a *reader* scrolling it and
 * does nothing to a script. Opening „Zdroje" on a phone asked for the block's
 * top, the thread ran out of scroll before it got there, and the shell made up
 * the difference by sliding the whole app 61px up the glass — the header off
 * the top of the screen and 61px of bare page under the composer, a layout
 * failure no CSS rule on this page can explain.
 *
 * So the scroller is found once and written to directly. `overflow: hidden`
 * ancestors are skipped by construction, which is exactly the shell.
 */
function scroller(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** Bring `el` to the top of its scroller — „Zdroje", opening below the fold. */
export function scrollToTop(el: Element): void {
  const box = scroller(el);
  if (!box) return;
  const dy = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
  box.scrollTo({ top: box.scrollTop + dy, behavior: scrollBehavior() });
}

/**
 * Move `el` just far enough to be wholly inside its scroller, or not at all.
 *
 * `scrollIntoView({ block: "nearest" })`, minus the ancestor walk: a `[n]` that
 * focuses a card already on screen must move nothing, which is why the whole
 * card is not simply scrolled to the top.
 */
export function scrollIntoNearest(el: Element): void {
  const box = scroller(el);
  if (!box) return;
  const e = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const above = e.top - b.top;
  const below = e.bottom - b.bottom;
  // Above the top edge: pull it down to the edge. Below the bottom: push up by
  // the overhang, but never past the top edge, so a card taller than the box
  // shows its beginning rather than its end.
  const dy = above < 0 ? above : below > 0 ? Math.min(below, above) : 0;
  if (dy !== 0) box.scrollTo({ top: box.scrollTop + dy, behavior: scrollBehavior() });
}
