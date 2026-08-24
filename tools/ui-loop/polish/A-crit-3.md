# Candidate A — critique, round 3 (closing pass)

Judged on the 34 shots in `shots/A-3/` only. Mobile read as if at 1x.

## Pass-2 defects, one line each

1. **Evidence rail carries no evidence in the flagship answer — UNFIXED, but
   covered by the declared limit.** Cards 1–6 in `answer-desktop-*`,
   `cite-focus-desktop-*`, `sources-open-mobile-*` still render title · lab ·
   date only; the component itself is proven to work — `chart-desktop-light/dark`
   cards 1–5 show a legible compact band („B_Hemoglobin … 149", dimmed to a grey
   paper tone in dark, not a white glare panel) — so this is the stated
   server-side gap (odběr events carry no per-parameter data), not a UI defect.
   Not counted.
2. **Document excerpts are letterhead, sliced through the glyphs — FIXED.**
   Excerpts now open on the cited line where the payload has one
   („…RA: bez kardiovaskulární zátěže…" card 7, „…Operatér: MUDr. Kamil
   Brandejs…" card 4, „…Diagnóza: stav po plastice předního zkříženého vazu…"
   card 5), clamp on whole lines, and nothing bleeds past the rounded border in
   either theme or viewport. The three tail-only excerpts are the declared limit.
3. **Turnstile the brightest object on every dark screen — FIXED.** The widget
   sits on a dark surface in `empty-mobile-dark`, `midstream-mobile-dark`,
   `sources-open-mobile-dark`, `answer-desktop-dark`, `chart-desktop-dark`; the
   only saturated pixels left are the vendor's orange logo.
4. **Two copy slips — FIXED, both.** The rail explainer now reads „Číslo na
   konci věty sem odkazuje." (`empty-desktop-*`, `midstream-desktop-*`), matching
   the bracket-less chip actually rendered; the candidate rows read „nar. 19. 7.
   1963" / „nar. 27. 2. 1988" (`ambiguity-desktop-*`, `ambiguity-mobile-*`) —
   nominative, no verb.

## The „Související" check

**CONFIRMED, in both themes.** In `sources-open-mobile-light` and
`sources-open-mobile-dark` the „Související" heading is followed by its hairline
divider and then ~30 CSS px of bare background before the composer dock — the
three follow-up rows exist (they render correctly in `answer-end-mobile-*`) but
sit entirely behind the opaque floating dock, with no fade or scrim to say so.
Read as a shipped screen it is a labelled empty region.

## Remaining consequential defects — 2 to fix, 1 optional

1. **„Související" heading over nothing** — `sources-open-mobile-light` and
   `-dark`. Expanding a turn's „Zdroje (5)" pushes the follow-up rows under the
   floating composer, and the section's own heading is the last thing visible;
   give the thread bottom scroll-padding equal to the dock height (and keep the
   text fade over the dock edge) so the section that owns the heading can never
   end up fully occluded.
2. **A decimal point in Czech chrome** — „Rozpočet ukázky: zbývá 9.61 $" in the
   sidebar footer of every desktop shot, both themes, and in
   `drawer-mobile-light/dark` (9.78 $ on the ortopedie tenant). Two centimetres
   away the same screen writes 5,1 μkat/l and 13,9 % — set „9,61 $".
3. **Mixed date typography inside one screen** (least severe; lives in the
   fixture prose, not the chrome) — `chart-desktop-light/dark` and
   `chart-mobile-light/dark` read „od 16.1.2024 do 19.5.2025" and „16.1.2024:
   149 g/l" while the rail beside them reads „16. 1. 2024"; normalise the
   fixture text to the spaced Czech form.
