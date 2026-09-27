# Moje krev — the edge cases, and what was decided (2026-09-27)

An audit walked Moje krev (`apps/portal`, `workers/portal`) the way a person
uses it — a wrong picture, a slow line, a dropped connection, a closed tab,
two tabs, an expired login — and found 36 ways it could lose a document,
show a wrong number or leave someone stuck. Ondřej decided each one; this
is the record of what was built, so the next change does not undo a
decision by accident. Deploying it: [moje-krev-go-live.md](../moje-krev-go-live.md), step 7.

## A document is never spent for nothing

| Case | Now |
|---|---|
| Allowance at zero mid-batch | `no_documents` ends the batch (it was missing from the stop-list, `lib/api.ts`) |
| Tab closed, phone died, answer lost | the browser asks before leaving; the worker settles a page under `waitUntil` and settles a stream that ends early as failed; the cron gives back a document opened over an hour ago with nothing read (`src/sweep.ts`) |
| Network drop, timeout, 429/5xx on a page | two more tries with backoff; a failed page does not count against the page cap (retries bounded at 3× the cap) |
| Every page failed | „Zkusit znovu" re-reads the redacted pages — same id if the document is still held, new one if it went back |
| Read, but the save failed | the read report is kept; „Uložit znovu" |
| Paid, but the credit failed | the webhook's credit and its mark are one D1 batch; Stripe's retry finishes it (`purchases.credited_at`) |

## What is asked before a document is spent

Refused outright: another file type, an empty file, over 20 MB (PDF) or
25 MB (photo), over 10 pages, a password-protected or broken PDF — each
with a Czech sentence saying what to do. Asked (FileCheck, „Nahrát i tak"):
over 6 pages, two different draw dates on the pages (only dates printed
after a draw label count — a birth date is not a second report), text that
does not read as a lab sheet, a photo whose local reading failed. The same
file again is recognised by its SHA-256 (`report.fingerprint`).

**Not built, on purpose (#8):** a per-page tick before sending a photo with
no redaction boxes. Ondřej: too much gating; the review's one confirmation
stays the person's responsibility.

## What is decided after the read

- **Nothing in it** — stored nowhere, document given back.
- **The same report again** — same day, same parameters, same values: not
  stored, given back.
- **Every third** such read in 30 days is kept, not given back
  (`documents.empty_at`, `POST /api/documents/:id/empty`) — the server never
  sees the rows, so the refund is bounded rather than trusted.
- **Same day, same parameters, other values** — held with „Uložit i tak" /
  „Neukládat". Czech labs send one draw as several PDFs (biochemie, krevní
  obraz, moč) with one date, so a shared date alone is never a duplicate.
  Ondřej first proposed forcing a date change; rejected together, because it
  would make people type a false date.
- **No date** — a pop-up with the page asks for it; „Později" leaves ⚠️ in
  Reporty and a field in Ověření. The field also appears when the readers or
  the pages disagreed on the date, or it is in the future or before 1990.
  Otherwise dates are not editable.

## Numbers the person is shown

- **Units (#19):** every reading is converted to the parameter's canonical
  unit where the catalog declares the factor (31 common parameters got SI
  factors in `seed_registry.py`, urea left out because mg/dl there is urea
  or BUN); Ověření says „v trendech převedeno z … na …". A unit nothing
  converts stays off the axis and the card says so — never plotted beside
  the others. The misread check uses the curated interval only for a
  reading in the canonical unit.
- **Bounds (#20):** „>200" against 0–5 is flagged high, in Python and
  TypeScript (parity cases). „<X" stays unknown: a low CRP is a good result.
- **Units and ranges are not editable in Ověření (#23).** Ondřej's call.

## Shared state

- Name mappings belong to the account that taught them first; a demo
  session teaches nothing; each account lists its own with an undo.
- Reports and settings carry a revision; a stale tab's save is refused
  (409) and reloads or merges instead of silently winning.
- The live AI link is rewritten whenever the data changes, and revoked when
  the last report is deleted.
- Demo visitors spend from their own ledger (`DEMO_USD_LIMIT`).
- The login lockout is per address and IP, with a ceiling across IPs.

## The shell

A root error boundary instead of a white page; an expired session goes to
the login with a sentence saying why; a server that does not answer is
„Server neodpovídá — Zkusit znovu", not the landing page; every request has
a deadline; the tab is in the address; logout waits for the server; a stale
code chunk after a deploy reloads the page once.

**Not built (#14, #26):** checking that a photo is the account holder's own
report (it would read as the app keeping their name), and a retry queue for
failed corrections in Ověření.

Layout audit in this container: six cases (Souhrn at 360, Ověření search at
834) fail on the untouched base too — fonts differ from the machine the
sweep was calibrated on — and were not treated as regressions.
