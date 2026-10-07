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
--        AND ((btrim(s.ical_url) ~* '^(https?|webcal)://' AND nullif(btrim(p.ical_url), '') IS NULL)
--          OR (s.pool IS NOT NULL AND p.pool IS NULL));
--    As of 2026-10-06 that is 3 ical_url fills (properties 284, 316, 652) and
--    5 pool fills (properties 400, 582, 583, 650, 651, all answered "No").
--    Only real http(s)/webcal links are copied (a webcal:// link is stored as
--    https://), so submitted text like `javascript:...` can never land in a column
--    the app renders as a link. The newest VALID link per property wins.
UPDATE public.properties p
SET ical_url = src.ical_url
FROM (
  SELECT DISTINCT ON (property_id) property_id,
         regexp_replace(btrim(ical_url), '^webcal://', 'https://', 'i') AS ical_url
  FROM public.onboarding_submissions
  WHERE status = 'converted'
    AND property_id IS NOT NULL
    AND btrim(ical_url) ~* '^(https?|webcal)://'
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
      -- starts_with, not equality: a note written by the app's Re-apply continues
      -- with invoice / deep-clean lines after this same head.
      AND starts_with(
        n.content,
        'Onboarding form notes from '
          || coalesce(nullif(btrim(s.client_name, E' \t\r\n'), ''), 'client')
          || ': ' || btrim(s.notes, E' \t\r\n')
      )
  );

-- 4. Calendar links must be links. Both columns are written by people other than
--    staff (the public intake form, the owner portal) and the app renders them as
--    anchors, so a `javascript:` value is a stored-XSS vector. The client now only
--    renders http(s) values as links; this is the database-side backstop.
--
--    properties.ical_url had no violations when checked, so its constraint is
--    validated. onboarding_submissions.ical_url holds one legacy non-URL answer
--    that is deliberately not rewritten, so that constraint stays NOT VALID:
--    PostgreSQL still enforces it for every new insert and update, and the
--    existing row is simply not re-checked.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_ical_url_scheme_chk') THEN
    ALTER TABLE public.properties
      ADD CONSTRAINT properties_ical_url_scheme_chk
      CHECK (ical_url IS NULL OR btrim(ical_url) = '' OR btrim(ical_url) ~* '^(https?|webcal)://') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_submissions_ical_url_scheme_chk') THEN
    ALTER TABLE public.onboarding_submissions
      ADD CONSTRAINT onboarding_submissions_ical_url_scheme_chk
      CHECK (ical_url IS NULL OR btrim(ical_url) = '' OR btrim(ical_url) ~* '^(https?|webcal)://') NOT VALID;
  END IF;
END $$;
ALTER TABLE public.properties VALIDATE CONSTRAINT properties_ical_url_scheme_chk;

-- 5. Link an owner to the property their own submission created.
--
--    `owner_properties` INSERT is admin-only (owner_properties_insert_admin), so
--    a non-admin who converts an owner-portal submission (Operations holds the
--    onboarding-queue view) could create the property but not the owner's portal
--    access to it. This RPC is the narrow bridge, and it is deliberately tighter
--    than "any staff may link any owner to any property":
--      * caller needs EDIT on the onboarding-queue view (admins always have it);
--      * the submission must be an owner-portal one (source = 'owner'), converted
--        within the last 30 days, filed by that owner, and point at the property;
--      * the property must still be in Onboarding (stage 3) and have NO owner
--        linked yet, so it can never be used to attach a second owner to a
--        property someone already owns;
--      * every link it creates is written to activity_log (action
--        'owner_portal_linked', changed_by = the staff member), so a portal grant
--        made through this path is never silent.
--    Idempotent: returns true when the owner ends up linked (including already
--    linked), so the app can call it again from Re-apply to repair a failed link.
CREATE OR REPLACE FUNCTION public.onboarding_link_owner_property(p_submission_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner      uuid;
  v_prop       bigint;
  v_staff      text;
  v_prop_name  text;
  v_owner_name text;
BEGIN
  IF NOT (public.is_staff() AND public.current_user_can_edit('onboarding-queue')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT s.owner_id, s.property_id::bigint
    INTO v_owner, v_prop
  FROM public.onboarding_submissions s
  WHERE s.id = p_submission_id
    AND s.status = 'converted'
    AND s.source = 'owner'
    AND s.owner_id IS NOT NULL
    AND s.property_id IS NOT NULL
    AND s.approved_at > now() - interval '30 days';

  IF v_owner IS NULL THEN
    RETURN false;
  END IF;

  -- Already linked: nothing to do (and nothing to log).
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

  IF FOUND THEN
    SELECT coalesce(nullif(btrim(a.label), ''), a.google_email)
      INTO v_staff
    FROM public.app_users a
    WHERE a.google_email = public.current_auth_email()
    LIMIT 1;
    SELECT p.name INTO v_prop_name FROM public.properties p WHERE p.id = v_prop;
    SELECT coalesce(nullif(btrim(o.name), ''), o.email) INTO v_owner_name FROM public.property_owners o WHERE o.id = v_owner;

    INSERT INTO public.activity_log (entity_type, entity_id, entity_name, action, field_name, new_value, changed_by, metadata)
    VALUES (
      'property', v_prop::text, v_prop_name, 'owner_portal_linked', 'owner_properties', v_owner_name,
      coalesce(v_staff, public.current_auth_email()),
      jsonb_build_object('owner_id', v_owner, 'submission_id', p_submission_id, 'via', 'onboarding_link_owner_property')
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.onboarding_link_owner_property(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_link_owner_property(uuid) TO authenticated;
