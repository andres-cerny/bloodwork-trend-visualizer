# apps — both UIs

**Apps render; they do not reason.** `apps/chat` must import neither
`@bw/lab-core` nor `@bw/agent-tools`: every number it shows arrived through the
agent from the deterministic layer, which is what will let the data source move
to a doctor's database without the client changing. `check-bundle.mjs` fails a
chat bundle containing domain code.

## Czech is a constraint, not a translation

- On screen it is a **parametr**, never an "analyt" — the code says analyte, the
  interface never does.
- Nominative, no verbs, in labels and table headers.
- Both apps' copy is Czech, including errors.

## Colour and theme

Tokens come from `@bw/ui-kit/styles.css`, imported before the app's own sheet.
**Anything here may use a token; nothing here may define one.**

- **Signal colours draw, ink colours are for type.** A colour that means
  something is reserved for meaning it.
- The palette is validated and green-free — see design-notes, this was measured
  against colour vision, not chosen by taste.
- Every rule needs both palettes. `packages/ui-kit/tests/theme.test.ts` pins
  that the media-query dark block and the `[data-theme="dark"]` block stay
  identical: a token added to one and forgotten in the other yields a nearly
  dark page, and only for readers whose system theme is light.

## Layout

Tabs mount all panels and hide the inactive ones with the `hidden` attribute,
so a panel keeps its state — and stays out of the accessibility tree and tab
order. A `display: none` class would need all three re-implemented.

The layout auditor is the gate for any change here: `npm run test:audit` sweeps
every screen at five widths in both palettes.
`AUDIT_COLLECT=out.json` collects instead of failing, for a before/after diff.

Why the bloodwork UI looks as it does, and what a clinician could not use:
[bloodwork/docs/design-notes.md](bloodwork/docs/design-notes.md).
