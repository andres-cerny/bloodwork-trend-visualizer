# tools/pipeline — the Python CI still needs

Five modules and four scripts, kept because CI runs them. The Streamlit tool and
everything only it reached is in `tools/archive/`.

Run from **this directory**: `python3 -m scripts.make_demo_data`.

## The generators are font-locked

`scripts/_fonts.py` resolves the committed DejaVu 2.37 TTFs, and **nothing here
may use a system font**. This is not aesthetic:

- CI asserts the demo data regenerates byte-identically. A system font makes
  that diff depend on the machine, and the check silently stops meaning
  anything.
- Plain **Arial is forbidden**: pdf.js loses the hyphen, so a printed
  `4,11-5,60` reads back as `4,115,60` — a range that parses as a number.
- Arial Unicode embeds 23 MB per fixture.

Same rule for `scripts/make_layout_fixtures.py`, which is the only generator for
the nine committed fixture PDFs in `packages/lab-core/tests/fixtures/`. It is
not in CI, but its outputs are, and `npm test` reads them.

## The parsing contract exists twice

`src/normalize.py` and `packages/lab-core/src/normalize.ts` are the same rules in
two languages. Both read `tests/parity_cases.json`; CI runs both sides. **Change
one, change the other, in the same commit** — that fixture is the only thing
holding them together.

## Privacy

`export_web_data.py` is the only path that puts real reports into a published
app. It redacts the name and rodné číslo from the page images before rendering,
and refuses to write if an identifier survives into the text layer or the JSON.
It cannot catch an identifier that exists only as pixels in a scan — check
`apps/bloodwork/public/demo/pages/` by eye before deploying.

`data/` and `samples/*.pdf` are git-ignored and a hook refuses to stage them.
