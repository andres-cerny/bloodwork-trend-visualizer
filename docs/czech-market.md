# Who else does this in Czechia — the market in September 2026

Market scan run 2026-09-13, before Moje krev opens sign-up to strangers
([moje-krev-public.md](plans/moje-krev-public.md)). The question was narrow:
**is anyone already selling a Czech person a place to keep their lab results
and watch the numbers move?** The answer changed ten days before this scan,
and it changed in two places at once — the state shipped the trend chart for
free, and one funded Czech startup already reads any lab's PDF.

Neither kills the product. Both move where its value has to sit.

## The two findings that matter

**1. The state now draws the chart.** On 3 September 2026 the Ministry of
Health shipped a new generation of **EZKarta**: lab results with history,
reference ranges and an in-range/out-of-range colour scale, on ~450 million
lab records, free, logged in with Identita občana. That is Moje krev's
overview and trend screens, for ten of the most common parameters.

**2. One Czech competitor is already the whole product.** **Macromo** —
Prague, funded, iOS + Android — takes a photo or a PDF from *any* provider,
reads it, explains each biomarker, and tracks it over time, on a 1 500 /
5 500 / 10 000 Kč-per-year membership. This is the same product shape,
already in the stores, with money behind it.

Everything else in the market is one of: a lab showing its own customers
their own results, an insurer showing its own members results from partner
labs, a test bundle with a dashboard attached, or a foreign AI PDF-reader
with a Czech translation.

## 1. EZKarta — the state, free, and now on this ground

| | |
|---|---|
| Who | Ministerstvo zdravotnictví / ÚZIS / NCEZ |
| Shipped | 3 September 2026 (new generation; app dates to Tečka, 2021) |
| Reach | ≈ 3.1 M downloads, ≈ 34 k users **per day**, Play rating **2.4** (8 785 ratings) |
| Login | Identita občana (bank identity etc.) — 5 M Czechs have one, ≈ 56 % of adults |
| Lab results | Per parameter: last value, **history**, **reference range**, draw details, green/red in-range scale |

What it carries and what it does not:

- **Ten parameters in phase 1** ("deset vybraných laboratorních parametrů",
  Ladislav Dušek, ÚZIS), to be widened over time. NCEZ's own video and
  Zdravotnický deník said *twelve* markers; the ministry's press release says
  ten. Either way it is a shortlist, not a report.
- **How far back**: the press release quotes Dušek on "values for the last
  five years" and then, in its own numbers box, says the user sees their
  results for the **last three years**, with five years of history present in
  the central system. The two statements are in the same document.
- **Refreshed about monthly** in phase 1. A draw taken today is not in the app
  tomorrow.
- **Only what is connected.** The data arrive from providers wired into the
  central system — participation that reporting (tema21) describes as
  voluntary, with 30+ hospitals in the shared record so far. Self-pay tests
  bought from a private lab are not the case this was built for.
- **No interpretation, by policy.** "Odborná interpretace výsledků a
  rozhodování o další péči zůstávají vždy na zdravotníkovi." The state will
  show you the number and the range, and stop there. It also cannot show you
  anything on paper: a 2019 PDF in a drawer stays in the drawer.
- **A trust and quality gap.** 2.4 stars across 8 785 ratings, and 34 k daily
  users against 3.1 M downloads, is a large installed base that mostly does
  not open the app.

**Roadmap that closes the gap further**: mandatory eŽádanky from July 2027,
mandatory electronic records from 2029, and under EHDS, March **2031** for
Europe-wide sharing of lab results, imaging and discharge reports. The window
where "getting at your own numbers" is a real problem is roughly the next four
years; after that only interpretation and trust are left as reasons to exist.

## 2. The insurers — VITAKARTA is the one that matters

**OZP's VITAKARTA** has shown lab results since November 2023 (Spadia first,
then Synlab, Unilabs Diagnostics, BILA). OZP says **over 52 % of its clients**
now have lab results available there, and they appear as soon as the lab
uploads them — faster than the state's monthly cycle. It covers
doctor-ordered, insurance-paid tests only, for OZP members only.

**Moje VZP** and **ZP211** (ZP MV ČR) remain claimed-care overviews, payments
and benefits — not lab values. If VZP, at ~6 M members, copies OZP, the free
baseline widens sharply. Worth watching.

## 3. The labs' own apps — walled to their own results

| Product | Who | What it does | Wall |
|---|---|---|---|
| **Moje kApka** | LabIn (since Jul 2025) | Book a draw, results with consent, "how your values change over time", plain explanations, e-shop | LabIn's own results only; 1 k+ Android installs |
| **Unilabs Online** | Unilabs (ex-AeskuLab) | Self-pay e-shop, 143 collection points, account with result history; **interpretation via uLékaře.cz for 495 Kč** | Unilabs results only |
| **SYNLAB** | Synlab CZ | Self-pay e-shop, e-Výsledky / Onlinebefunde portal | Synlab results only |
| **mojeEUC** | EUC | Clinic app that also shows documentation and lab results | EUC patients only |
| **AGEL Partner** | AGEL | Portal with lab results for its programme members | AGEL only |

This is the structural weakness of the whole tier: a Czech person with ten
years of draws typically has them spread across three or four labs plus a
hospital, and each of these apps shows one quarter of the picture. Nobody in
this tier wants to import a competitor's PDF.

## 4. Macromo — the direct competitor

Czech startup, app in Czech and English on both stores, investment from Tomáš
Čupr's group in 2025. Sells its own blood (56 biomarkers), DNA and microbiome
tests through 120+ collection points — but the part that overlaps Moje krev is
free of its own lab:

> "Import or scan your lab results from any provider, in any format. We'll
> instantly highlight what's out of range" — macromo.com

The help centre spells out the same flow this repo built: Zdravotní testy →
"+" → *Nahrát krevní testy* → upload, PDF preferred "pro rychlejší rozpoznání
textu". Plus trends across tests, stored health documents, wearables, and an
AI health overview.

**Pricing**: Essential 1 500 Kč/yr · Premium 5 500 Kč/yr · Ultra 10 000 Kč/yr.
That is the Czech willingness-to-pay anchor for exactly this product.

What is *not* visible from outside, and is where a comparison would have to be
won: whether the read is verifiable (can the user see the number against the
page it came from?), what happens to identity on the uploaded PDF, and how
well it handles a decade-old Czech scan rather than a clean born-digital
report.

## 5. Test bundles with a dashboard attached

Adjacent, but they set price expectations and they own the "prevention"
conversation:

- **Blooberry** — 53 / 77 marker panels (Prevence, Advanced, Sport), **3 990
  Kč**, draws through SYNLAB; app charts every biomarker, AI summary, a
  doctor's written summary, optional online consultation.
- **Sapiera Health** — longevity nutrition care built on biomarker panels.
- **NEXTLIFE**, **Vital Age Clinic**, and **Pilulka's** pivot to longevity —
  the same customer, paying clinic prices.
- **uLékaře.cz** — 579 Kč for a one-off doctor's answer; 495 Kč as Unilabs'
  interpretation partner. The market rate for "a human explains this".

All of these sell the draw. None of them wants your old PDFs.

## 6. The AI PDF readers — foreign, translated, loud

**Kantesti** (kantesti.net, App Store CZ "Kantesti – AI Krevní Test", Google
Play "AI Analyzátor Krevních Testů") takes PDF/JPG/PNG, interprets in 75+
languages, compares results over time, and now sells nutrition and supplement
plans. Marketing claims "98.7 % accurate" and a "2.38M parameter neural
network"; Trustpilot's page for it carries the notice that fake reviews were
removed. Beside it in the Czech stores: "Blood Test Results & Guideline",
"Výsledky krevních testů", "AI Blood Test Analyzer", testresult.ai, Carrot
Care.

They are generic, they are not built for a Czech lab's sheet, and their
trust posture is the opposite of this project's. They matter mainly because
they will be what a Czech person finds first when they search.

## 7. What nobody in this market does

Checked deliberately, and found nowhere in the Czech listings above:

1. **Identity never leaves the device.** No Czech competitor advertises
   client-side redaction. EZKarta's own privacy policy is a lawful-basis
   document about central registries; the lab apps hold your rodné číslo
   because they are the provider. Moje krev paints identity out in the browser
   and stores health numbers keyed to an e-mail — a claim nobody else can
   make without rebuilding.
2. **Verification against the page.** Every competitor asks you to trust the
   read. This product shows the row against the stored page and withholds
   values it cannot prove — the photo/scan `unverified` rule in `review.ts`.
3. **Any Czech lab, including paper-era scans.** The state has ten parameters
   from connected providers; the labs have their own feed; Macromo is the only
   other one reading arbitrary uploads.
4. **The lab's own reference ranges, no diagnosis.** Deterministic parsing,
   the sheet's own flags — which is also the regulatory line that keeps this
   off medical-device ground while the AI-interpretation crowd drifts toward
   it.

## 8. Where Moje krev sits

| | EZKarta | VITAKARTA | Moje kApka | Macromo | Kantesti | **Moje krev** |
|---|---|---|---|---|---|---|
| Reads any lab's PDF | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ |
| Old paper scans / photos | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ |
| Trend over time | ✓ (10 params) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Lab's own reference ranges | ✓ | ✓ | ✓ | ~ | ~ | ✓ |
| Verify the read against the page | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Identity not stored | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Interpretation | ✗ by policy | ✗ | text explainers | AI | AI | AI context card, planned |
| Price | free | free (OZP) | free | 1 500–10 000 Kč/yr | subscription | free, 5 reports |
| Czech-first | ✓ | ✓ | ✓ | ✓ | translated | ✓ |

## 9. What this should change in the plan

Nothing here invalidates [moje-krev-public.md](plans/moje-krev-public.md) —
web-first, open sign-up, quota, photos all still hold. Four adjustments follow
from the scan:

1. **Stop selling "see your results".** As of 3 September that is a free
   government app with 3.1 M downloads. Sell the two things it structurally
   cannot do: *everything the state does not carry* (self-pay panels,
   pre-2021 paper, parameters outside the ten, private labs that are not
   connected) and *a read you can check*.
2. **Say the EZKarta sentence out loud** on the landing page. A visitor in
   2026 will have heard of EZKarta; the honest line — "EZKarta shows you ten
   parameters from connected providers, about once a month; this reads any
   report you have, including the ones on paper" — is a better opener than any
   feature list.
3. **Treat Macromo, not the state, as the competitor.** They have the same
   loop and a real price. The differentiators to build against them are the
   ones in §7 that they show no sign of: redaction before upload, and verify
   against the page. Both are already built.
4. **The AI context card is the right next bet, and it is the regulatory
   edge.** EZKarta will not interpret — by policy, permanently. That leaves
   interpretation to Macromo, Kantesti and 495 Kč from uLékaře.cz. Keep
   [moje-krev-ai-context.md](plans/moje-krev-ai-context.md) inside the
   existing line: the app only says what the record says, no diagnosis, no
   advice.

Time-box the whole thing against 2031: EHDS makes lab data portable across the
EU, and the "my numbers are stuck in a PDF" problem this product solves gets
much smaller. What survives is trust, verification and explanation.

## Sources

Nothing on this list could be fetched directly — the container's network
policy blocked every egress except the search index, so the material is the
indexed content of these pages, not a browsing session. App-store copy,
pricing and accuracy claims are the vendors' own.

| Source | Date | Used for |
|---|---|---|
| [mzd.gov.cz — press release, new EZKarta](https://mzd.gov.cz/tiskove-centrum-mz/ministerstvo-zdravotnictvi-spousti-novou-generaci-ezkarty-pripomene-preventivni-vysetreni-a-zpristupni-dulezite-zdravotni-informace/) | 2026-09-03 | Parameters, history, ranges, 450 M records, 3.1 M downloads, 34 k daily, monthly refresh, no interpretation |
| [nzip.cz — EZKarta FAQ](https://www.nzip.cz/clanek/1742-ezkarta-nejcastejsi-otazky-a-odpovedi) | 2026-09-02 | Identita občana requirement, voluntary use |
| [zdravotnickydenik.cz — EZKarta update](https://www.zdravotnickydenik.cz/2026/09/ezkarta-ukaze-laboratorni-vysledky-i-prehled-prevence/) · [ČT24](https://ct24.ceskatelevize.cz/clanek/domaci/v-aplikaci-ezkarta-jsou-nove-vysledky-vysetreni-i-dostupna-prevence-377233) · [Novinky](https://www.novinky.cz/clanek/domaci-ezkarta-nove-ukaze-vysledky-vysetreni-i-to-na-jakou-prevenci-mate-narok-40595910) · [tema21](https://tema21.cz/clanek/vysledky-testu-i-prevence-v-mobilu-aplikace-ezkarta-ma-nove-funkce/) | 2026-09 | "12 markers", five years back, voluntary provider participation |
| [Seznam Zprávy — Stát každému ukáže výsledky krve](https://www.seznamzpravy.cz/clanek/domaci-zivot-v-cesku-stat-kazdemu-ukaze-vysledky-krve-a-take-kontroly-u-lekare-314558) | 2026-09 | Green/red in-range scale in EZKarta |
| [Google Play — EZKarta](https://play.google.com/store/apps/details?id=cz.nakit.eocko.wallet) | read 2026-09-13 | 2.4 rating, 8 785 ratings |
| [ozp.cz — VITAKARTA lab results](https://www.ozp.cz/pro-klienty/laboratorni-vysledky) · [Spadia](https://www.spadia.cz/en/verejnost/clanky/2023/laboratorni-vysledky-v-aplikaci-vitakarta-od-ozp/) · [Synlab](https://www.synlab.cz/pro-verejnost/ozp-laboratorni-vysledky-v-aplikaci) | 2023–2026 | Which labs feed VITAKARTA, 52 % of clients, insured care only |
| [macromo.com](https://macromo.com/) · [mobile app / pricing](https://macromo.com/mobile-app) · [help: uploading past results](https://macromo.gorgias.help/en-US/jak-si-do-aplikace-macromo-mohu-nahrat-p%C5%99edchozi-v%C3%BDsledky-krevnich-test%C5%AF-3434004) · [App Store CZ](https://apps.apple.com/cz/app/macromo/id1629905556?l=cs) | read 2026-09-13 | Any-provider import, trends, tiers at 1 500 / 5 500 / 10 000 Kč |
| [labin.cz — Moje kApka](https://labin.cz/aplikace-moje-kapka/) · [mojekapka.cz](https://www.mojekapka.cz/) | 2025–2026 | Booking, consent-gated results, values over time |
| [cz.unilabs.online](https://cz.unilabs.online/) | read 2026-09-13 | 143 collection points, 495 Kč interpretation via uLékaře.cz |
| [blooberry.health](https://www.blooberry.health/testy/) | read 2026-09-13 | 53/77 markers, 3 990 Kč, per-biomarker charts, doctor summary |
| [uLékaře.cz App Store](https://apps.apple.com/cz/app/ul%C3%A9ka%C5%99e-cz/id1488852248) | read 2026-09-13 | 579 Kč per consultation |
| [kantesti.net](https://www.kantesti.net/cs/) · [App Store CZ](https://apps.apple.com/cz/app/kantesti-ai-krevn%C3%AD-test/id6751127324) · [Trustpilot](https://www.trustpilot.com/review/kantesti.net) | read 2026-09-13 | Upload formats, claims, review notice |
| [cazi.cz — eŽádanky July 2027](https://cazi.cz/elektronizace-zdravotnictvi-povinne-ezadanky-od-cervence-2027-a-novy-system-pro-laboratorni-data/) · [mladilekari.cz — EHDS timeline](https://mladilekari.cz/2026/06/24/digitalizace_zdravotnictvi_v_cesku/) | 2026 | 2027 / 2029 / 2031 milestones |
| [dia.gov.cz — 5 million digital identities](https://www.dia.gov.cz/cs/aktuality/5-milionu-obcanu-jiz-vyuziva-svoji-digitalni-identitu) | 2026 | Identita občana reach, 56 % of adults |
