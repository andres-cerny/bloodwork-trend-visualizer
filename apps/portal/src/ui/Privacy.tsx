/**
 * The privacy page, in plain Czech, reachable logged out at /soukromi.
 *
 * Every sentence here is checkable against the code: what is stored is what
 * schema.sql holds, what never leaves the browser is what redact.ts strips
 * and the review screen shows, and what deletion does is what
 * tests/account.test.ts walks. If a sentence here stops being true, the
 * sentence is the bug report.
 */
import { useEffect, useState } from "react";
import { processorPhrase, RETENTION_NOTE } from "@bw/ui-kit";
import { getProcessors } from "../lib/api";

export default function Privacy() {
  // Who processes a page is asked of the deployment, not written down here.
  // workers/portal-extract is config over the extractor's code, so a secret
  // and a var would have sent redacted page images of real family data to a
  // second vendor while this page still named only the first
  // (docs/security-review-gemini.md, finding 1). `null` — loading, or the
  // request failed — names every processor rather than fewer.
  const [photoReaders, setPhotoReaders] = useState<string | null>(null);
  useEffect(() => {
    getProcessors().then(
      (p) => setPhotoReaders(p.photoReaders),
      () => setPhotoReaders(null),
    );
  }, []);

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
        <li>
          přihlašovací e-mail, otisk hesla (heslo samo ne), vaše ruční opravy, přiřazení názvů a
          parametry, které jste si sami založili — jejich název, jednotku a rozmezí z vašeho
          dokumentu,
        </li>
        <li>
          kontext pro AI, pokud jste ho vyplnili — pohlaví, věková skupina, výška, váha, pohyb, léky a
          doplňky, diagnózy, kouření, alkohol a vaše poznámka. Jméno k němu nepřidáváme; co napíšete
          sami, uložíme tak, jak jste to napsali. Mizí s účtem.
        </li>
      </ul>
      <p>
        Nic víc. V databázi není sloupec pro jméno, rodné číslo, datum narození ani adresu —
        záměrně: účet je jediná identita.
      </p>

      <h2>Nikdy neopustí váš prohlížeč</h2>
      <ul>
        <li>původní PDF i fotka — otevřou se u vás a nikam se nenahrávají,</li>
        <li>jméno, rodné číslo, datum narození a adresa — začerněné z obrázků i z textu, vždy před odesláním,</li>
        <li>vše, co při kontrole začerníte sami.</li>
      </ul>
      <p>
        Kontrola před nahráním není formalita: automatika čte textovou vrstvu a nevidí razítko ani
        podpis. Poslední pohled je váš.
      </p>
      <p>
        U fotky a u skenu žádná textová vrstva není, takže automatika nemá kde hledat a nenajde nic
        — ne proto, že by tam nic nebylo. Tam začerníte hlavičku vy: kontrola u nich začíná bez
        jediného nalezeného pole a s tužkou v ruce, a bez ní se fotka neodesílá.
      </p>

      <h2>Ke zpracování odchází</h2>
      <p>
        Začerněné řádky s hodnotami (u skenů a fotek začerněný obrázek stránky) na náš server a z
        něj{" "}
        {processorPhrase(photoReaders)}, kde se přepíšou na čísla. {RETENTION_NOTE} Útrata za
        zpracování má měsíční strop na osobu.
      </p>

      <h2>AI konzultace — jen když chcete</h2>
      <p>
        Na záložce AI konzultace si můžete vytvořit dočasný odkaz na stránku s prostým textem: vaše
        hodnoty, jednotky, referenční meze a data odběrů, a pokud jste ho vyplnili, i kontext o vás —
        bez jména, bez e-mailu, bez obrázků stránek.
        Odkaz platí 24 hodin, kdykoli ho zrušíte, a nový nahrazuje starý. Je náhodný a nikde
        zveřejněný není: kdo ho nezná, nic neuvidí. Čte ho asistent, kterému ho sami vložíte — a
        u něj platí podmínky jeho provozovatele, ne naše.
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
