/**
 * The words around the document allowance, held to the copy rules
 * (apps/CLAUDE.md): Czech, decimal comma, no exclamation marks, „parametr"
 * never „analyt". Pure functions and constants, so this runs in node with
 * no DOM — the layout of the chip, the sheet and the page is the auditor's
 * (tests/e2e/audit-portal.e2e.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Allowance, ApiError } from "../src/lib/api";
import { allowanceLabel, allowanceNumbers, exhaustedCopy, PURCHASE_DONE, PURCHASE_LANDED, PURCHASE_PENDING } from "../src/ui/AllowanceChip";
import { BUY_FAILED, buyNotice, PACKAGES, packageLabel, SHOP_CLOSED } from "../src/ui/BuySheet";
import { ALLOWANCE } from "../src/ui/legal";
import { WHY_PAY } from "../src/ui/WhyPayPage";

const a = (used: number, purchased = 0, free = 5): Allowance => ({ free, purchased, used, remaining: Math.max(0, free + purchased - used) });

/** Every sentence a person can read here, for the rules that apply to all. */
const ALL_COPY = [
  allowanceLabel(a(3)),
  exhaustedCopy(a(5)),
  exhaustedCopy(a(20, 15)),
  PURCHASE_PENDING,
  PURCHASE_LANDED,
  PURCHASE_DONE,
  SHOP_CLOSED,
  BUY_FAILED,
  ...PACKAGES.map((p) => p.compare),
  ...PACKAGES.map(packageLabel),
  ...WHY_PAY,
];

describe("the chip", () => {
  it("says used of total, in that order", () => {
    expect(allowanceLabel(a(0))).toBe("Dokumenty: 0 z 5");
    expect(allowanceLabel(a(3))).toBe("Dokumenty: 3 z 5");
    expect(allowanceLabel(a(5))).toBe("Dokumenty: 5 z 5");
    // Bought: the total grows, the free five stay inside it.
    expect(allowanceLabel(a(7, 15))).toBe("Dokumenty: 7 z 20");
    expect(allowanceNumbers(a(0, 5))).toBe("0 z 10");
  });

  it("keeps the total the operator set, even under five", () => {
    expect(allowanceLabel(a(1, 0, 2))).toBe("Dokumenty: 1 z 2");
  });
});

describe("the refusal at zero", () => {
  it("names the free five while nothing was bought, and offers the two ways on", () => {
    expect(exhaustedCopy(a(5))).toBe(
      "Máte vyčerpáno 5 dokumentů zdarma. Přikupte další, nebo pokračujte s tím, co už máte uložené — trendy, souhrn i ověření fungují dál.",
    );
  });

  it("names the whole total once documents were bought — those were not free", () => {
    expect(exhaustedCopy(a(20, 15))).toBe(
      "Máte vyčerpáno všech 20 dokumentů. Přikupte další, nebo pokračujte s tím, co už máte uložené — trendy, souhrn i ověření fungují dál.",
    );
    expect(exhaustedCopy(a(20, 15))).not.toContain("zdarma");
  });

  it("declines the count", () => {
    expect(exhaustedCopy(a(2, 0, 2))).toContain("vyčerpáno 2 dokumenty zdarma");
    expect(exhaustedCopy(a(1, 0, 1))).toContain("vyčerpáno 1 dokument zdarma");
  });
});

describe("the sheet", () => {
  it("sells exactly the two packages the worker sells, at the decided prices", () => {
    expect(PACKAGES.map((p) => [p.id, p.documents, p.czk])).toEqual([
      ["5", 5, 49],
      ["15", 15, 99],
    ]);
    expect(PACKAGES.map(packageLabel)).toEqual(["5 dokumentů za 49 Kč", "15 dokumentů za 99 Kč"]);
  });

  it("puts one comparison line under each price, the ones Ondřej wrote", () => {
    expect(PACKAGES.find((p) => p.id === "5")!.compare).toBe("Méně než jedno kafe ve Starbucks. To se vyplatí, ne?");
    expect(PACKAGES.find((p) => p.id === "15")!.compare).toBe("Levnější než trdelník na Václaváku. A vydrží déle.");
  });

  it("says the shop is not open yet in the one sentence the door agreed on", () => {
    expect(SHOP_CLOSED).toBe("Obchod zatím není otevřený.");
    expect(buyNotice(new ApiError("Obchod zatím není otevřený.", "shop_closed", 503))).toBe(SHOP_CLOSED);
  });

  it("shows the worker's own sentence to a demo visitor, not the generic failure", () => {
    // The demo may not buy (403 demo_readonly, „V demu nelze nakupovat."):
    // that is a rule, not a failure, and the person should read the rule.
    expect(buyNotice(new ApiError("V demu nelze nakupovat.", "demo_readonly", 403))).toBe("V demu nelze nakupovat.");
    // Anything else — a network error, Stripe refusing — is the generic line.
    expect(buyNotice(new ApiError("No such price", "stripe_failed", 502))).toBe(BUY_FAILED);
    expect(buyNotice(new TypeError("Failed to fetch"))).toBe(BUY_FAILED);
  });
});

describe("one source for the promise", () => {
  // The free five, the six pages and the two prices are a promise a
  // stranger reads on the landing and in the terms (legal.tsx ALLOWANCE);
  // the sheet and the why-pay page must read the same constant, not
  // restate the numbers, or the day one changes the other keeps promising.
  it("the sheet's PACKAGES are ALLOWANCE.packages, in order", () => {
    expect(PACKAGES.map((p) => ({ documents: p.documents, czk: p.czk }))).toEqual(ALLOWANCE.packages.map((p) => ({ ...p })));
    expect(PACKAGES.map((p) => p.id)).toEqual(ALLOWANCE.packages.map((p) => String(p.documents)));
  });

  it("the why-pay text carries ALLOWANCE.free and ALLOWANCE.pagesPerDocument, and its source no literal for either", () => {
    const text = WHY_PAY.join(" ");
    expect(text).toContain(`Prvních ${ALLOWANCE.free} dokumentů`);
    expect(text).toContain(`nejvýše ${ALLOWANCE.pagesPerDocument} stran`);
    expect(text).toContain(`${ALLOWANCE.packages[0].documents} dokumentů za ${ALLOWANCE.packages[0].czk} Kč`);
    const source = readFileSync(join(import.meta.dirname, "../src/ui/WhyPayPage.tsx"), "utf-8");
    expect(source).not.toMatch(/Prvních \d/);
    expect(source).not.toMatch(/nejvýše \d/);
    expect(source).not.toContain("./BuySheet");
  });
});

describe("the page: proč přikoupit", () => {
  it("is four to six sentences and says the six things it has to", () => {
    expect(WHY_PAY.length).toBeGreaterThanOrEqual(4);
    expect(WHY_PAY.length).toBeLessThanOrEqual(6);
    const text = WHY_PAY.join(" ");
    expect(text).toContain("dva modely");
    expect(text).toContain("5 dokumentů");
    expect(text).toContain("zdarma, natrvalo");
    expect(text).toContain("5 dokumentů za 49 Kč");
    expect(text).toContain("15 za 99 Kč");
    expect(text).toContain("bez předplatného");
    expect(text).toContain("nepropadají");
    expect(text).toContain("nejvýše 6 stran");
    expect(text).toContain("Smazání reportu dokument nevrátí");
    expect(text).toContain("Stripe");
  });
});

describe("every sentence", () => {
  it("has no exclamation mark, no decimal point, no analyt, and ends like a sentence", () => {
    for (const s of ALL_COPY) {
      expect(s, s).not.toContain("!");
      expect(s, s).not.toMatch(/\d\.\d/);
      expect(s.toLowerCase(), s).not.toContain("analyt");
      expect(s, s).toMatch(/[.?\p{L}0-9]$/u);
    }
  });

  it("uses vykání, never tykání", () => {
    for (const s of ALL_COPY) expect(s, s).not.toMatch(/\b(máš|přikup si|kup si|počkej|zkus)\b/i);
  });
});
