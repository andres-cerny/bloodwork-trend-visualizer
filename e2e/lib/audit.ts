/**
 * A layout auditor that runs against the real, rendered page.
 *
 * The defects this project keeps producing are not logic errors — the unit
 * suite has never missed one of those. They are geometric: a chip that pushes
 * a table column off its own card, a sticky bar that sits on the first row of
 * content, a status word clipped to "nedopor…" with no ellipsis to say so, a
 * button whose centre belongs to something painted over it. None of that is
 * visible to a test that reads state, and all of it is trivially visible to
 * one that reads boxes.
 *
 * So this walks every element on screen and reports violations of eight
 * invariants. It is deliberately generic: it knows nothing about this app, so
 * it keeps working when the markup changes, and a new screen gets audited by
 * being added to the list of screens rather than by writing new assertions.
 *
 * Every rule here fired on real markup at least once while it was written.
 * The ones that produced only false positives were deleted rather than
 * loosened, because an auditor that cries wolf gets muted and then ignored.
 */
import type { Page } from "playwright";

export interface Flaw {
  rule: string;
  detail: string;
  where: string;
}

/** Rules a screen may legitimately break, keyed by rule name. */
export interface AuditOptions {
  /** CSS selectors whose subtrees are exempt, with a reason. */
  ignore?: string[];
  /** Rules to skip entirely on this screen. */
  skip?: string[];
}

/**
 * The audit body, serialised into the page.
 *
 * Written as one self-contained function because it has to execute inside the
 * browser: it needs getComputedStyle, elementFromPoint and live layout boxes,
 * none of which survive a trip across the wire.
 */
/* eslint-disable */
function inPage(opts: { ignore: string[]; skip: string[] }): Flaw[] {
  const flaws: Flaw[] = [];
  const add = (rule: string, where: string, detail: string) => {
    if (opts.skip.includes(rule)) return;
    flaws.push({ rule, where, detail });
  };

  /** A short, human-findable description of an element. */
  const name = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const cls = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    const id = el.id ? `#${el.id}` : "";
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${tag}${id}${cls.length ? "." + cls.join(".") : ""}${text ? ` «${text}»` : ""}`;
  };

  const ignored = new Set<Element>();
  for (const sel of opts.ignore) {
    document.querySelectorAll(sel).forEach((root) => {
      ignored.add(root);
      root.querySelectorAll("*").forEach((d) => ignored.add(d));
    });
  }

  const all = Array.from(document.body.querySelectorAll("*"));

  /**
   * The part of an element that is actually painted.
   *
   * getBoundingClientRect reports where a box *would* be, which for anything
   * scrolled out of a capped list is a position on top of whatever follows
   * the list. Every collision rule below was reporting those phantoms until
   * the rect was intersected with each clipping ancestor.
   */
  const clipped = (el: Element): DOMRect => {
    let r = el.getBoundingClientRect();
    let top = r.top, left = r.left, right = r.right, bottom = r.bottom;
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      const ps = getComputedStyle(p);
      const clips = (o: string) => o === "hidden" || o === "clip" || o === "auto" || o === "scroll";
      if (clips(ps.overflowX) || clips(ps.overflowY)) {
        const pr = p.getBoundingClientRect();
        if (clips(ps.overflowX)) { left = Math.max(left, pr.left); right = Math.min(right, pr.right); }
        if (clips(ps.overflowY)) { top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom); }
      }
      p = p.parentElement;
    }
    return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
  };

  const visible = (el: Element): boolean => {
    if (ignored.has(el)) return false;
    // checkVisibility, not just display/opacity. The body of a closed
    // <details> is hidden with `content-visibility`, which leaves
    // getBoundingClientRect reporting a real box at the disclosure's
    // position — so every collapsed occurrence table looked like a stack of
    // buttons piled on the card behind it. This is the API that knows.
    const anyEl = el as Element & {
      checkVisibility?: (o: Record<string, boolean>) => boolean;
    };
    if (typeof anyEl.checkVisibility === "function") {
      if (
        !anyEl.checkVisibility({
          contentVisibilityAuto: true,
          opacityProperty: true,
          visibilityProperty: true,
        })
      ) {
        return false;
      }
    }
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) < 0.05) return false;
    const r = clipped(el);
    return r.width > 0.5 && r.height > 0.5;
  };

  const shown = all.filter(visible);

  /**
   * The positioned ancestor an element belongs to, or null for the page.
   *
   * Two controls in different layers — a dropdown over the list behind it, a
   * drawer over the page, a sticky bar over the content scrolling beneath it
   * — are stacked on purpose. Comparing across layers reports the design
   * rather than a defect.
   */
  const layerOf = (el: Element): Element | null => {
    let p: Element | null = el;
    while (p && p !== document.body) {
      const ps = getComputedStyle(p);
      if (ps.position === "fixed" || ps.position === "absolute" || ps.position === "sticky") return p;
      p = p.parentElement;
    }
    return null;
  };

  // ---- 1. The page itself must not scroll sideways -----------------------
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1) {
    add("page-overflow", "document", `page scrolls sideways: ${doc.scrollWidth}px of content in ${doc.clientWidth}px`);
  }

  /** Does any ancestor scroll horizontally, making overflow intentional? */
  const inScroller = (el: Element, axis: "x" | "y"): boolean => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const s = getComputedStyle(p);
      const o = axis === "x" ? s.overflowX : s.overflowY;
      if (o === "auto" || o === "scroll") return true;
      p = p.parentElement;
    }
    return false;
  };

  for (const el of shown) {
    const s = getComputedStyle(el);
    const r = clipped(el);

    // ---- 2. Nothing may sit outside the viewport ------------------------
    // A fixed off-canvas drawer is parked off-screen on purpose; so is
    // anything inside a horizontal scroller.
    const parked = s.position === "fixed" || s.position === "absolute";
    if (!parked && !inScroller(el, "x")) {
      if (r.right > window.innerWidth + 1.5) {
        add("offscreen", name(el), `extends ${Math.round(r.right - window.innerWidth)}px past the right edge`);
      }
      if (r.left < -1.5) {
        add("offscreen", name(el), `starts ${Math.round(-r.left)}px left of the viewport`);
      }
    }

    // ---- 3. Text must not be silently cut off ---------------------------
    // Only elements that hold text themselves: a wrapper's scrollWidth is its
    // children's business, and reporting both would report every ancestor.
    const ownText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && (n.textContent || "").trim().length > 1,
    );
    if (ownText) {
      const clipX = s.overflowX === "hidden" || s.overflowX === "clip";
      const clipY = s.overflowY === "hidden" || s.overflowY === "clip";
      const ellipsis = s.textOverflow === "ellipsis";
      if (clipX && !ellipsis && el.scrollWidth > el.clientWidth + 1) {
        add("clipped-text", name(el), `text is ${el.scrollWidth - el.clientWidth}px wider than its box, cut with no ellipsis`);
      }
      if (clipY && el.scrollHeight > el.clientHeight + 1) {
        add("clipped-text", name(el), `text is ${el.scrollHeight - el.clientHeight}px taller than its box`);
      }
    }

    // ---- 4. Readable contrast -------------------------------------------
    if (ownText && r.width > 4 && r.height > 4) {
      const fg = parseColor(s.color);
      const bg = effectiveBg(el);
      if (fg && bg) {
        const ratio = contrast(fg, bg);
        const px = parseFloat(s.fontSize);
        const bold = Number(s.fontWeight) >= 700;
        const large = px >= 24 || (px >= 18.66 && bold);
        const floor = large ? 3 : 4.5;
        if (ratio < floor) {
          add("contrast", name(el), `contrast ${ratio.toFixed(2)}:1 against its background, needs ${floor}:1`);
        }
      }
    }
  }

  // ---- 5. Interactive things must be reachable and big enough ------------
  const interactiveSel = 'button, a[href], input, select, textarea, [role="tab"], [role="button"], summary';
  const controls = shown.filter((el) => el.matches(interactiveSel));
  const layer = new Map<Element, Element | null>();
  for (const c of controls) layer.set(c, layerOf(c));

  for (const el of controls) {
    const r = clipped(el);
    // Size is intrinsic; collision is about what is painted. A tab scrolled
    // half out of a horizontal tab strip is not a small target, so this one
    // rule reads the element's own box rather than the clipped one.
    const own = el.getBoundingClientRect();
    const s = getComputedStyle(el);

    // Too small to hit. WCAG 2.2 AA puts the floor at 24×24 CSS px, but a
    // control may satisfy the *intent* by being a long thin row: a full-width
    // disclosure row 20px tall is an easy target, an 22×17px ✕ is not. So the
    // test is the smaller side against 24px, waived once the whole box is
    // comfortably larger than the 24×24 square the rule is protecting.
    const area = own.width * own.height;
    if (Math.min(own.width, own.height) < 24 && area < 24 * 48) {
      // An inline link inside a paragraph is exempt: it is sized by its text
      // and the sentence around it is the target. So is a checkbox wrapped in
      // its own label — the label is what the reader actually clicks, and it
      // is the full width of the sentence.
      const inlineLink = el.tagName === "A" && s.display.startsWith("inline");
      const labelled =
        el.tagName === "INPUT" &&
        ["checkbox", "radio"].includes((el as HTMLInputElement).type) &&
        el.closest("label") !== null;
      if (!inlineLink && !labelled) {
        add("tiny-target", name(el), `${Math.round(own.width)}×${Math.round(own.height)}px, below the 24×24 floor`);
      }
    }

    // Covered by something painted over it. This is the rule that catches
    // "text sitting on top of a feature": hit-test the control's own centre
    // and see who actually receives the click.
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight) {
      const hit = document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        // Deliberate layering is not coverage: a dropdown over the list it
        // belongs to, a drawer over the page, a scrim over what it blocks.
        // Sticky bars are excluded for the same reason — content scrolling
        // under one is what sticky means. What is left is a genuine collision
        // between two things that were meant to sit side by side.
        const hs = getComputedStyle(hit);
        const layered = layerOf(hit) !== (layer.get(el) ?? null);
        const stickyBar = hs.position === "sticky" || hs.position === "fixed";
        if (!layered && !stickyBar) add("covered", name(el), `its centre belongs to ${name(hit)}`);
      }
    }
  }

  // ---- 6. Controls must not overlap each other --------------------------
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i];
      const b = controls[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (layer.get(a) !== layer.get(b)) continue;
      const ra = clipped(a);
      const rb = clipped(b);
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w <= 1 || h <= 1) continue;
      const overlap = w * h;
      const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
      if (smaller > 0 && overlap / smaller > 0.25) {
        add("overlap", name(a), `overlaps ${name(b)} by ${Math.round((overlap / smaller) * 100)}%`);
      }
    }
  }

  // ---- colour helpers ---------------------------------------------------
  function parseColor(c: string): [number, number, number, number] | null {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }

  /** Composite background colours up the tree until one is opaque. */
  function effectiveBg(el: Element): [number, number, number] | null {
    let cur: Element | null = el;
    let acc: [number, number, number, number] | null = null;
    while (cur) {
      const c = parseColor(getComputedStyle(cur).backgroundColor);
      if (c && c[3] > 0) {
        acc = acc ? over(acc, c) : c;
        if (acc[3] >= 0.99) return [acc[0], acc[1], acc[2]];
      }
      cur = cur.parentElement;
    }
    // Nothing opaque found: fall back to the canvas colour.
    const body = parseColor(getComputedStyle(document.body).backgroundColor);
    if (acc && body) {
      const f = over(acc, body);
      return [f[0], f[1], f[2]];
    }
    return body ? [body[0], body[1], body[2]] : null;
  }

  /** `top` painted over `bottom`. */
  function over(
    top: [number, number, number, number],
    bottom: [number, number, number, number],
  ): [number, number, number, number] {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    const ch = (i: number) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
    return [ch(0), ch(1), ch(2), a];
  }

  function luminance([r, g, b]: [number, number, number]): number {
    const f = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function contrast(fg: [number, number, number, number], bg: [number, number, number]): number {
    // Flatten a translucent foreground onto its background first, otherwise
    // every muted-with-alpha token reads as a failure it is not.
    const solid: [number, number, number] =
      fg[3] >= 0.99
        ? [fg[0], fg[1], fg[2]]
        : [
            fg[0] * fg[3] + bg[0] * (1 - fg[3]),
            fg[1] * fg[3] + bg[1] * (1 - fg[3]),
            fg[2] * fg[3] + bg[2] * (1 - fg[3]),
          ];
    const l1 = luminance(solid);
    const l2 = luminance(bg);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  }

  return flaws;
}
/* eslint-enable */

/** Run the audit against whatever is currently on screen. */
export async function audit(page: Page, opts: AuditOptions = {}): Promise<Flaw[]> {
  return (await page.evaluate(inPage as any, {
    ignore: opts.ignore ?? [],
    skip: opts.skip ?? [],
  })) as Flaw[];
}

/** One line per flaw, for a failure message that says what to go and look at. */
export function report(label: string, flaws: Flaw[]): string {
  if (flaws.length === 0) return "";
  const byRule = new Map<string, Flaw[]>();
  for (const f of flaws) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule)!.push(f);
  }
  const lines = [`${flaws.length} layout flaw(s) on ${label}:`];
  for (const [rule, fs] of byRule) {
    lines.push(`  ${rule} (${fs.length}):`);
    for (const f of fs.slice(0, 6)) lines.push(`    - ${f.where}: ${f.detail}`);
    if (fs.length > 6) lines.push(`    … and ${fs.length - 6} more`);
  }
  return lines.join("\n");
}
