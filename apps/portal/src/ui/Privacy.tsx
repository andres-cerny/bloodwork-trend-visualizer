/**
 * The privacy page, in plain Czech, reachable logged out at /soukromi.
 *
 * Every sentence here is checkable against the code: what is stored is what
 * schema.sql holds, what never leaves the browser is what redact.ts strips
 * and the review screen shows, and what deletion does is what
 * tests/account.test.ts walks. If a sentence here stops being true, the
 * sentence is the bug report.
 *
 * A draft until the operator approves it (legal.tsx: LEGAL_DRAFT); the
 * controller renders from the OPERATOR placeholder. The one clause that
 * varies with the deployment — who reads a page — is asked of the
 * deployment, never written down: see processorPhrase.
 */
import { useEffect, useState } from "react";
import { processorPhrase, RETENTION_NOTE, sendsToGoogle } from "@bw/ui-kit";
import { getProcessors } from "../lib/api";
import { CONSENT_HEALTH, CONTACT_PATH, DraftBanner, LEGAL_VERSION, LegalFooter, LegalHead, OPERATOR, TERMS_PATH } from "./legal";

/**
 * The seat and the transfer basis of the five processors under a
 * data-processing agreement — one sentence, once, so the five bullets
 * cannot drift from each other. Telegram is not among them: see its bullet.
 */
const SEAT_USA = "Sídlo: USA; předání se opírá o standardní smluvní doložky EU, které jsou součástí smlouvy o zpracování.";

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
    <main className="privacy legal">
      <LegalHead />
      <DraftBanner />
      <h1>Zásady ochrany soukromí</h1>
      <p className="legal-meta">Verze: {LEGAL_VERSION}</p>

      <h2>1. Kdo je správcem</h2>
      <p>
        Správcem vašich údajů je {OPERATOR.name}, {OPERATOR.address}, e-mail {OPERATOR.email}.
        Žádosti týkající se údajů pošlete tam nebo přes <a href={CONTACT_PATH}>Napište nám</a>.
      </p>

      <h2>2. Co zpracováváme a proč</h2>
      <ul>
        <li>
          <strong>Hodnoty z laboratorních zpráv a začerněné stránky</strong> — naměřené hodnoty,
          jednotky a referenční meze, a začerněné obrázky stránek kvůli ověření přepisu. Jsou to
          údaje o zdraví, zvláštní kategorie podle čl. 9 GDPR. Zpracováváme je jen na základě
          vašeho výslovného souhlasu, který dáváte při registraci zaškrtnutím věty:
        </li>
      </ul>
      <blockquote className="legal-quote">„{CONSENT_HEALTH}“</blockquote>
      <ul>
        <li>
          <strong>E-mail</strong> — vede účet, chodí na něj přihlašovací odkazy a odpovědi na vaše
          zprávy. Základ: plnění smlouvy (<a href={TERMS_PATH}>Podmínky užití</a>).
        </li>
        <li>
          <strong>Otisk hesla</strong> (heslo samo ne), <strong>vaše ruční opravy</strong>, přiřazení
          názvů a parametry, které jste si založili — jejich název, jednotku a rozmezí z vašeho
          dokumentu. Základ: plnění smlouvy.
        </li>
        <li>
          <strong>Kontext pro AI</strong>, pokud jste ho vyplnili — pohlaví, věková skupina, výška,
          váha, pohyb, léky a doplňky, diagnózy, kouření, alkohol a vaše poznámka. Jméno k němu
          nepřidáváme; co napíšete sami, uložíme tak, jak jste to napsali. Základ: váš souhlas
          (vyplnění je dobrovolné), mizí s účtem.
        </li>
        <li>
          <strong>Záznamy o přihlašování</strong> — neúspěšné pokusy k adrese a otisk IP adresy u
          registrace, kvůli zámku po opakovaných chybách a omezení počtu registrací. Základ:
          oprávněný zájem na bezpečnosti účtů.
        </li>
        <li>
          <strong>Zprávy z Napište nám</strong> — vaše adresa, text, případně id reportu a označení
          prohlížeče (nejvýše 200 znaků), abychom mohli odpovědět a poznat, v čem se to stalo.
          Základ: oprávněný zájem na vyřízení vaší žádosti.
        </li>
        <li>
          <strong>Záznamy o odmítnutích</strong> — když server něco odmítne (chyba, odmítnuté
          nahrání), uloží se cesta, stav, kód chyby, otisk účtu a id požadavku; nikdy hodnota,
          stránka, název parametru ani e-mail. Ukazují nám u vaší zprávy, co se stalo. Základ:
          oprávněný zájem na vyřízení vaší žádosti a na provozu služby.
        </li>
        <li>
          <strong>Nákup balíčku</strong> — e-mail, částka, datum a identifikátor platby od Stripe.
          Základ: plnění smlouvy a účetní předpisy.
        </li>
      </ul>
      <p>
        Nic víc. V databázi není sloupec pro jméno, rodné číslo, datum narození ani adresu —
        záměrně: účet je jediná identita.
      </p>

      <h2>3. Co nikdy neopustí váš prohlížeč</h2>
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

      <h2>4. Kdo údaje zpracovává za nás</h2>
      <p>
        Začerněné řádky s hodnotami (u skenů a fotek začerněný obrázek stránky) odcházejí na náš
        server a z něj {processorPhrase(photoReaders)}, kde se přepíšou na čísla. {RETENTION_NOTE}{" "}
        Útrata za zpracování má měsíční strop na osobu.
      </p>
      {/* The seat is stated per processor, where it is known. Five sit in
          the USA under a data-processing agreement with the EU's standard
          contractual clauses; Telegram sits in Dubai with no such agreement
          and carries nothing but the message the person wrote — so one
          sentence about all of them was false for it. */}
      <ul>
        <li>
          <strong>Cloudflare</strong> — běh aplikace, databáze a úložiště začerněných stránek.
          Datová centra Cloudflare: databáze leží v jedné oblasti, úložiště stránek je
          rozprostřené po síti Cloudflare, takže kopie mohou být i mimo EU. Model běžící u
          Cloudflare (Workers AI) přečte zprávu z Napište nám spolu se záznamy o odmítnutích
          vašeho účtu a připraví provozovateli první odhad příčiny; nedostane žádnou hodnotu ani
          stránku. {SEAT_USA}
        </li>
        <li>
          <strong>Anthropic</strong> — začerněný text stránky, u skenů a fotek začerněný obrázek
          stránky, k přepisu na čísla. {SEAT_USA}
        </li>
        {sendsToGoogle(photoReaders) && (
          <li>
            <strong>Google</strong> — začerněný obrázek stránky u fotografií a skenů, jako druhé
            čtení téže stránky. {SEAT_USA}
          </li>
        )}
        <li>
          <strong>Resend</strong> — vaše e-mailová adresa a obsah zprávy (odkaz, odpověď), aby
          mail došel. {SEAT_USA}
        </li>
        <li>
          <strong>Stripe</strong> — při nákupu balíčku: e-mail a částka. Číslo karty zadáváte
          Stripe; naše aplikace ho nikdy nevidí. {SEAT_USA}
        </li>
        <li>
          <strong>Telegram</strong> — zpráva z Napište nám (adresa, text, případně id reportu) se
          přepošle provozovateli do jeho chatu, aby se k němu dostala hned. Sídlo: Spojené
          arabské emiráty. Dostane jen zprávu, kterou jste napsali — žádné zdravotní údaje, žádnou
          hodnotu ani stránku; smlouvu o zpracování s ním nemáme, proto k němu nic jiného nejde.
        </li>
      </ul>
      <p>
        Návrh: sídla a smluvní základ jsou uvedeny u každého zpracovatele zvlášť; provozovatel je
        před schválením ověří proti svým smlouvám. Žádný z nich nedostane vaše jméno — nemáme ho.
      </p>

      {/* What the model does and does not decide. A footnote under every
          tab until 2026-09-19; it is a promise about processing, so it stands
          here with the sub-processors. */}
      <p>
        Hodnoty, jednotky i meze počítá deterministický kód, ne model. Model přepisuje, co je
        vytištěno; název přiřadí jen tam, kde jednotka a rozmezí souhlasí, a vy to vidíte.
      </p>

      <h2>5. Jak dlouho</h2>
      <ul>
        <li>Hodnoty, stránky, opravy, kontext a e-mail — dokud účet nesmažete.</li>
        <li>
          Neúspěšné přihlášení — 15 minut, pak se záznam maže; otisk IP u registrace — nejdéle
          den.
        </li>
        <li>Odkaz pro AI konzultaci — 24 hodin, nebo dokud ho nezrušíte.</li>
        <li>Měsíční součet útraty za zpracování — 90 dní.</li>
        <li>Zpráva z Napište nám — do odpovědi a 12 měsíců po ní.</li>
        <li>Záznam o odmítnutí — 30 dní, pak ho pravidelná kontrola maže.</li>
        <li>Záznam o platbě — po dobu, kterou ukládají účetní a daňové předpisy.</li>
      </ul>

      <h2>6. AI konzultace — jen když chcete</h2>
      <p>
        Na záložce AI konzultace si můžete vytvořit dočasný odkaz na stránku s prostým textem: vaše
        hodnoty, jednotky, referenční meze a data odběrů, a pokud jste ho vyplnili, i kontext o vás —
        bez jména, bez e-mailu, bez obrázků stránek.
        Odkaz platí 24 hodin, kdykoli ho zrušíte, a nový nahrazuje starý. Je náhodný a nikde
        zveřejněný není: kdo ho nezná, nic neuvidí. Čte ho asistent, kterému ho sami vložíte — a
        u něj platí podmínky jeho provozovatele, ne naše.
      </p>

      <h2>7. Vaše práva</h2>
      <ul>
        <li>
          <strong>Přístup a přenositelnost</strong> — export kdykoli, jedním souborem (JSON nebo
          CSV), v záložce Reporty.
        </li>
        <li>
          <strong>Oprava</strong> — přepsanou hodnotu opravíte sami v záložce Ověření.
        </li>
        <li>
          <strong>Výmaz a odvolání souhlasu</strong> — smazání účtu, okamžité a úplné: hodnoty,
          obrázky stránek, opravy i e-mail. Bez lhůt, bez kopie. Bez souhlasu služba nemá co
          zpracovávat, proto je odvolání souhlasu smazání účtu.
        </li>
        <li>
          <strong>Stížnost</strong> — u Úřadu pro ochranu osobních údajů, Pplk. Sochora 27, 170 00
          Praha 7, www.uoou.gov.cz. Rádi to ale vyřešíme dřív: <a href={CONTACT_PATH}>Napište nám</a>.
        </li>
      </ul>

      <h2>8. Cookies</h2>
      <p>
        Jedna, přihlašovací, na 90 dní, nedostupná skriptům. Žádná analytika, žádné sledování,
        žádné třetí strany — proto ani lišta se souhlasem. Ověření, že formulář vyplňuje člověk
        (Cloudflare Turnstile), běží na registraci, přihlášení, zapomenutém heslu a na formuláři
        Napište nám bez přihlášení; není to analytika.
      </p>

      <h2>9. Věk</h2>
      <p>Služba je pro osoby starší 18 let. Účet mladší osoby smažeme, jakmile se o něm dozvíme.</p>

      <h2>10. Změny</h2>
      <p>
        Platná verze je vždy na této stránce, s datem verze nahoře. O změně, která se vás dotkne,
        dáme vědět e-mailem na adresu účtu.
      </p>

      <h2>11. Kontakt</h2>
      <p>
        {OPERATOR.email}, nebo <a href={CONTACT_PATH}>Napište nám</a>.
      </p>

      <LegalFooter />
    </main>
  );
}
