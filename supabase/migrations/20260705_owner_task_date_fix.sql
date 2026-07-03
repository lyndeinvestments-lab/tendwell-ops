-- ═══════════════════════════════════════════════════════════════════════════════
-- Owner Task Date Fix
-- ═══════════════════════════════════════════════════════════════════════════════
-- Previously get_owner_property_tasks() returned task_date as TIMESTAMPTZ,
-- which anchored bare dates to midnight UTC and rolled them back one day for
-- clients in Eastern time. This migration redefines the function to return
-- task_date as DATE so calendar dates display as the same calendar day for all
-- viewers regardless of timezone.
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_owner_property_tasks(BIGINT);

CREATE OR REPLACE FUNCTION public.get_owner_property_tasks(p_property_id BIGINT)
RETURNS TABLE (
  source     TEXT,
  title      TEXT,
  task_date  DATE,
  status     TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth AS $$
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

  -- Trellis / Trello snapshot, matched to this property by trellis_id or name
  SELECT
    'trellis'::TEXT AS source,
    COALESCE(NULLIF(t.title, ''), 'Task')::TEXT AS title,
    t.scheduled_date AS task_date,
    t.status::TEXT AS status
  FROM public.trellis_task_snapshot t
  JOIN public.properties p ON p.id = p_property_id
  WHERE t.scheduled_date IS NOT NULL
    AND (
      -- trellis_property_id is uuid; properties.trellis_id is text -- compare as text
      (p.trellis_id IS NOT NULL AND t.trellis_property_id::text = p.trellis_id)
      OR (t.property_name IS NOT NULL AND lower(t.property_name) = lower(p.name))
    )

  ORDER BY task_date DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.get_owner_property_tasks(BIGINT) TO authenticated;
