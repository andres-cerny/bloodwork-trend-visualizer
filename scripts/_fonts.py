"""Locating a font that can render Czech, and refusing ones that corrupt it.

The generator scripts hard-coded a Linux DejaVu path, so they could not run on
macOS at all — they raised `cannot open .../DejaVuSans.ttf` from deep inside
MuPDF, which reads as a PyMuPDF fault rather than a missing font. Since the
handoff asks a local session to run these scripts, that made them unusable on
the machine most likely to run them.

**The output is font-dependent.** Glyph widths differ between fonts, so
regenerating on a different machine shifts text positions and with them the row
bounding boxes and rendered page images. CI regenerates on Linux and asserts no
diff, so the committed artefacts under `web/public/demo/` and
`web/tests/fixtures/` should be regenerated on Linux — or the resulting diff
reviewed deliberately rather than committed by accident.
"""
from __future__ import annotations

import sys
from pathlib import Path

# (regular, bold, warning), most preferred first. An empty warning means the
# choice is free of caveats.
#
# DejaVu leads because it is what CI uses, and therefore what the committed
# artefacts were generated with.
#
# Plain Arial is deliberately ABSENT, despite being on every Mac and only
# 0.8 MB against Arial Unicode's 23 MB. Text drawn with it loses the hyphen
# when read back through pdf.js: a reference range printed "4,11-5,60"
# extracts as "4,115,60", which parses to a plausible wrong number instead of
# failing. A fixture generator that silently corrupts reference ranges is worse
# than one that refuses to run.
_CANDIDATES: list[tuple[str, str, str]] = [
    (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "",
    ),
    (
        "/opt/homebrew/share/fonts/DejaVuSans.ttf",
        "/opt/homebrew/share/fonts/DejaVuSans-Bold.ttf",
        "",
    ),
    (
        str(Path.home() / "Library/Fonts/DejaVuSans.ttf"),
        str(Path.home() / "Library/Fonts/DejaVuSans-Bold.ttf"),
        "",
    ),
    (
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "Arial Unicode is 23 MB and PyMuPDF embeds the whole font into every "
        "PDF it writes, so fixtures generated with it grow from 1.5 MB to "
        "24 MB each. Usable for a local check; do not commit the result. "
        "Install DejaVu instead: brew install --cask font-dejavu",
    ),
]


def czech_fonts() -> tuple[str, str]:
    """First usable (regular, bold) pair on this machine.

    Raises with something actionable rather than letting MuPDF fail on a path
    the caller never chose.
    """
    for regular, bold, warning in _CANDIDATES:
        if Path(regular).is_file() and Path(bold).is_file():
            if warning:
                print(f"WARNING: using {Path(regular).name} — {warning}", file=sys.stderr)
            return regular, bold

    tried = "\n  ".join(regular for regular, _, _ in _CANDIDATES)
    raise SystemExit(
        "No usable font found for rendering Czech. Tried:\n  "
        + tried
        + "\n\nInstall DejaVu so output matches CI:"
        "\n  macOS:  brew install --cask font-dejavu"
        "\n  Debian: apt-get install fonts-dejavu-core"
        "\n\nNote that plain Arial is excluded on purpose: pdf.js drops the "
        "hyphen from text drawn with it, which corrupts reference ranges."
    )
