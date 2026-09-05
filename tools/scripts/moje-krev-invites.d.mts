/** Hand-written types for the invite script, so the worker's tests can call it. */
export const DEFAULT_ORIGIN: string;
export const TTL_HOURS: number;
export function mintInvites(opts?: {
  n?: number;
  note?: string;
  email?: string;
  origin?: string;
  now?: Date;
}): { sql: string; links: string[]; codes: string[]; expires: string };
