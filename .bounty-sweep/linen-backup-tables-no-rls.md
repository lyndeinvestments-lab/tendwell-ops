# Finding: RLS disabled on new `properties_linen_*_backup_20260916` tables

Two migrations landed 2026-09-16 and each create a snapshot table via
`CREATE TABLE IF NOT EXISTS ... AS SELECT ... FROM public.properties`:

- `supabase/migrations/20260916_linen_recurring_cost_basis.sql:178-184`
  (`properties_linen_recalc_backup_20260916`)
- `supabase/migrations/20260916_linen_unsized_beds_assume_king.sql:169-176`
  (`properties_linen_king_backup_20260916`)

Neither migration runs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` or any
`GRANT`/`REVOKE` for the new table — every other new-table migration in this
repo does this immediately (see `organizations`, `api_keys`,
`mcp_oauth_*`, `website_leads`, etc.). A `CREATE TABLE ... AS SELECT` does
not inherit RLS from the source table, so these two tables are created with
`relrowsecurity = false`.

Since PostgREST auto-exposes every table in the `public` schema, and this
project's default privileges hand `SELECT` to `anon`/`authenticated` on
newly created tables (the reason literally every other table in this repo
explicitly enables RLS, in several cases "enabled with deliberately no
policy" specifically to default-deny), these two tables are fully
readable by anyone holding the public `VITE_SUPABASE_ANON_KEY` — no login
required — via a plain `GET /rest/v1/properties_linen_recalc_backup_20260916`.

Both tables carry `name` (property identity) plus financial columns:
`linen_program_cost`, `total_estimated_cost`, `estimated_profit`,
`profit_percentage`, `monthly_cost_estimate`, `monthly_profit_estimate`.
