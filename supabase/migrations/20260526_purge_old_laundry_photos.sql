-- ═══════════════════════════════════════════════════════════════════════════════
-- 90-day retention for laundry-weigh-in photos.
-- ═══════════════════════════════════════════════════════════════════════════════
-- Laundry weigh-ins are proof-of-work for that week's billing; we don't need
-- the photo evidence forever. After the retention window, null out the
-- photo_url / photo_path columns on the row (the weight data + cleaner name
-- stay forever for reporting) and return the storage paths so the cron
-- handler can delete the objects from the `laundry-weigh-ins` bucket via
-- the Supabase Storage REST API.
--
-- SECURITY DEFINER so the cron service-role call doesn't depend on RLS, and
-- so the function can be hardened with a fixed search_path.

CREATE OR REPLACE FUNCTION public.purge_old_laundry_photos(retention_days integer DEFAULT 90)
RETURNS TABLE(storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF retention_days IS NULL OR retention_days < 1 THEN
    RAISE EXCEPTION 'retention_days must be >= 1, got %', retention_days;
  END IF;

  RETURN QUERY
  WITH cutoff AS (
    SELECT now() - make_interval(days => retention_days) AS ts
  ),
  to_purge AS (
    SELECT id, photo_path AS path
    FROM laundry_weigh_ins, cutoff
    WHERE submitted_at < cutoff.ts AND photo_path IS NOT NULL
    UNION ALL
    SELECT id, special_linen_photo_path AS path
    FROM laundry_weigh_ins, cutoff
    WHERE submitted_at < cutoff.ts AND special_linen_photo_path IS NOT NULL
  ),
  cleared AS (
    UPDATE laundry_weigh_ins l
    SET
      photo_url = NULL,
      photo_path = NULL,
      special_linen_photo_url = NULL,
      special_linen_photo_path = NULL
    WHERE l.submitted_at < (SELECT ts FROM cutoff)
      AND (l.photo_path IS NOT NULL OR l.special_linen_photo_path IS NOT NULL)
    RETURNING l.id
  )
  SELECT DISTINCT path FROM to_purge WHERE path IS NOT NULL AND path <> '';
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_laundry_photos(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_old_laundry_photos(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.purge_old_laundry_photos(integer) TO service_role;
