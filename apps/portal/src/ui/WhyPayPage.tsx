/**
 * Proč přikoupit? — the page behind the link beside „Dokumenty: 3 z 5",
 * reachable logged out at /proc-prikoupit, the same kind of page as
 * /soukromi and in the same prose column.
 *
 * Every sentence is checkable against the code: the two readers are the
 * extractor's pair (packages/extraction), the five free documents and the
 * two packages are workers/portal/src/allowance.ts and stripe.ts, the page
 * cap is MAX_PAGES_PER_REPORT in workers/portal/wrangler.jsonc (6), and what
 * a deletion does to the count is tests/allowance.test.ts. The numbers are
 * written here rather than fetched because the page has to read before a
 * login and the prices are a decision, not a measurement.
 */
import { ALLOWANCE, LegalHead } from "./legal";

/** The six sentences, exported so a node test can hold them to the copy rules. */
export const WHY_PAY: readonly string[] = [
  "Každý dokument čtou dva modely nezávisle na sobě, aby se odhalil přepis, ve kterém jeden z nich chybuje, a za každou přečtenou stránku platíme.",
  "Prvních 5 dokumentů má každý účet zdarma, natrvalo — dokument je jedno PDF nebo jedna sada fotografií, nejvýše 6 stran.",
  `Kdo potřebuje víc, přikoupí balíček: ${ALLOWANCE.packages[0].documents} dokumentů za ${ALLOWANCE.packages[0].czk} Kč nebo ${ALLOWANCE.packages[1].documents} za ${ALLOWANCE.packages[1].czk} Kč, bez předplatného, a dokumenty nepropadají.`,
  "Smazání reportu dokument nevrátí — čtení už proběhlo a bylo zaplaceno; vrací se jen dokument, ze kterého se nepodařilo přečíst ani jednu stranu.",
  "Platbu zpracovává Stripe, kartou nebo přes Apple Pay a Google Pay, a číslo karty k nám nedorazí.",
  "Přikoupit najdete v aplikaci na kartě Reporty, hned pod uloženými reporty.",
];

export default function WhyPayPage() {
  return (
    <main className="privacy">
      <LegalHead />
      <h1>Proč přikoupit?</h1>
      {WHY_PAY.map((s) => (
        <p key={s}>{s}</p>
      ))}
    </main>
  );
}
