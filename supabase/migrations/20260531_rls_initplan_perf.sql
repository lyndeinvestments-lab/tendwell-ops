-- Fix auth_rls_initplan advisors: RLS policies that call auth.<fn>() get
-- re-evaluated once per row in a query. Wrapping in (select auth.<fn>())
-- causes Postgres to evaluate the call once and reuse the result, which
-- is dramatically faster on queries that return many rows.
--
-- Semantics are identical — this is the pattern Supabase documents at
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- Tables affected: notification_preferences, proforma_months, intel_feed_items.

-- notification_preferences: gate writes to "rows whose user_id matches the
-- caller's google_email in app_users".
DROP POLICY IF EXISTS "notif_prefs_self_write" ON public.notification_preferences;
CREATE POLICY "notif_prefs_self_write"
  ON public.notification_preferences
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (
    user_id IN (
      SELECT app_users.id
      FROM app_users
      WHERE app_users.google_email = ((select auth.jwt()) ->> 'email'::text)
    )
  )
  WITH CHECK (
    user_id IN (
      SELECT app_users.id
      FROM app_users
      WHERE app_users.google_email = ((select auth.jwt()) ->> 'email'::text)
    )
  );

-- proforma_months: read = any logged-in user; write = any logged-in user.
DROP POLICY IF EXISTS "proforma_months_read" ON public.proforma_months;
CREATE POLICY "proforma_months_read"
  ON public.proforma_months
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "proforma_months_write" ON public.proforma_months;
CREATE POLICY "proforma_months_write"
  ON public.proforma_months
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((select auth.uid()) IS NOT NULL)
  WITH CHECK ((select auth.uid()) IS NOT NULL);

-- intel_feed_items: service-role-only writes (used by the ingestion cron).
DROP POLICY IF EXISTS "allow_service_write" ON public.intel_feed_items;
CREATE POLICY "allow_service_write"
  ON public.intel_feed_items
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((select auth.role()) = 'service_role'::text);
