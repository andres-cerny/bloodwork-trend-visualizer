# public_sheets — hand-transcribed truth for the public sample sheets

The PDFs themselves live in git-ignored `data/public-sheets/` (see its `SOURCES.md`);
`manifest.json` records each one's URL, sha256 and page so a fresh clone can re-fetch it.
They are the labs' copyrighted handbooks and name real staff, so they are never committed —
only the facts printed on the sample sheet are, one `<slug>.json` per page, every cell
copied exactly as printed (decimal comma, spaced parentheses, en dashes, the `>=1.0` typo).
Patients are fictitious (`Novák Jan`, `XY YZ`) or blacked out (Břeclav).
Two independent reading passes were diffed before these were written; see `conventions`
in each file for what the layout does that the parser has never seen.
The vision arms render the page at run time from `data/public-sheets/<source>` at 220 DPI.
