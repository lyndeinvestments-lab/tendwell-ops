-- 20260707_owner_portal_photos.sql
-- Owners can VIEW and ADD property photos in the owner portal (no delete;
-- staff manage deletions via the staff property modal).
--
-- 1. Adds a 13th permission key `photos` to owner_field_permissions_default()
--    (body reproduced verbatim from 20260707_owner_portal_property_fields.sql
--    with only that key added).
-- 2. property_photos RLS: the blanket "property_photos_authenticated" FOR ALL
--    policy (20260401) already let ANY authenticated user — including owners —
--    read, write, and delete every photo. It is replaced by an equivalent
--    staff-full policy plus owner-scoped SELECT/INSERT policies, so staff
--    behavior is unchanged while owners are narrowed to their own properties
--    with no UPDATE/DELETE.
-- 3. Storage: no changes needed. The property-photos bucket (20260602b) is
--    public (getPublicUrl object reads work for everyone) and its
--    "property_photos_auth_insert" policy already allows any authenticated
--    user — owners included — to upload.

-- a. owner_field_permissions_default: 13 keys (12 existing + photos).
CREATE OR REPLACE FUNCTION public.owner_field_permissions_default()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "address":        {"visible": true, "editable": true},
    "bed_sizes":      {"visible": true, "editable": true},
    "square_footage": {"visible": true, "editable": true},
    "door_code":      {"visible": true, "editable": true},
    "other_codes":    {"visible": true, "editable": true},
    "wifi_info":      {"visible": true, "editable": true},
    "bedrooms":       {"visible": true, "editable": true},
    "baths":          {"visible": true, "editable": true},
    "amenities":      {"visible": true, "editable": true},
    "check_times":    {"visible": true, "editable": true},
    "filter_size":    {"visible": true, "editable": true},
    "ical_url":       {"visible": true, "editable": true},
    "photos":         {"visible": true, "editable": true}
  }'::jsonb
$$;

-- b. property_photos RLS: staff keep full access; owners get scoped
--    SELECT + INSERT on their assigned properties only.
DROP POLICY IF EXISTS "property_photos_authenticated" ON public.property_photos;

DROP POLICY IF EXISTS "property_photos_all_staff" ON public.property_photos;
CREATE POLICY "property_photos_all_staff"
  ON public.property_photos FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "property_photos_select_owner" ON public.property_photos;
CREATE POLICY "property_photos_select_owner"
  ON public.property_photos FOR SELECT TO authenticated
  USING (
    property_id IN (
      SELECT op.property_id FROM public.owner_properties op
      WHERE op.owner_id = public.current_owner_id()
    )
  );

DROP POLICY IF EXISTS "property_photos_insert_owner" ON public.property_photos;
CREATE POLICY "property_photos_insert_owner"
  ON public.property_photos FOR INSERT TO authenticated
  WITH CHECK (
    property_id IN (
      SELECT op.property_id FROM public.owner_properties op
      WHERE op.owner_id = public.current_owner_id()
    )
  );
