-- Drop redundant "Allow all..." legacy RLS policies that duplicate the
-- "<table>_authenticated" policies introduced in the security hardening
-- migration (20260401_security_rls.sql).
--
-- On each of these 11 tables, two PERMISSIVE policies coexist with
-- byte-identical predicates (cmd=ALL, role=authenticated, qual=true,
-- with_check=true). Postgres still has to evaluate both for every row of
-- every query — pure CPU waste, flagged by the Supabase
-- `multiple_permissive_policies` advisor.
--
-- Dropping the legacy "Allow all..." policy is provably a no-op for access
-- semantics (the other policy grants exactly the same access). Verified
-- via pg_policies before this migration.
--
-- Not touched here (different predicates, need per-table audit):
--   notification_preferences, app_settings, app_users, intel_feed_items.

DROP POLICY IF EXISTS "Allow all for authenticated" ON public.clean_assignments;
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.cleaners;
DROP POLICY IF EXISTS "Allow all access to cleaning_history" ON public.cleaning_history;
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.contact_notes;
DROP POLICY IF EXISTS "Allow all access to contacts" ON public.contacts;
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.inspection_photos;
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.inspections;
DROP POLICY IF EXISTS "Allow all access to onboarding_task_templates" ON public.onboarding_task_templates;
DROP POLICY IF EXISTS "Allow all access to onboarding_tasks" ON public.onboarding_tasks;
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.property_photos;
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.property_supplies;
