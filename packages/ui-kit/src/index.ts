/**
 * Interface parts both apps share.
 *
 * Chart is here because the clinical agent proposes charts and the bloodwork
 * app draws them, and "the model may name a chart, never fill one"
 * (docs/constraints.md) has to be enforced in one place or it is enforced in
 * neither.
 *
 * useTurnstile is here for a duller reason that would have bitten just as hard:
 * the widget used to be mounted inside UploadPanel, and its success callback
 * was the only thing that unlocked chat. An app with no upload panel could
 * never have unlocked anything.
 */
export { default as ThemeSwitch } from "./ThemeSwitch";
export { default as Chart, niceTicks } from "./Chart";
export { default as TrendChart, Sparkline, trendDomain } from "./TrendChart";
export * from "./useTurnstile";
