-- Per-user saved UI preferences (first use: the Inspections "My View" tab's
-- saved filters, key 'inspections.myView').
--
-- app_users writes are admin-only, so self-service reads/writes go through
-- SECURITY DEFINER RPCs scoped to the caller's own row (same pattern as
-- set_my_locale). Values are small JSON blobs keyed by a short dotted name.

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS ui_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.get_my_ui_prefs()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT ui_prefs FROM public.app_users
      WHERE google_email = public.current_auth_email()
      LIMIT 1),
    '{}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION public.set_my_ui_pref(p_key TEXT, p_value JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_.-]{1,64}$' THEN
    RAISE EXCEPTION 'invalid ui pref key';
  END IF;
  IF p_value IS NOT NULL AND length(p_value::text) > 8192 THEN
    RAISE EXCEPTION 'ui pref value too large';
  END IF;

  UPDATE public.app_users
     SET ui_prefs = CASE
       WHEN p_value IS NULL THEN ui_prefs - p_key
       ELSE ui_prefs || jsonb_build_object(p_key, p_value)
     END
   WHERE google_email = public.current_auth_email();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_ui_prefs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_my_ui_pref(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_ui_prefs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_ui_pref(TEXT, JSONB) TO authenticated;
