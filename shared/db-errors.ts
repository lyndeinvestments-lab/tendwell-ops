// PostgREST / Postgres errors that mean "this table or column is not in the
// database yet", i.e. code shipped ahead of its migration. Callers use this to
// fall back to the old behaviour instead of failing outright.
//
//   42P01     undefined_table (Postgres)
//   42703     undefined_column (Postgres)
//   PGRST204  column not found in the schema cache
//   PGRST205  table not found in the schema cache

const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205'])

export function isMissingSchemaError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && MISSING_SCHEMA_CODES.has(code)) return true
  const msg = (err as { message?: unknown }).message
  return typeof msg === 'string' &&
    /(relation|column) "?[\w.]+"? does not exist|could not find the ('[\w.]+' column|table '[\w.]+') .*schema cache/i.test(msg)
}
