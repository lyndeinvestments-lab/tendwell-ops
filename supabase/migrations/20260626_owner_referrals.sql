-- Owner-submitted referrals. Owners insert + read their own; status and reward
-- are staff-controlled. Keyed by property_owners.id (clean FK), so plain RLS
-- (no SECURITY DEFINER RPC needed) scopes rows by current_owner_id().
CREATE TABLE IF NOT EXISTS public.owner_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.property_owners(id) ON DELETE CASCADE,
  referred_name text NOT NULL,
  referred_email text,
  referred_phone text,
  note text,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','contacted','converted','declined')),
  reward_status text NOT NULL DEFAULT 'pending'
    CHECK (reward_status IN ('pending','earned','paid')),
  reward_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_referrals_owner_id_idx ON public.owner_referrals(owner_id);

CREATE OR REPLACE FUNCTION public.owner_referrals_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_owner_referrals_touch ON public.owner_referrals;
CREATE TRIGGER trg_owner_referrals_touch
  BEFORE UPDATE ON public.owner_referrals
  FOR EACH ROW EXECUTE FUNCTION public.owner_referrals_touch();

ALTER TABLE public.owner_referrals ENABLE ROW LEVEL SECURITY;

-- Owners: read + create their own referrals only. No update/delete policy, so
-- owners cannot alter status/reward even with table-level grants.
CREATE POLICY owner_referrals_owner_select ON public.owner_referrals
  FOR SELECT USING (owner_id = public.current_owner_id());
CREATE POLICY owner_referrals_owner_insert ON public.owner_referrals
  FOR INSERT WITH CHECK (owner_id = public.current_owner_id());

-- Staff: full management.
CREATE POLICY owner_referrals_staff_all ON public.owner_referrals
  FOR ALL USING (public.is_staff()) WITH CHECK (public.is_staff());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_referrals TO authenticated;
GRANT ALL ON public.owner_referrals TO service_role;
