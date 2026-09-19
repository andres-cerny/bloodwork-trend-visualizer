# Moje krev for many people — the goals

Branch `claude/multi-user-hardening`, 2026-09-19. Ondřej wants Moje krev
to work for people from laboratories the app has never seen, with the
name mapping done by a model rather than a lookup, an information "i" on
every analyte, and the whole UI proven — registration included — before
it is opened to more people. This file is the contract between the
orchestrating session and the agents doing the work: each goal has a
condition that says when it is done, and nothing is "done" without it.

Money: **15 USD** for end-to-end runs through the real extractor. The
ledger at the bottom is kept by whoever spends.

## Goal 1 — a name from any Czech lab lands in the catalog, or is left alone

**Done when** the mapping bench runs over the BioLAB fixture *and* the
four synthetic labs of Goal 2 and reports **0 wrong**, with the model's
`unknown`/`low` answers counted separately as "left for the person".

- Mapping runs **on its own** after every upload, and once on load for
  names never asked. No click. The click button stays as "ask again".
  ([apps/portal/src/ui/MappingTab.tsx](../../apps/portal/src/ui/MappingTab.tsx),
  [Portal.tsx](../../apps/portal/src/ui/Portal.tsx))
- Applied without a click only when the model says `catalog`, is
  `high`-confident, and `canApplyUnasked` holds (unit known to agree,
  nothing else disagreeing). Everything else — `medium`, `low`, `new`,
  `unknown` — stays in the mapping tab with the model's reason, for the
  person. **When unsure, do not map**: the prompt says so and the eval
  tests that it obeys.
- Each name is asked once per account; the answer (decision, id,
  confidence, reason, model, date) is stored in `users.settings.aiAsked`
  so a reload does not spend again. "Ask again" clears it for the
  pending names.
- The model is Haiku 4.5 through `/api/map` (unchanged: 30 names per
  call, names/units/intervals only, priced on the person's ledger).
- Evaluation is a subagent handed `mapPrompt()` verbatim plus one
  confirming run through the API. The near-miss traps in Goal 2 are the
  point: free vs total T4, conjugated vs total bilirubin, serum vs urine,
  mg/dl vs mmol/l.
- *Product code done 2026-09-19*: the run is
  [apps/portal/src/lib/aiMapping.ts](../../apps/portal/src/lib/aiMapping.ts)
  (who is asked, what is filed, what is stored; never rejects), Portal
  owns it, the tab renders the record. Tests: `aiMapping.test.ts`,
  `mappingTabAi.test.ts`, the prompt sentences in
  `packages/extraction/tests/map.test.ts`.
- *Eval done 2026-09-19* — `tests/bench/map_eval.ts` and its three steps
  (`bench:map:dump` → answers → `bench:map:score`, plus `bench:map:api`):
  the names the catalog leaves null on all five fixtures (84 per pass),
  the exact `SYSTEM_MAP` + `mapPrompt()`, the exact portal `judge()`.

  | arm | names | applied wrong | applied right | shown right | shown wrong | left alone | parked/new right | traps taken |
  |---|---|---|---|---|---|---|---|---|
  | Haiku 4.5, API ($0.10) | 84 | **0** | 60 | 9 | 0 | 7 | 8 | 0 |
  | Haiku subagent × 2 | 168 | **0** | 119 | 9 | 0 | 17 | 23 | 0 |
  | Sonnet subagent | 84 | **0** | 59 | 3 | 0 | 12 | 10 | 0 |

  "Shown right" is the mg/dl, g/dl, U/l and pg/ml rows: the model said
  `medium`/`low` or named the right id and the unit gate refused it — both
  the intended answer. "Left alone" is `unknown` on tests the catalog lacks
  (Q10, iodine, riboflavin) and on BMI — conservative, the person decides.
  The scorer was proven to fail: a planted `K (Potassium)` → `glukoza` at
  `high` (same unit, overlapping interval) is the one fault the evidence
  gate cannot catch, and it throws; four planted traps with a disagreeing
  interval were all caught by the gate and counted as "shown wrong".

## Goal 2 — four synthetic labs the catalog has never seen

**Done when** four PDF fixtures with hand-authored truth exist under
`packages/lab-core/tests/fixtures/labs/<lab>/` (synthetic, committable,
byte-identical on regeneration) and `npm run bench:mapping` accepts a
fixture directory holding a PDF as well as one holding payloads.

Each lab differs in vocabulary and layout from the five known (AGILAB,
SPADIA, CASRI, PREVEDIG, BioLAB): a Slovak sheet, a hospital LIS with
abbreviation-only names and English echoes, a lab printing `mg/dl` and
`g/dl`, a lab with a "Materiál" column and no prefixes. Every lab has
rows in all four classes — catalog analytes under unseen spellings,
analytes the catalog lacks, urine and non-measurements, and near-miss
traps. `truth.json` names each printed name's `canonicalId`, `NEW:<id>`,
`NOT_BLOOD` or `IGNORE`, and each trap's *wrong* answer, so "wrong" is
scored, not just "unmatched".

## Goal 3 — a catalog wide enough for the Czech Republic, with an "i" on every analyte

**Done when** the catalog holds every analyte a Czech blood panel commonly
reports (target ≥ 250 entries, each with printed-name synonyms, canonical
unit, and a typical adult interval where one exists), every entry carries
`about`, and the "i" opens next to every analyte in Trendy and Souhrn.

- `AnalyteDef.about?: { what: string; usedFor: string }` — Czech, each
  one or two sentences: **what** the analyte is and measures, and **what
  it is usually used for** (which organ or system it reflects). Never a
  verdict on the person's numbers, never a disclaimer saying so, never a
  diagnosis. Written by one agent, reviewed by another against those
  rules, merged by `seed_registry.py` from a committed JSON so the
  registry stays the one source of truth.
- The "i" is a small round button after the analyte name in Trendy and
  Souhrn; tap opens a popover (or a sheet under 480 px) with the two
  paragraphs and closes on outside tap, Escape, and the button again.
  Keyboard reachable, `aria-expanded`, tokens only, Czech copy rules
  ([apps/CLAUDE.md](../../apps/CLAUDE.md)). An analyte without `about`
  (one a person founded) shows no "i".
- Sources for the catalog: labtestsonline.cz, the public price lists and
  sample reports of Czech laboratories, and the model's own knowledge.
  Ids are lowercase ASCII snake case; units use `µ` (U+00B5).

## Goal 4 — two strangers can register, upload, and never see each other

**Done when** a written test log shows, on a local stack with the real
extractor (`workers/portal-extract` run beside `workers/portal` under one
`wrangler dev`, keys from `.dev.vars`): two invite codes minted, two
accounts registered, each uploading a synthetic report, each seeing only
its own data through every tab and every API route (including
`/api/pages/*`, `/api/map`, `/api/share`, export and delete), the
password reset link, the ten-failures lockout, and the budget freeze.

Every button on every screen is pressed; every screen is swept at 360,
414, 768, 1024 and 1440 px in both palettes. What breaks is fixed when
it is a class of defect (and guarded), listed when it is cosmetic. The
list lives in [multi-user-findings.md](multi-user-findings.md) — written
2026-09-19: every proof above holds; five classes fixed and guarded (money
with a decimal point in Czech copy, a report row outgrowing its list on a
phone, Souhrn saying nothing about out-of-range values while an account
has a single draw, a session outliving logout and a password reset, the
settings cap a few hundred unmapped names could pass).

## Goal 5 — the gate

`npm run test:all`, `bench:mapping` over all fixtures, `portal-auditor`
over the mapping, trends and summary tabs, `invariant-reviewer` over the
whole diff. Then Ondřej reviews the branch. Deploy is his call.

## Ledger (USD)

| who | what | pages / calls | spent |
|---|---|---|---|
| Goal 4 agent | A uploads `identity.pdf` (text path, Sonnet + Haiku) | 1 page | 0.0244 |
| Goal 4 agent | B uploads `slovak_grouped.pdf` (text path) | 1 page | 0.0250 |
| Goal 4 agent | B's „Nechat AI navrhnout přiřazení" (Haiku, 1 name) | 1 call | 0.0048 |
| orchestrator | `bench:map:api` — Haiku over 6 batches, 84 names | 6 calls | 0.1045 |
| | **total** | | **0.1587** |
