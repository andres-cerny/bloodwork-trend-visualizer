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
Read those as the shop window, not the till — see §4b.

What is *not* visible from outside, and is where a comparison would have to be
won: whether the read is verifiable (can the user see the number against the
page it came from?), what happens to identity on the uploaded PDF, and how
well it handles a decade-old Czech scan rather than a clean born-digital
report.

## 4b. How Macromo is actually doing — the price tag is not the business

Asked because 1 500–10 000 Kč/yr looks steep for a Czech consumer app. It is,
and the company's own numbers say the market agreed.

**The company.** Founded December 2021 (Macromo s.r.o., IČO 14031493, Prague)
by **Eva Kuttichová** (CEO), **Petr Štěpánek** and **Michal Pohludka**, out of
Štěpánek's Wilson's-disease research. It began selling home DNA tests and only
later added blood, microbiome and the app. Lab partners: SYNLAB, Eurofins,
SPADIA.

**Funding: one disclosed round, and it was a control sale.** In April 2025
Tomáš Čupr's **TCF Capital** took a **majority of the voting rights in
exchange for financing** — CzechCrunch put the round at **20 million Kč**.
That is a modest cheque for a company then 3.5 years old, and majority control
went with it; it reads as a strategic rescue-and-absorb, not a growth round.
No later round is public. Registered capital is 10 853 Kč split into numbered
investor shares (a long tail of small holders); Kuttichová's own deposit is
listed at 1 503 Kč. Tracxn still shows "has not raised any funding" — the
third-party databases are wrong here, so don't quote them.

**Users — small, and openly so.**

| When | Users | Source |
|---|---|---|
| April 2025 (TCF deal) | "over 5 000 users" across 9 countries | Silicon Canals / ain.ua |
| 2026 | **≈ 15 000**, target **30 000** by end of 2026 | TCF Capital's own portfolio story |

Fifteen thousand users in four and a half years, across nine countries, with a
funded team. EZKarta has **34 000 users a day**. Of the paying side, the only
public figure is **"more than 1 500 people" taking Macromo blood tests in the
first two months** of the test launch (reported 24 January 2026). Review
counts match that order of magnitude: Trustpilot 4.3 from **81** reviews, the
company's own site 4.7 from **35**.

**Revenue: not public.** Filings exist in the Sbírka listin, but no figures
surfaced in anything indexed, and this container cannot reach or.justice.cz.
Treat any revenue claim about Macromo as unknown rather than small.

**What the pricing actually is.** The memberships are the anchor; the funnel
is the pharmacy. On 15 October 2025 **Pilulka** — also Čupr-controlled, also
pivoting to longevity — launched **Pilulka PRO at 99 Kč/month**: two blood
tests a year, 20 % off Daily supplements, 50 % off the Macromo DNA Premium
test. Macromo's tests sit on pilulka.cz as ordinary e-shop items. The chain
that TCF describes runs data → AI recommendation → a supplement from Pilulka.

So the honest reading: **the app is customer acquisition for diagnostics and
supplement retail.** The 10 000 Kč tier exists to make 5 500 look reasonable
and to serve the few who want the full panel; the volume play is 99 Kč a month
attached to a pharmacy with a large existing base. Since March 2026 the
company has been repositioning again — "from one-off testing to a digital
prevention partner", an AI health plan and wider panels.

**What that means here.** Nobody in Czechia has yet shown that people will pay
for *the tracking app by itself*. The one funded competitor needed a
pharmacy's customer base and a 99 Kč price to move volume, and its moat is
distribution — Pilulka, TCF, 120+ collection points — not the PDF reader. Two
consequences for Moje krev:

1. **Don't price against Macromo's tiers.** They are not evidence of Czech
   willingness to pay for tracking; they are a bundle price for testing. If
   Moje krev ever charges, the comparable is 99 Kč/month **with something
   physical attached**, and the plan's free-with-a-hard-quota shape is the
   better answer while demand is unmeasured.
2. **The competitor to fear is the channel, not the feature.** Their reader is
   matched; their distribution is not. That argues for keeping Moje krev's
   differentiators where a pharmacy cannot follow — redaction before upload,
   a verifiable read — rather than racing them on biomarker counts.

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
3. **Treat Macromo, not the state, as the competitor — but the right half of
   it.** They have the same loop; what they also have is a pharmacy channel
   (§4b), which is the part that is hard to answer. The differentiators to
   build against them are the ones in §7 they show no sign of: redaction
   before upload, and verify against the page. Both are already built.
4. **The AI context card is the right next bet, and it is the regulatory
   edge.** EZKarta will not interpret — by policy, permanently. That leaves
   interpretation to Macromo, Kantesti and 495 Kč from uLékaře.cz. Keep
   [moje-krev-ai-context.md](plans/moje-krev-ai-context.md) inside the
   existing line: the app only says what the record says, no diagnosis, no
   advice.

Time-box the whole thing against 2031: EHDS makes lab data portable across the
EU, and the "my numbers are stuck in a PDF" problem this product solves gets
much smaller. What survives is trust, verification and explanation.

**The EHDS clock, in detail.** Regulation (EU) 2025/327, in force 2025-03-26,
has two pillars: *primary* use — a right to immediate, free, machine-readable
access to your own records and to have them passed to a recipient of your
choice — and *secondary* use for research. General applicability **2027-03-26**;
patient summary and ePrescription **March 2029**; **lab results, imaging and
discharge reports March 2031**. Czech milestones sit inside it: mandatory
eŽádanky from July 2027, mandatory electronic documentation from 2029.

The threat is obvious and the opportunity is not: the same regulation that
dissolves the PDF problem also creates, for the first time, a lawful route by
which a small app can receive structured data without a contract with every
lab. Whether a third-party app counts as an eligible recipient is for the
implementing acts due by March 2027 — worth watching, not assuming. The right
posture is therefore not "finish before it lands" but **be the thing that is
ready when the door opens**: `packages/lab-core` is the deterministic layer and
PDF extraction is only one source feeding it, so an eZdraví import is a new
source, not a rewrite.

## 10. Money — asked, analysed, deferred

Asked 2026-09-13: should the free allowance be 3–5 reports with paid bundles
after (5 for 100 Kč, 20 for 250 Kč)?

The unit economics are not the problem. At `moje-krev-extract`'s two-reader
text path (5.1 ¢/page, `docs/extraction-speed.md`) a typical three-page report
costs ~15 ¢ ≈ 3.4 Kč, and five reports ≈ 0.77 $ ≈ 17 Kč — already under the
"less than a dollar a person" bar. The real bound is the fuse:
`BUDGET_USD_LIMIT: 30` on the extract deployment (15 until 2026-09-19, when
the door opened) is a ceiling of ~660 Kč a month, and `PORTAL_USD_LIMIT: 5`
per person per month sits under it. Budget
~0.8 $ per invited person in their first month, or the global fuse trips and
freezes extraction for everyone.

Against that, payments cost more than they collect: ~7 % on a 100 Kč
transaction is the cheap part, and trader status, invoicing, EU digital-content
withdrawal rules, T&Cs and refunds are the expensive part — for perhaps
1 000–3 000 Kč a year at friends-and-family scale. Worse, a paywall at report
six is exactly where a curious doctor stops, and the doctor is the actual goal
([the clinical agent's market](clinical-agent-market.md)).

**What shipped:** `MAX_PAGES_PER_REPORT` 30 → 6, because at thirty a single
upload could spend most of a person's monthly ledger. Real Czech reports are
one to three pages; beyond the cap `prepareFile` truncates and the upload log
says so.

**Deferred, not decided against:** lowering `PORTAL_USD_LIMIT` to ~1.5, and
keeping invites rather than open sign-up as the growth fuse. If a paid bundle
is ever built, price **pages, not reports** — at a 4–6 page cap the proposed
prices clear cost several times over, at the old 30-page cap "20 reports for
250 Kč" could cost 660 Kč.

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
| [CzechCrunch — Čupr invests in Macromo](https://cc.cz/tomas-cupr-slape-do-longevity-investuje-do-ceskeho-startupu-ktery-hlida-zdravi/) · [e15](https://www.e15.cz/byznys/obchod-a-sluzby/cupr-zacal-budovat-novou-longevity-divizi-jeho-tcf-capital-ziskala-majoritu-v-nadejnem-startupu-1423825) · [Silicon Canals](https://siliconcanals.com/tcf-capital-acquires-majority-stake-macromo/) | 2025-04 | 20 M Kč, majority of voting rights, founders, 5 000+ users in 9 countries |
| [TCF Capital — Macromo portfolio story](https://www.tcfcap.com/stories/macromo-a-novinky-v-app) | 2026 | ≈ 15 000 users, target to double by end of 2026 |
| [ceske-novinky.cz — Macromo 56 biomarkers](https://www.ceske-novinky.cz/2026/01/24/co-vasemu-telu-chybi-macromo-prinasi-personalizovana-doporuceni-zalozena-na-krevnich-testech-nove-generace/) · [CzechCrunch](https://cc.cz/firmy-tomase-cupra-dovezou-nakup-ale-i-upozorni-jak-jist-a-zit-ted-k-tomu-maji-detailni-krevni-test/) | 2026-01 | 1 500+ people tested in the first two months |
| [CzechCrunch — Pilulka PRO at 99 Kč/month](https://cc.cz/pilulka-spousti-longevity-predplatne-za-99-korun-mesicne-zmeri-a-doporuci-co-telo-potrebujee/) · [pilulka.cz/vase-pilulka-pro](https://www.pilulka.cz/vase-pilulka-pro) | 2025-10-15 | The real entry price and the supplement funnel |
| [kurzy.cz — Macromo s.r.o., IČO 14031493](https://rejstrik-firem.kurzy.cz/14031493/macromo-sro/) · [Trustpilot](https://www.trustpilot.com/review/macromo.com) | read 2026-09-13 | Incorporation date, registered capital, 81 reviews at 4.3 |
| [labin.cz — Moje kApka](https://labin.cz/aplikace-moje-kapka/) · [mojekapka.cz](https://www.mojekapka.cz/) | 2025–2026 | Booking, consent-gated results, values over time |
| [cz.unilabs.online](https://cz.unilabs.online/) | read 2026-09-13 | 143 collection points, 495 Kč interpretation via uLékaře.cz |
| [blooberry.health](https://www.blooberry.health/testy/) | read 2026-09-13 | 53/77 markers, 3 990 Kč, per-biomarker charts, doctor summary |
| [uLékaře.cz App Store](https://apps.apple.com/cz/app/ul%C3%A9ka%C5%99e-cz/id1488852248) | read 2026-09-13 | 579 Kč per consultation |
| [kantesti.net](https://www.kantesti.net/cs/) · [App Store CZ](https://apps.apple.com/cz/app/kantesti-ai-krevn%C3%AD-test/id6751127324) · [Trustpilot](https://www.trustpilot.com/review/kantesti.net) | read 2026-09-13 | Upload formats, claims, review notice |
| [cazi.cz — eŽádanky July 2027](https://cazi.cz/elektronizace-zdravotnictvi-povinne-ezadanky-od-cervence-2027-a-novy-system-pro-laboratorni-data/) · [mladilekari.cz — EHDS timeline](https://mladilekari.cz/2026/06/24/digitalizace_zdravotnictvi_v_cesku/) | 2026 | 2027 / 2029 / 2031 milestones |
| [dia.gov.cz — 5 million digital identities](https://www.dia.gov.cz/cs/aktuality/5-milionu-obcanu-jiz-vyuziva-svoji-digitalni-identitu) | 2026 | Identita občana reach, 56 % of adults |
