"""Python half of the cross-language parity check.

`web/src/lib/` reimplements this module's parsing in TypeScript so the browser
can re-derive a corrected value live. Two implementations of the same rules
drift silently unless something forces them together — that is what
`tests/parity_cases.json` is for. Both this file and
`web/tests/parity.test.ts` read it, so a change made on one side and not the
other fails a test.

    python3 tests/test_parity.py
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.normalize import (  # noqa: E402
    canonicalize_unit,
    compute_flag,
    parse_czech_number,
    parse_range,
    parse_value,
)

CASES = json.loads(
    open(os.path.join(os.path.dirname(__file__), "parity_cases.json"), encoding="utf-8").read()
)


def _check(name, fn, cases, unpack=lambda c: (c[:-1], c[-1])):
    failures = []
    for case in cases:
        args, expected = unpack(case)
        actual = fn(*args)
        if isinstance(expected, list):
            actual = list(actual)
        if actual != expected:
            failures.append(f"  {name}({args!r}) -> {actual!r}, expected {expected!r}")
    return failures


def main() -> int:
    failures = []
    failures += _check("parse_czech_number", parse_czech_number, CASES["parse_czech_number"])
    failures += _check("parse_value", parse_value, CASES["parse_value"])
    failures += _check("canonicalize_unit", canonicalize_unit, CASES["canonicalize_unit"])
    failures += _check("parse_range", parse_range, CASES["parse_range"])
    failures += _check("compute_flag", compute_flag, CASES["compute_flag"])

    total = sum(len(v) for k, v in CASES.items() if not k.startswith("_"))
    if failures:
        print(f"{len(failures)} of {total} parity cases FAILED:")
        print("\n".join(failures))
        return 1
    print(f"{total} parity cases pass (Python side)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
