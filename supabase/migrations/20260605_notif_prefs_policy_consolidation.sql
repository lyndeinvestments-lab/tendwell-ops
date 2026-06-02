-- Collapse the 3 overlapping policies on notification_preferences into one
-- per action. The old shape (from 20260413_notifications.sql, with
-- self_write last rewritten for the initplan fix in 20260531_rls_initplan_perf.sql):
--   - notif_prefs_admin_write  FOR ALL    USING/WITH CHECK is_admin
--   - notif_prefs_read_auth    FOR SELECT USING true
--   - notif_prefs_self_write   FOR ALL    USING/WITH CHECK user_id = me
-- caused 4 multiple_permissive_policies advisor warnings (one per
-- SELECT/INSERT/UPDATE/DELETE for the authenticated role): every relevant
-- query had to evaluate 2–3 policies per row.
--
-- The new shape preserves the exact same effective access:
--   - SELECT: any authenticated user (the old `read_auth USING true` rule)
--   - INSERT/UPDATE/DELETE: admin OR self
-- but each (role, action) pair now has exactly one permissive policy,
-- dropping the 4 advisor WARNs to zero.
--
-- Net UI / app behavior change: zero. Net policy evaluation per query:
-- 3 → 1 on SELECT, 2 → 1 on INSERT/UPDATE/DELETE.

DROP POLICY IF EXISTS notif_prefs_admin_write ON public.notification_preferences;
DROP POLICY IF EXISTS notif_prefs_read_auth   ON public.notification_preferences;
DROP POLICY IF EXISTS notif_prefs_self_write  ON public.notification_preferences;

-- SELECT: preserved as "any authenticated user", same as the old read_auth rule.
CREATE POLICY notif_prefs_select_authenticated
  ON public.notification_preferences
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: admin OR self. Uses (select auth.jwt()) initplan form so the
-- subquery executes once per query, not once per row.
CREATE POLICY notif_prefs_insert_admin_or_self
  ON public.notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    current_user_role() = 'admin'::text
    OR user_id IN (
      SELECT app_users.id
      FROM app_users
      WHERE app_users.google_email = ((SELECT auth.jwt()) ->> 'email'::text)
    )
  );

-- UPDATE: admin OR self, on both the existing row (USING) and the new row
-- shape (WITH CHECK) to prevent self-writers from reassigning user_id.
CREATE POLICY notif_prefs_update_admin_or_self
  ON public.notification_preferences
  FOR UPDATE
  TO authenticated
  USING (
    current_user_role() = 'admin'::text
    OR user_id IN (
      SELECT app_users.id
      FROM app_users
      WHERE app_users.google_email = ((SELECT auth.jwt()) ->> 'email'::text)
    )
  )
  WITH CHECK (
    current_user_role() = 'admin'::text
    OR user_id IN (
      SELECT app_users.id
      FROM app_users
      WHERE app_users.google_email = ((SELECT auth.jwt()) ->> 'email'::text)
    )
  );

-- DELETE: admin OR self.
CREATE POLICY notif_prefs_delete_admin_or_self
  ON public.notification_preferences
  FOR DELETE
  TO authenticated
  USING (
    current_user_role() = 'admin'::text
    OR user_id IN (
      SELECT app_users.id
      FROM app_users
      WHERE app_users.google_email = ((SELECT auth.jwt()) ->> 'email'::text)
    )
  );
