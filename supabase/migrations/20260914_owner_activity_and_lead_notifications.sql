-- Website-lead + owner-portal notifications, and the "booked a call" fix.
--
-- Three things, all in service of one ask: Jordan wants an email when a lead
-- fills out the website form, and an email when an owner does something in
-- their portal.
--
--   1. crm_log_web_lead claimed every submission had "booked a 5-Star Audit
--      call". It is written at INTAKE time, before any booking exists, so it
--      was never true at the moment it was written and was wrong forever for
--      anyone who filled the form and left. Kristy Horn's three submissions
--      (one booking) all read as bookings, which is what made her history
--      unreadable.
--   2. Half the owner portal wrote no audit trail at all, so an activity
--      sweep would only ever see property/contact field edits. Notes, quote
--      responses, referrals, testimonials, feedback and photo uploads are now
--      logged like everything else.
--   3. The notification plumbing: two new preference columns, a first-login
--      marker, and a watermark for the sweep.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Web lead summaries: say what actually happened
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.crm_log_web_lead(
  p_external_id text,
  p_full_name text,
  p_email text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_company text DEFAULT NULL::text,
  p_property_count text DEFAULT NULL::text,
  p_property_location text DEFAULT NULL::text,
  p_message text DEFAULT NULL::text,
  p_source_page text DEFAULT NULL::text,
  p_referrer text DEFAULT NULL::text,
  p_utm jsonb DEFAULT '{}'::jsonb,
  p_user_agent text DEFAULT NULL::text,
  p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $fn$
DECLARE
  v_contact_id UUID;
  v_lead_id    UUID;
  v_iid        UUID;
  v_created    BOOLEAN := false;
  v_existing   UUID;
  v_name       TEXT;
  v_email      TEXT;
  v_when       TIMESTAMPTZ;
  v_summary    TEXT;
  v_prior      INTEGER := 0;
BEGIN
  IF NOT public.crm_caller_allowed() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_external_id IS NULL OR TRIM(p_external_id) = '' THEN
    RAISE EXCEPTION 'p_external_id is required for idempotent lead intake';
  END IF;

  v_name  := NULLIF(TRIM(COALESCE(p_full_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'p_full_name is required';
  END IF;

  v_email := NULLIF(TRIM(COALESCE(p_email, '')), '');
  v_when  := COALESCE(p_occurred_at, now());

  SELECT id, contact_id, interaction_id INTO v_existing, v_contact_id, v_iid
  FROM public.website_leads WHERE external_id = TRIM(p_external_id);
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('lead_id', v_existing, 'contact_id', v_contact_id,
                              'interaction_id', v_iid, 'created_contact', false,
                              'already_logged', true);
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT id INTO v_contact_id FROM public.contacts
    WHERE lower(email) = lower(v_email) LIMIT 1;
  END IF;

  IF v_contact_id IS NULL THEN
    SELECT id INTO v_contact_id FROM public.contacts
    WHERE lower(full_name) = lower(v_name) LIMIT 1;
  END IF;

  IF v_contact_id IS NULL THEN
    INSERT INTO public.contacts
      (full_name, email, phone, company, source, client_stage, client_stage_since, is_active)
    VALUES (v_name, v_email,
            NULLIF(TRIM(COALESCE(p_phone, '')), ''),
            NULLIF(TRIM(COALESCE(p_company, '')), ''),
            'Website', 'new', v_when, true)
    RETURNING id INTO v_contact_id;
    v_created := true;

    INSERT INTO public.client_stage_transitions
      (contact_id, from_stage, to_stage, changed_by, notes)
    VALUES (v_contact_id, NULL, 'new', 'Website form',
            'Created from a "Book a Call" submission on tendwellcleaningco.com');
  ELSE
    UPDATE public.contacts
    SET phone      = COALESCE(phone, NULLIF(TRIM(COALESCE(p_phone, '')), '')),
        email      = COALESCE(email, v_email),
        company    = COALESCE(company, NULLIF(TRIM(COALESCE(p_company, '')), '')),
        updated_at = now()
    WHERE id = v_contact_id;
  END IF;

  -- How many times has this person filled the form before? Counted before the
  -- insert below, so the first submission reads plainly and only repeats get
  -- numbered. Someone submitting three times is a real signal (confusion, or
  -- something they wanted to add) and reading three identical-looking cards
  -- with no hint they are the same person is how that signal gets lost.
  SELECT count(*) INTO v_prior
  FROM public.website_leads WHERE contact_id = v_contact_id;

  -- NEVER say "booked" here. This runs when the form is submitted; booking is
  -- a separate event that may never happen, and is logged by
  -- crm_mark_web_lead_booked as its own call_scheduled interaction.
  v_summary := 'Website form: requested a 5-Star Audit call'
    || CASE WHEN v_prior > 0
            THEN ' (submission #' || (v_prior + 1) || ' from this person)'
            ELSE '' END
    || COALESCE(E'\nPortfolio: '  || NULLIF(TRIM(COALESCE(p_property_count, '')), ''), '')
    || COALESCE(E'\nLocation: '   || NULLIF(TRIM(COALESCE(p_property_location, '')), ''), '')
    || COALESCE(E'\nPhone: '      || NULLIF(TRIM(COALESCE(p_phone, '')), ''), '')
    || COALESCE(E'\nEmail: '      || v_email, '')
    || COALESCE(E'\nNotes: '      || NULLIF(TRIM(COALESCE(p_message, '')), ''), '')
    || COALESCE(E'\nPage: '       || NULLIF(TRIM(COALESCE(p_source_page, '')), ''), '');

  INSERT INTO public.contact_interactions
    (contact_id, interaction_type, summary, created_by, source, external_id, occurred_at)
  VALUES (v_contact_id, 'web_form', v_summary, 'Website form', 'website',
          TRIM(p_external_id), v_when)
  RETURNING id INTO v_iid;

  INSERT INTO public.website_leads
    (contact_id, interaction_id, external_id, full_name, email, phone, company,
     property_count, property_location, message, source_page, referrer, utm,
     user_agent, created_at)
  VALUES (v_contact_id, v_iid, TRIM(p_external_id), v_name, v_email,
          NULLIF(TRIM(COALESCE(p_phone, '')), ''),
          NULLIF(TRIM(COALESCE(p_company, '')), ''),
          NULLIF(TRIM(COALESCE(p_property_count, '')), ''),
          NULLIF(TRIM(COALESCE(p_property_location, '')), ''),
          NULLIF(TRIM(COALESCE(p_message, '')), ''),
          NULLIF(TRIM(COALESCE(p_source_page, '')), ''),
          NULLIF(TRIM(COALESCE(p_referrer, '')), ''),
          COALESCE(p_utm, '{}'::jsonb),
          NULLIF(TRIM(COALESCE(p_user_agent, '')), ''),
          v_when)
  RETURNING id INTO v_lead_id;

  UPDATE public.contacts
  SET next_action      = 'Reply to website lead',
      next_action_date = (v_when AT TIME ZONE 'UTC')::date,
      updated_at       = now()
  WHERE id = v_contact_id;

  RETURN jsonb_build_object('lead_id', v_lead_id, 'contact_id', v_contact_id,
                            'interaction_id', v_iid, 'created_contact', v_created,
                            'already_logged', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.crm_log_web_lead(text,text,text,text,text,text,text,text,text,text,jsonb,text,timestamptz) FROM PUBLIC;

-- Rewrite the history that already claims a booking. Only the lead-in line
-- changes; every detail line is left exactly as submitted.
UPDATE public.contact_interactions
SET summary = 'Website form: requested a 5-Star Audit call'
              || substr(summary, length('Website form: booked a 5-Star Audit call') + 1)
WHERE interaction_type = 'web_form'
  AND summary LIKE 'Website form: booked a 5-Star Audit call%';

-- ---------------------------------------------------------------------------
-- 2. Audit-log the rest of the owner portal
-- ---------------------------------------------------------------------------
-- Before this, only property field edits (properties_owner_update_guard) and
-- contact edits (owner_update_self_contact) wrote activity_log rows. An owner
-- could add a note, approve a quote, refer a client, leave feedback or upload
-- a photo and leave no trace anywhere staff would look.
--
-- Attribution follows the existing convention exactly: changed_by is
-- '<owner name> (owner)', which is what the Activity page's "Owner Portal"
-- filter tab matches on, and what the notification sweep selects.

CREATE OR REPLACE FUNCTION public.owner_activity_actor()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  -- NULL when the caller is not acting as an owner, which is the signal the
  -- triggers below use to stay out of the way of staff writes.
  SELECT COALESCE(po.name, 'Owner') || ' (owner)'
  FROM public.property_owners po
  WHERE po.id = public.current_owner_id();
$fn$;

REVOKE ALL ON FUNCTION public.owner_activity_actor() FROM PUBLIC;

-- Notes -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_add_property_note(p_property_id bigint, p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  oid   UUID;
  oname TEXT;
  pname TEXT;
  nrow  property_notes;
BEGIN
  IF public.is_owner_emulating() THEN
    RAISE EXCEPTION 'Owner emulation is read-only';
  END IF;
  oid := current_owner_id();
  IF oid IS NULL OR NOT owner_owns_property(p_property_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'Note is empty';
  END IF;
  SELECT name INTO oname FROM property_owners WHERE id = oid;
  INSERT INTO property_notes (property_id, content, context, created_by, owner_id)
  VALUES (p_property_id, btrim(p_content), NULL, COALESCE(oname, 'Owner'), oid)
  RETURNING * INTO nrow;

  SELECT name INTO pname FROM properties WHERE id = p_property_id;
  INSERT INTO activity_log (entity_type, entity_id, entity_name, action, field_name,
                            old_value, new_value, changed_by, metadata)
  VALUES ('property', p_property_id::text, pname, 'note_added', 'note',
          NULL, left(btrim(p_content), 500),
          COALESCE(oname, 'Owner') || ' (owner)',
          jsonb_build_object('owner_id', oid, 'note_id', nrow.id));

  RETURN jsonb_build_object('id', nrow.id, 'content', nrow.content, 'created_at', nrow.created_at);
END $fn$;

-- Quote responses --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_respond_to_quote(p_property_id bigint, p_response text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $fn$
DECLARE
  v_actor TEXT;
  v_prop  TEXT;
BEGIN
  IF public.is_owner_emulating() THEN
    RAISE EXCEPTION 'Owner emulation is read-only';
  END IF;
  IF public.current_owner_id() IS NULL OR NOT public.owner_owns_property(p_property_id) THEN
    RAISE EXCEPTION 'Not authorized for this property';
  END IF;
  IF p_response NOT IN ('approved','declined') THEN
    RAISE EXCEPTION 'Invalid response';
  END IF;
  UPDATE public.properties
    SET quote_owner_response = p_response,
        quote_responded_at = now()
  WHERE id = p_property_id
    AND quote_sent_at IS NOT NULL
    AND (quote_owner_response IS NULL OR quote_owner_response = 'pending');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending quote to respond to';
  END IF;

  v_actor := public.owner_activity_actor();
  SELECT name INTO v_prop FROM public.properties WHERE id = p_property_id;
  INSERT INTO public.activity_log (entity_type, entity_id, entity_name, action, field_name,
                                   old_value, new_value, changed_by)
  VALUES ('property', p_property_id::text, v_prop, 'quote_response', 'quote_owner_response',
          'pending', p_response, COALESCE(v_actor, 'Owner (owner)'));
END $fn$;

-- Referrals / testimonials / feedback / photos ---------------------------
-- One trigger function for all four. It reads current_owner_id() rather than
-- the row, so a staff member editing the same table never trips it, and
-- property_photos (which carries no owner column at all) is still covered.
CREATE OR REPLACE FUNCTION public.log_owner_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor TEXT := public.owner_activity_actor();
  v_name  TEXT;
  v_body  TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RETURN NEW;  -- staff write, already covered elsewhere
  END IF;

  IF TG_TABLE_NAME = 'owner_referrals' THEN
    v_name := NEW.referred_name;
    v_body := concat_ws(' · ', NEW.referred_name, NEW.referred_email, NEW.referred_phone);
  ELSIF TG_TABLE_NAME = 'owner_testimonials' THEN
    v_name := 'Testimonial';
    v_body := concat_ws(' · ', NULLIF(NEW.rating::text, ''), left(COALESCE(NEW.body, ''), 400));
  ELSIF TG_TABLE_NAME = 'owner_feedback' THEN
    v_name := COALESCE(NEW.category, 'Feedback');
    v_body := left(COALESCE(NEW.body, ''), 400);
  ELSE -- property_photos
    SELECT name INTO v_name FROM properties WHERE id = NEW.property_id;
    v_body := 'Photo uploaded';
  END IF;

  INSERT INTO public.activity_log (entity_type, entity_id, entity_name, action, field_name,
                                   old_value, new_value, changed_by, metadata)
  VALUES (CASE WHEN TG_TABLE_NAME = 'property_photos' THEN 'property' ELSE 'other' END,
          NEW.id::text, v_name,
          CASE TG_TABLE_NAME
            WHEN 'owner_referrals'    THEN 'referral_submitted'
            WHEN 'owner_testimonials' THEN 'testimonial_submitted'
            WHEN 'owner_feedback'     THEN 'feedback_submitted'
            ELSE 'photo_uploaded' END,
          TG_TABLE_NAME, NULL, NULLIF(v_body, ''), v_actor,
          jsonb_build_object('owner_id', public.current_owner_id()));
  RETURN NEW;
END $fn$;

REVOKE ALL ON FUNCTION public.log_owner_submission() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_log_owner_referral     ON public.owner_referrals;
DROP TRIGGER IF EXISTS trg_log_owner_testimonial  ON public.owner_testimonials;
DROP TRIGGER IF EXISTS trg_log_owner_feedback     ON public.owner_feedback;
DROP TRIGGER IF EXISTS trg_log_owner_photo        ON public.property_photos;

CREATE TRIGGER trg_log_owner_referral    AFTER INSERT ON public.owner_referrals
  FOR EACH ROW EXECUTE FUNCTION public.log_owner_submission();
CREATE TRIGGER trg_log_owner_testimonial AFTER INSERT ON public.owner_testimonials
  FOR EACH ROW EXECUTE FUNCTION public.log_owner_submission();
CREATE TRIGGER trg_log_owner_feedback    AFTER INSERT ON public.owner_feedback
  FOR EACH ROW EXECUTE FUNCTION public.log_owner_submission();
CREATE TRIGGER trg_log_owner_photo       AFTER INSERT ON public.property_photos
  FOR EACH ROW EXECUTE FUNCTION public.log_owner_submission();

-- ---------------------------------------------------------------------------
-- 3. Notification plumbing
-- ---------------------------------------------------------------------------

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS notify_web_lead             BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_owner_portal_activity BOOLEAN NOT NULL DEFAULT true;

-- Notification state, not data: the real first-login time lives on
-- auth.users.last_sign_in_at. This only records that we have told staff.
ALTER TABLE public.property_owners
  ADD COLUMN IF NOT EXISTS first_login_notified_at TIMESTAMPTZ;

-- Everyone who has already signed in is backfilled as notified, so turning
-- this on does not blast fourteen emails about logins from July.
UPDATE public.property_owners po
SET first_login_notified_at = now()
FROM auth.users u
WHERE lower(u.email) = lower(po.email)
  AND u.last_sign_in_at IS NOT NULL
  AND po.first_login_notified_at IS NULL;

-- Watermark for the activity sweep. Seeded at now() for the same reason.
-- app_settings.value is TEXT, so this is stored as an explicit ISO-8601 UTC
-- string rather than Postgres' default timestamp rendering, which JavaScript's
-- Date parser treats as implementation-defined.
INSERT INTO public.app_settings (key, value)
VALUES ('owner_activity_notified_through',
        to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT (key) DO NOTHING;

COMMIT;
