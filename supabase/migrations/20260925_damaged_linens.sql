-- Damaged Linen Tracker
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per damaged/stained linen report across the portfolio: which
-- property, what item, how many, what kind of damage, and what happened to it
-- (stain treatment → back in service, or written off). Backs /damaged-linens.
--
-- Access follows the permission matrix like invoicing does
-- (20260817c_permission_driven_invoicing.sql): SELECT needs the
-- `damaged-linens` view grant, writes need its edit grant, resolved through
-- current_user_can_view/edit so the route, the sidebar and RLS agree.

CREATE TABLE IF NOT EXISTS public.damaged_linens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     bigint REFERENCES public.properties(id) ON DELETE SET NULL,
  item_type       text NOT NULL,
  quantity        integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  damage_type     text NOT NULL DEFAULT 'stain'
                  CHECK (damage_type IN ('stain','tear','burn','discoloration','worn','other')),
  status          text NOT NULL DEFAULT 'reported'
                  CHECK (status IN ('reported','treating','restored','discarded')),
  found_date      date NOT NULL DEFAULT CURRENT_DATE,
  found_by        text,
  cleaner_id      uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  -- Estimated replacement cost for the whole row (all units), optional.
  estimated_cost  numeric(10,2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  -- Guest-caused damage worth pursuing as a charge-back with the client.
  charge_back     boolean NOT NULL DEFAULT false,
  notes           text,
  photo_urls      text[] NOT NULL DEFAULT '{}',
  resolved_at     timestamptz,
  resolved_by     text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS damaged_linens_property_idx ON public.damaged_linens (property_id);
CREATE INDEX IF NOT EXISTS damaged_linens_found_date_idx ON public.damaged_linens (found_date DESC);
CREATE INDEX IF NOT EXISTS damaged_linens_status_idx ON public.damaged_linens (status);

-- updated_at + resolved_at are derived here so every write path agrees.
CREATE OR REPLACE FUNCTION public.damaged_linens_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IN ('restored','discarded') THEN
    IF TG_OP = 'INSERT' OR OLD.status NOT IN ('restored','discarded') OR NEW.resolved_at IS NULL THEN
      NEW.resolved_at := COALESCE(NEW.resolved_at, now());
    END IF;
  ELSE
    NEW.resolved_at := NULL;
    NEW.resolved_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.damaged_linens_touch() FROM PUBLIC;

DROP TRIGGER IF EXISTS damaged_linens_touch ON public.damaged_linens;
CREATE TRIGGER damaged_linens_touch
  BEFORE INSERT OR UPDATE ON public.damaged_linens
  FOR EACH ROW EXECUTE FUNCTION public.damaged_linens_touch();

ALTER TABLE public.damaged_linens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS damaged_linens_select ON public.damaged_linens;
CREATE POLICY damaged_linens_select ON public.damaged_linens
  FOR SELECT TO authenticated
  USING (public.current_user_can_view('damaged-linens'));

DROP POLICY IF EXISTS damaged_linens_insert ON public.damaged_linens;
CREATE POLICY damaged_linens_insert ON public.damaged_linens
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_edit('damaged-linens'));

DROP POLICY IF EXISTS damaged_linens_update ON public.damaged_linens;
CREATE POLICY damaged_linens_update ON public.damaged_linens
  FOR UPDATE TO authenticated
  USING (public.current_user_can_edit('damaged-linens'))
  WITH CHECK (public.current_user_can_edit('damaged-linens'));

DROP POLICY IF EXISTS damaged_linens_delete ON public.damaged_linens;
CREATE POLICY damaged_linens_delete ON public.damaged_linens
  FOR DELETE TO authenticated
  USING (public.current_user_can_edit('damaged-linens'));

-- ── Photo bucket ────────────────────────────────────────────────────────────
-- Public-read (object URLs render in <img>), authenticated upload, images
-- only with a 20 MB cap — same constraints as issue-photos.
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES ('damaged-linens', 'damaged-linens', true,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'], 20971520)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "damaged_linens_auth_insert" ON storage.objects;
CREATE POLICY "damaged_linens_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'damaged-linens' AND public.current_user_can_edit('damaged-linens'));

-- ── Permission grant ────────────────────────────────────────────────────────
-- The stored role_permissions blob overrides the hardcoded ROLE_VIEWS, so a
-- new view must be granted here or it stays hidden. Every role that can see
-- Linen Inventory gets the same view/edit on Damaged Linens.
UPDATE public.app_settings s
   SET value = (
     SELECT jsonb_object_agg(
              k,
              CASE
                WHEN (v->'views') ? 'linen-inventory' AND NOT (v->'views') ? 'damaged-linens' THEN
                  jsonb_set(
                    jsonb_set(v, '{views}', (v->'views') || '"damaged-linens"'::jsonb),
                    '{permissions,damaged-linens}',
                    COALESCE(v->'permissions'->'linen-inventory', '{"view":true,"edit":false}'::jsonb),
                    true)
                ELSE v
              END)
       FROM jsonb_each(s.value::jsonb) AS e(k, v)
   )::text
 WHERE s.key = 'role_permissions';
