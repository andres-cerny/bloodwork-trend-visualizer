# CSM protocol inventory

The closed list of everything Centrum sportovní medicíny's own test protocols
print, surveyed from the git-ignored `samples/`. The demo corpus generators
and the patient-card UI both build from this file and nothing else — **the
app only knows what the record says.** Privacy rule: this file carries
document shapes, section structure, metric names, units and the *form* of
printed norms only — never a measured value, date, personal name, identifier
or finding. The CSM letterhead is deliberate demo branding: *Centrum sportovní medicíny z.s., Pod altánem 67/352, 100 00 Praha 10 · Ambulance I.P. Pavlova: Sokolská 1662/35, 120 00 Praha 2 · Ambulance Jeneč: Lidická 210, 252 61 Jeneč · tel +420 722 050 450 · info@centrumsportmed.cz · www.centrumsportmed.cz*.

`make_chat_docs.py` already generates: an examination report with spiro +
threshold tables + inline blood panel + zones, a zones protocol, operation
protocols, imaging and physio notes. Still ungenerated: standalone
spirometry, funkční vyšetření chart bundle, EKG, PhysioFlow, tHb log.

## CSM document types

### `lekarska_zprava` — „Zpráva z vyšetření" (1–2 pp)
The annual-exam report; red C.S.M logo + display title on scanned years,
plain print layout on signed exports. CSM footer on every page; ends with
date + physician signature (stamp „Tělovýchovný lékař" / digital signature
block). Sections in order:
1. Patient header (labels Pacient/Adresa/Email · Číslo pojištěnce/Pojišťovna/Telefon), date line with Základní dg. / Vedlejší dg.
2. Anamnesis: RA, OA, SA, NA (older variant adds AA, FA).
3. **Subjektivně**, **Objektivně** — prose; výška, váha and TK printed inline.
4. **EKG v klidu** (prose: rytmus, el. osa, PR, QRS, QTc), **EKG při zátěži**.
5. **Spirometrie** table `Parametr | Hodnota | % normy`.
6. **Laktátové parametry** stage table `Rychlost | Tempo | Laktát | TF` (row per treadmill step; oldest variant `rychlost | ½ úseku | po úseku`).
7. **Spiroergometrické parametry** table, columns `VT1/LT | VT2/MLSS/CS | Max/Peak` (one older year: `FAT MAX | MLSS | Peak`).
8. Inline blood panel as running text: `BIOCHEMIE` then `HEMATOLOGIE`, `S_`/`B_` prefixed analytes, semicolon-separated; the lab's reference range appears in parentheses **only for out-of-range analytes**; a missing assay prints „málo materiálu".
9. **Total hemoglobin mass a další parametry** table `Parametr | absolutní | relativní`.
10. **Závěr z vyšetření**, **Doporučení** (prose), **Tréninkové intenzity** table `Intenzita/zóna | TF | RPE` — zones `I0–I4` (newer) or `I1–I5` (older), TF as ranges („do …" / „…–…" / „nad …").

| metric_id | printed name | unit | norm printed? | notes |
|---|---|---|---|---|
| fvc | FVC | l | ano — „% normy" | spiro table |
| fev1 | FEV1 | l | ano — „% normy" | spiro table |
| fev1_fvc | FEV1/FVC – Tiff index | % | ano — „% normy" | spiro table |
| lactate_curve | Laktát (po stupních) | mmol/l | ne | series with tempo (min/km) and TF |
| speed | Rychlost | km/h | ne | at VT1 · VT2 · Max; bike years print Výkon (W) and Výkon (W/kg) instead |
| hr | Tepová frekvence | /min | ne | at VT1 · VT2 · Max |
| stroke_volume | Tepový objem | ml | ne | at VT1 · VT2 · Max |
| cardiac_output | Srdeční výdej | l/min | ne | at VT1 · VT2 · Max |
| vo2_rel | VO2 | ml/kg/min | ne | at VT1 · VT2 · Max; Max row = VO₂max |
| rer | RER | – | ne | at VT1 · VT2 · Max |
| ventilation | Ventilace | l/min | ne | at VT1 · VT2 · Max |
| breath_freq | Dechová frekvence | /min | ne | at VT1 · VT2 · Max |
| tidal_volume | Dechový objem | l | ne | at VT1 · VT2 · Max |
| energy_expenditure | Energetický výdej | kcal/hod | ne | VT1 · VT2 only |
| cho_rate | Spotřeba sacharidů | g/hod | ne | VT1 · VT2 only |
| o2_extraction | Extrakce O2 ve svalu | % | ne | one older year adds Fick ml O2 row |
| spo2 | Arteriální saturace SpO2 | % | ne | „SaO2" in the oldest variant |
| smo2 | Svalová saturace SmO2 | % | ne | may print NA |
| run_economy | Ekonomika běhu | VO2/km/h | ne | one older year only |
| bp_exercise | Krevní tlak | mm Hg | ne | oldest (bike) variant only |
| thb_mass | Hbmass / Total Hb Mass | g | ne | „absolutní" column |
| thb_mass_rel | Hbmass rel. | g/kg | ne | „relativní" column |
| blood_volume | Blood volume / Objem krve | ml | ne | plasma-volume row printed too, often blank |
| body_mass | váha | kg | ne | inline in Objektivně, with výška and TK |

Blood-panel roster (names as printed; parsing and reference ranges stay lab-core's business): BIOCHEMIE — Glukóza, Urea, Kreatinin, Kyselina močová, Bilirubin celkový a konjugovaný, AST, ALT, ALP, GGT, LDH, Kreatinkináza, Erytropoetin, Testosteron, IGF 1, Sodík, Draslík, Chloridy, Hořčík, Zinek, Cholesterol, Triacylglyceroly, Železo, Vol.VK Fe, Celk.VK Fe, Saturace Trf, Ferritin, Transferrin, Sol.tr.receptor, Vitamin B12, Aktivní B12, Kyselina listová (+ ery), Myoglobin, CRP, TSH, T4 volný, T3 volný, Vitamin D celkový, eGF (CKD-EPI).
HEMATOLOGIE — Leukocyty, Erytrocyty, Hemoglobin, Hematokrit, MCV, MCH, MCHC, RDW-CV, Trombocyty, Trombokrit, PDW, MPV, Retikulocyty (podíl, #, index), Neutrofily/Lymfocyty/Monocyty/Eosinofily/Basofily (podíl i #).

### `spirometrie` — „Spirometrie (Průtok-objem)" (1 p, footer code SPIR_FVC_CSM / SPIR_FVC)
CSM letterhead top-left; patient block (Příjmení, Křestní jméno,
Identifikace, Věk, Datum narození, Datum návštěvy, Výška, Hmotnost; older
adds Pohlaví, BMI). Flow–volume loops „Nejlepší zkouška" / „Všechny zkoušky"
(trials 1–3); numeric table rows FVC, FEV1, FEV1%F, PEF, IC_F, FEF25/50/75
(Vyaire rendering: VC MAX, MEF75/50/25), columns `Nál. | Best | %(B/N) |
1 | 2 | 3 | Z-skóre` — **norm form: náležitá hodnota, % náležité hodnoty,
Z-skóre**. Ambient block (Datum, Čas, Teplota, Tlak, Vlhkost).

### `funkcni_vysetreni` — „Funkční vyšetření" (3–6 pp)
The spiroergometry chart bundle. Patient strip on every page; conditions
block on p1 (Metoda, Zdroj srdeční frekvence, Protokol, Datum, Baro. tlak,
Teplota, Vlhkost). Time/scatter panels with VT1/VT2(/VT3) markers: V'E, HR,
V'O2, V'CO2 (abs and /kg), O2pulse, EqO2/EqCO2, VTex + VTex%VC, BF, RER,
PETO2/PETCO2, Rychlost or Zátěž, Lac, CHO, FAT, EE; an exercise flow–volume
page (EILV, stage legend). Newer bundles add a numeric stage table and a
`VT1 ABS | VT1 % max | VT2 ABS | VT2 % max | MAX` summary. No norms.
Workstation renderings vary (Vyaire WS_CPET_VMAX + 9-Plot + Anaerobic
Threshold Graphs; Jeneč „Ergo" pages) — the generator standardizes on the
chart bundle + threshold summary shape.

### `ekg_klidove` — „EKG-klidové" (1 p)
Patient strip; measurement line (rytmus, paper speed mm/s, gain mm/mV,
filter Hz, then Čas, HR, PR, QRS, QT, QTcB, RR, axes <P <QRS <T); 12-lead
grid (I–III, aVR/aVL/aVF, V1–V6 + rhythm strip). No norms.

### `physioflow` — „PhysioFlow" (3 pp, English device export)
CSM name atop; patient line; Patient ID, DOB, Duration, Mode, Averaging.
**Calibration Table** `Parameter | Description | Value | Lower limit | Upper
limit | Gauge` for SV (ml), HR (bpm), CO (l/min), CI (l/min/m²) — **norm
form: lower/upper limit**. Measurement-plot pages follow.

### `moxy_export` — Moxy/training-app strip chart (1 p, English)
Header tiles Heart Rate (bpm), Power (W), Cadence (rpm), Speed, Muscle
Oxygen (%), Total Hemoglobin (g/dl) with Avg/Max/Min; SmO2 + tHb strip
chart below. No norms.

### `thb_measurement_log` — „Measurement Log" (1 p, English, CO-rebreathing)
No CSM letterhead; provenance is the Project block (IdentNo, name, leader,
date) — CSM-run. Sections: Personal data; Characteristics; Test data ([Hb]
cap/ven g/dl, [Hct] cap/ven %, CO-Hb before/after %, CO-application ml, Bag
volume l, CO ppm); **Results**: Body mass index, MCHC (g/dl), CO accounting
(ml), Haemoglobin mass (g), Erythrocyte / Plasma / Blood volume (ml), each
with a rel. twin (g/kg, ml/kg). Footer `export measurement #… | timestamp`.
No norms.

### Occasional CSM pages
- `echokardiografie` (1 p): free-text TTE finding on the zpráva layout;
  no table, nothing charted.
- `bia_segmental` (1 p): „BIACORPUS – Segmentální hodnocení BIA" (MEDICAL
  HealthCare GmbH device) — segments, tříkomponentní model, tuková tkáň
  (kg, %), TBW/ECW, ECM/BCM, bazální metabolismus; norms as percentage
  bands. One-off; not charted.
- `zpusobilost_posudek` (1 p): statutory „Žádost o posouzení…" + „Lékařský
  posudek o zdravotní způsobilosti k tělesné výchově a sportu"; no metrics.

## Older-provider documents (timeline only — they do not define the protocol)
- `tvl_dekurz` (2 pp) — regional-hospital letterhead, not CSM: „Ambulantní
  dekurz", TVL prohlídka. Anamnesis, prose Objektivně, Vyšetření (Výška,
  Hmotnost, BMI, Klidová fH, Klidový TK), EKG prose, bike ergometry stage
  table (`TF | TK na PHK | SpO2` at rest / W/kg steps / max / zotavení),
  numbered Závěr, Dg dle MKN.
- `cpet_export_olymp` — device exports, no clinic letterhead (Olymp-era):
  „Klidové měření" spirometry (`Parametr | Jednotka | Norm. | LLN | Hodnota
  | % Norm | Z-score`); „Olymp" CPET report (Prahové hodnoty `VT1 | VT2 |
  V'O2peak`, each `Hodnota | % Norm | % Max`, plus Norm./Absolutní; data
  table; charts); „Hodnocení výkonnosti" zones protocol (Pásma A–E with TF,
  v (km/h), V'O2 (L/min) bounds + prose). The companion CPET xlsx duplicates
  the PDF's key-value dump — not a distinct source.
Note: two sample files are byte-identical duplicates of one annual bundle.

## Charted metrics (the patient card's trend set)

| metric_id | display name | unit | sources |
|---|---|---|---|
| vo2max_rel | VO₂max | ml/kg/min | lekarska_zprava, funkcni_vysetreni, cpet_export_olymp |
| vo2max_abs | VO₂max absolutní | l/min | funkcni_vysetreni, cpet_export_olymp, lekarska_zprava (kalkulováno row, one year) |
| hr_max | TF max | /min | lekarska_zprava, funkcni_vysetreni, tvl_dekurz, cpet_export_olymp |
| hr_vt1 / hr_vt2 | TF na VT1 / VT2 | /min | lekarska_zprava, funkcni_vysetreni |
| speed_vt1 / speed_vt2 | Rychlost na VT1 / VT2 | km/h | lekarska_zprava (bike years: power_vt1/power_vt2 in W) |
| fvc | FVC | l | lekarska_zprava, spirometrie |
| fvc_pct_norm | FVC % náležité | % | lekarska_zprava („% normy"), spirometrie („%(B/N)") |
| fev1 | FEV1 | l | lekarska_zprava, spirometrie |
| fev1_pct_norm | FEV1 % náležité | % | lekarska_zprava, spirometrie |
| body_mass | Hmotnost | kg | every doc header, thb_measurement_log |
| thb_mass | Hb mass | g | thb_measurement_log, lekarska_zprava, tHb xlsx |
| thb_mass_rel | Hb mass rel. | g/kg | thb_measurement_log, lekarska_zprava, tHb xlsx |
| blood_volume | Objem krve | ml | thb_measurement_log, lekarska_zprava, tHb xlsx |
| spo2_max | SpO2 v maximu | % | lekarska_zprava, funkcni_vysetreni, tvl_dekurz |

Deliberately excluded: single-appearance rows (run_economy, Fick extraction,
BIA), per-visit stage series (lactate curve), and everything the
workstations chart but no summary table prints.

## tHb xlsx column map (`hemoglobin_vyvoj.xlsx`, header row 1)
One row per measurement; the export carries history whose PDFs are lost.
Ingest → metric_id (unit): I `Body mass [kg]` → body_mass (kg) · AL `MCHC
[g/dl]` → thb_mchc (g/dl) · AQ `Haemoglobin mass [g]` → thb_mass (g) · AR/AS/
AT `Erythrocyte|Plasma|Blood volume [ml]` → ery/plasma/blood_volume (ml) ·
AU `rel. Haemoglobin mass [g/kg]` → thb_mass_rel (g/kg) · AV/AW/AX rel.
volumes → …_rel (ml/kg). Visit keys: A `IdentNo`, B `Date`, C `Time`. Method
columns (skip for the card): J–M ambient, N–S [Hb]/[Hct] cap+ven, T–AE CO-Hb
readings, AF–AJ CO dosing, AK BMI, AM–AP CO accounting. Identity/anamnesis
columns D–H and AY–BY (names, DOB, analyzer, sport, training, altitude,
address, project) are **never ingested** — real personal data.

## Visit kinds (document co-occurrence observed in the samples)
- **annual** — one date carries the battery: lekarska_zprava + spirometrie +
  ekg_klidove + funkcni_vysetreni, some years + physioflow, moxy_export,
  bia_segmental, zpusobilost_posudek; the blood panel is drawn the same
  visit and printed inline in the zpráva. A post-illness check (zpráva +
  echokardiografie) also lands here.
- **perf_test** — funkcni_vysetreni (or an older-provider tvl_dekurz /
  cpet_export_olymp set) without a same-date zpráva.
- **thb** — thb_measurement_log (or an xlsx-only row); standalone or on a
  day adjacent to an annual battery — still its own visit.
- **blood** — a lab-report date with no performance document.
