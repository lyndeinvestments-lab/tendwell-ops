-- Security hardening from the bounty-hunter pass:
-- 1. Move the 30-day purge into a SECURITY DEFINER RPC so deletes run as
--    parameterized SQL instead of PostgREST `in.(...)` filters (finding #4).
-- 2. Add SET search_path to current_user_role() so a hostile schema can't
--    shadow app_users (finding #6).

-- ── 1. purge_deleted_properties() ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_deleted_properties(retention_days integer DEFAULT 30)
RETURNS TABLE (purged_id bigint, purged_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(days => retention_days);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the service role may purge properties';
  END IF;

  RETURN QUERY
  WITH doomed AS (
    SELECT id, name FROM properties
    WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff
  ),
  del_tasks AS (
    DELETE FROM tasks
    WHERE property_id IN (SELECT id FROM doomed)
       OR (property_id IS NULL AND property_name IN (SELECT name FROM doomed))
    RETURNING 1
  ),
  del_props AS (
    DELETE FROM properties WHERE id IN (SELECT id FROM doomed)
    RETURNING id, name
  )
  SELECT id AS purged_id, name AS purged_name FROM del_props;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_deleted_properties(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_deleted_properties(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_deleted_properties(integer) TO service_role;

-- ── 2. Harden current_user_role() search_path ────────────────────────────────
-- Body preserved verbatim from the existing function (see
-- pg_get_functiondef output at migration time). Only the SET search_path
-- line is new — closes the schema-shadowing vector that the Supabase
-- security linter flags and that the bounty-hunter pass confirmed.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT role FROM public.app_users
  WHERE google_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  LIMIT 1
$$;
