# chat UI, second pass — the Perplexity layout

The backend is right and the model is right; the shell is not. Today apps/chat
is one centered column: header, transcript, pinned composer. This plan replaces
it with the three-zone research layout doctors already know from Perplexity —
history rail on the left, the conversation in the middle, evidence on the
right — and adds the two things that make a demo self-guiding: premade
conversations in the sidebar, and follow-up suggestions under every answer so a
doctor discovers charts without being told they exist.

Two tracks run in parallel. The UI track is a rendering pass, executed by a
generate-and-judge agent loop (§5) — $0 of API. The follow-up track touches the
evaluated prompt on purpose: the follow-ups are model-generated, so the eval
gate re-opens, with its own agent and its own ≤ $10 budget (§3).

## 0. Decisions

| Decision | Choice | Why |
|---|---|---|
| Layout | Three-zone: left history rail, center thread, right sources rail (desktop); drawer + inline sources (mobile) | The user asked for Perplexity specifically; doctors know the pattern |
| Sidebar histories | **Clickable, replaying canned transcripts** — not dead labels | A sidebar item that does nothing reads as broken. A canned replay costs $0, loads instantly, and demos capability while the doctor is still deciding what to type |
| Canned transcripts | Static JSON fixtures, committed, **synthetic patients only** | Fixtures live in git and in dist. The real record must never appear in one — same rule as evidence images, same reason |
| Follow-up suggestions | **Model-generated, in the same turn** — up to three next questions, steered hard toward what the toolset can do next, charts above all | Ondřej's call, 2026-08-23: the doctor should see the model's potential, not a canned menu. This re-opens the eval gate deliberately |
| Follow-up eval | A new `followups_*` suite with its own agent; **≤ $10** for its promotion runs; the existing 14 answer cases must stay green in the same promotion | "The evaluation of the response is good. I just wanna create essentially a new evaluation of what follow-up questions come up" |
| Sources placement | Right rail on desktop, showing the focused answer's registry; collapsible "Zdroje (n)" block under each answer on mobile | The user asked for references on the right. The row crops are the demo's best asset — the rail gives them width |
| `[n]` markers | Become interactive: click scrolls/highlights the rail entry | Perplexity's core gesture; today the chips are inert text |
| Build process | Two parallel agents/tracks: the UI tournament (3 variants → blind evaluator → refine) and the follow-up eval loop | The user's design, both halves of it |
| Round-3 exit | **The final candidates go to Ondřej.** He assesses the side-by-side screenshots; the build continues on his pick and notes — no merge before that | His explicit instruction; taste calls on the shipped look are his |
| Screenshots | Orchestrator captures all variants **sequentially** through one browser; builders only build | One shared Playwright/devtools browser cannot serve three agents at once, and per-worktree npm installs are dead weight |
| API budget for this pass | $0 UI loop (fixture replay) · ≤ $10 follow-up eval · ≤ $1 fixture capture + live walkthrough | The UI loop never talks to the worker; the eval gate and the smoke test do |

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
  superscripts, charts inline, then „Související" — the model's own follow-up
  proposals as chips (§3). The patient chip moves to the top of the center
  column (it scopes the thread, not the app). Composer floats at the bottom.
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
  (`text`/`tool_start`/`tool_result`/`patient`/`chart`/`sources`/`followups`/
  `done`) plus a title and the user turns.
- A tiny replayer feeds them through the **same** event-handling path `send()`
  uses — one code path renders both live and canned turns, so a fixture that
  renders is proof the UI handles the event grammar.
- Captured from the deployed worker against synthetic patients (three per
  tenant: one summary with mixed lab+document sources, one chart turn, the
  Novák disambiguation for orto). Evidence image URLs in fixtures point at the
  committed synthetic page assets, never the KV shelf.
- The replayer doubles as the deterministic data source for the UI loop (§5):
  every variant renders identical pixels from identical fixtures. Until the
  follow-up track promotes, fixtures carry hand-authored `followups` events;
  they are re-captured for real once it has (~$0.30).

## 3. Follow-ups, model-generated

The model proposes what to ask next, in the same turn — steered hard, in the
prompt, toward showing its own range: a chart when numbers appeared without
one, the documents when only labs were read, a comparison when a trend was
shown, the cohort when one patient was. Up to three, Czech, each answerable by
the toolset it actually has.

**Mechanics.** The system prompt gains a closing-section instruction: after the
answer, emit the proposals in a marked tail (a sentinel line, then a JSON
array). The agent loop already mediates every text delta, so it withholds
streaming once the sentinel starts, parses the tail, and emits a `followups`
SSE event instead — the reader never sees the scaffolding. If tail-parsing
proves flaky under eval, the fallback is a second, minimal generation after the
answer (cheap, but a latency tax) — the eval decides, not taste. The client
renders chips; clicking sends the text as a normal turn. If the event never
arrives, the UI shows nothing — no deterministic fallback pool pretending to be
the model.

**The eval is the point.** A new `tests/evals/cases/followups_*` suite, graded
deterministically like the rest of the harness: the tail parses; 1–3 proposals;
Czech; a chart nudge present when the case's turn showed numbers chartless; no
proposal names a capability the toolset lacks (checked against a verb/pattern
allowlist built from the nine tools); no diagnostic or recommendation phrasing
(the profile's banned patterns apply to proposals too); proposals mention the
pinned patient's context, not another patient. And the standing rule: the
existing 14 answer cases run in the same promotion and must stay at baseline —
a prompt change that buys follow-ups by degrading answers is a regression, not
a feature.

**Budget.** Iteration happens on spawned subagents (subscription-billed), as
established. Real-API promotion runs are capped at **$10** for this suite
(`EVAL_MAX_USD`), on top of nothing else — the answer baseline re-check rides
in the same runs. Live cost per doctor turn rises by the tail's few hundred
output tokens; the ledgers absorb that unchanged.

## 4. What changes where

| File | Change |
|---|---|
| `apps/chat/src/App.tsx` | Becomes the three-zone shell: layout state (drawer, focused answer), fixture replay, follow-up chips; `send()`'s event loop moves to a shared `applyEvent` used by both live and replay paths |
| `apps/chat/src/Transcript.tsx` | Turns group into per-question blocks (heading, steps, answer, chart, follow-ups); `[n]` chips become buttons that focus the rail |
| `apps/chat/src/Sources.tsx` | Unchanged internals, re-homed: renders into the rail (desktop) or the disclosure (mobile); RowCrop stays as is |
| `apps/chat/src/Sidebar.tsx` (new) | History rail / drawer |
| `apps/chat/src/fixtures/` (new) | Canned transcripts + capture script note |
| `apps/chat/src/app.css` | Rewritten for the grid; ui-kit tokens only, both palettes — the theme test's rule stands |
| `packages/agent/core` | `profiles.ts`: the follow-up closing section; `loop.ts`: sentinel-tail withholding + parse; `events.ts`: the `followups` event |
| `packages/api-client` | The `followups` event type passes through `askAgent` |
| `tests/evals/cases/` | The `followups_*` suite; run.eval.ts grader additions |
| `tests/e2e/` | Chat states join the audit sweep (the plan's standing „Open" item) — five widths, both palettes, over fixture replays |

Not touched: workers/* routes, gate, datasource, tools, the answer-side prompt
sections. If either track discovers it wants more than this table, that is a
finding for the log, not an edit.

## 5. The build — two tracks, then Ondřej

One orchestrator session; builders, the evaluator and the follow-up agent are
spawned agents on the subscription. The 50%-usage stop rule stands.

**Track B — follow-ups (one agent, runs alongside Rounds 1–3).**
Implements §3: prompt section, loop tail-parse, event, unit tests against the
fake-stream harness, then the eval loop — iterate on spawned subagents, promote
via real-API `npm run eval` under the $10 cap with the answer baseline riding
along. Lands as its own commits; merges in Round 4 only if promoted.

**Round 0 — the harness (orchestrator, no fan-out).**
Commit the `followups` event shape first — both tracks build against it.
Capture the fixtures (§2) from the live worker (~$0.30 once, cached forever in
git), hand-authoring the `followups` events for now. Write the screenshot
script: for a given dev-server port, drive the scripted states — empty,
mid-stream (replayer paused), full answer with sources and follow-up chips,
Novák ambiguity, chart turn, drawer open — at 390px and 1440px, both palettes.
Write the rubric the evaluator scores against: hierarchy, likeness to the
reference pattern, row-crop legibility at rail width, Czech copy fit (no
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

**Round 3 — the winner branches, and Ondřej decides.**
Two refiner agents fork the winning worktree: one applies the critique
(including the grafts), one does the mobile/a11y/palette pass against the audit
states. Orchestrator re-screenshots both; the evaluator scores them — but does
not pick. **The candidates go to Ondřej**: the refined pair plus the Round-2
winner as reference, side-by-side screenshots per state, with the evaluator's
score table attached. He assesses; Round 4 builds on his pick and whatever he
asks changed. If he asks for another generation instead, that is the loop
branching again — his call, not a cut line.

**Round 4 — merge and prove.**
Merge Ondřej's pick and Track B into `chat-demo`. `npm run typecheck`,
`npm test`, check-bundle, the extended audit sweep, re-capture fixtures with
real follow-ups, then one live browser walkthrough against the deployed worker
(the five-defect lesson: the walkthrough catches what unit tests cannot) —
including one real turn to confirm live and replay paths render identically,
chips included. Deploy. Update the build log here and in
docs/plans/chat-demo.md.

**Cut lines.** If parallel worktrees misbehave: fall back to sequential
variants, same rubric. If fixture capture from live is blocked (Turnstile):
hand-author one fixture from the routes test's fake stream and capture the rest
after the human click. If Track B cannot promote inside $10: ship the UI with
the chips hidden (the event simply never arrives) and hold the prompt change —
the two tracks are separable by design.

## Build log

- [ ] Round 0 — event shape, fixtures, screenshot script, rubric committed
- [ ] Track B — follow-ups implemented; eval promoted under the $10 cap
- [ ] Round 1 — variants A/B/C built and screenshotted
- [ ] Round 2 — critique committed, winner chosen
- [ ] Round 3 — refined candidates screenshotted and handed to Ondřej
- [ ] Ondřej's pick recorded here
- [ ] Round 4 — merged, audited, walked through live, deployed
