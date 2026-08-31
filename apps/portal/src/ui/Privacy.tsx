/**
 * The privacy page, in plain Czech, reachable logged out at /soukromi.
 *
 * Every sentence here is checkable against the code: what is stored is what
 * schema.sql holds, what never leaves the browser is what redact.ts strips
 * and the review screen shows, and what deletion does is what
 * tests/account.test.ts walks. If a sentence here stops being true, the
 * sentence is the bug report.
 */

export default function Privacy() {
  return (
    <main className="privacy">
      <p>
        <a href="/">← Moje krev</a>
      </p>
      <h1>Co ukládáme, a co ne</h1>

      <h2>Uloženo, k vašemu účtu</h2>
      <ul>
        <li>naměřené hodnoty, jednotky a referenční meze z vašich výsledků,</li>
        <li>začerněné obrázky stránek — kvůli ověření přepisu proti dokumentu,</li>
        <li>přihlašovací e-mail a vaše ruční opravy a přiřazení názvů.</li>
      </ul>
      <p>
        Nic víc. V databázi není sloupec pro jméno, rodné číslo, datum narození ani adresu —
        záměrně: účet je jediná identita.
      </p>

      <h2>Nikdy neopustí váš prohlížeč</h2>
      <ul>
        <li>původní PDF — otevře se u vás a nikam se nenahrává,</li>
        <li>jméno, rodné číslo, datum narození a adresa — před odesláním začerněné z obrázků i z textu,</li>
        <li>vše, co při kontrole začerníte sami.</li>
      </ul>
      <p>
        Kontrola před nahráním není formalita: automatika čte textovou vrstvu a nevidí razítko ani
        podpis. Poslední pohled je váš.
      </p>

      <h2>Ke zpracování odchází</h2>
      <p>
        Začerněné řádky s hodnotami (u skenů začerněný obrázek stránky) na náš server a z něj do
        Anthropic API, které je přepíše na čísla. Přepis se neukládá u zpracovatele; útrata za
        zpracování má měsíční strop na osobu.
      </p>

      <h2>Vaše data jsou vaše</h2>
      <ul>
        <li>
          <strong>Export</strong> — kdykoli, jedním souborem (JSON nebo CSV), v záložce Reporty.
        </li>
        <li>
          <strong>Smazání účtu</strong> — okamžité a úplné: hodnoty, obrázky stránek, opravy i
          e-mail. Bez lhůt, bez kopie.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>Jedna, přihlašovací, na 90 dní, nedostupná skriptům. Žádná analytika, žádné třetí strany.</p>
    </main>
  );
}
