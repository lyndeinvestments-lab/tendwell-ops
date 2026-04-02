-- ═══════════════════════════════════════════════════════════════════════════════
-- Security hardening: Enable RLS on ALL tables, restrict to authenticated users
-- ═══════════════════════════════════════════════════════════════════════════════
-- Previously, most tables had no RLS and the few that did used USING(true) for
-- the anon role. Now that Google OAuth is in place, we lock everything down to
-- require a valid Supabase Auth session (authenticated role only).
--
-- The anon key is embedded in the client bundle and visible to anyone. Without
-- restrictive RLS, anyone with the anon key could read/write all data.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Helper: get current user's role from app_users ─────────────────────────
-- Used by policies that need role-based restrictions.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.app_users
  WHERE google_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  LIMIT 1
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. app_users — CRITICAL: protect against self-escalation
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all user records (needed for settings page, activity labels)
CREATE POLICY "app_users_select_authenticated"
  ON app_users FOR SELECT TO authenticated
  USING (true);

-- Only admins can insert new users
CREATE POLICY "app_users_insert_admin"
  ON app_users FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

-- Only admins can update users (prevents self-escalation)
CREATE POLICY "app_users_update_admin"
  ON app_users FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Only admins can delete users
CREATE POLICY "app_users_delete_admin"
  ON app_users FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. app_settings — only admins can write, all authenticated can read
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_select_authenticated"
  ON app_settings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "app_settings_insert_admin"
  ON app_settings FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "app_settings_update_admin"
  ON app_settings FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "app_settings_delete_admin"
  ON app_settings FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. properties — all authenticated users can read; only authenticated can write
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "properties_select_authenticated"
  ON properties FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "properties_modify_authenticated"
  ON properties FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. pipeline_stages — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_stages_authenticated"
  ON pipeline_stages FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. stage_transitions — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE stage_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stage_transitions_authenticated"
  ON stage_transitions FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. contacts — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_authenticated"
  ON contacts FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. contact_notes — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_notes_authenticated"
  ON contact_notes FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. cleaners — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE cleaners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cleaners_authenticated"
  ON cleaners FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. clean_assignments — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE clean_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clean_assignments_authenticated"
  ON clean_assignments FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. inspections — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inspections') THEN
    ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "inspections_authenticated"
      ON inspections FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. inspection_photos — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE inspection_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inspection_photos_authenticated"
  ON inspection_photos FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 12. property_photos — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE property_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "property_photos_authenticated"
  ON property_photos FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 13. property_supplies — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE property_supplies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "property_supplies_authenticated"
  ON property_supplies FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 14. onboarding_tasks — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'onboarding_tasks') THEN
    ALTER TABLE onboarding_tasks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "onboarding_tasks_authenticated"
      ON onboarding_tasks FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 15. onboarding_task_templates — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'onboarding_task_templates') THEN
    ALTER TABLE onboarding_task_templates ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "onboarding_task_templates_authenticated"
      ON onboarding_task_templates FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 16. linen_inventory — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'linen_inventory') THEN
    ALTER TABLE linen_inventory ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "linen_inventory_authenticated"
      ON linen_inventory FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 17. access_codes — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'access_codes') THEN
    ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "access_codes_authenticated"
      ON access_codes FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 18. ac_filters — authenticated read/write
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ac_filters') THEN
    ALTER TABLE ac_filters ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "ac_filters_authenticated"
      ON ac_filters FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 19-22. Fix existing "allow all" policies — remove anon access
-- ═══════════════════════════════════════════════════════════════════════════════

-- activity_log: drop the open policy, replace with authenticated-only
DROP POLICY IF EXISTS "allow_all_activity_log" ON activity_log;
CREATE POLICY "activity_log_authenticated"
  ON activity_log FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- property_edit_log: same treatment
DROP POLICY IF EXISTS "allow_all_property_edit_log" ON property_edit_log;
CREATE POLICY "property_edit_log_authenticated"
  ON property_edit_log FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- cleaning_history: same treatment
DROP POLICY IF EXISTS "allow_all_cleaning_history" ON cleaning_history;
CREATE POLICY "cleaning_history_authenticated"
  ON cleaning_history FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- csv_import_log: same treatment
DROP POLICY IF EXISTS "allow_all_csv_import_log" ON csv_import_log;
CREATE POLICY "csv_import_log_authenticated"
  ON csv_import_log FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 23. Clear all legacy password hashes — no longer needed with Google OAuth
-- ═══════════════════════════════════════════════════════════════════════════════
UPDATE app_users SET password_hash = NULL WHERE password_hash IS NOT NULL;
