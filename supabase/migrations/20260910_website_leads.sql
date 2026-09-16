-- Website lead capture — tendwellcleaningco.com "Book a Call" → the CRM.
--
-- Why: the marketing site's only CTA was a bare Calendly link. Someone who
-- clicked it either booked (and we learned about them from a calendar invite)
-- or bounced, and either way nothing reached Ops. Every inbound lead was
-- retyped by hand, or lost. This is the same pattern Haven runs on its own
-- site: gate the scheduler behind a short form, write the answers into the CRM
-- the moment they're submitted, THEN show the calendar.
--
-- Two things are stored, deliberately:
--
--   1. `contacts` — the CRM record, created at client_stage 'new'. That column
--      is already the human review queue (see 20260831_crm_client_lifecycle),
--      so a web lead lands exactly where a meeting-intake lead lands and a
--      person promotes or discards it. Nothing auto-advances a stage, and an
--      existing client filing the form is never demoted — we only set their
--      next_action so the attention queue surfaces them.
--
--   2. `website_leads` — the raw submission. The contact row holds identity;
--      this holds what they actually told us (portfolio size, location, what
--      prompted the search) plus forensics (UTM, referrer, landing page) and
--      whether the Calendly booking that follows the form ever completed.
--      Keeping it separate means a lead's answers survive a contact merge, and
--      "filled the form but never booked" is answerable — that gap is the
--      single most useful follow-up list the site can produce.
--
-- Writes arrive service-role only, through api/leads/intake.ts. There is no
-- anon INSERT policy: the public internet reaches this table through a
-- validating, rate-limited, honeypotted endpoint or not at all.

-- ─── website_leads ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.website_leads (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The CRM records this lead resolved to. Both nullable + ON DELETE SET NULL
  -- so purging a contact never destroys the evidence of where they came from.
  contact_id         UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  interaction_id     UUID REFERENCES public.contact_interactions(id) ON DELETE SET NULL,

  -- Idempotency key minted by the website (`web:<uuid>`). A retried POST — a
  -- double-click, a flaky connection, a client-side retry — is a no-op.
  external_id        TEXT NOT NULL UNIQUE,

  -- What the form asked. Only the name is structurally required; every other
  -- answer is optional so the form can be shortened or lengthened without a
  -- migration.
  full_name          TEXT NOT NULL,
  email              TEXT,
  phone              TEXT,
  company            TEXT,
  property_count     TEXT,          -- '1' | '2-5' | '6-15' | '16+' (free text; a label, not a number)
  property_location  TEXT,          -- one of site.serviceAreas, or free text
  message            TEXT,

  -- Where they came from.
  source_page        TEXT,          -- pathname of the page holding the form
  referrer           TEXT,
  utm                JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_agent         TEXT,

  -- Did the Calendly step that follows the form actually complete? NULL means
  -- form-filled-but-never-booked, which is the follow-up list.
  booked_at          TIMESTAMPTZ,
  calendly_event_uri TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.website_leads IS
  'One row per "Book a Call" form submission on tendwellcleaningco.com. Written service-role only via api/leads/intake.ts.';
COMMENT ON COLUMN public.website_leads.booked_at IS
  'Set when the Calendly step after the form completes. NULL = filled the form but never picked a time.';

CREATE INDEX IF NOT EXISTS website_leads_created_idx
  ON public.website_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS website_leads_contact_idx
  ON public.website_leads (contact_id, created_at DESC);
-- The "never booked" follow-up list, cheap.
CREATE INDEX IF NOT EXISTS website_leads_unbooked_idx
  ON public.website_leads (created_at DESC) WHERE booked_at IS NULL;

ALTER TABLE public.website_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS website_leads_staff_select ON public.website_leads;
CREATE POLICY website_leads_staff_select ON public.website_leads
  FOR SELECT TO authenticated USING (public.is_staff());

-- No INSERT/UPDATE policy on purpose. Owners must never read these (they are
-- other people's contact details), and public writes go through the
-- service-role endpoint, which bypasses RLS.

-- ─── crm_log_web_lead ────────────────────────────────────────────────────────
-- The intake entry point. Mirrors crm_log_meeting's contract: idempotent on
-- external_id, matches an existing client by email then exact name, creates one
-- at stage `new` when nothing matches, and never moves an existing client's
-- stage. The one difference is that this one always sets a next_action, because
-- an inbound form is a person waiting on a reply right now.

CREATE OR REPLACE FUNCTION public.crm_log_web_lead(
  p_external_id       TEXT,
  p_full_name         TEXT,
  p_email             TEXT DEFAULT NULL,
  p_phone             TEXT DEFAULT NULL,
  p_company           TEXT DEFAULT NULL,
  p_property_count    TEXT DEFAULT NULL,
  p_property_location TEXT DEFAULT NULL,
  p_message           TEXT DEFAULT NULL,
  p_source_page       TEXT DEFAULT NULL,
  p_referrer          TEXT DEFAULT NULL,
  p_utm               JSONB DEFAULT '{}'::jsonb,
  p_user_agent        TEXT DEFAULT NULL,
  p_occurred_at       TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
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

  -- Already seen: return the existing linkage rather than erroring or writing a
  -- duplicate, so a retried submit is a cheap no-op.
  SELECT id, contact_id, interaction_id INTO v_existing, v_contact_id, v_iid
  FROM public.website_leads WHERE external_id = TRIM(p_external_id);
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('lead_id', v_existing, 'contact_id', v_contact_id,
                              'interaction_id', v_iid, 'created_contact', false,
                              'already_logged', true);
  END IF;

  -- Match by email first (exact identity), then by exact case-insensitive name.
  -- Never fuzzy: a wrong match hands one person's enquiry to another's record.
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
    -- Known contact. Fill in blanks only — a form typo must never overwrite a
    -- phone number staff have already verified — and leave client_stage alone.
    UPDATE public.contacts
    SET phone      = COALESCE(phone, NULLIF(TRIM(COALESCE(p_phone, '')), '')),
        email      = COALESCE(email, v_email),
        company    = COALESCE(company, NULLIF(TRIM(COALESCE(p_company, '')), '')),
        updated_at = now()
    WHERE id = v_contact_id;
  END IF;

  -- One readable block, because this is what shows in the client sheet's
  -- history and in the MCP client brief. Composed here rather than in the
  -- endpoint so every caller of the RPC produces the same shape.
  v_summary := 'Website form: booked a 5-Star Audit call'
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

  -- Always set the next action: someone is waiting. Overwriting a stale one is
  -- correct here (unlike crm_log_interaction, which preserves it) because a
  -- brand-new inbound enquiry outranks whatever follow-up was pending.
  UPDATE public.contacts
  SET next_action      = 'Reply to website lead',
      next_action_date = (v_when AT TIME ZONE 'UTC')::date,
      updated_at       = now()
  WHERE id = v_contact_id;

  RETURN jsonb_build_object('lead_id', v_lead_id, 'contact_id', v_contact_id,
                            'interaction_id', v_iid, 'created_contact', v_created,
                            'already_logged', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crm_log_web_lead(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_log_web_lead(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ
) TO authenticated, service_role;

-- ─── crm_mark_web_lead_booked ────────────────────────────────────────────────
-- Called when the Calendly widget on the same page reports event_scheduled.
-- Separate from intake because the two are genuinely separate events: the form
-- is submitted, and then some fraction of those people actually pick a time.

CREATE OR REPLACE FUNCTION public.crm_mark_web_lead_booked(
  p_lead_id      UUID,
  p_event_uri    TEXT DEFAULT NULL,
  p_scheduled_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_contact_id UUID;
  v_name       TEXT;
  v_first      BOOLEAN;
  v_ext        TEXT;
BEGIN
  IF NOT public.crm_caller_allowed() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT contact_id, full_name, external_id
  INTO v_contact_id, v_name, v_ext
  FROM public.website_leads WHERE id = p_lead_id;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'website lead % not found', p_lead_id;
  END IF;

  -- Claim the booking atomically. `booked_at IS NULL` in the WHERE means the
  -- first caller wins and every duplicate reports already_booked, so two
  -- simultaneous postMessages can never both write the interaction row.
  UPDATE public.website_leads
  SET booked_at          = COALESCE(p_scheduled_at, now()),
      calendly_event_uri = COALESCE(NULLIF(TRIM(COALESCE(p_event_uri, '')), ''), calendly_event_uri)
  WHERE id = p_lead_id AND booked_at IS NULL;
  v_first := FOUND;

  -- A late-arriving event URI still gets recorded on an already-booked lead.
  IF NOT v_first AND NULLIF(TRIM(COALESCE(p_event_uri, '')), '') IS NOT NULL THEN
    UPDATE public.website_leads
    SET calendly_event_uri = COALESCE(calendly_event_uri, TRIM(p_event_uri))
    WHERE id = p_lead_id;
  END IF;

  -- Guarded on the lead's own booked_at (checked above) rather than an
  -- ON CONFLICT clause: contact_interactions' unique index on external_id is
  -- PARTIAL (WHERE external_id IS NOT NULL), which arbiter inference cannot
  -- match from a bare column list. A duplicated postMessage from the Calendly
  -- widget therefore loses the atomic claim above and writes nothing.
  IF v_first AND v_contact_id IS NOT NULL THEN
    INSERT INTO public.contact_interactions
      (contact_id, interaction_type, summary, created_by, source, external_id, occurred_at)
    VALUES (v_contact_id, 'call_scheduled',
            'Booked a 5-Star Audit call from the website',
            'Website form', 'website', v_ext || ':booked',
            COALESCE(p_scheduled_at, now()));

    UPDATE public.contacts
    SET next_action      = 'Audit call booked — prep for the call',
        next_action_date = (COALESCE(p_scheduled_at, now()) AT TIME ZONE 'UTC')::date,
        updated_at       = now()
    WHERE id = v_contact_id;
  END IF;

  RETURN jsonb_build_object('lead_id', p_lead_id, 'contact_id', v_contact_id,
                            'already_booked', NOT v_first);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crm_mark_web_lead_booked(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_mark_web_lead_booked(UUID, TEXT, TIMESTAMPTZ) TO authenticated, service_role;
