# Candidate B — pass 2 critique (screenshots only)

32 shots in `shots/r2/B` reviewed: picker, home, timeline, timeline-sparse,
visit-annual, visit-scrolled, note, chart-lab, chart-perf, book-dead-end ·
mobile (390×844) + desktop (1440) · light + dark. Judged against
portal-rubric.md and portal-spec.md; B.md is the first-pass baseline.

## 1 · Regression check against B.md's defect list

| # | First-pass defect | Status | Evidence |
|---|---|---|---|
| 1 | Note tables flattened into one-cell-per-line lists | **CLOSED** | note-mobile-light/dark: the spiro stage table renders as a real table — header row `Parametr · VT1 / LT · VT2 / MLSS · Max / Peak`, each stage's numbers on one line (Tepová frekvence 156 / 178 / 192). visit-scrolled-mobile-light/dark: the training-zone table likewise (I0–I4 × TF × RPE). The „2 / 2" page marker is now a centred marker on a dashed rule, not body prose; scans sit behind „▶ Naskenované stránky (2) · originál dokumentu". *(Sub-issue introduced — see New defect 1.)* |
| 2 | Home note preview spends the first screen on letterhead | **CLOSED** | home-mobile/desktop, both palettes: the preview opens at „Hodnocení" and the clinical first sentence; it ends on a sentence boundary („…ale nejnižší za dobu sledování."). No address block, no orphaned „Datum kontroly:…". |
| 3 | Timeline date column wraps („19." / „11.") | **CLOSED** | timeline-desktop-light/dark 2024 entry: „19. 11." on one line. timeline-mobile-light bottom card: same date renders unbroken at 390. |
| 4 | Red paints the neutral half of a summary | **CLOSED** | timeline-sparse-mobile-light/dark, 6. 5. 2025: „● 2 parametry mimo rozmezí" carries the flag colour, „· 13 výkonnostních ukazatelů" is muted ink. Bullet sits on the first line, not beside the wrap. |
| 5 | Sticky „Objednat se" bar occludes the first flagged card | **CLOSED (by removal)** | home-mobile-light/dark: no sticky bar anywhere in the viewport; the Ferritin card is unobstructed. book-dead-end-mobile-*: the last home card („Historie návštěv") is fully clear above the sheet. Side effect noted in §3 (open question 1). |
| 6 | Badge placement inconsistent in timeline | **CLOSED** | timeline-mobile/desktop-*: krev, tHb, prohlídka and spiroergometrie all sit on their own line under the title; rows have one rhythm. |
| 7 | „MIMO ROZMEZÍ 0" on a metric with no reference range | **CLOSED** | chart-perf-mobile/desktop, both palettes: three stat cards (MĚŘENÍ · MINIMUM · MAXIMUM), no out-of-range card. chart-lab-* keeps the fourth card, where a band (135–175) actually exists. |
| 8 | Dark reference band nearly invisible | **CLOSED** | chart-lab-mobile-dark and chart-lab-desktop-dark: the in-range fill reads as a distinctly lighter block against the card, edge-to-edge, comparable in weight to light. |
| 9 | Unit stated twice in the chart header | **CLOSED** | chart-lab-*: „Hemoglobin" then „144 g/l". chart-perf-*: „VO₂max absolutní" then „5,39 l/min". |
| 10 | Display-size red numeral on home | **CLOSED** | home-mobile/desktop-*: „**4** parametry mimo rozmezí" — the numeral is heading-size, inline, flag-coloured; the words carry the message and „z 15 měřených" sits under it. |
| 11 | Small text-link touch targets | **PARTIAL (unprovable from pixels)** | visit-annual-mobile-*: „‹ Přehled" and „Historie" are noticeably larger type with more air around them; chart-*: „‹ Přehled" the same. But „změnit" inside the header pill (all states) and „Celá zpráva a podrobnosti návštěvy ›" (home-mobile-*) are still bare inline links — a screenshot cannot show padding, so I can neither confirm 44px nor call it open. |

Ten of eleven closed, one unprovable. No first-pass defect regressed.

## 2 · Score table (this pass)

| # | Criterion | Score | Justification (state) |
|---|---|---|---|
| 1 | First-screen answer | 2 | home-mobile-light/dark: date, kind badge, title, verdict card and „MIMO ROZMEZÍ 4" all land above the fold, and the first flagged row (Ferritin 18,0 µg/l · pod rozmezím · rozmezí 30,0–400,0) is legible — but its delta („↘ −14,0 od 9. 6. 2026") is cut by the fold. „Co se změnilo" is still one scroll away; a 3 needs the note preview two lines shorter. |
| 2 | Calm, not clinical | 3 | home-*: proportion is honest — a heading-size flag count, four ranged cards, then the in-range parameters with the same calm treatment (book-dead-end-mobile-* shows CRP 1,2 and Glukóza 4,62 in ink and blue). timeline-*: „vše v normě" earns its place; red appears only on flag phrases. No panic fields in either palette. |
| 3 | Trend legibility at phone width | 3 | chart-lab-mobile-light/dark: band labelled „max 175" / „min 135", y ticks 140/160, year ticks 2024–2026, decimal commas, no horizontal scroll. visit-annual-mobile-*: sparklines read as direction at word size. |
| 4 | The delta view | 3 | chart-lab-mobile-*: „↘ −3 g/l od 9. 6. 2026 · měřeno 11. 8. 2026"; visit-annual-mobile-*: „↘ −0,005 od 10. 6. 2025". Direction, magnitude, comparison date, no legend. Arrow is a drawn mark in accent blue, the magnitude is ink — the kit's rule respected. |
| 5 | Timeline scannability | 3 | timeline-sparse-mobile-*: dotted spine with „10 měsíců bez návštěvy" / „19 měsíců" / „17 měsíců", year rules, one badge rule, dates unbroken, per-visit counts scanning as a story. Only nit: „· 13" strands at the end of a line before „výkonnostních ukazatelů". |
| 6 | The note as a document | 2 | visit-scrolled-mobile-*: serif body, real tables, signature („MUDr. Jana Procházková / tělovýchovný lékař"), ukázka disclaimer, page marker on a dashed rule, scans collapsed. Docked for note-mobile-*: the four-column stage table is clipped at the card edge („Max / Peak" cut mid-glyph), and source hard breaks land mid-sentence („nad druhým ventilačním / prahem."). |
| 7 | Czech copy fit | 2 | Pluralization holds everywhere (1 parametr / 2 parametry / 4 parametry / 5 návštěv / 9 návštěv / 10 měsíců); labels nominative („Výsledky", „Krevní výsledky", „Všechna měření", „Další ukazatele"); vykání in frames („Vyberte si prosím svůj profil", „Děkujeme Vám za trpělivost"); Czech dates and decimal commas throughout; „parametr" never „analyt". Docked only for the clipped table header (note-mobile-*). |
| 8 | Palette parity | 3 | All ten states shipped in both palettes with no light artifact. Dark secondary ink measures #98968D on #1B1B1A ≈ 5.8:1; the light flag chip #B83737 on #FBEEEE ≈ 5.1:1. Band, gold note border, tenant blue and flag red all present in both. No green in any frame. Accent stays chrome/links/lines and never repaints a clinical verdict. |
| 9 | Mobile ergonomics | 2 | Full-width row targets, a large „Rozumím" button, the sheet reachable one-handed (book-dead-end-mobile-*), occlusion gone. Held at 2: „změnit" and „Celá zpráva…" remain bare links, and „Objednat se" now lives at the end of a long home page instead of always being in reach. PWA chrome still not assessable from shots. |
| 10 | Wow, honestly earned | 3 | chart-lab-desktop-light: labelled band, stat quartet, „Všechna měření" ledger — a clinic-grade metric page. visit-scrolled-mobile-light: the note finally reads as a letter, tables and signature intact. timeline-sparse-mobile-*: honest gaps, still the best idea in the field. Nothing in 1–9 was sacrificed to get there. |

**Total: 26/30** (pass 1: 22/30).

## 3 · New defects and what remains open (most severe first)

1. **CONSEQUENTIAL — the stage table is clipped at the card's right edge.**
   note-mobile-light and note-mobile-dark. The four-column table overflows its
   container: the header „Max / Peak" is cut through the final glyph and the
   column's values (20,1 · 192 · 70,4 · 5,39 · 1,12 · 176 · 94) sit flush
   against the same clip line, with the header rule stopping there too. The
   values themselves survive at 390 — VO₂ 70,4 ml/kg/min against 5,39 l/min is
   internally consistent — but the reader sees chopped text in the one view
   whose whole claim is „this is a document", and there is no scroll
   affordance to explain it. The audit sweeps five widths; at 360 or 320 this
   clip eats digits, not just a „k". *Fixed = the four columns fit inside the
   note card at the narrowest swept width (tighter header type, narrower
   gutters, or the label column stacked), or an explicit scroller with a
   visible edge and no mid-glyph cut.*

2. Not consequential — source hard breaks preserved mid-sentence.
   visit-scrolled-mobile-light/dark, „Doporučení": „…a vypuštění jednotek nad
   druhým ventilačním / prahem." breaks to a two-word line, and the next
   sentence starts on its own line. It reads as raw text pasted into a letter
   rather than set type. Cosmetic — the words are all there and legible.

3. Not consequential — the first delta is clipped by the fold.
   home-mobile-light/dark: „↘ −14,0 od 9. 6. 2026" is half-cut at the viewport
   edge. This is the last third of criterion 1, not a wrongness; one more
   trimmed line of note preview would close it.

4. Not consequential — chart label collision at desktop width.
   chart-lab-desktop-light/dark: the „144" value label overlaps the
   second-to-last marker, and the final point sits on the band's right edge.
   Taste, not legibility.

5. Not consequential — row rhythm varies on desktop.
   home-desktop-light/dark: „Saturace transferrinu" keeps chip, range and
   delta on one line while Ferritin, Železo and CK use two, so the value
   column reads ragged. Cosmetic.

**Open question, not counted as a defect:** „Objednat se" itself appears in
none of the 32 frames — its dead-end sheet does (book-dead-end-mobile-*, exact
mandated copy „Objednávání připravujeme." plus „Tato část portálu zatím není v
provozu. Děkujeme Vám za trpělivost."), so a trigger exists. Un-sticking the
bar closed defect 5 honestly; whether the button is still comfortably reachable
cannot be judged without a frame that contains it. Worth one shot next round.

**Disqualifiers:** none. Summaries stay count-derived („4 parametry mimo
rozmezí z 15 měřených", „vše v normě · 13 výkonnostních ukazatelů") with no
interpretive prose; no green in either palette; ghost patients only (Jakub
Svoboda, Lucie Dvořáková, Petr Beneš) with the „Ukázková data — smyšlený
pacient i pracoviště" disclaimer inside the note. Still not verifiable from
pixels: dynamic fixture import, data.ts-only fetching, URL pushes, test ids.

VERDICT: ANOTHER PASS — 1 consequential defect
