# Plan: Moje krev — round two

Ondrej's review of the live portal, 2026-09-05, on top of the deployed
`ui-redesign` tip (30fb58b). Four pieces of work, one of them new surface
area. Design decisions are settled here; do not re-litigate them in the build.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Chart lines | Straight segments between points | We do not know what happened between two draws; a curve claims we do |
| Chart bands | Inside the range stays paper; above and below tinted `--status-critical-soft`; no fill under the line | Two colours, not three: blue says "the line", red says "outside" |
| Last-value label | Removed | The current value sits above the chart and every point answers to hover |
| Hover | Unchanged | Already right |
| Redaction removal | Tap the box, an ✕ appears at its top-right, tap ✕ to remove | The chip list under the page named what each box covers ("Jméno · Jan Novák"), which shows the reader we read it. The screen must look like we cannot |
| Share with AI | New tab **Sdílet s AI**: one sentence to copy, pointing at a private, temporary markdown page | Cloudflare's agent-setup pattern; works in any chat that can fetch a page, no connector, no MCP |
| What the page holds | A snapshot the browser built at mint time, stored verbatim by the worker | Keeps "the worker never reads a value out of a payload" true, and the preview is byte-for-byte what is served |
| Link lifetime | 24 hours, one live link per person, minting replaces | The link is a bearer key to health numbers; short life plus revoke is the whole safety net |
| Token at rest | Hashed, like login tokens | A database leak yields no working link |
| Page instructions | Ask the assistant to interpret as an experienced doctor, without a disclaimer on every answer | Ondrej's call: people will use it for exactly that |

## Phase 1 — charts

`packages/ui-kit/src/TrendChart.tsx`, both `TrendChart` and `Sparkline`.

- Path: straight `L` segments. `monotonePath` and its test go; the smoothing
  has no other caller.
- Bands: the two out-of-range rects switch from `--band-neutral` to
  `--status-critical-soft`. The gradient area fill and its `<defs>` go.
- The last-point value label goes. Hover popovers stay exactly as they are.
- Check both palettes: the red tint must stay light enough that the blue line
  and red out-of-range points read on top of it in dark mode too.

Gate: ui-kit tests, `npm run typecheck`, `portal-auditor` (Trendy and Souhrn at
five widths, both palettes).

## Phase 2 — redaction review

`apps/portal/src/ui/RedactReview.tsx`.

- The `review-hits` chip list goes, and with it every place the screen prints
  `hit.text` or the identity kind next to a box. The aria-label of a box says
  "Začerněné pole 3", nothing more.
- A box becomes a button. Tapping selects it (outline), and a ✕ control is
  drawn at its top-right corner at a fixed tap size, outside the box if the box
  is thinner than the control. Tapping ✕ removes the box; tapping elsewhere or
  Escape deselects. Auto-detected and hand-drawn boxes behave the same.
- Phone: a box over one printed line is a few pixels tall. Give the button a
  minimum hit height (transparent padding) without growing the painted black.
- Test: the rendered review contains none of the strings the detector found.

Gate: redaction tests, `portal-auditor` on the review screen.

## Phase 3 — the stale highlight

On the 25.10.2024 SPADIA report, Ověření frames "Bilirubin celkový" for
"Bilirubin konjugovaný". The matcher (`rowBoxFor`) was fixed in the redesign
and has a test for this page; the report was uploaded before the fix, and its
highlight box is stored in the payload. The page's text rows are not stored
(the PDF never is), so nothing server-side can re-run the match.

Two ways out, Ondrej's choice:

- **Patch that one measurement's `bbox`** in the stored payload, from his
  logged-in browser, with a script that reads the report, moves the box one
  row down and PUTs it back. Cheap, precise, keeps his confirmations.
- **Re-upload the report.** The fixed matcher gets it right; costs one
  extraction and loses any Potvrdit/oprava on that report.

Recommended: the patch. Every later upload is already correct.

The patch is written: `tools/scripts/moje-krev-fix-bbox.mjs`. It runs in the
browser, not in node — open the logged-in portal, paste the whole file into
the console, and it reads the report through the session's `/api/reports`,
prints the boxes it found and the row pitch it measured, asks once, and PUTs
the report back with the "Bilirubin konjugovaný" box moved one row down.

## Phase 4 — Sdílet s AI

### The page text

Built in the browser by a new `buildAiShare(reports, trends)` in
`packages/lab-core` (next to `buildChatContext`, which supplies the table).
The header, verbatim:

```
This page holds one person's own blood test results, shared deliberately by them. Read it and follow the instructions below in Czech.

Toto jsou moje vlastní výsledky krevních testů, které jsem sem záměrně nahrál(a). Chci, abys mi pomohl(a) jim porozumět jako zkušený lékař, který mluví srozumitelně.

Jak se mnou pracuj:
- Odpovídej česky, jasně a bez zbytečných výhrad.
- Projdi všechny hodnoty. U každé mimo rozmezí řekni, co znamená, jaké jsou nejpravděpodobnější příčiny a jak vážné to je.
- Všímej si vývoje v čase, ne jen poslední hodnoty. Zhoršující se trend v normě je důležitější než stabilní hodnota lehce mimo.
- Nezakončuj každou odpověď stejným upozorněním. Pokud je něco skutečně naléhavé, řekni to jednou a jasně.
- Ptej se mě na doplňující informace (léky, příznaky, věk, pohlaví), pokud by změnily tvůj závěr.

Formát dat: jeden řádek na analyt. Sloupce: analyt | jednotka | referenční meze | hodnoty jako "datum: hodnota (stav)". Stav "H" je nad mezí, "L" pod mezí, "norm" v normě.
```

Then the table. No email, no name, no report id, no PDF.

### Worker

`workers/portal`:

- Schema: `ai_shares (token_hash PK, user_id, snapshot, created_at,
  expires_at, revoked_at)`. `CREATE TABLE IF NOT EXISTS`, applied with
  `wrangler d1 execute moje-krev --remote --file schema.sql`.
- `POST /api/ai-share` body `{ text }`: revoke the caller's live share, mint 32
  random bytes, store the hash and the text, answer `{ url, expiresAt }`. The
  token is shown once; the browser keeps the sentence for the tab's life, and
  a reload offers to make a fresh one.
- `GET /api/ai-share`: `{ expiresAt }` or `null`.
- `DELETE /api/ai-share`: sets `revoked_at`.
- `GET /ai/<token>.md`, **above** `requireUser` in the router: strict token
  regex, then lookup by hash; expired, revoked, unknown and malformed all
  answer the same 404. Headers: `text/markdown; charset=utf-8`,
  `cache-control: no-store`, `x-robots-tag: noindex`.
- `deleteAccount` gains `deleteSharesForUser`. The cascade comment says it
  lists everything an account owns; this is the sixth thing.

Tests, plain node with the fake D1: mint stores a hash and not the token; the
page answers for a live token and 404s for expired, revoked, garbage and a
token of the wrong length; minting again kills the previous one; the served
page contains neither the email nor any word from the users table; deleting
the account deletes the share.

### Tab

`apps/portal/src/ui/ShareTab.tsx`, sixth entry in `TABS` as `["share",
"Sdílet s AI"]`, laid out per the design mockup (artboards from the design
agent). States: no link, live link with copy and "Zkopírováno", revoke, the
"Co AI uvidí" disclosure showing the exact text that was stored. The copy
above the button explains it to a non-technical reader: click, copy, paste into
your AI (ChatGPT, Claude…), then ask.

Mockup (2026-09-05, six artboards, both palettes):
https://claude.ai/code/artifact/33692cbf-3715-4e16-ad00-340d705e08de. It
uses existing classes throughout; the one new element is `.ai-line`, the
monospace box for the sentence (`.runlog` ground, `ui-monospace`,
`user-select: all`). The preview table header says **Parametr**, per the copy
rule.

Six tabs on a phone, measured in a browser with the portal's own rules: at
390px they fit only if the label is written with non-breaking spaces, or the
bold active label wraps and the bar jumps in height. At 360px they need one
rule, `@media (max-width: 374.98px) { nav.tabs button { font-size: 0.66rem;
padding: 8px 0; } }`. Below 320px the strip would have to scroll; not
supported.

Gate: worker tests, `portal-auditor` on the tab at five widths, and a manual
check that ChatGPT and Claude actually fetch a live link from `workers.dev`
and read the table. That check cannot be automated and must be done before
the tab is deployed.

## Phase 5 — deploy

Work continues on `ui-redesign` in this worktree. Preview with `wrangler
versions upload` as before; after Ondrej's sign-off, commit, apply the schema
to D1, `npm run deploy:moje-krev`. Then the Phase 3 patch, from his browser.
`docs/constraints.md` gets one line: the AI share page carries values only,
never a page image, never an identity.

Order: 1, 2, 4, 5, 3. The chart and redaction changes are small and stand
alone; the share tab waits on the mockup; the patch needs the deploy.
