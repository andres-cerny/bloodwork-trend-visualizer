/** Hand-written types for the budget script, so the worker's tests can call it. */
export function budgetSql(opts: { email: string; usd: number | null }): { sql: string; says: string };
export function documentsSql(opts: { email: string; n: number | string }): { sql: string; says: string };
export const SHOW_SQL: string;
