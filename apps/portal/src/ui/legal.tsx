/**
 * What the two legal pages and the registration form share, in one place.
 *
 * The consent sentences live here and nowhere else: the registration form
 * shows them beside its checkboxes, and the privacy page quotes them as the
 * legal basis for health data. A sentence that exists twice is a sentence
 * that drifts once, and this one is a promise to a stranger about their
 * medical record.
 *
 * The draft banner and the operator placeholder are the two things Ondřej
 * removes when he approves the texts: flip `LEGAL_DRAFT` to false, and put
 * the real identity into `OPERATOR`. Until then both pages say, at the top,
 * that they are drafts — a stranger who reads them should know that too.
 */

/** True until the operator has approved the texts. One constant, both pages. */
export const LEGAL_DRAFT = true;

/** The sentence the banner shows while `LEGAL_DRAFT` holds. */
export const DRAFT_NOTICE = "Návrh — čeká na schválení provozovatele.";

/**
 * Who runs the service. Deliberately a placeholder: the operator's legal
 * identity, address and contact address are his to fill, not an agent's to
 * guess. Every occurrence on either page renders from these three, so
 * filling them here fills them everywhere.
 */
export const OPERATOR = {
  /** Name, or entity name with its identification number. */
  name: "[provozovatel]",
  /** Seat or business address. */
  address: "[adresa provozovatele]",
  /** The address for legal and data-protection requests. */
  email: "[e-mail provozovatele]",
} as const;

/** The date shown as the texts' version; set when the operator approves them. */
export const LEGAL_VERSION = "[datum schválení]";

/**
 * The consent to health data (GDPR art. 9(2)(a)), checked at registration.
 * The privacy page quotes it verbatim as the legal basis.
 */
export const CONSENT_HEALTH =
  "Souhlasím se zpracováním svých zdravotních údajů — hodnot z laboratorních zpráv a začerněných stránek — za účelem jejich zobrazení a sledování v čase, jak popisují Zásady ochrany soukromí.";

/** The consent to the terms, checked at registration. */
export const CONSENT_TERMS = "Souhlasím s Podmínkami užití.";

/**
 * A consent sentence with its document's name turned into a link, the rest
 * of the sentence untouched — so the text a person ticks is the constant,
 * character for character, and the privacy page can quote the same constant
 * as what was ticked. Throws when the name is not in the sentence: a link on
 * nothing would be a sentence that drifted from its document.
 */
export function linked(sentence: string, name: string, href: string) {
  const at = sentence.indexOf(name);
  if (at < 0) throw new Error(`consent sentence does not name "${name}"`);
  return (
    <>
      {sentence.slice(0, at)}
      <a href={href}>{name}</a>
      {sentence.slice(at + name.length)}
    </>
  );
}

/**
 * The allowance as the landing and the terms state it. Goal 7 counts it in
 * the worker; the numbers here are the ones a stranger reads before they
 * register, and the two must agree — the terms are a promise.
 */
export const ALLOWANCE = {
  /** Documents free on account creation, for good. */
  free: 5,
  /** Pages one document may have: one PDF, or one set of photos. */
  pagesPerDocument: 6,
  /** The two packages, in the order the buy sheet offers them. */
  packages: [
    { documents: 5, czk: 49 },
    { documents: 15, czk: 99 },
  ],
} as const;

/** Where the two documents live; the registration form links both. */
export const PRIVACY_PATH = "/soukromi";
export const TERMS_PATH = "/podminky";
export const CONTACT_PATH = "/napiste-nam";

/** The banner at the top of a draft legal page. Renders nothing once approved. */
export function DraftBanner() {
  if (!LEGAL_DRAFT) return null;
  return (
    <p className="legal-draft" role="note">
      {DRAFT_NOTICE}
    </p>
  );
}

/** The links every logged-out page ends with. */
export function LegalFooter() {
  return (
    <nav className="legal-foot" aria-label="Právní informace">
      <a href={PRIVACY_PATH}>Soukromí</a>
      <span aria-hidden="true">·</span>
      <a href={TERMS_PATH}>Podmínky</a>
      <span aria-hidden="true">·</span>
      <a href={CONTACT_PATH}>Napište nám</a>
    </nav>
  );
}
