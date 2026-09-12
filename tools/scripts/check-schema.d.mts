/** Hand-written types for the schema check, so the worker's tests can call it. */
/** table name → column names, as `schema.sql` declares them. */
export function tablesFromSchema(sql: string): Map<string, string[]>;
/** What `schema.sql` declares and the live database does not have. */
export function schemaDrift(
  declared: Map<string, string[]>,
  live: Map<string, string[]>,
): { missingTables: string[]; missingColumns: string[] };
