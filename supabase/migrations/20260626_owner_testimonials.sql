-- Owner-submitted testimonials with consent/display controls. Owners insert +
-- read their own; status is staff-controlled (review -> approve/publish). Same
-- RLS shape as owner_referrals.
CREATE TABLE IF NOT EXISTS public.owner_testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.property_owners(id) ON DELETE CASCADE,
  rating int CHECK (rating BETWEEN 1 AND 5),
  body text NOT NULL,
  display_preference text NOT NULL DEFAULT 'full_name'
    CHECK (display_preference IN ('full_name','first_name','anonymous')),
  allow_photo boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','approved','published','declined')),
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_testimonials_owner_id_idx ON public.owner_testimonials(owner_id);

CREATE OR REPLACE FUNCTION public.owner_testimonials_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_owner_testimonials_touch ON public.owner_testimonials;
CREATE TRIGGER trg_owner_testimonials_touch
  BEFORE UPDATE ON public.owner_testimonials
  FOR EACH ROW EXECUTE FUNCTION public.owner_testimonials_touch();

ALTER TABLE public.owner_testimonials ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_testimonials_owner_select ON public.owner_testimonials
  FOR SELECT USING (owner_id = public.current_owner_id());
CREATE POLICY owner_testimonials_owner_insert ON public.owner_testimonials
  FOR INSERT WITH CHECK (owner_id = public.current_owner_id());
CREATE POLICY owner_testimonials_staff_all ON public.owner_testimonials
  FOR ALL USING (public.is_staff()) WITH CHECK (public.is_staff());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_testimonials TO authenticated;
GRANT ALL ON public.owner_testimonials TO service_role;
