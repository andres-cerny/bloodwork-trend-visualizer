/** Hand-written types for the help-desk script, so the worker's tests can call it. */
export function listSql(opts?: { unanswered?: boolean; limit?: number }): string;
export function readSql(id: string): string;
export function answeredSql(id: string, at?: string | null): string;
