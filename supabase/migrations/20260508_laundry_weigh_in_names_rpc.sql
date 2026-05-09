-- Public RPC that returns distinct cleaner names from prior weigh-ins so
-- the public submission form can offer name autocomplete. The underlying
-- table stays anon-INSERT-only; this function is the only way anon can
-- read any data from it, and it returns names only — no pounds, no
-- timestamps, no photo URLs.

CREATE OR REPLACE FUNCTION public.get_laundry_weigh_in_names()
RETURNS TEXT[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(DISTINCT cleaner_name ORDER BY cleaner_name),
    ARRAY[]::TEXT[]
  )
  FROM laundry_weigh_ins
  WHERE cleaner_name IS NOT NULL
    AND length(btrim(cleaner_name)) > 0;
$$;

REVOKE ALL ON FUNCTION public.get_laundry_weigh_in_names() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_laundry_weigh_in_names() TO anon, authenticated;
