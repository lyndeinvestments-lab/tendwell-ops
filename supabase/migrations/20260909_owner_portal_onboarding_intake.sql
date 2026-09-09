-- Owner-portal onboarding intake.
--
-- Until now the intake form (`/onboarding`) was reachable only anonymously: the
-- page posts through a separate anon Supabase client, and the only INSERT path
-- was `onboarding_submissions_anon_insert`. A signed-in owner is `authenticated`
-- but not staff, so `onboarding_submissions_auth_all` (USING is_staff()) refused
-- their insert. Owners can now open the same form from their portal with their
-- details pre-filled, so they need an INSERT path of their own — scoped to
-- themselves, and still with NO read access to anyone's submissions.

-- 1. `source`: distinguish a portal submission from an anonymous public one, so
--    the staff queue can show who it came from and trust `owner_id`.
ALTER TABLE public.onboarding_submissions
  DROP CONSTRAINT IF EXISTS onboarding_submissions_source_chk;
ALTER TABLE public.onboarding_submissions
  ADD CONSTRAINT onboarding_submissions_source_chk
  CHECK (source = ANY (ARRAY['token'::text, 'public'::text, 'owner'::text]));

-- Only the token flow requires a token; 'public' and 'owner' never carry one.
ALTER TABLE public.onboarding_submissions
  DROP CONSTRAINT IF EXISTS onboarding_submissions_token_or_public_chk;
ALTER TABLE public.onboarding_submissions
  ADD CONSTRAINT onboarding_submissions_token_or_public_chk
  CHECK ((source = 'token' AND token IS NOT NULL) OR source <> 'token');

-- 2. Attribution. Nullable because the anon/token flows have no owner. ON DELETE
--    SET NULL matches `property_id` — deleting an owner must not delete the
--    intake history staff are working from.
ALTER TABLE public.onboarding_submissions
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.property_owners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS onboarding_submissions_owner_id_idx
  ON public.onboarding_submissions (owner_id);

-- 3. INSERT-only policy for owners.
--
--    Deliberately no USING clause and no SELECT/UPDATE/DELETE: an owner may file
--    a submission and never read one back (submissions hold other clients' door
--    codes, Wi-Fi passwords and booking API secrets). supabase-js `.insert()`
--    without `.select()` needs no read grant, so the client works as written.
--
--    WITH CHECK pins the row to the caller: they cannot forge `source`, cannot
--    attribute the submission to another owner, and cannot attach it to a
--    property that isn't assigned to them. `current_owner_id()` is the same
--    resolver the rest of the portal uses (and resolves the emulated owner for
--    an admin previewing the portal — harmless, since staff already have full
--    access via `onboarding_submissions_auth_all` and the portal disables
--    submission while emulating).
DROP POLICY IF EXISTS "onboarding_submissions_owner_insert" ON public.onboarding_submissions;
CREATE POLICY "onboarding_submissions_owner_insert"
  ON public.onboarding_submissions FOR INSERT TO authenticated
  WITH CHECK (
    source = 'owner'
    AND owner_id IS NOT NULL
    AND owner_id = public.current_owner_id()
    AND (
      property_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.owner_properties op
        WHERE op.owner_id = public.current_owner_id()
          AND op.property_id = onboarding_submissions.property_id
      )
    )
  );
