# chat UI, second pass — the Perplexity layout

The backend is right and the model is right; the shell is not. Today apps/chat
is one centered column: header, transcript, pinned composer. This plan replaces
it with the three-zone research layout doctors already know from Perplexity —
history rail on the left, the conversation in the middle, evidence on the
right — and adds the two things that make a demo self-guiding: premade
conversations in the sidebar, and follow-up suggestions under every answer so a
doctor discovers charts without being told they exist.

Nothing on the server changes. The system prompt does not change, so the
promoted eval baseline (14/14) stays valid and no eval budget is spent. This is
a rendering pass, executed by a generate-and-judge agent loop (§5).

## 0. Decisions

| Decision | Choice | Why |
|---|---|---|
| Layout | Three-zone: left history rail, center thread, right sources rail (desktop); drawer + inline sources (mobile) | The user asked for Perplexity specifically; doctors know the pattern |
| Sidebar histories | **Clickable, replaying canned transcripts** — not dead labels | A sidebar item that does nothing reads as broken. A canned replay costs $0, loads instantly, and demos capability while the doctor is still deciding what to type |
| Canned transcripts | Static JSON fixtures, committed, **synthetic patients only** | Fixtures live in git and in dist. The real record must never appear in one — same rule as evidence images, same reason |
| Follow-up suggestions | **Deterministic, client-side** — a curated Czech pool keyed on what the turn did (tools run, chart drawn or not, patient pinned) | Model-generated follow-ups would touch the evaluated prompt and re-open the eval gate. Rule-based costs nothing, never hallucinates a capability, and guarantees a "vykresli to do grafu" nudge whenever numbers appeared without a chart |
| Sources placement | Right rail on desktop, showing the focused answer's registry; collapsible "Zdroje (n)" block under each answer on mobile | The user asked for references on the right. The row crops are the demo's best asset — the rail gives them width |
| `[n]` markers | Become interactive: click scrolls/highlights the rail entry | Perplexity's core gesture; today the chips are inert text |
| Build process | Tournament: 3 parallel variant builders → blind evaluator → refine round → merge | The user's design: "three UIs get generated, an evaluator picks one, the winner branches" |
| Screenshots | Orchestrator captures all variants **sequentially** through one browser; builders only build | One shared Playwright/devtools browser cannot serve three agents at once, and per-worktree npm installs are dead weight |
| API budget for this pass | $0 during the loop (fixture replay), ≤ $0.50 for the final live walkthrough | The loop never talks to the worker; only the last smoke test does |

## 1. What the doctor sees

### Desktop (≥ 960px)

```
┌───────────┬──────────────────────────────┬─────────────┐
│ Ordinace  │  Dotaz (heading)             │  Zdroje     │
│           │  ▸ kroky nástrojů            │  [1] crop   │
│ + Nové    │  Odpověď s [n]               │  [2] crop   │
│   vlákno  │  ░ graf ░                    │  [3] výňatek│
│           │  Související: ▸ ▸ ▸          │             │
│ Historie  │                              │             │
│  · conv 1 │  ─ další dotaz… ─            │             │
│  · conv 2 │                              │             │
│  · conv 3 │  [ Napište dotaz…        ➤ ] │             │
└───────────┴──────────────────────────────┴─────────────┘
```

- **Left rail (~240px).** Practice name, „Nové vlákno", then „Nedávné" — the
  canned conversations, titled like real work („Souhrn — Tomáš Hrubý",
  „Ferritin v sezóně — K. Šebestová", „Dva Michalové Novákové"). Clicking one
  replays its fixture into the thread instantly (no API call) and pins its
  patient chip; the composer stays live, so the doctor can continue a canned
  conversation with a real turn. Below: theme switch, budget, the disclaimer.
- **Center.** Perplexity answer anatomy per turn: the question as a heading,
  tool steps as small rows while streaming, the answer with clickable `[n]`
  superscripts, charts inline, then „Související" — up to three follow-up
  chips. The patient chip moves to the top of the center column (it scopes the
  thread, not the app). Composer floats at the bottom of the column.
- **Right rail (~320px).** The evidence registry of the focused answer — the
  latest by default, or whichever answer's `[n]` was clicked. Lab sources keep
  the full-width row-crop band; document sources keep the excerpt; either
  expands to the page image in place.

### Mobile (< 960px)

- Left rail becomes a hamburger drawer, same content.
- Right rail disappears; each answer gets a „Zdroje (n)" disclosure directly
  beneath it, rendering the same components at column width.
- Composer stays pinned above the keyboard — the current behaviour, kept.
- Follow-up chips scroll horizontally in one row.

### States that must survive the redesign

Empty state (suggestions), Turnstile gate, budget-frozen, error row, streaming
tool steps, the ambiguity question (two Nováks), chart turns, and the
practice picker on `/`. Each is a scripted screenshot state in §5.

## 2. Canned conversations

A fixture is the SSE event log of a real turn, captured once and committed:

- `apps/chat/src/fixtures/<tenant>/<slug>.json` — ordered events
  (`text`/`tool_start`/`tool_result`/`patient`/`chart`/`sources`/`done`) plus a
  title and the user turns.
- A tiny replayer feeds them through the **same** event-handling path `send()`
  uses — one code path renders both live and canned turns, so a fixture that
  renders is proof the UI handles the event grammar.
- Captured from the deployed worker against synthetic patients (three per
  tenant: one summary with mixed lab+document sources, one chart turn, the
  Novák disambiguation for orto). Evidence image URLs in fixtures point at the
  committed synthetic page assets, never the KV shelf.
- The replayer doubles as the deterministic data source for the UI loop (§5):
  every variant renders identical pixels from identical fixtures.

## 3. Follow-up suggestions

A pure function of the finished turn, in the shell (rendering a menu is not
reasoning — the check-bundle rule is untouched):

```
suggest(turn): tools ran, no chart, numbers shown → „Vykresli to do grafu."
              chart drawn                        → „Porovnej s minulou sezónou."
              patient pinned, labs only          → „Co říkají dokumenty?" (sport: výkonnostní testy)
              patient pinned, documents only     → „Ukaž laboratorní hodnoty."
              cohort answer                      → „Otevři jednoho z nich." (names from the answer's refs)
              no patient pinned                  → tenant suggestion pool
```

Curated Czech strings per tenant, at most three shown, clicking sends the text
as a normal turn. The pool lives beside TENANTS in one file so copy review is
one diff.

## 4. What changes where

| File | Change |
|---|---|
| `apps/chat/src/App.tsx` | Becomes the three-zone shell: layout state (drawer, focused answer), fixture replay, follow-ups; `send()`'s event loop moves to a shared `applyEvent` used by both live and replay paths |
| `apps/chat/src/Transcript.tsx` | Turns group into per-question blocks (heading, steps, answer, chart, follow-ups); `[n]` chips become buttons that focus the rail |
| `apps/chat/src/Sources.tsx` | Unchanged internals, re-homed: renders into the rail (desktop) or the disclosure (mobile); RowCrop stays as is |
| `apps/chat/src/Sidebar.tsx` (new) | History rail / drawer |
| `apps/chat/src/fixtures/` (new) | Canned transcripts + capture script note |
| `apps/chat/src/app.css` | Rewritten for the grid; ui-kit tokens only, both palettes — the theme test's rule stands |
| `tests/e2e/` | Chat states join the audit sweep (the plan's standing „Open" item) — five widths, both palettes, over fixture replays |

Not touched: workers/*, packages/* (agent, gate, datasource, tools, core),
prompts, evals, api-client. If the loop discovers it wants a server change, that
is a finding for the log, not an edit.

## 5. The build loop — generate, judge, branch

One orchestrator session; builders and the evaluator are spawned agents on the
subscription. The 50%-usage stop rule stands.

**Round 0 — the harness (orchestrator, no fan-out).**
Capture the fixtures (§2) from the live worker (~$0.30 once, cached forever in
git). Write the screenshot script: for a given dev-server port, drive the
scripted states — empty, mid-stream (replayer paused), full answer with
sources, Novák ambiguity, chart turn, drawer open — at 390px and 1440px, both
palettes. Write the rubric the evaluator scores against: hierarchy, likeness to
the reference pattern, row-crop legibility at rail width, Czech copy fit (no
overflow, no orphaned labels), mobile composer ergonomics, palette parity,
streaming states, wow. Commit the harness before any variant exists.

**Round 1 — three variants in parallel.**
Three builder agents, each in its own worktree, each with the same spec (§1–§4)
and a distinct temperament: **A** Perplexity-faithful (closest mapping of their
anatomy), **B** clinical-calm (same zones, quieter surfaces, evidence-first),
**C** dense-pro (data-forward, tighter rhythm, for the doctor who wants a
worklist). Builders code until `npm run typecheck` and a production build pass;
they do not screenshot. Orchestrator then serves each worktree's build on its
own port, runs the screenshot script sequentially through the one browser, and
files the shots as A/B/C.

**Round 2 — blind judgment.**
The evaluator agent (role file: `ui-auditor`) receives the rubric and the
labeled screenshots — not the code, not the temperament names — scores each
state, picks a winner, and writes a concrete critique: what the winner must fix,
and which single idea from each loser is worth grafting. The critique is a
committed artifact; „B won" without reasons re-runs the round.

**Round 3 — the winner branches.**
Two refiner agents fork the winning worktree: one applies the critique
(including the grafts), one does the mobile/a11y/palette pass against the audit
states. Orchestrator re-screenshots both; evaluator picks again. One refinement
generation is the default; a second only if the evaluator's score table says
the loser states are still failing, and the cut line is two.

**Round 4 — merge and prove.**
Merge the winner into `chat-demo`. `npm run typecheck`, `npm test`,
check-bundle, the extended audit sweep, then one live browser walkthrough
against the deployed worker (the five-defect lesson: the walkthrough catches
what unit tests cannot) — including one real turn to confirm live and replay
paths render identically. Deploy. Update the build log here and in
docs/plans/chat-demo.md.

**Cut lines.** If parallel worktrees misbehave: fall back to sequential
variants, same rubric. If fixture capture from live is blocked (Turnstile):
hand-author one fixture from the routes test's fake stream and capture the rest
after the human click. If the tournament stalls on taste: variant A
(Perplexity-faithful) ships — it is what was asked for.

## Build log

- [ ] Round 0 — fixtures, screenshot script, rubric committed
- [ ] Round 1 — variants A/B/C built and screenshotted
- [ ] Round 2 — critique committed, winner chosen
- [ ] Round 3 — refinement generation judged
- [ ] Round 4 — merged, audited, walked through live, deployed
