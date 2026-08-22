# Design notes

For anyone changing how this looks. The UI was reviewed four times by agents
role-playing Czech clinicians, and several choices that look arbitrary are
answers to something a doctor could not use. Those are listed here so they are
not undone by accident.

Verify visual changes with `npm run test:e2e` — it drives the built app in a
real browser at 390px and 1200px and asserts *rendered geometry*, which is
where the worst defects here lived. It waits for the app's own first render,
never for `networkidle`: with a Turnstile site key configured the upload panel
embeds a widget that holds a request open for the life of the page, so the
network is never idle and every navigation would time out.

## The shell: a left rail, a reading area, one screen per question

The demo used to be a single 1100px column with the ingest controls parked at
the bottom of every tab — you scrolled past several thousand pixels of charts
to reach the upload box, and the chat answered two lines below that. The
Streamlit original it replaced had this right, and the layout is now back to
it:

- **The left rail owns the documents.** Upload, the list of loaded reports,
  removing one, removing all. Anything that answers "which PDFs am I looking
  at" lives there and nowhere else. Below 1080px it becomes an off-canvas
  drawer with its own close button — on a phone it covers most of the screen,
  so the strip of scrim beside it is not a target anyone can hit.
- **The reading area owns the findings.** One tab per question, including chat,
  which is a conversation and needs the height of a screen rather than a card
  under a chart.
- **The patient line is in the top bar**, pinned above everything, for the same
  reason it used to be a sticky strip: a chart screenshotted into a record has
  to say whose it is.

**Clearing every report is a first-class action, and it is reversible.** There
was no way to get rid of the sample patient, so anyone trying their own PDF
mixed their results into a fictional person's. It confirms first (an uploaded
PDF is never stored — reloading it costs another extraction) and the demo set
can be loaded back with one button.

## Changing tabs changes the view, not what you have built

Every panel is mounted; the inactive ones are `hidden`. Rendering them as
`tab === x && <Panel/>` unmounted the previous one and took its state with it —
the charts you had opened, the conversation you were having, a correction typed
but not yet saved. Nine pieces of state across five tabs, all of it the
reader's work, and clicking a document in the rail destroyed it too, because
that force-switches to Ověření.

`hidden` rather than a class: it takes the panel out of the accessibility tree
and the tab order as well as out of view. The whole mechanism rests on it, so
`[hidden]` is `!important` — a later rule setting `display` on a panel would
otherwise stack all five silently.

Two test selectors assumed one panel existed in the DOM and both broke on this,
which is worth knowing before writing a third: a text match under `.main` now
also reads the hidden panels, and "click every closed `<details>`" now finds
ones that cannot be clicked. Match on visible elements.

## Uploads are a queue, and a spent allowance stops it

Several PDFs can be chosen or dropped at once, and more can be added while the
first are running. The queue is worked one document at a time — a phone
rendering a long report concurrently is how it runs out of memory — and its
rules live in `lib/uploadQueue.ts` with no PDF or React in them, because
ordering, isolation and "each file once" are exactly what is painful to check
through a browser.

What a queue changes is which failures matter. A page that will not parse is
local to its document; a spent page allowance, an exhausted budget or a dead
session defeat every remaining file, and retrying against them produces a wall
of identical errors that reads as a broken app rather than as a limit. That
distinction is `isFatalApiError` in `lib/api.ts`, next to the error it inspects.

## The verification highlight frames the row, it does not cover it

The highlight was a 2px border with a red wash inside it. `box-sizing:
border-box` put that border on the first and last pixel row of the print and
the wash over the digits — the value it pointed at was the one thing it
obscured. It is now a `box-shadow` ring drawn *outside* the element's box, with
a second, very large spread dimming the rest of the page instead of tinting the
row. Nothing is painted over the characters being verified.

`getBoundingClientRect` ignores both, so the geometry assertions in
`e2e/visual.e2e.ts` still measure exactly the same box.

The magnified row crop bleeds sideways as well as fitting the pane width. Scaled
to the bare bounding box it ran wider than its container, and the
reference-range column — the thing being checked — sat off-screen behind a
scrollbar nobody notices.

## The app opens on the patient, not on an empty tab

The first screen used to be the Trends tab with nothing plotted, and the only
patient context anywhere was one line in the top bar. A doctor had to choose an
analyte before the app told them anything at all.

`web/src/ui/PatientCard.tsx` now sits **above the tab strip**, so it is outside
the panels and true of every tab: name and rodné číslo, the birth date and age
decoded from that number, how long the follow-up has run, how many draws — and
two or three generated Czech sentences about the whole series.

- **It reads `seriesShape`, not the last pair.** That is the point of it. On
  the demo it renders GGT at +103 % and triacylglycerols at +85 % across the
  whole series, and says so explicitly — "napříč celou sérií, ne jen mezi
  posledními dvěma odběry". Only the two largest moves per direction are named,
  so ALT's +67 % is ranked out; the sentence is a lead, not an inventory.
- **A withheld reading can never reach it, and never reads as a clean
  result.** Everything is computed through `numericPoints`, asserted in
  `patientSummary.test.ts` with the misread glucose placed at the *end* of the
  series — the position where forgetting would actually show.

  Filtering alone was not enough, and getting this wrong was the worst defect
  in the first version: with the latest draw's only abnormal reading withheld,
  the card announced "žádná hodnota mimo referenční rozmezí" — an all-clear the
  app had no evidence for, in the first paragraph on every tab. Withheld
  readings are now named ("2 hodnoty k ověření: …") and the all-clear is
  qualified to "žádná **ověřená** hodnota". `constraints.md` requires exactly
  this: a doubt must reach the screen the patient is shown.

  This is checked by unit test only. The shipped demo's misread sits at draw
  two of ten and is normal at the last draw, so no browser test built on the
  demo data can exercise it — removing the filter entirely leaves the whole e2e
  suite green. Worth knowing before trusting a green run here.
- **"Mimo rozmezí" means measured at that draw**, not "the last time we looked".
  An analyte measured once in 2022 and never since was being reported as out of
  range "k poslednímu odběru 14. 4. 2026", which is a false sentence about a day
  on which nothing was measured. The demo hides it — all ten reports carry all
  twenty-two analytes — so this only ever appears on a real upload.
- **A rise and a fall get a sentence each.** They share no noun in Czech, and
  taking only the largest move meant a haemoglobin falling out of range vanished
  whenever something else was rising faster. That is the single worst thing this
  paragraph could omit.
- **It degrades by omission.** No rodné číslo means no birth date and no age
  rendered, not a dash; one draw means no follow-up span and a sentence saying
  the comparison does not exist yet, rather than a card claiming nothing
  changed. Age is labelled "v době odběru", because on a report set that ends
  years ago a bare number reads as the patient's age today.

The auditor needs no new screen for it: it renders above the tab strip, so
every screen already in `SCREENS` measures it at all four widths in both
palettes.

## The summary is grouped, and every line is a link

Twenty analytes as one flat list buried the four a doctor opened it for. It is
now out-of-range, then real moves inside the interval, then a collapsed
"prakticky beze změny". Each line jumps to the row it was read from in
verification: the next question about a surprising number is "where does that
come from", and the answer is the printed row.

## Trends open empty, and parameters are added by name

The tab used to plot all twenty analytes on load. That is not a view of
anything — it is twenty charts to scroll past to reach the one you came for. It
now opens with a search picker and nothing else, the way the Streamlit original
worked: **＋ Přidat analyt**, type, pick, and it stacks under the ones already
there. Matching ignores diacritics ("kyselina mocova" finds "Kyselina močová")
and prefers prefixes, so typing "al" offers ALT before Kyselina močová.

The empty screen still names the out-of-range analytes as one-click chips.
"Nothing here, go and choose" is honest but unhelpful, and what a doctor came
for is usually one of those four.

**The list is anchored to the toolbar card, not to the ＋ button.** `right: 0`
hangs a dropdown leftwards from its containing block, and the button is a 133px
box: once one chart is on screen the toolbar carries "Vyčistit" too, which on a
phone wraps the button onto its own line at the *left* of the card — so the
list opened from x=162 and ran to −173px, with the search field and the first
half of every parameter name off the left edge of a 390px screen. Measuring the
right edge from the card instead puts it 15px inside the viewport at every
width, while the list is at most 86vw, so it cannot leave the screen; on a
desktop the button sits at the card's right edge anyway and nothing moves.
`.map-actions` had already made this move for the mapping picker, and the two
are now the same pattern — **anchor a dropdown to the row, never to the
control**. Guarded by the auditor screen *trends (picker open over a chart)*,
which is a different screen from *trends (picker open)* for exactly this
reason: with nothing plotted the toolbar does not wrap and the bug is invisible.

## The hover readout is on the chart, not under it

Pointing at a measurement shows a small box with the draw date, the value with
its unit, its range status and whether it is unconfirmed, plus a dashed guide
down to the axis. It used to be a line of text in the figcaption below the
plot, which is a long way to look for something you are pointing at. That
caption is still written — it is the accessible and touch fallback — but it is
no longer the only channel.

**Everything drawn after the hit target is `pointerEvents="none"`.** The
visible dot was painted over its own hit circle and `mouseenter` does not
bubble, so pointing *straight at* a measurement did nothing and only the ring
of empty space around it responded. Guarded by "shows a readout when the
pointer is on the dot itself".

## Light / dark / system

Three states, not two: a machine set to dark should serve the app dark, and a
two-way toggle has to guess at first paint and is wrong half the time. The
choice is persisted to `localStorage` — it says nothing about a patient, and a
theme that resets every reload is not a setting.

That test is the whole rule for what may be stored, and exactly two things pass
it: the theme and whether the document rail is collapsed. Both are display
preferences describing the reader's screen, not the patient's data. Nothing
derived from a report is written to disk, which is the guarantee stated at the
top of `App.tsx` and the reason this list is worth keeping short.

The dark palette's values live once, as `--dk-*`, aliased onto the real tokens
by the system-preference rule and by `[data-theme="dark"]`. Those two rules
cannot be merged (a media query and a plain selector), and written out in full
they drifted immediately — a token added to one and forgotten in the other
gives a nearly-dark page with a white table header, but only for readers whose
system theme is light. `web/tests/theme.test.ts` fails if the two lists stop
matching.

## The demo dataset is ten draws over four years

Two to three a year, unevenly spaced, which is what routine follow-up looks
like. Fewer draws hid whole classes of defect: an axis that spaces by index, a
chart that flattens a real slope, a summary that reads the last two draws and
misses the shape. The headline analytes end at their highest — see the summary
limitation below; the dataset must not manufacture the one case the summary
reads wrong.

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

## On screen it is a "parametr", in the code an analyte

A laboratory measures *analytes*; a clinician reading the report says
*parametr* or *laboratorní hodnota*. The screen uses the clinician's word,
because they are the reader. `canonicalId`, `AnalyteDef`, `AnalytePicker` and
`rawAnalyteName` keep the laboratory's, because the registry is a laboratory
concept and renaming it would say nothing true.

Two notes for anyone repeating this kind of rename. It was safe to do by
substitution only because *analyt* and *parametr* share a declension — both
masculine inanimate hard-stem — so every `count(n, …)` plural and every
agreement around them carried over untouched. "Hodnota" is feminine, and the
same change would have been a rewrite of the surrounding grammar. And the chat
context header in `lib/api.ts` still says "Analyt": it is sent to the model
rather than shown to anyone, and the agent chat was out of scope for that pass.

## Czech is a constraint, not a translation

- **The summary uses no verb.** Czech verbs agree with the subject's gender and
  number, and the subject is an analyte name from a 109-entry registry —
  "Triacylglyceroly vzrostlo" should be "vzrostly". Dropping the verb removes
  the agreement problem; gendering the registry would be large and fragile.
  `web/tests/summary.test.ts` asserts no verb appears.
- **The opening card goes one step further: a registry name may only appear in
  the nominative.** A verb would have to agree with the analyte's gender, and a
  *preposition* would have to decline it — "u cholesterolu celkového", not "u
  Cholesterol celkový". So `web/src/lib/patientSummary.ts` writes verbless
  sentences in which analyte names occur only as items of a colon-introduced
  list or inside brackets, and every other word is one the module owns and
  whose agreement is therefore fixed at authoring time.
  `web/tests/patientSummary.test.ts` asserts both halves, the second by
  checking what precedes every occurrence of a name — over a fixture set that
  reaches **every** sentence template. The first version of that guard ran only
  over an all-rising fixture, so three of the templates went unchecked,
  including the one the demo actually renders; and it accepted `a ` as a
  preceding token, which any word ending in -a satisfies — including the
  prepositions *na* and *za*, the exact case it existed to catch.
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

## Mapping leads with the decision, not with the data

The mapping screen answers one question — *is the thing I already have under
this heading the same measurement as the thing I am looking at* — and getting
it wrong merges one analyte's history into another's, where it then looks like
it always belonged. That makes it the most consequential screen in the app,
and it used to be laid out as a data dump: ten rows of provenance before the
first decision, four suggestions of equal visual weight, and no way to reach an
analyte the suggester had not offered.

It is now built around the decision:

- **The recommendation is promoted** into a filled card with an accent edge —
  one per analyte, accepted without scrolling. Alternatives, the occurrence
  table and the escape hatch expand in place.
- **A contradicted candidate is never promoted.** When nothing survives the
  evidence the screen says so and offers the registry, instead of putting a
  filled accept button on a mapping the algorithm has already rejected. The
  contradicted ones stay reachable, marked, behind a quiet button.
- **The reference interval is shown.** It carries the largest weight in the
  scorer (+0.3 / −0.6), it is the only signal that works on a first-ever report
  where there is no history to compare against — and it was computed, weighted,
  unit-tested and never rendered. It was also missing from the test that decides
  whether to warn, so a candidate the algorithm had all but rejected could still
  be presented as the clean best match. `mapping.test.ts` now isolates that
  case: total against conjugated bilirubin, same unit, same material, similar
  name, no history — where only the printed intervals object.
- **"Nothing known" is not "checked and agrees".** A candidate with no
  corroborating signal is labelled *bez potvrzení*, not *doporučeno*.
- **The material is always named**, even when it cannot be compared. A urine
  reading mapped onto a serum analyte is a different test however alike the
  names look, and staying silent when the candidate had no history yet hid the
  one fact most likely to stop it.
- **Every acceptance is reversible.** `Registry.removeSynonym` unlearns only
  what the UI taught — a shipped synonym is not the user's to delete, since
  dropping it would silently change how every future report parses.

## The layout auditor

`e2e/audit.e2e.ts` walks every screen at five widths in both palettes — 119
combinations — and checks six invariants against the rendered boxes: no
sideways page scroll, nothing outside the viewport, no text clipped without an
ellipsis, 4.5:1 contrast on every piece of type, no control below the 24×24
target floor, and no control whose centre is claimed by something painted over
it.

**Two of those widths are phones, and the narrower one is the one that finds
things.** For a long time 390px was the narrowest measured, and 360px — what an
Android has been since the Galaxy S line settled on it — went unaudited. The
mapping screen, the most consequential in the app, scrolled 10px sideways there
while auditing clean at 390: a `minmax(310px, 1fr)` track keeps its 310px floor
when the container is narrower, and that card is ~296px wide at 360.

The lesson generalises past the one track. **A minimum width propagates all the
way up**, so any grid or flex ancestor that has not had its own automatic
minimum removed hands it on — which is why the occurrence table pushed the same
screen sideways from inside its own `overflow-x` container, and why the fix is
`minmax(0, 1fr)` plus `min-width: 0` on the containers rather than a smaller
number on the child. Reaching for `min(310px, 100%)` fixes only the *used*
width: a percentage is indefinite during intrinsic sizing, so the floor is still
there for anything sized from min-content.

It knows nothing about this app, so a new screen is audited by being added to
the list of screens, and a new invariant is enforced everywhere at once. Its
first run reported 1689 violations. Most were real: `--ink-muted` was 3.2–3.8:1
throughout, which on a screen a doctor reads numbers from is not a style
preference.

Three rules it does *not* enforce, because each produced only false positives:

- **Sticky bars covering content.** Content scrolling under a sticky header is
  what sticky means. `elementFromPoint` answers the same question honestly, so
  the z-index heuristic was deleted rather than loosened.
- **Overlap across layers.** A dropdown over its list, a drawer over the page,
  a scrim over what it blocks — comparing across layers reports the design.
- **Long thin targets.** A full-width 20px disclosure row satisfies the intent
  of the 24×24 floor; a 22×17px ✕ does not.

Two measurement details are load-bearing. Element rects are intersected with
every clipping ancestor, or anything scrolled out of a capped list reports a
phantom box on top of whatever follows it. And visibility is decided by
`checkVisibility()`, not by `display`: the body of a closed `<details>` is
hidden with `content-visibility`, which leaves `getBoundingClientRect` still
reporting a real box.

Run it with `npm run test:audit`.

## Still open

Three clinical limitations, deliberately left — decide on them before a real
clinic sees this:

- **Reference ranges are applied two-sided.** A CRP printed `1,0–5,0` makes
  `<1,0` render as "pod rozmezím", but a low CRP is a good result. Fixing it
  needs a per-analyte flag for whether the lower bound is clinical or a
  detection limit.
- **The *Souhrn změn* tab still compares only the last two draws.** With ten
  demo draws this is plain to see: ALT climbing 0,61 → 1,02 across four years,
  with GGT alongside, is the arresting fact; that tab's prose says "+5 %". The
  demo data deliberately ends on a rising point so it does not also invert the
  sign. The opening card now answers the whole-series question — `seriesShape`
  feeding `patientSummary.ts` — but the tab itself has not been rewritten, so
  the two describe the same analyte at two different scales.
- **In-range analytes rank by percent change** in the *Souhrn změn* tab, which
  inside a wide interval is usually assay noise. The opening card no longer has
  this problem — it names an in-range drift only when the series is monotone
  and has moved at least 15 %, so a bouncing percentage cannot lead the
  paragraph — but the tab itself is unchanged.
- **The computed values are not reachable.** `lib/derived.ts` builds non-HDL,
  LDL by Friedewald, cholesterol/HDL and AST/ALT, and the demo measures the
  inputs for all four but never LDL itself — the number a doctor asks about.
  `lib/chartSpec.ts` turns a described chart into a real one without letting a
  model near a value. Both are tested and neither has a route to the screen:
  they were built for the chat, which is deliberately unchanged. Wiring them in
  means either bringing chat back or putting the controls in *Trendy*.
