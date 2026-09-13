# The clinical agent's market — who else, what rules, who pays

Companion to [the consumer scan](czech-market.md), researched 2026-09-13, for
the *other* product in this repo: `apps/chat` + `workers/agent`, the practice
tenants in [chat-demo.md](plans/chat-demo.md), and the pitch in
[csm-demo.md](plans/csm-demo.md). Three questions: who else sells this in
Czechia, where the regulatory line runs, and whether anyone will ever pay for
it out of public insurance.

Short answers: **the pattern is already in Czech hospitals** (STAPRO, 23 of
them), **Europe is a deliberate carve-out from what OpenAI built**, and
**reimbursement and the non-device position are mutually exclusive** — which is
the decision this document exists to force.

## 1. What OpenAI built, and where it is not

Two products, often confused:

**ChatGPT Health — consumer.** Announced 2026-01-07; live to US users 18+ on
web and iOS since 2026-07-23. A separate sidebar tab with its own memory,
encryption and isolation; conversations not used for training or ads. Connects
Apple Health (iOS), medical records through **b.well** (~2.2 M US providers,
covering Epic and Oracle Health systems), One Medical, Function Health, plus
MyFitnessPal, Peloton, Weight Watchers, AllTrails, Instacart. Its own example
prompts are this repo's: *"How's my cholesterol trending?"*, *"Summarize my
latest bloodwork before my appointment."* Built with 260+ physicians from 60
countries, evaluated on HealthBench. Explicitly **"not intended for diagnosis
or treatment"** — the same line drawn in [csm-demo.md](plans/csm-demo.md).

**ChatGPT for Healthcare — clinician.** 2026-09-01: an **Epic** integration
letting clinicians import notes, labs, medications, conditions and encounters
for patients they are already authorised to see, inside HIPAA-enabled
Enterprise / ChatGPT for Healthcare workspaces under a BAA. UCSF Health
piloting; a plugin adds nine public healthcare data sources. **Read-only** —
nothing writes back to the chart. The "325 million patients" headline is Epic's
global install base, not a connected corpus.

**Neither is available here.** ChatGPT Health excludes the **EEA, Switzerland
and the UK**; record connections are US-only. From a Czech account there is no
Health tab. Not a technical limit — GDPR Art. 9, Chapter V transfers, the AI
Act.

Testable from Czechia today, closest first: **NotebookLM** (grounded answers
with citations into your own documents — the nearest free analogue and a fair
benchmark for the sources rail); **ChatGPT / Claude Projects** with a few lab
PDFs (the baseline every user compares against — and paste a Czech lab sheet in
to see what it gets wrong, which is the demo slide); **ChatGPT Business
connectors**; and self-hosted **Open WebUI, LibreChat, AnythingLLM, Onyx,
RAGFlow** with Ollama, which is literally the "chat with your own server" shape.

## 2. Who sells clinical AI in Czechia

| Layer | Who | Reading |
|---|---|---|
| NIS/LIS incumbents | **STAPRO** — "AI asistent výkaznictví" for DRG coding, **23 hospitals** in pilot, 2 200 cases in July 2026 alone, **with click-through to the source text**. Built with VŠB-TUO, Baťa Zlín, Nové Město na Moravě. **Medicalc** — AI documentation assistant | RAG-with-citations is validated in CZ *and* the channel owner is already moving. "Citations" is not a differentiator |
| Certified devices | **Carebot** — CE-marked imaging AI, record funding | The device path works here, but it is slow and expensive |
| Platforms | **ChatGPT for clinicians** (Czech landing page) | The default answer a doctor reaches for |
| Adoption | MZ national survey: **67.6 %** of respondents say AI is used in their facility | The "is this allowed" conversation is over |
| Europe | **Corti** (DK, expanding with **Dedalus**), **Tandem Health** (Stockholm + Paris hub; reported as the only one with a verified CE mark as MDR class IIa), **Nabla**, **Heidi**, **TORTUS** | Almost all are **ambient scribes** — they *write* documentation. Query-the-record-with-citations is nearly empty |

Nobody found is selling *ask the clinic's own record, get the page back* to
small and mid-sized clinics. STAPRO aims at hospital coding; the Europeans aim
at the consultation note.

## 3. EU data residency is the buying criterion

Corti, publishing 2026-09-02, states the European sales reality plainly: buyers
require **proof, not claims, that patient data is stored and processed inside
the EU, including through subprocessors**. European clinical-AI rankings now
score residency as a first-class axis and note that many hospitals simply will
not permit US-only hosting.

**This repo's gap.** Cloudflare Workers can sit in EU regions; the model calls
do not, by default. The first question a clinic's DPO asks is *where does the
data go and who are the subprocessors*. Before any clinic meeting:

1. EU processing for the model calls — verify what the provider offers
   directly, or route through a cloud provider's EU region. **Verify; do not
   promise from memory.**
2. A DPA, a subprocessor list, and a DPIA template (Art. 35 is normally
   required for AI-assisted clinical processing at scale).
3. The deal-winner for the stubborn buyer: an on-prem / EU-hosted deployment on
   open weights. Slower and weaker, but "nothing leaves the building" closes
   what answer quality cannot.

## 4. The regulatory line — already drawn in the architecture

Software that **retrieves, organises and summarises what the record says** is
an information tool. Software that **interprets data for diagnosis, prognosis
or treatment** is a medical device under MDR Rule 11 — notified body, ISO 13485
QMS, clinical evaluation.

The principle in [csm-demo.md](plans/csm-demo.md) — *the app only knows what the
record says* — **is** that line, built into the architecture rather than the
sales copy. `"ferritin fell from 89 to 24 between [1] and [2]"` is not a device.
`"this suggests iron deficiency, consider supplementation"` is.

Two pieces of Czech guidance close the other door: **NCEZ's FAQ** (where the
software qualifies as a device under MDR/IVDR, only a **certified** device may
be used in the provision of care) and **Věstník MZ 20/2025** (providers should
always ask the supplier whether the offered software/AI is qualified as a
device).

Dates as they stood in September 2026 — they have moved repeatedly:

| When | What |
|---|---|
| 2026-05-07 | Parliament and Council agree the AI Omnibus; the Commission's Dec 2025 proposal to make the AI Act largely **inapplicable** to medical devices is **rejected** — MDR/IVDR stay in full scope |
| 2026-06-29 | Council final approval of the Digital Omnibus: stand-alone high-risk (Annex III) moves from 2026-08-02 to **2027-12-02** |
| 2027-08-02 | Art. 6(1) for CE-marked MDR/IVDR devices — **reported** to shift to 2028-08-02 after the May agreement |
| pending | An MDR **Rule 11 clarification** would classify much clinical-benefit software as **class I**. Proposed, not adopted. Do not plan on it |

Net: roughly 12–24 months in which a non-device, citations-only tool can be
piloted in clinics without a conformity assessment.

## 5. Who pays — the VZP pilot, and the catch

| | |
|---|---|
| What | "Řízený vstup inovací do úhrad" — VZP's own methodology, approved by its správní rada, announced late April 2026 |
| Starts | **2026-07-01**, as a pilot of the process |
| Instrument | **Dočasná úhrada**, **12–24 months**, benefit monitored, then a decision on permanent inclusion |
| Who may apply | **Manufacturer, developer, university or consortium** — *vývojář*, not only a certified manufacturer |
| Assessment | Safety, **data protection**, clinical benefit; ~3 months (reported) |
| First phase | Three areas; confirmed: **AI for diagnostics**, **apps for chronic patients** |
| Why | VZP's own words: no methodological or legislative process exists, so innovations enter "only sporadically and rather exceptionally" |

**The catch.** Reimbursement attaches to *hrazené zdravotní služby* — a
**výkon** the doctor performs and bills, or a device in the úhradový katalog.
It does not attach to useful software. So the decision that keeps this product
out of MDR is the same one that keeps it out of reimbursement: to a payer, a
tool that only surfaces what the record already says is infrastructure, in the
same category as the clinic's NIS licence. **Infrastructure is bought, not
reimbursed.**

Calibration: Germany's **DiGA**, the scheme everyone points at, has taken
**229 applications since May 2020 with 59 positive outcomes** (~26 %) — and
still requires a CE-marked class I or IIa device. There is no European scheme
that reimburses a non-device.

### The three roads

| | Cost | Opens |
|---|---|---|
| **A — stay a non-device** | Nothing. Ship now | A software subscription sold to the clinic, sales cycle in weeks. No reimbursement, ever |
| **B — become a SaMD** | Class IIa under Rule 11 as it stands; QMS, clinical evaluation, notified body, plus AI Act high-risk duties from 2027/2028. 12–24 months, several hundred thousand Kč | The reimbursement door |
| **C — apply to the pilot anyway** | Weeks of paperwork | The criteria, and a name in front of the people writing them. Expected outcome is refusal ("not a health service") — but a *useful* refusal |

### The reframe that actually unlocks money

Not *"will they reimburse my software"* but **"which billable výkon does my
software make possible, faster or cheaper?"** Reimbursement follows the
procedure, not the vendor. Candidates in this product's reach: structured
review of longitudinal data before a preventive visit (the preventive-exam
rules widened from January 2026); remote monitoring of a chronic patient — the
one area the pilot names; any unbillable work that could become a billable,
documented act. No attachable výkon means no reimbursement story — sell
software and stop optimising for the payer.

### Next steps, in order

1. **Get the methodology.** VZP announced it and did not publish it; it is in
   no public index reachable from here. Ask VZP, or file under zákon
   106/1999 Sb. (they publish the answers). Wanted: the three target areas, the
   eligibility definition, whether a non-device may apply, the deadline.
2. **Call ČAUI.** They lobbied for this and welcomed it publicly; they will
   know the criteria before they are published.
3. **Decide A/B/C before the CSM meeting** — it changes what gets built.
4. **Measure time saved at CSM regardless.** "Sixty seconds instead of fifteen
   minutes of scrolling" underwrites road A today and road B later.

## 6. Not verified — do not repeat until checked

The third target area of the VZP pilot; the full criteria list and application
deadline; whether a non-device can qualify at all; Tandem Health's CE class
(claimed by a partisan ranking); and the exact Art. 6(1) date after the AI
Omnibus. Press coverage is thin and the methodology itself is not public.

## Sources

Same constraint as the consumer scan: no page could be fetched directly — the
container's network policy blocks egress except the search index — so this is
indexed content of the pages named, not a browsing session.

| Source | Date | Used for |
|---|---|---|
| [OpenAI — Introducing ChatGPT Health](https://openai.com/index/introducing-chatgpt-health/) · [product page](https://chatgpt.com/health/) · [Help Center](https://help.openai.com/en/articles/20001036-health-in-chatgpt) | 2026-01-07, updated 2026-07-23 | Features, connectors, EEA/CH/UK exclusion, US-only records |
| [OpenAI — EHR and healthcare sources](https://openai.com/index/chatgpt-connects-health-records-and-healthcare-sources/) · [TechCrunch](https://techcrunch.com/2026/09/01/chatgpt-health-adds-epic-integration-for-clinicians-to-import-patient-data/) · [Fierce Healthcare](https://www.fiercehealthcare.com/ai-and-machine-learning/openai-makes-health-chatgpt-widely-available-moving-deeper-consumer-health) | 2026-09-01 | Epic integration, read-only, BAA, UCSF |
| [STAPRO — AI asistent výkaznictví](https://www.stapro.cz/category/nezarazene/) | 2026 | 23 hospitals, 2 200 cases in July 2026, click-through to source |
| [MZ ČR — national AI survey](https://mzd.gov.cz/tiskove-centrum-mz/narodni-pruzkum-ministerstva-zdravotnictvi-umela-inteligence-se-stava-beznou-soucasti-ceskeho-zdravotnictvi/) | 2026 | 67.6 % of facilities |
| [Corti — EU data residency](https://corti.ai/stories/eu-data-residency-what-european-healthcare-builders-need-to-know) | 2026-09-02 | Proof of EU processing incl. subprocessors |
| [NCEZ — AI FAQ](https://ncez.mzcr.cz/cs/ai-inovativni-digitalni-technologie-ve-zdravotnictvi/casto-kladene-otazky-faq) · [Věstník MZ 20/2025](https://mzd.gov.cz/wp-content/uploads/2025/11/Vestnik-MZD_20-2025.pdf) | 2025–2026 | Only a certified device may be used where the software is one |
| [Gleiss Lutz — MDR/IVDR and the AI Act](https://www.gleisslutz.com/en/know-how/radical-simplification-mdr-and-ivdr-and-broad-inapplicability-ai-act-medical-devices-and-ivds) · [CSA — high-risk deadline](https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-ai-act-omnibus-vii-deadline-delay-20260/) · [EC AI Act page (cs)](https://digital-strategy.ec.europa.eu/cs/policies/regulatory-framework-ai) | 2026 | Omnibus dates, rejection of the device exemption |
| [VZP — řízený vstup inovací](https://www.vzp.cz/o-nas/aktuality/nove-technologie-v-peci-o-pacienty-i-pro-praci-lekaru-vzp-spousti-rizeny-vstup-inovaci-do-systemu) · [Lupa](https://www.lupa.cz/aktuality/vzp-meni-system-uhrad-tak-ze-by-mohlo-projit-vice-technologickych-inovaci/) · [Zdravé zprávy](https://www.zdravezpravy.cz/2026/04/27/vzp-cr-otevre-1-7-docasne-uhrady-pro-technologicke-inovace/) · [ČAUI](https://asociace.ai/caui-vita-novy-pristup-vzp-k-uhradam-inovaci-a-umele-inteligence/) | 2026-04 | Pilot date, 12–24 months, who may apply, criteria |
| [Úhrady digitálních technologií — současný stav a doporučení](https://npotelemedicina.fnol.cz/uploads/composer/7b0ojg9j7v-%C3%9Ahrady%20digit%C3%A1ln%C3%ADch%20technologi%C3%AD%20-%20sou%C4%8Dasn%C3%BD%20stav%20a%20doporu%C4%8Den%C3%AD%20.pdf) | — | Existing reimbursement routes and their gaps; DiGA 229/59 |
