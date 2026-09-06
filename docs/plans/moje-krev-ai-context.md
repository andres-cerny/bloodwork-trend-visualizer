# Plan: Moje krev — kontext pro AI

Ondrej's brainstorm of 2026-09-06: a short questionnaire under the AI share
link, so the assistant that fetches the snapshot knows who it is reading.
Design decisions are settled here and in the mockup
(https://claude.ai/code/artifact/787d96f6-059f-41cf-bd27-d2d299feda9a,
variant "B2, upraveno"); do not re-litigate them in the build. Nothing is
built yet; this plan runs when Ondrej says go.

It also carries the one bug found on the live tab the same day: ChatGPT
cannot open the share page at all ("server vrací Markdown soubor, který můj
webový přístup neumí otevřít"). Ondrej's call: build the fix and the card as
one piece of work, one deploy, one debugging session if it fails.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where | Second card on the **Sdílet s AI** tab, under the link card, in every link state: heading "Doplnit kontext pro AI" with a `nepovinné` chip | The link stays the hero; the card is an offer, not a gate |
| Shape | One flat form, all fields visible; no sections, no wizard | Eight fields fit one phone screen and a half; hiding them hides how little is asked |
| Filled how often | Once, per account; every later link carries it | The whole point is that the person never refills it |
| Storage | `users.settings` JSON, key `aiContext`. No migration | The column exists, holds 64 KB, and is deleted with the account. A D1 migration needs Ondrej at the keyboard; this does not |
| After the first save | The card collapses to one summary line with **Upravit**; the form reopens in place | Otherwise the tab is a screen of fields forever. The mockup's A2 frame shows the line |
| Into the snapshot | Built in the browser by `buildAiShare`, a block after the header, before the table. The worker stores it verbatim as today | Keeps "the worker never reads a value out of a payload" true; the preview stays byte-for-byte what is served |
| Goal steers the reading | One sentence in the header's instruction list, chosen by *Zajímá mě* | A performance reader wants athlete reference context; a health reader does not |
| Sex | Segment: Muž / Žena | Reference ranges split on it |
| Age | Five-year bands in a select: do 18, 18–24, 25–29 … 60–64, 65 a více | Ranges shift by decade, not by year; a band cannot go stale and reads as less personal than a birth year |
| Height, weight | Two numbers, cm and kg, side by side | — |
| Pohyb | **One free text field.** No chips, no hours box. Placeholder asks what and how many hours a week | Ondrej's call; the volume still comes through the placeholder |
| Zajímá mě | Select: Výkon / Zdraví / Výkon i zdraví | — |
| Léky a doplňky | Chips: Kreatin, Železo, Vitamin D, Protein, Antikoncepce, Statiny, Léky na štítnou žlázu; plus a free line | Creatine alone saves the AI from a false kidney warning for a good share of athletes |
| Diagnózy | Chips: Štítná žláza, Cukrovka, Vysoký tlak, Gilbertův syndrom, Anémie; plus a free line | Gilbert is named because it explains high bilirubin every single time |
| Kouření, Alkohol | Selects: Ne / Občas / Ano (Pravidelně for alcohol) | Direction is enough for the AI; people answer three options honestly |
| Poznámka pro AI | Textarea | Where "odběr byl den po závodě" goes |
| Not asked, on purpose | Fasting, recent illness, women's context, blood donation, diet | Illness and fasting belong to a per-report questionnaire, a later idea; women's context felt too sensitive to ask; donation is rare |
| The page's type | The share page is served as **HTML** at `/ai/<token>` (no extension): a one-line heading, the snapshot in a `<pre>`, escaped, a robots noindex meta. A request whose `Accept` asks for `text/markdown` or `text/plain` gets the stored text byte for byte | ChatGPT's browser opens HTML and a few document types; `text/markdown` at a `.md` URL is "a file I cannot open". Probed 2026-09-06: Cloudflare passes ChatGPT's user agents, there is no robots.txt; only the type was wrong. Claude's fetch reads either. The negotiation is Cloudflare's own Markdown-for-Agents convention |
| Privacy wording | The intro says it is saved to the account, "bez jména, anonymně". Flagged: the account has an e-mail, so "anonymně" is a stretch. Ondrej kept it | His call. The privacy page says the honest version |

## Copy, verbatim

Heading: **Doplnit kontext pro AI** · chip `nepovinné`

Intro, two paragraphs:

> AI čte výsledky lépe, když ví, kdo jste, a má co nejvíc souvislostí — krev sportovce se vykládá jinak než krev člověka z kanceláře.
>
> Uloží se k vašemu účtu — bez jména, anonymně — takže až budete příště potřebovat nový odkaz, nic znovu nevyplňujete.

Labels, nominative: Pohlaví · Věk · Zajímá mě · Výška · Váha · Pohyb ·
Léky a doplňky · Diagnózy · Kouření · Alkohol · Poznámka pro AI. Optional
fields carry "· nepovinné" in the label, muted.

Placeholders: Pohyb "Co děláte a kolik hodin týdně — např. běh 3× týdně,
posilovna 2×"; meds free line "Další — název stačí"; diagnoses free line
"Jiné, co má AI vědět"; note "Cokoli, co má AI vědět — třeba že odběr byl den
po závodě."

Button: **Uložit a přidat k odkazu**. Nothing under it. Collapsed state
heading "Co AI o vás ví", the summary line, **Upravit**.

## Phase 0 — the page ChatGPT can open

`workers/portal/src/index.ts`, the share route and `serveSharePage`.

- `SHARE_PAGE` matches `/ai/<token>` with no extension; `/ai/<token>.md`
  keeps working for the 24 hours a link minted before the deploy can live,
  then the pattern loses the suffix in a later cleanup (note it in the code).
  `createShare` mints the extension-less URL.
- Content negotiation on the `Accept` header: `text/markdown` or
  `text/plain` named ahead of `text/html` → the snapshot as today,
  `text/markdown; charset=utf-8`. Anything else, including no header →
  `text/html; charset=utf-8`: `<!doctype html>`, `lang="cs"`, `<meta
  charset>`, `<meta name="robots" content="noindex">`, `<title>Moje krev —
  výsledky pro AI</title>`, an `<h1>` saying the same, and the snapshot in one
  `<pre>` with `&`, `<`, `>` escaped. No stylesheet, no script, nothing
  fetched. `x-robots-tag: noindex` and `cache-control: no-store` on both.
- Escaping is not optional: lab text carries values like "<0,5", which would
  swallow the rest of the line as a tag.
- The 404 stays one body, one status, one set of headers for every miss, on
  both paths.
- `ShareTab.tsx`: the sentence's URL comes from the worker as before, so the
  copy needs no change; the "Co AI uvidí" note stays true ("prostý text" is
  what sits in the `<pre>`). The claim in the file header becomes: the text
  is stored verbatim and served verbatim on the text path; the HTML path wraps
  it without reading it.
- `Privacy.tsx`: "odkaz na prostý text" → "odkaz na stránku s prostým textem".

Tests, `workers/portal/tests/aiShare.test.ts`: the minted URL has no
extension; a fetch with no Accept header gets HTML whose `<pre>` holds the
escaped snapshot and nothing else of the text; `Accept: text/markdown` gets
the bytes that were posted; a snapshot containing `<0,5 & >` round-trips
through both; a revoked or expired token 404s identically on both paths;
the `.md` form of a live token still serves during the overlap.

Gate: `npx vitest run --project portal`, `npm run typecheck`. The real gate
is after deploy, below.

**Amended after the first deploy, 2026-09-06.** Ondrej pasted a link and
ChatGPT refused it again as "a Markdown file". The worker log showed the
fetched address still ended in `.md` (the tab kept a link minted before the
deploy), and the content negotiation could hand raw markdown to any fetcher
that asks for it — which OpenAI's may. Both hypotheses closed at once: the
page is HTML whatever `Accept` says, the `.md` address redirects (301) to
the bare one, the tab strips `.md` from a kept link's sentence, and the
route logs the fetcher's user agent and `Accept` header (no token, no body)
so the next paste leaves evidence.

## Phase 1 — lab-core: the text

`packages/lab-core/src/aiContext.ts`, exported from the index.

- `AiContext`: every field optional; `sex: "m" | "f"`, `ageBand` as one of
  the fixed band ids, `heightCm`, `weightKg` numbers, `activity`, `meds`
  (chip ids), `medsOther`, `diagnoses` (chip ids), `diagnosesOther`,
  `smoking`, `alcohol`, `goal`, `note`. Chip ids and band ids are `const`
  arrays with Czech labels beside them, so the form and the text agree.
- `aiContextBlock(ctx)`: the Czech lines for the snapshot, headed `O mně:`,
  one line per answered field, nothing for an empty one; `null` when nothing
  is answered. Free text is trimmed and capped at 300 characters here, so a
  runaway paste cannot bloat the snapshot.
- `aiContextSummary(ctx)`: the one collapsed line, " · "-joined, as in the
  mockup ("Muž, 30–34 let · 178 cm, 76 kg · Silniční kolo 6–8 h týdně …").
- `goalSentence(goal)`: the header line — performance: read the values as
  an active athlete's, name what training explains; health: read them as a
  general health check; both: both. Written in Czech, in the header's voice.
- `buildAiShare(reports, trends, context?)`: header, the goal line appended
  to "Jak se mnou pracuj" when a goal is set, then the `O mně:` block, then
  the table. With no context the output is byte-identical to today.

Tests, `packages/lab-core/tests/aiShare.test.ts` and a new
`aiContext.test.ts`: the byte-identity with no context; every field renders
and every empty field is absent; the leak test runs again over a share built
with a context whose note contains an e-mail-shaped string and a name, and
pins that the block carries only what the person typed (the builder adds
nothing); the cap; the summary line's order and separators.

Gate: `npx vitest run --project lab-core`, `npm run typecheck`.

## Phase 2 — portal: storage and the card

- `apps/portal/src/lib/api.ts`: `Settings` gains `aiContext?: AiContext`.
- `Portal.tsx` keeps the **whole** `Settings` object in state. `PUT
  /api/settings` replaces the blob, so `saveLearned` today would erase a
  saved context, and a context save would erase the learned synonyms. One
  `saveSettings(patch)` merges and PUTs; both callers go through it. A pure
  merge helper gets a test in `apps/portal/tests`.
- `apps/portal/src/ui/AiContextCard.tsx`: three states — empty (form open),
  saved (collapsed line + Upravit), editing (form open with the saved
  values, Uložit, Zrušit). Chips are `<button aria-pressed>`; the sex
  segment is a two-button radio group; selects are native. No sentence is
  composed here: the summary line and the snapshot text come from lab-core.
- `ShareTab.tsx`: takes `context` and `onSave`; the share text is
  `buildAiShare(reports, trends, context)`; the card renders under the link
  card in all three link states. "Co AI uvidí" gains one muted line, "a to,
  co jste o sobě vyplnili", when a context exists — the raw text already
  shows the block.
- `apps/portal/src/styles.css`: `.pick`, `.ctx-seg`, `.ctx-row2`,
  `.ctx-summary` from the mockup, tokens only, both palettes.
- Worker: the settings handler needs no change. `PUT /api/ai-share` is new:
  it replaces the live link's text in place (404 with no live link), so
  "Uložit a přidat k odkazu" is literally that — a URL already pasted into
  an assistant serves the newer page rather than dying under a re-mint.
  The tab calls it after a save whenever a link is live; a failed refresh is
  not a failed save. `GET /api/export` adds
  `aiContext` to the JSON so the export stays "everything the account
  holds"; `workers/portal/tests/account.test.ts` pins it, and pins that
  deleting the account deletes it (it rides on the users row).
- `Privacy.tsx`: the share paragraph gains "a, pokud jste ho vyplnili, kontext
  o vás — pohlaví, věková skupina, výška, váha, pohyb, léky, diagnózy,
  kouření, alkohol a vaše poznámka"; the "co ukládáme" list gains the item,
  with the honest wording: saved to the account, no name, deleted with it.
- `docs/constraints.md`, the share sentence: extend "values, units, ranges
  and draw dates only" with the context clause; the tests it names still pin
  the absences.

Gate: `npx vitest run --project portal-app --project portal`,
`npm run typecheck`, `npm run docs:check`.

## Phase 3 — audit

- `tests/e2e/lib/portalHarness.ts`: the fake API answers `PUT /api/settings`
  and can serve a filled `aiContext`. `audit-portal.e2e.ts` gains one screen,
  "sdílet s AI (kontext uložený)", and the existing "bez odkazu" screen now
  shows the open form.
- `npm run test:audit:portal`, then the `portal-auditor` agent on the diff,
  then `invariant-reviewer` on the full diff.

## Deploy

No migration. Portal worker and portal app, one deploy via the `deploy`
skill; Ondrej runs the deploy himself (auto mode blocks it). After deploy,
in this order, so a failure points at one phase:

1. Mint a link with no context saved. `curl -H "Accept: text/markdown"` gets
   the text; a plain `curl` gets HTML with the text in `<pre>`.
2. Paste the sentence into ChatGPT and into Claude. Both must read the values
   back. This is the Phase 0 gate and the reason for the whole change.
3. Save a context on the live account, mint again, fetch the text path and
   read the `O mně:` block; ask ChatGPT what it knows about you.

## To confirm at go

- The collapse after the first save (recommended, shown as A2 in the
  mockup).
- The goal sentence in the header (recommended; one line, nothing else in
  the settled header changes).
