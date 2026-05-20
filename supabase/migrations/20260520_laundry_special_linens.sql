-- Add special linens fields to laundry_weigh_ins
ALTER TABLE laundry_weigh_ins
  ADD COLUMN IF NOT EXISTS has_special_linens boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS special_linen_property text,
  ADD COLUMN IF NOT EXISTS special_linen_description text,
  ADD COLUMN IF NOT EXISTS special_linen_photo_url text,
  ADD COLUMN IF NOT EXISTS special_linen_photo_path text,
  ADD COLUMN IF NOT EXISTS special_linen_weight numeric;

-- Public RPC so the anon key can fetch property names for the weigh-in form
CREATE OR REPLACE FUNCTION get_property_names_for_weigh_in()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT name FROM properties
    WHERE name IS NOT NULL
    ORDER BY name
  );
$$;

GRANT EXECUTE ON FUNCTION get_property_names_for_weigh_in() TO anon;
