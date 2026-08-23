# UI tournament — spec addenda

docs/plans/chat-ui.md §1–§4 is the design. This file pins the mechanics every
variant must share, so one screenshot script and one evaluator can judge all of
them. A variant that ignores a MUST here loses on disqualification, not taste.

## Fixture replay

- Fixtures live in `apps/chat/src/fixtures/<tenant>/<slug>.json`:
  `{ title, tenant, turns: [{ user, events: AgentEvent[] }] }`. Bundle them
  (eager glob import is fine — 52 KB total); the sidebar lists each tenant's
  fixtures by `title` under „Nedávné".
- Clicking a history replays it **instantly and without any API call or
  session**, through the **same event-applying code path** live turns use —
  one `applyEvent` for both. The composer stays live afterwards: continuing a
  replayed conversation sends its turns as history, and its pinned patient ref
  (from the fixture's `patient` event) rides along.
- URL affordance (MUST, the screenshot script depends on it):
  `/{tenant}?fx=<slug>` renders the replay on load; `&step=<n>` applies only
  the first *n* events of the **last** turn (earlier turns in full) — the
  mid-stream state. Unknown slug → normal empty state. „Nové vlákno" clears
  `fx` and the thread.

## The gate moves into the composer

The transcript, sidebar and replays are static content and render without a
session. The Turnstile widget lives where the composer is; until `gate.ready`
the input is the verification surface, after it the input. Clicking a
suggestion or follow-up chip before `ready` fills the composer instead of
sending. Budget-frozen and gate-unavailable states disable sending, never the
reading of canned content.

## Follow-ups

A `followups` event renders as chips („Související") under that turn's answer,
after the sources of desktop-inline elements and before the next question.
Clicking sends the text as a normal user turn (or fills the composer pre-gate).
No event → render nothing. Never invent chips client-side.

## Test ids (MUST — the script and evaluator are variant-blind)

| data-testid | on |
|---|---|
| `sidebar` | the history rail / drawer |
| `sidebar-toggle` | the control that opens the drawer on mobile |
| `thread` | the scrolling conversation column |
| `composer-input` | the text input |
| `sources-panel` | the evidence rail (desktop) / the open disclosure (mobile) |
| `sources-toggle` | mobile: the „Zdroje (n)" disclosure control for a turn |
| `followups` | the chip row of one turn |
| `patient-chip` | the pinned-patient chip |
| `cite-1` | the first `[1]` marker button in an answer |

## Unchanged truths

Czech per apps/CLAUDE.md (parametr, never analyt; nominative labels). Colours
only via ui-kit tokens, every rule in both palettes (`bloodwork-theme` in
localStorage + `data-theme` on the root). No lab-core, no agent-tools imports —
check-bundle stays green. RowCrop semantics from the current Sources.tsx are
kept: bbox band, full page width, expand to page image. Keep `npm run
typecheck` and `npm -w apps/chat run build` green — that is a builder's
definition of done.
