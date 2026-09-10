# Portal tournament — spec addenda

docs/plans/csm-demo.md Phase 4 is the design. This file pins the mechanics
every variant must share so one camera and one evaluator judge all of them.
A variant that ignores a MUST loses on disqualification, not taste.

## What every variant builds

`apps/csm-portal` — the CSM patient card, mobile-first at 390px, desktop the
adaptation. Fixed scope (no variant adds or drops a feature):

- **Home = last visit**: newest visit's note (or its absence, honestly),
  that day's results with flags, „od minulé návštěvy" deltas, then the
  timeline entry point. Not a dashboard.
- **Timeline**: every visit, newest first, kind badges (krev /
  spiroergometrie / tHb / prohlídka), honest gaps, per-visit deterministic
  summary from the counts the API provides („2 parametry mimo rozmezí" /
  „vše v normě") — never composed from anything but the counts.
- **Visit detail**: labs with value, unit, flag, reference range and delta
  arrow; performance results with deltas; the note text when there is one.
- **Results & trends**: per-row sparklines (word-sized, no axes) drawn from
  the trend endpoint's points; row opens the full chart with reference band
  where bounds exist. Charts may depart from the bloodwork app's style —
  tokens and the green-free palette stay law.
- **Performance section**: VO₂max and tHb mass as headline trends, the rest
  of the inventory's metrics behind them.
- **Note viewer**: body text, „Uvolňeno" line with the visit date, page
  images when present.
- **„Objednat se"**: one button, opening the polite dead-end („Objednávání
  připravujeme."). No other actions anywhere.
- Header: CsmMark + „Moje CSM", ThemeSwitch, the patient's name with a way
  back to the picker. Czech throughout: vykání in section frames, nominative
  clinical labels, no diagnosis-flavoured prose anywhere.

## Data (MUST)

All data through `src/data.ts`'s `CardData` — no component fetches. With
`?fx=1` in the URL the app uses `fixtureData` over the committed fixture and
renders **without a session or gate**; otherwise `liveData` behind the
Turnstile gate. The camera shoots fixture mode only. The fixture holds ghost
patients only — the real record never enters one. Load the fixture via
**dynamic `import()` only when `fx=1`** — it is ~340 KB and a live visitor
must not download it.

## URL affordances (MUST — the camera navigates by these)

- `/?fx=1` — picker
- `/?fx=1&p=<patientId>` — that patient's home
- `/?fx=1&p=<id>&view=timeline` — full timeline
- `/?fx=1&p=<id>&v=<visitId>` — visit detail
- `/?fx=1&p=<id>&t=<kind>:<metricOrCanonicalId>` — full chart
- State changes push URLs so Back works.

## Test ids (MUST)

`picker`, `pick-<patientId>`, `home`, `timeline`, `timeline-toggle`,
`visit-<visitId>`, `visit-detail`, `note`, `chart`, `row-<canonicalId>` (lab
rows), `perf-<metricId>` (performance rows), `book`, `book-dead-end`,
`back-to-picker`.

## Theme & viewport

Palette via `localStorage["bloodwork-theme"]` (the kit's ThemeSwitch key) and
`data-tenant="csm"` stays on `<html>`. Both palettes must hold at 390 and
1440 — the audit later sweeps five widths, so nothing may assume exactly two.

## Builders

Build until `npm run typecheck` and `npm run build:portal` pass. Do not
screenshot; the orchestrator drives the one browser. Do not touch files
outside `apps/csm-portal/src` (data.ts's interface included — extend it only by
adding, never by changing a signature; index.html/manifest stay).
