-- Owners sign in as `authenticated`, but many staff tables have always-true
-- `authenticated` RLS policies (USING true / WITH CHECK true), so an owner's
-- token could read AND write staff data directly via the REST API, bypassing
-- the portal. Gate every such policy on public.is_staff() so only staff retain
-- access. Staff (is_staff()=true) are unaffected; owners go through SECURITY
-- DEFINER RPCs + their own scoped tables; anon/public policies are untouched.
-- Excludes intel_feed_items (separate app, role=public, intentionally public).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND 'authenticated' = ANY(roles)
      AND COALESCE(qual, 'true') = 'true'
      AND COALESCE(with_check, 'true') = 'true'
      AND (qual = 'true' OR with_check = 'true')
  LOOP
    IF r.qual IS NOT NULL AND r.with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (public.is_staff()) WITH CHECK (public.is_staff())', r.policyname, r.tablename);
    ELSIF r.with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (public.is_staff())', r.policyname, r.tablename);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I USING (public.is_staff())', r.policyname, r.tablename);
    END IF;
    RAISE NOTICE 'scoped: %.%', r.tablename, r.policyname;
  END LOOP;
END $$;
