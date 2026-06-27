-- Owner feedback / feature suggestions. Owners insert + read their own; status
-- is staff-controlled. Same RLS shape as owner_referrals / owner_testimonials.
CREATE TABLE IF NOT EXISTS public.owner_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.property_owners(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'suggestion'
    CHECK (category IN ('suggestion','issue','praise','other')),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reviewing','planned','done','declined')),
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_feedback_owner_id_idx ON public.owner_feedback(owner_id);

CREATE OR REPLACE FUNCTION public.owner_feedback_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_owner_feedback_touch ON public.owner_feedback;
CREATE TRIGGER trg_owner_feedback_touch
  BEFORE UPDATE ON public.owner_feedback
  FOR EACH ROW EXECUTE FUNCTION public.owner_feedback_touch();

ALTER TABLE public.owner_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_feedback_owner_select ON public.owner_feedback
  FOR SELECT USING (owner_id = public.current_owner_id());
CREATE POLICY owner_feedback_owner_insert ON public.owner_feedback
  FOR INSERT WITH CHECK (owner_id = public.current_owner_id());
CREATE POLICY owner_feedback_staff_all ON public.owner_feedback
  FOR ALL USING (public.is_staff()) WITH CHECK (public.is_staff());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_feedback TO authenticated;
GRANT ALL ON public.owner_feedback TO service_role;
