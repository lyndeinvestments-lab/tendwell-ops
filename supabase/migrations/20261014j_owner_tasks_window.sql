-- 20261014j — keep the owner portal task feed to recent + upcoming Trellis tasks.
--
-- The Trellis history backfill (api/trellis/_aux-core.ts, task_backfill)
-- loads completed tasks back to 2025-06 so reviews and inspections can be
-- attributed to the clean that prepared them. get_owner_property_tasks()
-- returned EVERY snapshot task for the property, unbounded, so owners would
-- suddenly see 16 months of cleans, self-inspections and filter changes.
-- Before the backfill the feed reached ~30 days back for Haven properties
-- (and to April 2026 for Tendwell-direct ones); it now shows Trellis tasks
-- from the last 90 days onward. Inspections branch unchanged. Live body
-- verified 2026-10-14; only the date bound is new. Signature unchanged.

CREATE OR REPLACE FUNCTION public.get_owner_property_tasks(p_property_id bigint)
 RETURNS TABLE(source text, title text, task_date date, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NOT (public.is_staff() OR public.owner_owns_property(p_property_id)) THEN
    RAISE EXCEPTION 'Not authorized for this property';
  END IF;

  RETURN QUERY
  -- Internal inspections
  SELECT
    'inspection'::TEXT AS source,
    COALESCE(NULLIF(i.status, ''), 'Inspection')::TEXT AS title,
    COALESCE(i.scheduled_for, i.inspected_at)::date AS task_date,
    i.status::TEXT AS status
  FROM public.inspections i
  WHERE i.property_id = p_property_id
    AND COALESCE(i.scheduled_for, i.inspected_at)::date IS NOT NULL

  UNION ALL

  -- Trellis snapshot, matched to this property by trellis_id or name; last
  -- 90 days onward (the snapshot now also holds backfilled history).
  SELECT
    'trellis'::TEXT AS source,
    COALESCE(NULLIF(t.title, ''), 'Task')::TEXT AS title,
    t.scheduled_date AS task_date,
    t.status::TEXT AS status
  FROM public.trellis_task_snapshot t
  JOIN public.properties p ON p.id = p_property_id
  WHERE t.scheduled_date IS NOT NULL
    AND t.scheduled_date >= current_date - 90
    AND (
      -- trellis_property_id is uuid; properties.trellis_id is text -- compare as text
      (p.trellis_id IS NOT NULL AND t.trellis_property_id::text = p.trellis_id)
      OR (t.property_name IS NOT NULL AND lower(t.property_name) = lower(p.name))
    )

  ORDER BY task_date DESC;
END $function$;
