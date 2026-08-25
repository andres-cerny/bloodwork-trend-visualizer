# Candidate A — polish-loop pass 2 (screenshots only)

Judged from all 32 shots in `shots/r2/A`. The set is complete this time: the two
note states that timed out in pass 1 are present. Colour and contrast claims
below are measured off the PNGs, not eyeballed.

## 1. Regression check against A.md's defect list

| # | Pass-1 defect | Status | Where |
|---|---|---|---|
| 1 | Note unreachable at mobile; two states missing | **CLOSED** | `note-mobile-light` / `note-mobile-dark` both exist. Two entry points are now visible: „Číst celou zprávu →" on the home note card (`home-mobile-*`) and „Zobrazit s náhledy stránek" at the foot of the note (`visit-scrolled-mobile-*`). |
| 2 | Doctor's table renders as flattened prose | **CLOSED** | `visit-scrolled-mobile-*`: „Tréninkové intenzity" is a real 3-column table — header row INTENZITA / ZÓNA · TF (/MIN) · RPE, then I0…I4 with TF range and RPE paired on one line. `note-mobile-*` likewise renders the spiroergometry block as a 4-column table (PARAMETR · VT1 / LT · VT2 / MLSS · MAX / PEAK). „2 / 2" is now small letter-spaced grey chrome, not body text. |
| 3 | Reference band invisible as a band | **CLOSED** | `chart-lab-*`, all four. The band's top edge (175) and bottom edge (135) are both inside the plot, with the 180 gridline above it and headroom below. Pixel scan of `chart-lab-mobile-dark`: page `#0d0d0c`, band interior `#1a1a19`, edges at y=705 and y=979. Light: page `#f2f1ed`, band `#e5e4e1`. Separation is ~1.11:1 dark and ~1.09:1 light — matched across palettes. |
| 4 | English label „Hb mass rel." | **CLOSED** | `book-dead-end-mobile-*`: now „Relativní hmota hemoglobinu", nominative, consistent with „Objem krve" above it. |
| 5 | Lab rows: no sparkline, no tap affordance | **PARTIAL** | Affordance closed — a chevron sits on every lab row (`home-mobile-*`, `home-desktop-*`, `visit-annual-mobile-*`, `visit-annual-desktop-*`); verified on a full-resolution crop, not the downscaled preview. Sparklines: still absent from every lab row in all 32 states, while performance rows have them (`book-dead-end-mobile-*`). See §3.1 — I cannot close or convict this from pixels. |
| 6 | Date column wraps at desktop | **CLOSED** | `timeline-desktop-light` / `-dark`: „19. 11. 2024" sits on one line, as do all other dates. |
| 7 | Kind badges not distinguishable; placement wanders | **PARTIAL** | Placement closed: every badge now occupies a fixed right-aligned slot (`timeline-desktop-*`, `timeline-mobile-*`), no more inline-after-short-title drift. Hue not closed: THB is gold, PROHLÍDKA blue, but KREV (neutral grey fill) and SPIROERGOMETRIE (neutral outline) still share one hue and differ only by fill vs. border. |
| 8 | Label with trailing colon | **CLOSED** | `visit-scrolled-mobile-*`: „TRÉNINKOVÉ INTENZITY" is bare, matching LABORATOŘ / ZPRÁVA LÉKAŘE. |
| 9 | Theme switch names the state, not the action | **OPEN** | All 32 states: the pill reads „Světlý" with a sun in light and „Tmavý" with a moon in dark. The icon narrows the ambiguity but does not remove it. Cosmetic. |
| 10 | Desktop is a centred phone column | **PARTIAL** | `visit-annual-desktop-*` and `timeline-desktop-*` now use true multi-column rows (name · value · unit · range · delta · chevron). `picker-desktop-*`, `home-desktop-*`, `chart-*-desktop-*` are still one ~716 px column in a 1440 viewport. Spec permits „desktop the adaptation", so this stays taste. |
| 11 | Unconfirmed hairline light strip, dark mobile | **NOT A DEFECT** | Reproduced and explained: the bright bottom rows are clipped glyph tops (65–146 bright columns of 780 in `timeline-mobile-dark`, `home-mobile-dark`, `visit-annual-mobile-dark`), not a strip. A full-width row scan of `picker-desktop-dark` and `home-desktop-dark` returns a single uniform background value. No overflow-x artifact. |

## 2. Fresh score table

| # | Criterion | Score | State + justification |
|---|---|---|---|
| 1 | First-screen answer | 3 | `home-mobile-light/dark`: patient name, „POSLEDNÍ NÁVŠTĚVA · 11. 8. 2026", KREV badge, serif „Kontrolní odběr", the verdict „4 parametry mimo rozmezí" and all four flagged rows inside one 390 px viewport. No chrome to scroll past. |
| 2 | Calm, not clinical | 2 | Unchanged from pass 1 and docked for the same reason: `home-mobile-*` stacks five red elements above the fold — the headline plus four arrow+value pairs — so salience is tripled per row (arrow, number, headline). Honest and proportionate elsewhere: „Vše v normě" as the visit subtitle (`visit-annual-*`), „vše v normě" in timeline rows. Red is legible, not a panic field: 5.72:1 light, 7.93:1 dark. |
| 3 | Trend legibility at phone width | 3 | `chart-lab-mobile-*`: the band now reads as a band (defect 3), Czech decimals „144" / „5,39", axis type large, no horizontal scroll at 390. `book-dead-end-mobile-*`: eight word-sized sparklines, no axes, direction legible at a glance. |
| 4 | The delta view | 3 | `home-mobile-*` „OD MINULÉ NÁVŠTĚVY / ve srovnání s návštěvou 9. 6. 2026"; `chart-lab-mobile-*` header „11. 8. 2026 · ↓ −3 g/l od 9. 6. 2026"; `visit-annual-*` „změna oproti návštěvě 10. 6. 2025". Direction, magnitude with unit, and the compared visit all named. No legend needed. |
| 5 | Timeline scannability | 2 | `timeline-sparse-mobile-*` gap rows remain the best thing in the round. Docked: KREV and SPIROERGOMETRIE share the neutral hue (`timeline-desktop-*`), so kind still requires reading; and the long SPIROERGOMETRIE badge squeezes the title column into two-line wraps at 390 („Funkční / vyšetření", „Měření tHb (CO- / rebreathing)" in `timeline-mobile-*`). |
| 6 | The note as a document | 3 | `note-mobile-*` and `visit-scrolled-mobile-*`: serif body, real tables, signature block („MUDr. Jana Procházková / tělovýchovný lékař / Centrum sportovní medicíny z.s."), the honest fixture disclaimer, „Uvolněno 11. 8. 2026" on the home card, page markers demoted to chrome, page images behind an explicit „Zobrazit s náhledy stránek" rather than shouting. |
| 7 | Czech copy fit | 3 | „Relativní hmota hemoglobinu" replaces the English label; colon dropped; desktop date no longer wraps. Plural morphology correct across states: 1 parametr / 2 parametry / 4 parametry / 4 ukazatele / 7 ukazatelů / 10, 17, 19 měsíců. The note's table header is „PARAMETR" — never „analyt". Vykání in frames („Vyberte, prosím, své jméno.", „Přejete si další termín?"), nominative labels, verbs confined to buttons. Decimal commas, thin-space thousands („7 150 ml"), Czech dates including axis labels. |
| 8 | Palette parity | 3 | Measured: secondary ink 4.93:1 light / 6.72:1 dark; flag red `#b32828` → rose `#ec8a8a` (5.72 / 7.93); link navy `#21498f` → periwinkle `#92b4ee` (8.70 / 8.28); „Objednat se" navy-with-light-text → periwinkle-with-dark-text (7.70 / 9.25); badge text 6.50–15.81 across all four kinds and both palettes. Band separation matched (§1.3). A hue sweep of all 32 PNGs returns no green at any saturation. No light artifact in dark. |
| 9 | Mobile ergonomics | 3 | Tall row targets with a chevron on every openable row; full-width „Objednat se" with the polite dead-end „Objednávání připravujeme." and „← Zpět na výběr karty" (`book-dead-end-mobile-*`); the note now reachable at 390 by two routes. The PWA half of this criterion (icon, theme colour on a home screen) cannot be judged from this camera — scored on what is visible. |
| 10 | Wow, honestly earned | 3 | `visit-scrolled-mobile-light` is the photograph: a doctor's letter in serif with a properly set training-zone table, on a phone. `timeline-sparse-mobile-*`'s dashed „10 měsíců bez návštěvy" rules and the `home-mobile-*` hero (kicker → serif title → one-line count verdict) hold up beside it, and nothing in frame undercuts 1–9 any more. |

**Total: 28/30** (pass 1: 22/30)

## 3. Open items, most severe first

**3.1 Lab trend rows carry no sparkline — OPEN, but unproven, and therefore not counted.**
State: absent from all 32. Every lab row the camera framed is a *visit result*
row (`home-mobile-*`, `visit-annual-desktop-*`) showing value · unit · range ·
delta · chevron and no sparkline, confirmed on a full-resolution crop.
Performance rows in the same app do have them (`book-dead-end-mobile-*`), which
is what makes the asymmetry suspicious. But the spec's MUST attaches sparklines
to the „Results & trends" list, and no state in this shoot frames a lab trends
list — `book-dead-end-mobile-*` catches the tail of the performance list only.
Visit-result rows may legitimately carry no sparkline. This is a camera-coverage
gap as much as a candidate defect. Fixed = either a shot that frames the lab
trends list, or a one-line code check; do not convict on these pixels.

**3.2 KREV and SPIROERGOMETRIE share the neutral hue.** `timeline-desktop-*`,
`timeline-mobile-*`. Fixed = a distinct token hue per kind. **Cosmetic** — the
badge is also spelled out in full, so nothing is misread, only slower to scan.

**3.3 Theme switch names the state.** All states. **Cosmetic.**

**3.4 Desktop remains a centred column on picker, home and both charts.**
~50 % of a 1440 viewport is margin. The spec allows „desktop the adaptation",
and the two states that most need columns (visit, timeline) now have them.
**Cosmetic** — and not worth trading mobile for.

**3.5 Ragged numeric columns at desktop.** `visit-annual-desktop-light`: the
value+unit groups end at x≈1017 / 981 / 958 / 950 / 952 and the range column is
similarly uncentred, so decimal points do not line up down a column of numbers.
**Cosmetic**, but it is the one place where a table of numbers is harder to scan
than it needs to be.

**3.6 SpO2 loses the subscript that VO₂ gets, in the same list.**
`book-dead-end-mobile-*` („SpO2 v maximu" beside „VO₂max absolutní"), and again
in the note's own table (`note-mobile-*`: „VO₂ (ml/kg/min)" vs „SpO2 (%)").
**Cosmetic.**

**3.7 The note's second page is a raw analyser dump.** `note-mobile-*`:
„S_Ferritin: 32 µg/l; …", „B_Erytrocyty: 4,81 10^12/l", „0,436 1". It reads as
machine output rather than a letter, and the caret exponent is uglier than the
app's own tables, which set 10¹²/l correctly (`visit-annual-desktop-*`). This is
the fixture document's own text rendered verbatim, which is the honest thing to
do. **Cosmetic, and arguably correct as-is** — flagging only so the next reader
does not mistake it for a rendering bug.

**3.8 Reference range labelled inconsistently between screens.**
`home-mobile-*` says „rozmezí 30–400"; `visit-annual-mobile-*` shows a bare
„135–175" under the parameter name. **Cosmetic.**

**No new defects were introduced by the polish.** Everything in §3 except 3.6
and 3.7 was already visible in pass 1; 3.6 and 3.7 became visible only because
the note states now exist.

## 4. Disqualifier watch

- No colour outside the token set is evident: all four badge kinds, both link
  colours, the flag red and the band shift consistently between palettes, which
  is the signature of tokens rather than hard-coded values. All 32 shots are
  green-free.
- Every interpretation string seen is count-derived („4 parametry mimo rozmezí",
  „2 parametry mimo rozmezí", „1 parametr mimo rozmezí", „vše v normě",
  „4 ukazatele výkonu", „7 ukazatelů výkonu"). No diagnosis-flavoured prose.
- Arithmetic spot-checks all hold: Hb 147→144 = „↓ −3 g/l"; Hb 149→147 = „↓ −2";
  Saturace transferrinu 20,3 against 20–45 and CK 3,1 against 0,4–3,2 are both
  in range, so `visit-annual-*`'s „Vše v normě" is not false reassurance; the
  sparse gaps (10, 19, 17 měsíců) match the dates either side of them.
- The fixture holds ghost patients (Jakub Svoboda, Lucie Dvořáková, Petr Beneš)
  and the note states it: „Ukázková data — smyšlený pacient i pracoviště,
  negenerováno z reálného vyšetření."

VERDICT: CLEAN — nothing consequential remains
