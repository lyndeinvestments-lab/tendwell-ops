-- WS3: hide cleaners.pay_rate from every browser login (column privileges).
--
-- RLS cannot hide one column, so the `authenticated` role gets column-level
-- SELECT on every column EXCEPT pay_rate (crews: inspector / supervisor hold
-- the Cleaners view and could read all 15 pay rates straight from the API).
-- Finance staff read pay via cleaner_pay_rates() and write it via
-- cleaner_set_pay_rate() (20261014e). status / trellis_user_id / source /
-- offboarded_* are not writable by the browser either: they change only via
-- cleaner_set_status / cleaner_link_trellis / cleaner_create_from_roster.
-- Realtime (realtime.apply_rls) honours column privileges, so change events
-- stop carrying pay_rate too.
--
-- ORDER: apply AFTER the client that selects explicit cleaner columns is
-- deployed (any `select('*')` on cleaners now fails with permission denied).
--
-- TRAP FOR FUTURE MIGRATIONS: a column added to `cleaners` is NOT readable by
-- the app until it is added to the GRANT SELECT list below. That is deliberate
-- (an allowlist, like property_ops): never `grant select on public.cleaners to
-- authenticated` again, it would re-expose pay_rate.

revoke all on public.cleaners from anon;
revoke select, insert, update on public.cleaners from authenticated;

grant select (
  id, full_name, phone, email, alt_email, notes, created_at, is_active, app_role,
  invite_sent_at, trellis_user_id, status, offboarded_at, offboarded_by, source
) on public.cleaners to authenticated;

grant insert (full_name, phone, email, alt_email, notes, app_role)
  on public.cleaners to authenticated;

grant update (full_name, phone, email, alt_email, notes, app_role, invite_sent_at)
  on public.cleaners to authenticated;
-- DELETE stays as it was (RLS is_staff(); the UI keeps it admin-only behind a confirm).
