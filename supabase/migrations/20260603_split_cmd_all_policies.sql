-- Split cmd=ALL write policies into INSERT/UPDATE/DELETE so SELECT no longer
-- has two overlapping permissive policies. Identical predicates kept, so
-- access semantics are unchanged on every action.
--
-- Per-table effect on `multiple_permissive_policies` advisor:
--   - proforma_months: -4 (one per role × SELECT)
--   - breezeway_import_log: -1
--   - breezeway_tasks: -1
--   - monthly_financial_snapshot: -1
--   - properties: -1 (drops dead _select_active policy)
--
-- Total: ~8 of 17 multiple_permissive_policies warnings cleared.

-- ─── proforma_months ────────────────────────────────────────────────────────
-- `_write` was cmd=ALL with the same predicate as `_read`; that's redundant
-- for SELECT. Convert to specific INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS "proforma_months_write" ON public.proforma_months;

CREATE POLICY "proforma_months_insert"
  ON public.proforma_months
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((select auth.uid()) IS NOT NULL);

CREATE POLICY "proforma_months_update"
  ON public.proforma_months
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((select auth.uid()) IS NOT NULL)
  WITH CHECK ((select auth.uid()) IS NOT NULL);

CREATE POLICY "proforma_months_delete"
  ON public.proforma_months
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((select auth.uid()) IS NOT NULL);

-- ─── breezeway_import_log ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "breezeway_import_log_admin_writes" ON public.breezeway_import_log;

CREATE POLICY "breezeway_import_log_admin_insert"
  ON public.breezeway_import_log
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() = 'admin'::text);

CREATE POLICY "breezeway_import_log_admin_update"
  ON public.breezeway_import_log
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (current_user_role() = 'admin'::text)
  WITH CHECK (current_user_role() = 'admin'::text);

CREATE POLICY "breezeway_import_log_admin_delete"
  ON public.breezeway_import_log
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (current_user_role() = 'admin'::text);

-- ─── breezeway_tasks ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "breezeway_tasks_admin_writes" ON public.breezeway_tasks;

CREATE POLICY "breezeway_tasks_admin_insert"
  ON public.breezeway_tasks
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() = 'admin'::text);

CREATE POLICY "breezeway_tasks_admin_update"
  ON public.breezeway_tasks
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (current_user_role() = 'admin'::text)
  WITH CHECK (current_user_role() = 'admin'::text);

CREATE POLICY "breezeway_tasks_admin_delete"
  ON public.breezeway_tasks
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (current_user_role() = 'admin'::text);

-- ─── monthly_financial_snapshot ─────────────────────────────────────────────
DROP POLICY IF EXISTS "monthly_financial_snapshot_admin_writes" ON public.monthly_financial_snapshot;

CREATE POLICY "monthly_financial_snapshot_admin_insert"
  ON public.monthly_financial_snapshot
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() = 'admin'::text);

CREATE POLICY "monthly_financial_snapshot_admin_update"
  ON public.monthly_financial_snapshot
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (current_user_role() = 'admin'::text)
  WITH CHECK (current_user_role() = 'admin'::text);

CREATE POLICY "monthly_financial_snapshot_admin_delete"
  ON public.monthly_financial_snapshot
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (current_user_role() = 'admin'::text);

-- ─── properties ─────────────────────────────────────────────────────────────
-- `_select_active` filters deleted_at IS NULL, but `_modify_authenticated`
-- is cmd=ALL with qual=true — it ALREADY grants SELECT on every row
-- (PERMISSIVE policies are OR'd, so the broader policy wins). The
-- _select_active filter has been a no-op the entire time. The app explicitly
-- filters .is('deleted_at', null) where needed; the Archive view depends on
-- being able to see deleted rows. Dropping the dead policy preserves
-- observed behavior and clears the warning.
DROP POLICY IF EXISTS "properties_select_active" ON public.properties;
