-- Drop 5 legacy admin policies on app_settings / app_users that duplicate
-- the post-hardening per-action policies. is_current_user_admin() and
-- (current_user_role() = 'admin') are functionally identical — both query
-- app_users.role for the current auth.uid()'s email — so dropping the
-- legacy ALL/SELECT policies leaves the per-action named policies as the
-- single permissive policy for each (action × role).
--
-- Clears 7 multiple_permissive_policies advisor warnings:
--   - app_settings SELECT × authenticated  (3 → 1)
--   - app_settings INSERT × authenticated  (2 → 1)
--   - app_settings UPDATE × authenticated  (2 → 1)
--   - app_settings DELETE × authenticated  (2 → 1)
--   - app_users   INSERT × authenticated   (2 → 1)
--   - app_users   UPDATE × authenticated   (2 → 1)
--   - app_users   DELETE × authenticated   (2 → 1)

DROP POLICY IF EXISTS "Allow admin write on app_settings"        ON public.app_settings;
DROP POLICY IF EXISTS "Allow authenticated read on app_settings" ON public.app_settings;

DROP POLICY IF EXISTS "Allow admin delete on app_users" ON public.app_users;
DROP POLICY IF EXISTS "Allow admin insert on app_users" ON public.app_users;
DROP POLICY IF EXISTS "Allow admin update on app_users" ON public.app_users;
