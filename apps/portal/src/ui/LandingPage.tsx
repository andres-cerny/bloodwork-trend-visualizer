/**
 * The first page a stranger reads: "/" when nobody is logged in.
 *
 * It says what Moje krev is, what it is not, what is stored and what never
 * leaves the device, who reads the pages, and what it costs — then offers
 * three ways on: register, log in, or open the demo patient. No marketing:
 * every sentence here is one the privacy page and the terms can stand
 * behind, and the one sentence that varies with the deployment — who reads
 * a page — is asked of the deployment, as the privacy page asks it
 * (packages/ui-kit/src/processors.ts).
 */
import { useEffect, useState } from "react";
import { processorPhrase, RETENTION_NOTE } from "@bw/ui-kit";
import { demoOffered, enterDemo, getProcessors } from "../lib/api";
import { fetchMe, messageOf, type Me } from "./Door";
import { ALLOWANCE, LegalFooter, PRIVACY_PATH } from "./legal";

/** The login form's own path, so „Přihlásit" is a link and a back button works. */
export const LOGIN_PATH = "/prihlaseni";
export const REGISTER_PATH = "/registrace";

const czk = (n: number) => `${n} Kč`;

export default function LandingPage({ onDone }: { onDone: (me: Me) => void }) {
  // Who processes a page is asked, not written down — see Privacy.tsx for
  // why. `null` (loading, or the request failed) names every processor.
  const [photoReaders, setPhotoReaders] = useState<string | null>(null);
  // Whether this deployment opens a demo patient to anyone; a link that
  // leads nowhere is worse than no link.
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProcessors().then(
      (p) => setPhotoReaders(p.photoReaders),
      () => setPhotoReaders(null),
    );
    void demoOffered().then(setDemo);
  }, []);

  /** The demo link's behaviour, unchanged from the door: mint, then ask who is in. */
  async function openDemo() {
    setBusy(true);
    setError(null);
    try {
      await enterDemo();
      const me = await fetchMe();
      if (me) onDone(me);
      else setError("Přihlášení se nezdařilo. Zkuste to prosím znovu.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const [small, large] = ALLOWANCE.packages;

  return (
    <main className="landing">
      <header className="landing-head">
        <span className="door-mark" aria-hidden="true">
          🩸
        </span>
        <h1>Moje krev</h1>
        <p className="landing-lead">
          Nahrajete laboratorní zprávu — PDF nebo fotografii — a vidíte každou hodnotu na jednom
          místě, v čase a s referenčními mezemi vaší laboratoře.
        </p>
      </header>

      <div className="landing-actions">
        <a className="btn primary" href={REGISTER_PATH}>
          Registrovat
        </a>
        <a className="btn" href={LOGIN_PATH}>
          Přihlásit
        </a>
        {demo && (
          <button type="button" className="btn linkish" disabled={busy} onClick={() => void openDemo()}>
            Zobrazit demo pacienta
          </button>
        )}
      </div>
      {demo && (
        <p className="landing-hint">
          Demo: skutečné výsledky bez jména, bez přihlášení. Účet je společný — co do něj nahrajete,
          uvidí i ostatní.
        </p>
      )}
      {error && <p className="notice">{error}</p>}

      <section>
        <h2>Co to je</h2>
        <p>
          Aplikace ze zprávy přepíše hodnoty, jednotky a referenční meze tak, jak je laboratoř
          vytiskla, a ukáže je pohromadě: každý parametr s poslední hodnotou, s vývojem od minula
          a s tím, zda leží v mezích, které uvedla laboratoř. Přepis si ověříte proti začerněné
          stránce, řádek po řádku.
        </p>
      </section>

      <section>
        <h2>Co to není</h2>
        <p>
          Moje krev není zdravotnický prostředek. Nestanovuje diagnózu, hodnoty nehodnotí a
          neradí, co dělat. Ukazuje, co laboratoř vytiskla; co to znamená pro vás, je otázka na
          vašeho lékaře.
        </p>
      </section>

      <section>
        <h2>Co ukládáme, a co ne</h2>
        <p>
          Jméno, rodné číslo, datum narození a adresu začerní prohlížeč ještě před odesláním a
          původní soubor zůstává u vás. K účtu vedenému na e-mail ukládáme jen hodnoty a začerněné
          stránky — bez jména, bez rodného čísla.
        </p>
      </section>

      <section>
        <h2>Kdo stránky čte</h2>
        <p>
          Začerněné řádky s hodnotami odcházejí z našeho serveru {processorPhrase(photoReaders)}, kde
          se přepíšou na čísla. {RETENTION_NOTE} Podrobně v{" "}
          <a href={PRIVACY_PATH}>Zásadách ochrany soukromí</a>.
        </p>
      </section>

      <section>
        <h2>Kolik to stojí</h2>
        <p>
          Prvních {ALLOWANCE.free} dokumentů je zdarma, natrvalo. Dokument je jedno PDF nebo jedna
          sada fotografií do {ALLOWANCE.pagesPerDocument} stran. Další přikoupíte v balíčcích:{" "}
          {small.documents} dokumentů za {czk(small.czk)}, {large.documents} za {czk(large.czk)}. Bez
          předplatného, bez propadnutí.
        </p>
      </section>

      <LegalFooter />
    </main>
  );
}
