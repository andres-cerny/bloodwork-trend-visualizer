# Bundled fonts

`DejaVuSans.ttf` and `DejaVuSans-Bold.ttf`, from DejaVu 2.37, committed rather
than taken from the system so the PDF generators produce byte-identical output
on every machine.

**Why this matters, and which two fonts are excluded and how that was learned:**
[docs/constraints.md](../../../../docs/constraints.md#the-pdf-generators-are-font-locked).
That is the one home for the reasoning; this file used to restate it, and two
copies of a rule drift.

The short version: CI asserts the demo data regenerates with no diff, and a
system font makes that assertion depend on the machine.

Resolved by `tools/pipeline/scripts/_fonts.py`.

Licence: `LICENSE-DejaVu.txt` (Bitstream Vera / Arev, permissive; DejaVu's own
changes are public domain).
