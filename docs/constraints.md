# Constraints

Things that look like ordinary code but will break something real if changed
without knowing why. Each has a test that fails if you get it wrong; where it
does not, that is noted.

## The parsing layer exists twice — keep it in step

`src/normalize.py` and `web/src/lib/normalize.ts` implement the same rules —
Python for the local pipeline, TypeScript so the browser can re-derive a
corrected value live. Two implementations of one specification drift silently,
and a drift here means the demo and the local tool disagree about what a
decimal means.

`tests/parity_cases.json` is read by **both** `tests/test_parity.py` and
`web/tests/parity.test.ts`. To change a parsing rule: edit the fixture first,
then make both implementations satisfy it. CI runs both.

## The PDF generators are font-locked

`scripts/make_demo_data.py` and `scripts/make_layout_fixtures.py` draw with a
DejaVu bundled at `assets/fonts/`, resolved from the repository and never from
the system. Their output is font-dependent — glyph widths move text, which
moves row bounding boxes and page images — and CI regenerates and asserts no
diff, so a system font makes that output machine-dependent.

**Do not repoint this at a system font.** Two are excluded for cause:

- **Plain Arial** loses the hyphen through pdf.js: a range printed
  `4,11-5,60` extracts as `4,115,60`, which parses to a plausible wrong number
  rather than failing.
- **Arial Unicode** works but is 23 MB, and PyMuPDF embeds the whole font into
  every PDF it writes — fixtures went from 1.5 MB to 24 MB each.

`web/tests/layouts.test.ts` fails if the hyphen ever goes missing again.

## Three kinds of range, and confusing them causes harm

| Question | Source | Where |
|---|---|---|
| Is this result abnormal? | The interval printed on the patient's own report | `normalize.py` / `normalize.ts` |
| Is this the same analyte? | Curated table → printed intervals → observed values | `web/src/lib/mapping.ts` |
| Is this number even possible? | Curated table, else the printed interval | `web/src/lib/implausible.ts` |

`scripts/reference_ranges.json` holds the curated intervals. **They are seeded
from commonly published adult values and are NOT verified against a Czech
clinical source** — check them against ČSKB recommendations or a lab handbook
before relying on them beyond a demo. They only ever tell analytes apart or
spot a misread; a result is never flagged normal or abnormal from them.

`web/tests/bench/plausibility.bench.test.ts` scores the strategies against each
other. On its current cases: observed values 8/15 with 7 false accepts, printed
intervals 12/15, the curated table 15/15. Run it after changing any of this.

## Every doubt must reach the screen a patient is shown

`web/src/lib/review.ts` is the single authority for "can this reading be
trusted, and why". The verification chips, the review filter, its counter and
the trend screen all read it. Two tiers, because the doubts differ:

- **withheld** — believed *wrong* (a misread decimal). Kept out of the plotted
  series and named on the card.
- **unconfirmed** — may well be right, nothing confirmed it (two reads
  disagreed, or low confidence). Plotted, drawn hollow, named in words.

If you add a new kind of doubt, add it **there**, not at a call site. The bug
this replaced was a misread flag reaching the chart while a model disagreement
did not, so four readings the app had itself doubted were plotted silently.

## Signal colours draw, ink colours are for type

`web/src/styles.css` carries two tokens for what looks like one colour:
`--accent` / `--accent-ink`, `--status-critical` / `--critical-ink`. The split
is not cosmetic. The same blue that reads correctly as a 2px chart line on
white is only 3.4:1 as 12px type on a tinted chip, so one token serving both
jobs means every legibility fix dulls the graphics and every vivid graphic
costs legibility.

**Type takes the `-ink` token; lines, rings, bands and tints take the signal
token.** This is a screen a doctor reads numbers from, so `npm run test:audit`
fails on any piece of type below 4.5:1 — the rule that found `--ink-muted`
sitting at 3.2–3.8:1 across the whole app.

## The registry unlearns only what the UI taught

`Registry.removeSynonym` walks back an accepted mapping, and refuses to remove
a synonym that shipped with the registry: it deletes from `learned` first and
returns `false` if the name was not there. A shipped synonym is not the user's
to delete, because dropping it silently changes how every future report parses
— the undo for one session's mistake would become a permanent parsing change.

It also clears the lookup index entry only when no remaining name still
normalizes to that key, or unlearning one spelling would strand the others.
`web/tests/registry.test.ts` covers both.

## A derived value must refuse rather than approximate

`web/src/lib/derived.ts` computes what the panel did not print — non-HDL, LDL
by Friedewald, cholesterol/HDL, AST/ALT. Two rules make that safe, and both are
enforced in code rather than trusted:

- **Every input comes from the same draw**, keyed on report id. Pairing by
  nearest date would combine a cholesterol from March with a triglyceride from
  September, which is not a lipid panel but two halves of different ones.
- **Friedewald is refused above 4,5 mmol/l of triglycerides.** Above that it is
  not a worse estimate of LDL, it is a wrong one. The draw is dropped and the
  series carries the reason. An unexpected unit is refused the same way rather
  than silently converted.

Nothing here invents a reference range — see the curated-interval warning
above. Every derived point carries flag `unknown` with no bounds: offered as a
number to look at, never judged normal or abnormal.

`web/tests/derived.test.ts` covers both rules. Both were proven by
reintroducing the fault.

## The model may name a chart, never fill one

`web/src/lib/chartSpec.ts` turns a request for a chart into a chart without the
model handling a value. It emits identifiers, a date window and a chart type;
everything plotted is read from the same trend map the Trendy tab renders from.
A chart built this way is therefore *by construction* the same data as the
chart in the tab, and there is no path by which an invented number reaches the
screen.

This is the same move `worker/claude.ts` already makes on the text path: the
model assigns columns rather than recognising characters, because the
characters come from the file.

`parseChartSpec` is the only door, so it is the only place that has to be
right. It reads four fields and drops everything else — a model that returns
its own values, a title and a colour gets none of them through. **Do not widen
it into a general validator**; anything it does not name cannot get through,
and that is the property doing the work.

Refusing is a first-class outcome: an unknown parameter, a window with fewer
than two draws, a single measurement, or mixed units each say so and say what
is available instead. An empty chart is worse than a refusal, because it looks
like a finding.

Note this reverses "prefer context injection over tool-calling" in
`docs/web-demo-plan.md`. That guidance was about multi-step agentic tool use on
weak models; this is single-step constrained output, and it is what *removes*
the fabrication risk.

## Privacy — the one hard rule

`data/`, `samples/*.pdf` and `web/public/demo/real/` are git-ignored because
they hold real medical data. Keep it that way.

The shipped demo dataset is synthetic (`scripts/make_demo_data.py`) and safe to
publish. To ship real reports instead:

```sh
python3 -m scripts.export_web_data --name "Jan Ukázka" --id "800101/0006" --shift-days -37
```

That replaces the identity in the JSON **and redacts the printed name and rodné
číslo from the page images before rendering them** — the images are photographs
of the original reports, and the verification tab is exactly where someone
studies them closely. It refuses to publish a page it cannot verify: finding
zero identifiers is only reassuring if it *could* have found them, so a page
without a usable text layer is rejected rather than exported. Images are staged
and published only once every page passes.

Its check reads the PDF text layer. It cannot catch an identifier that exists
only as pixels — a stamp, a signature, a handwritten note. **Look at
`web/public/demo/pages/` before deploying.**

## A security review found one real defect

The redaction guard above could not detect the case it existed for: redaction
and verification both ran through the text layer, so on a scanned page nothing
matched, nothing was painted over, and a page whose header carries the
patient's name rendered straight through looking clean. Fixed as described.

Confirmed sound in the same review: HMAC session verification denies on every
malformed path rather than falling through; no secret can reach the client
bundle or an error body; the spend ledger is driven only by token counts the
API reports; the Worker's only outbound hosts are hardcoded. Worth re-running
`/security-review` if you change `worker/`.
