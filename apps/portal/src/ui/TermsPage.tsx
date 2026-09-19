/**
 * The terms of use, in plain Czech, reachable logged out at /podminky.
 *
 * A draft until the operator approves it (legal.tsx: LEGAL_DRAFT), and it
 * says so at the top. Every sentence about what the service does is one the
 * code can be checked against; the sentences about who runs it render from
 * the OPERATOR placeholder, which is the operator's to fill. Numbered
 * sections, short, no clause a reader would need a lawyer to parse — the
 * reader is a person with a lab report, not a counterparty.
 */
import { ALLOWANCE, CONTACT_PATH, DraftBanner, LEGAL_VERSION, LegalFooter, OPERATOR, PRIVACY_PATH } from "./legal";

export default function TermsPage() {
  const [small, large] = ALLOWANCE.packages;
  return (
    <main className="privacy legal">
      <p>
        <a href="/">← Moje krev</a>
      </p>
      <DraftBanner />
      <h1>Podmínky užití</h1>
      <p className="legal-meta">Verze: {LEGAL_VERSION}</p>

      <h2>1. Kdo službu provozuje</h2>
      <p>
        Službu Moje krev (dále „služba") provozuje {OPERATOR.name}, {OPERATOR.address} (dále
        „provozovatel"). Kontakt: {OPERATOR.email}, nebo stránka{" "}
        <a href={CONTACT_PATH}>Napište nám</a>.
      </p>

      <h2>2. Co služba dělá</h2>
      <p>
        Přijme laboratorní zprávu — PDF nebo fotografii — přepíše z ní hodnoty, jednotky a
        referenční meze tak, jak je laboratoř vytiskla, a uloží je k vašemu účtu. Ukazuje je
        pohromadě a v čase, s mezemi, které uvedla laboratoř, a s možností ověřit každý přepsaný
        řádek proti začerněné stránce.
      </p>

      <h2>3. Co služba nedělá</h2>
      <ul>
        <li>Není zdravotnický prostředek a není určena k diagnostice ani k rozhodování o léčbě.</li>
        <li>Nestanovuje diagnózu, hodnoty nehodnotí a neradí, co dělat.</li>
        <li>
          Používá jen referenční meze vytištěné laboratoří. Zda hodnota leží v mezích, říká
          laboratoř, ne provozovatel.
        </li>
        <li>Nenahrazuje lékaře. Co pro vás výsledky znamenají, je otázka na něj.</li>
        <li>
          Přepis provádí model a může se zmýlit. Hodnotu, na které záleží, si ověřte proti
          stránce v záložce Ověření a proti původní zprávě.
        </li>
      </ul>

      <h2>4. Účet</h2>
      <ul>
        <li>Účet je vedený na e-mailovou adresu; na jednu adresu jeden účet.</li>
        <li>Službu může užívat osoba starší 18 let.</li>
        <li>
          Do účtu nahráváte své vlastní laboratorní zprávy, nebo zprávy člověka, který vás o to
          požádal a ví, co služba s nimi dělá.
        </li>
        <li>
          Heslo a přihlašovací odkazy jsou vaše; kdo je má, má i účet. Ztrátu přístupu řeší
          odkaz „Zapomenuté heslo" na adresu účtu.
        </li>
      </ul>

      <h2>5. Dokumenty zdarma a balíčky</h2>
      <ul>
        <li>
          Každý účet má {ALLOWANCE.free} dokumentů zdarma, natrvalo. Dokument je jedno PDF nebo
          jedna sada fotografií do {ALLOWANCE.pagesPerDocument} stran.
        </li>
        <li>
          Dokument se odečte ve chvíli, kdy je přijat ke čtení. Když se čtení nezdaří, dokument se
          vrátí. Smazání reportu dokument nevrací.
        </li>
        <li>
          Další dokumenty přikoupíte v balíčcích: {small.documents} za {small.czk} Kč a{" "}
          {large.documents} za {large.czk} Kč. Ceny jsou konečné.
        </li>
        <li>Žádné předplatné. Přikoupené dokumenty nepropadají.</li>
        <li>
          Platbu zajišťuje Stripe; provozovatel nevidí číslo karty. Peníze vracíme za dokumenty z
          balíčku, které nebyly přečteny; za přečtený dokument ne. O vrácení požádejte přes{" "}
          <a href={CONTACT_PATH}>Napište nám</a>.
        </li>
        <li>
          Provozovatel může výši bezplatného počtu i ceny balíčků do budoucna změnit; už
          přikoupené dokumenty zůstávají.
        </li>
      </ul>

      <h2>6. Co je dovoleno</h2>
      <ul>
        <li>Užívat službu pro sebe a pro lidi, kteří vás o to požádali.</li>
        <li>Není dovoleno nahrávat cizí zprávy bez vědomí toho, o kom jsou.</li>
        <li>
          Není dovoleno službu zatěžovat automatizovaně, obcházet ověření, že formulář vyplňuje
          člověk, ani se pokoušet o přístup k jiným účtům.
        </li>
        <li>
          Účet, který tato pravidla porušuje, může provozovatel uzavřít. Export dat zůstává
          dostupný před smazáním.
        </li>
      </ul>

      <h2>7. Dostupnost</h2>
      <p>
        Služba běží podle nejlepší snahy provozovatele, bez záruky nepřetržité dostupnosti.
        Může být kdykoli přerušena kvůli údržbě nebo ukončena; v takovém případě dostanete
        možnost svá data exportovat.
      </p>

      <h2>8. Ukončení a smazání</h2>
      <ul>
        <li>
          Účet můžete kdykoli smazat sami, v záložce Reporty. Smazání je okamžité a úplné:
          hodnoty, začerněné stránky, ruční opravy, přiřazení názvů, kontext pro AI i e-mail.
        </li>
        <li>
          Co zůstává: záznam o platbě (částka, datum, e-mail), po dobu, kterou ukládají účetní a
          daňové předpisy, a zprávy poslané přes Napište nám po dobu uvedenou v Zásadách ochrany
          soukromí.
        </li>
        <li>Před smazáním si data můžete exportovat (JSON nebo CSV).</li>
      </ul>

      <h2>9. Změny podmínek</h2>
      <p>
        Podmínky se mohou měnit. Platná verze je vždy na této stránce, s datem verze nahoře.
        O změně, která se vás dotkne, dáme vědět e-mailem na adresu účtu; užívání služby po
        tomto datu znamená souhlas s novou verzí.
      </p>

      <h2>10. Rozhodné právo</h2>
      <p>
        Návrh: podmínky se řídí právem České republiky. Práva, která vám jako spotřebiteli dává
        zákon, tím nejsou dotčena. Spor lze řešit také mimosoudně u České obchodní inspekce
        (www.coi.cz).
      </p>

      <h2>11. Osobní údaje</h2>
      <p>
        Jak služba zachází s vašimi údaji, popisují <a href={PRIVACY_PATH}>Zásady ochrany soukromí</a>
        .
      </p>

      <h2>12. Kontakt</h2>
      <p>
        <a href={CONTACT_PATH}>Napište nám</a> — zpráva dorazí provozovateli; odpovídáme na adresu,
        kterou uvedete.
      </p>

      <LegalFooter />
    </main>
  );
}
