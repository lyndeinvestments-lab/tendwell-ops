-- Onboarding admin: stop losing what clients tell us on the intake form.
--
-- The queue's "Review & Create" / "Merge" dialog only ever copied a whitelist of
-- fields onto the property, so an iCal link, the pool answer and the free-text
-- notes the client typed were silently dropped on every conversion (3 of 3
-- converted submissions that carried an iCal link left properties.ical_url
-- NULL; Michael Baradell's Airbnb + VRBO links never reached property 652).
-- The dialog is fixed in the client (client/src/lib/onboarding.ts); this file
-- repairs the rows that were already converted and adds one narrowly-scoped RPC.
--
-- Idempotent: every statement is safe to re-run. Nothing here weakens RLS.

-- 1. Index for the "Properties in onboarding" readiness panel, which looks up
--    submissions by property_id in one batched query.
CREATE INDEX IF NOT EXISTS onboarding_submissions_property_id_idx
  ON public.onboarding_submissions (property_id);

-- 2. Backfill properties.ical_url and properties.pool from converted
--    submissions. ONLY blanks are filled: a value staff or the owner portal
--    already set always wins. When a property has several converted submissions
--    the newest one with an answer is used.
--
--    Preview of what this touches (read-only, run it before applying):
--      SELECT s.property_id, s.id AS submission_id, s.ical_url, p.ical_url AS current_ical,
--             s.pool, p.pool AS current_pool
--      FROM public.onboarding_submissions s
--      JOIN public.properties p ON p.id = s.property_id
--      WHERE s.status = 'converted'
--        AND ((nullif(btrim(s.ical_url), '') IS NOT NULL AND nullif(btrim(p.ical_url), '') IS NULL)
--          OR (s.pool IS NOT NULL AND p.pool IS NULL));
--    As of 2026-10-06 that is 3 ical_url fills (properties 284, 316, 652) and
--    5 pool fills (properties 400, 582, 583, 650, 651, all answered "No").
UPDATE public.properties p
SET ical_url = src.ical_url
FROM (
  SELECT DISTINCT ON (property_id) property_id, btrim(ical_url) AS ical_url
  FROM public.onboarding_submissions
  WHERE status = 'converted'
    AND property_id IS NOT NULL
    AND nullif(btrim(ical_url), '') IS NOT NULL
  ORDER BY property_id, submitted_at DESC NULLS LAST
) src
WHERE p.id = src.property_id
  AND nullif(btrim(p.ical_url), '') IS NULL;

UPDATE public.properties p
SET pool = src.pool
FROM (
  SELECT DISTINCT ON (property_id) property_id, pool
  FROM public.onboarding_submissions
  WHERE status = 'converted'
    AND property_id IS NOT NULL
    AND pool IS NOT NULL
  ORDER BY property_id, submitted_at DESC NULLS LAST
) src
WHERE p.id = src.property_id
  AND p.pool IS NULL;

-- 3. Backfill the free-text notes into a staff property note, so the links and
--    instructions the client typed (Baradell's VRBO iCal link lives only here)
--    show up in the property's Notes tab. The text is the same "head" the
--    client-side re-apply builds, which is how it dedupes against this.
--    Skips a submission whose note already exists on the property.
INSERT INTO public.property_notes (property_id, content, context, created_by)
SELECT s.property_id,
       'Onboarding form notes from '
         || coalesce(nullif(btrim(s.client_name, E' \t\r\n'), ''), 'client')
         || ': ' || btrim(s.notes, E' \t\r\n'),
       NULL,
       'Onboarding form (backfill)'
FROM public.onboarding_submissions s
JOIN public.properties p ON p.id = s.property_id
WHERE s.status = 'converted'
  AND s.property_id IS NOT NULL
  AND nullif(btrim(s.notes, E' \t\r\n'), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.property_notes n
    WHERE n.property_id = s.property_id
      AND n.content = 'Onboarding form notes from '
        || coalesce(nullif(btrim(s.client_name, E' \t\r\n'), ''), 'client')
        || ': ' || btrim(s.notes, E' \t\r\n')
  );

-- 4. Link an owner to the property their own submission created.
--
--    `owner_properties` INSERT is admin-only (owner_properties_insert_admin), so
--    a non-admin who converts an owner-portal submission (Operations holds the
--    onboarding-queue view) could create the property but not the owner's portal
--    access to it. This RPC is the narrow bridge, and it is deliberately tighter
--    than "any staff may link any owner to any property":
--      * caller needs EDIT on the onboarding-queue view (admins always have it);
--      * the submission must be converted, filed by that owner, and point at the
--        property;
--      * the property must still be in Onboarding (stage 3) and have NO owner
--        linked yet, so it can never be used to attach a second owner to a
--        property someone already owns.
--    Returns true when the owner ends up linked (including already linked).
CREATE OR REPLACE FUNCTION public.onboarding_link_owner_property(p_submission_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_prop  bigint;
BEGIN
  IF NOT (public.is_staff() AND public.current_user_can_edit('onboarding-queue')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT s.owner_id, s.property_id::bigint
    INTO v_owner, v_prop
  FROM public.onboarding_submissions s
  WHERE s.id = p_submission_id
    AND s.status = 'converted'
    AND s.owner_id IS NOT NULL
    AND s.property_id IS NOT NULL;

  IF v_owner IS NULL THEN
    RETURN false;
  END IF;

  -- Already linked: nothing to do.
  IF EXISTS (SELECT 1 FROM public.owner_properties WHERE owner_id = v_owner AND property_id = v_prop) THEN
    RETURN true;
  END IF;

  -- Fresh onboarding property with nobody attached yet, and nothing else.
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE id = v_prop AND stage_id = 3)
     OR EXISTS (SELECT 1 FROM public.owner_properties WHERE property_id = v_prop) THEN
    RETURN false;
  END IF;

  INSERT INTO public.owner_properties (owner_id, property_id)
  VALUES (v_owner, v_prop)
  ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.onboarding_link_owner_property(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_link_owner_property(uuid) TO authenticated;
