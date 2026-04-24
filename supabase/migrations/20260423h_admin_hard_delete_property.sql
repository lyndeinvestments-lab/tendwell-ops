-- Admin-only immediate hard-delete of a property. Used by the Master List
-- Archive panel to bypass the 30-day retention window when an admin wants
-- to permanently remove a property right now.
--
-- Cascades the same way the nightly purge does: deletes tasks that reference
-- the property via FK or legacy property_name text, then deletes the property
-- itself. Other dependent tables with ON DELETE CASCADE FKs clean up
-- automatically.

CREATE OR REPLACE FUNCTION public.admin_hard_delete_property(p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_name text;
BEGIN
  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can hard-delete properties';
  END IF;

  SELECT name INTO v_name FROM properties WHERE id = p_id;
  IF v_name IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM tasks
    WHERE property_id = p_id
       OR (property_id IS NULL AND property_name = v_name);

  DELETE FROM properties WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_hard_delete_property(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_hard_delete_property(bigint) TO authenticated;
