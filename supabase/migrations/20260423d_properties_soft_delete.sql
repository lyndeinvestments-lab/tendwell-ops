-- 30-day soft-delete for properties.
-- Deleting a property now sets deleted_at; row remains in the DB for recovery
-- until a scheduled purge job (separate PR) removes it after 30 days.

ALTER TABLE properties ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_properties_deleted_at
  ON properties(deleted_at) WHERE deleted_at IS NOT NULL;

-- Replace the blanket SELECT policy: normal reads skip soft-deleted rows so no
-- caller code changes are required for the 60+ existing select queries.
DROP POLICY IF EXISTS "properties_select_authenticated" ON properties;

CREATE POLICY "properties_select_active"
  ON properties FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

-- Admins see and manage deleted rows only through the RPCs below (not via
-- direct SELECT), so master-list / pipeline / dashboard stay clean.

CREATE OR REPLACE FUNCTION public.admin_list_deleted_properties()
RETURNS SETOF properties
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can list deleted properties';
  END IF;
  RETURN QUERY
    SELECT * FROM properties WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_property(p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can restore properties';
  END IF;
  UPDATE properties SET deleted_at = NULL WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_deleted_properties() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_property(bigint) TO authenticated;
