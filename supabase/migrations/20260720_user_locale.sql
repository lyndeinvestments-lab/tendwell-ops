-- Per-user language preference for the Spanish rollout.
--
-- preferred_locale is nullable: NULL = "never chosen", in which case the
-- client falls back to localStorage / browser auto-detect. Once a user flips
-- the EN|ES toggle anywhere (app header, /account, owner portal), the client
-- persists it here via set_my_locale() and every later login on any device
-- starts in that language.

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS preferred_locale TEXT
  CHECK (preferred_locale IN ('en', 'es'));

ALTER TABLE public.property_owners
  ADD COLUMN IF NOT EXISTS preferred_locale TEXT
  CHECK (preferred_locale IN ('en', 'es'));

-- app_users writes are admin-only and property_owners writes are admin/RPC
-- scoped, so self-service persistence goes through a SECURITY DEFINER RPC
-- scoped to the caller's own identity (same pattern as
-- owner_update_self_contact). Updates whichever identity the caller has —
-- a staff user who is also an owner keeps both rows in sync.
CREATE OR REPLACE FUNCTION public.set_my_locale(p_locale TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_locale NOT IN ('en', 'es') THEN
    RAISE EXCEPTION 'invalid locale %', p_locale;
  END IF;

  UPDATE public.app_users
     SET preferred_locale = p_locale
   WHERE google_email = public.current_auth_email();

  UPDATE public.property_owners
     SET preferred_locale = p_locale
   WHERE id = public.current_owner_id();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_my_locale(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_locale(TEXT) TO authenticated;
