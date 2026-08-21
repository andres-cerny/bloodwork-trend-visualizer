# Bundled fonts

`DejaVuSans.ttf` and `DejaVuSans-Bold.ttf`, from DejaVu 2.37.

They are committed rather than taken from the system on purpose. The PDF
generators (`scripts/make_demo_data.py`, `scripts/make_layout_fixtures.py`)
produce output whose byte content depends on the font: glyph widths move text,
which moves row bounding boxes and the rendered page images. CI regenerates and
asserts no diff, so a machine with a different font — or a different *version*
of the same font — produces a spurious diff.

Bundling makes the output identical on every machine with no install step.

Two fonts are excluded deliberately, both learned the hard way:

- **Plain Arial** loses the hyphen when its text is read back through pdf.js. A
  reference range printed `4,11-5,60` extracts as `4,115,60`, which parses to a
  plausible wrong number rather than failing.
- **Arial Unicode** works but is 23 MB, and PyMuPDF embeds the whole font into
  every PDF it writes — fixtures went from 1.5 MB to 24 MB each.

Licence: `LICENSE-DejaVu.txt` (Bitstream Vera / Arev, permissive; DejaVu's own
changes are public domain).
