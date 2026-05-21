-- ═══════════════════════════════════════════════════════════════════════════════
-- Auto-grant app access (role='cleaning') to anyone added to the cleaners roster.
-- ═══════════════════════════════════════════════════════════════════════════════
-- When a cleaner is inserted with an email, automatically create a matching
-- app_users row so they can sign in via Google OAuth with the cleaning role.
-- If a user with that google_email already exists (e.g. supervisor, inspector,
-- admin), we leave them alone — never downgrade an existing account.
--
-- Backfills existing cleaners in the same migration.

CREATE OR REPLACE FUNCTION public.cleaner_grant_app_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_email text;
BEGIN
  normalized_email := lower(trim(NEW.email));
  IF normalized_email IS NULL OR normalized_email = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.app_users (role, label, google_email)
  VALUES ('cleaning', NEW.full_name, normalized_email)
  ON CONFLICT (google_email) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleaners_grant_app_access ON public.cleaners;

CREATE TRIGGER cleaners_grant_app_access
  AFTER INSERT ON public.cleaners
  FOR EACH ROW
  EXECUTE FUNCTION public.cleaner_grant_app_access();

-- Backfill: insert app_users rows for existing cleaners that don't have one yet.
INSERT INTO public.app_users (role, label, google_email)
SELECT 'cleaning', c.full_name, lower(trim(c.email))
FROM public.cleaners c
WHERE c.email IS NOT NULL
  AND trim(c.email) <> ''
ON CONFLICT (google_email) DO NOTHING;
