# Design notes

For anyone changing how this looks. The UI was reviewed four times by agents
role-playing Czech clinicians, and several choices that look arbitrary are
answers to something a doctor could not use. Those are listed here so they are
not undone by accident.

Verify visual changes with `npm run test:e2e` — it drives the built app in a
real browser at 390px and 1200px and asserts *rendered geometry*, which is
where the worst defects here lived.

## The palette is validated, not chosen by taste

Values come from the `dataviz` skill's reference palette and were run through
its checker in both themes.

**Green is deliberately absent.** Red↔green scores ΔE 4.1 under simulated
deuteranopia — a colourblind doctor could not separate "normal" from "out of
range". So in-range points wear the neutral series colour and only out-of-range
is marked. Blue↔red scores ΔE 23.8 (light) / 25.7 (dark).

Status is never colour alone: an arrow glyph and a Czech label ride along, and
the reference band means out-of-range is legible from position. If you add a
series colour, run the validator rather than eyeballing it.

## Czech is a constraint, not a translation

- **The summary uses no verb.** Czech verbs agree with the subject's gender and
  number, and the subject is an analyte name from a 109-entry registry —
  "Triacylglyceroly vzrostlo" should be "vzrostly". Dropping the verb removes
  the agreement problem; gendering the registry would be large and fragile.
  `web/tests/summary.test.ts` asserts no verb appears.
- **Plurals take three forms** (1, 2–4, 5+). `web/src/lib/czech.ts` handles
  agreement; "5 strany" instead of "5 stran" is immediately visible to a native
  reader.
- **Dates read `14. 2. 2024`**, axis labels `2/24`. Never `24/02` — a Czech
  reader parses that as the 24th of February.
- Prefer clinical Czech over anglicism: "Přiřazení názvů", not "Namapování".

## What a clinician could not use, and why it is the way it is

Each of these was a real finding. The parenthetical is what it protects.

- **A flagged misread is not plotted.** Glucose transcribed as 44,5 where the
  page prints 4,45 was drawn as a real result on the screen a patient is shown.
  It is now held out and named on the card. *(`web/tests/trends.test.ts`)*
- **An unconfirmed reading is plotted but named in words.** A hollow dot alone
  is a convention nobody taught the reader.
- **The x axis is time, not index.** Draws in January, February and then three
  years later rendered identically to three evenly spaced draws — a steep rise
  and plateau read as a gentle slope. *(`web/tests/chartAxis.test.ts`)*
- **Charts scale to the data, not the reference band.** Ferritin moving
  112 → 88 inside a 30–400 band rendered as a straight line, which is the fall
  the chart was opened to show. Limits are drawn as labelled dashed lines; a
  limit outside the view is named in the caption.
- **Axis values are round numbers.** Deriving ticks from the data range gave
  labels like "0,056", which reads as a measurement rather than a scale marker.
- **Tables show printed values unrounded.** The trends table showed 3,8 for a
  printed 3,802 — two numbers for one measurement, in a tool whose pitch is
  checking against the source.
- **A single measurement gets no chart**, because one point invents an axis and
  shades the whole plot as "reference range".
- **The patient bar is sticky.** The trends page runs several thousand pixels,
  and a chart screenshotted for the record must still say whose it is.
- **The verification highlight is positioned in percentages** of the image's own
  dimensions, never from a measured pixel width. A measured width is only
  correct once layout settles, and that pane relayouts constantly — on a phone
  it framed the wrong analyte entirely. *(asserted in `e2e/visual.e2e.ts`)*
- **On a phone the selected row gets a magnified crop.** At 390px the source
  page renders ~5px rows; the highlight landed correctly but the number could
  not be read, which is the whole point.
- **Review chips and the review filter are the same set.** A chip on a row the
  filter does not list, or a listed row with no chip, leaves the reader unable
  to tell what is being asked of them.

## Still open

Three clinical limitations, deliberately left — decide on them before a real
clinic sees this:

- **Reference ranges are applied two-sided.** A CRP printed `1,0–5,0` makes
  `<1,0` render as "pod rozmezím", but a low CRP is a good result. Fixing it
  needs a per-analyte flag for whether the lower bound is clinical or a
  detection limit.
- **The summary compares only the last two draws.** ALT rising across four
  draws with GGT alongside is the arresting fact; the prose says "+11% since
  February".
- **In-range analytes rank by percent change**, which inside a wide interval is
  usually assay noise.
