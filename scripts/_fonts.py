"""The font the PDF generators draw with.

Resolved from the repository, not from the system, and that is the whole point.

These generators produce output whose bytes depend on the font: glyph widths
move text, which moves the row bounding boxes and the rendered page images that
`web/public/demo/` and `web/tests/fixtures/` are committed copies of. CI
regenerates and asserts no diff, so any machine with a different font — or a
different *version* of the same font — produced a spurious diff. Bundling the
font removes the variable entirely: no install step, no platform branch, no
warning path, and identical output everywhere.

Two fonts are excluded deliberately, both learned by running into them:

* **Plain Arial** (on every Mac, only 0.8 MB) loses the hyphen when its text is
  read back through pdf.js. A reference range printed `4,11-5,60` extracts as
  `4,115,60` — which parses to a plausible wrong number rather than failing.
  Silently corrupting reference ranges is worse than refusing to run.
* **Arial Unicode** renders correctly but is 23 MB, and PyMuPDF embeds the whole
  font into every PDF it writes: fixtures grew from 1.5 MB to 24 MB each.

See `assets/fonts/README.md`.
"""
from __future__ import annotations

from pathlib import Path

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
REGULAR = FONT_DIR / "DejaVuSans.ttf"
BOLD = FONT_DIR / "DejaVuSans-Bold.ttf"


def czech_fonts() -> tuple[str, str]:
    """The bundled (regular, bold) pair.

    Fails loudly if the files are missing rather than falling back to a system
    font, because a fallback is exactly what reintroduces machine-dependent
    output — and the failure it caused last time was silent.
    """
    missing = [str(p) for p in (REGULAR, BOLD) if not p.is_file()]
    if missing:
        raise SystemExit(
            "Bundled fonts are missing:\n  "
            + "\n  ".join(missing)
            + "\n\nThey are committed to the repository — restore them with:\n"
            "  git checkout -- assets/fonts\n\n"
            "They are not resolved from the system on purpose: output is "
            "font-dependent, and a system font makes it machine-dependent."
        )
    return str(REGULAR), str(BOLD)
