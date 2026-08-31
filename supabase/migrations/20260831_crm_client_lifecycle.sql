-- CRM client lifecycle — the top-of-funnel half of the pipeline.
--
-- Why: the six `pipeline_stages` describe a PROPERTY's life (Lead → Quote →
-- Onboarding → Active → Offboarding → Offboarded) and work well for the
-- operational end — 263 stage_transitions, Onboarding/Active/Offboarded moving
-- daily. The sales end does not exist. A prospect from a first meeting has no
-- address yet, so there is nothing to create a property row from; "not
-- interested" and "long-term nurture" describe the RELATIONSHIP, not one house.
-- The result (measured 2026-08-31): 0 rows in Lead, 109 properties parked in
-- Quote untouched since 2026-06-25, and contact_interactions / contact_notes
-- both completely empty against ~20 external prospect meetings a month. The
-- CRM only ever recorded winners — Julie Anthony's contact row was created the
-- same day she closed.
--
-- This adds a second, INDEPENDENT lifecycle at the contact level. Nothing
-- cascades: moving a client never moves their properties and vice versa. The
-- two are shown side by side and a human decides. Auto-cascade is where
-- two-tier stage models rot.
--
-- The `new` stage is deliberately the review queue: the meeting-intake path
-- creates contacts there, and a human promotes or discards. Worst case is a
-- discarded card, which is a far better failure than either polluting the CRM
-- permanently or asking a confirmation question per meeting (which just
-- recreates the manual data entry this is meant to remove).

-- ─── Client lifecycle columns on contacts ────────────────────────────────────

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS client_stage       TEXT,
  ADD COLUMN IF NOT EXISTS client_stage_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_action        TEXT,
  ADD COLUMN IF NOT EXISTS next_action_date   DATE;

-- Backfill BEFORE the NOT NULL/CHECK so the existing 27 contacts don't all
-- land in `new` and read as an unreviewed queue on first load. Stage is
-- inferred from the evidence already on the row: a client_since date or a
-- property past Quote means the deal was won; properties only in Quote means
-- quoted; only-Offboarded means churned.
UPDATE public.contacts c
SET client_stage = CASE
  WHEN c.client_since IS NOT NULL THEN 'won'
  WHEN EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.contact_id = c.id AND p.archived_at IS NULL AND p.stage_id IN (3, 4, 5)
  ) THEN 'won'
  WHEN EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.contact_id = c.id AND p.archived_at IS NULL AND p.stage_id = 2
  ) THEN 'quoted'
  WHEN EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.contact_id = c.id AND p.stage_id = 6
  ) THEN 'churned'
  ELSE 'prospect'
END
WHERE c.client_stage IS NULL;

UPDATE public.contacts
SET client_stage_since = COALESCE(client_since::timestamptz, created_at, now())
WHERE client_stage_since IS NULL;

ALTER TABLE public.contacts
  ALTER COLUMN client_stage SET DEFAULT 'new',
  ALTER COLUMN client_stage SET NOT NULL,
  ALTER COLUMN client_stage_since SET DEFAULT now(),
  ALTER COLUMN client_stage_since SET NOT NULL;

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_client_stage_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_client_stage_check
  CHECK (client_stage IN (
    'new',            -- auto-created from a meeting, awaiting a human glance
    'prospect',       -- confirmed real, actively in conversation
    'quoted',         -- numbers sent, awaiting their answer
    'won',            -- signed
    'nurture',        -- long-term hold, revisit later
    'not_interested', -- they said no
    'churned'         -- was a client, left
  ));

COMMENT ON COLUMN public.contacts.client_stage IS
  'Relationship lifecycle, independent of properties.stage_id. Never cascades to or from property stages.';
COMMENT ON COLUMN public.contacts.next_action IS
  'The one thing to do next for this client, e.g. "send quote for 3 cabins".';

CREATE INDEX IF NOT EXISTS contacts_client_stage_idx ON public.contacts (client_stage);
CREATE INDEX IF NOT EXISTS contacts_next_action_date_idx ON public.contacts (next_action_date)
  WHERE next_action_date IS NOT NULL;

-- ─── Client stage audit trail (mirrors stage_transitions) ────────────────────

CREATE TABLE IF NOT EXISTS public.client_stage_transitions (
  id          BIGSERIAL PRIMARY KEY,
  contact_id  UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT NOT NULL,
  changed_by  TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_stage_transitions_contact_idx
  ON public.client_stage_transitions (contact_id, created_at DESC);

ALTER TABLE public.client_stage_transitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_stage_transitions_staff_select ON public.client_stage_transitions;
CREATE POLICY client_stage_transitions_staff_select ON public.client_stage_transitions
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS client_stage_transitions_staff_insert ON public.client_stage_transitions;
CREATE POLICY client_stage_transitions_staff_insert ON public.client_stage_transitions
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());

-- ─── Meeting intake on the existing (empty) contact_interactions table ───────
-- Reusing the table rather than adding one: it already has contact_id,
-- interaction_type, summary, created_by, created_at and zero rows. It needs
-- three things to become an idempotent intake target.

ALTER TABLE public.contact_interactions
  ADD COLUMN IF NOT EXISTS source      TEXT,          -- 'granola' | 'manual' | 'cowork'
  ADD COLUMN IF NOT EXISTS external_id TEXT,          -- e.g. 'granola:d72dae52-…'
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;   -- when we MET, not row-write time

-- The whole idempotency story: the intake pass can re-read the last 7 days of
-- meetings every morning and never double-log one.
CREATE UNIQUE INDEX IF NOT EXISTS contact_interactions_external_id_key
  ON public.contact_interactions (external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS contact_interactions_contact_occurred_idx
  ON public.contact_interactions (contact_id, COALESCE(occurred_at, created_at) DESC);

COMMENT ON COLUMN public.contact_interactions.occurred_at IS
  'When the interaction happened. created_at is when the row was written; a meeting logged three days late has an occurred_at three days earlier.';

-- ─── Tunable thresholds (app_settings, no migration needed to change) ────────

INSERT INTO public.app_settings (key, value) VALUES
  ('crm_new_lead_stale_days',      '3'),
  ('crm_prospect_stale_days',      '14'),
  ('crm_quote_response_days',      '7'),
  ('crm_nurture_revisit_days',     '90'),
  ('crm_property_quote_stale_days','30')
ON CONFLICT (key) DO NOTHING;

-- Reads an integer setting, falling back to the default when the key is absent
-- or holds anything that isn't a clean non-negative integer. A malformed
-- setting must not break the attention queue.
CREATE OR REPLACE FUNCTION public.crm_setting_int(p_key TEXT, p_default INT)
RETURNS INT
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT s.value::int FROM public.app_settings s
      WHERE s.key = p_key AND s.value ~ '^[0-9]+$'),
    p_default
  )
$$;
REVOKE EXECUTE ON FUNCTION public.crm_setting_int(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_setting_int(TEXT, INT) TO authenticated, service_role;

-- ─── crm_client_360: one row per client, everything about them ───────────────
-- Built once and consumed twice — by the /contacts CRM page and by the Cowork
-- MCP tool. That shared read model is what makes "see a client whole" and
-- "let Cowork brief me" the same project instead of two.

CREATE OR REPLACE VIEW public.crm_client_360
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.full_name,
  c.company,
  c.email,
  c.phone,
  c.client_stage,
  c.client_stage_since,
  EXTRACT(DAY FROM (now() - c.client_stage_since))::int      AS days_in_stage,
  c.next_action,
  c.next_action_date,
  c.source,
  c.tags,
  c.client_since,
  c.is_active,
  c.billing_channel,
  c.payment_method,
  COALESCE(p.property_count, 0)                              AS property_count,
  COALESCE(p.active_count, 0)                                AS active_count,
  COALESCE(p.quote_count, 0)                                 AS quote_count,
  COALESCE(p.onboarding_count, 0)                            AS onboarding_count,
  COALESCE(p.offboarded_count, 0)                            AS offboarded_count,
  COALESCE(p.monthly_value, 0)                               AS monthly_value,
  COALESCE(i.interaction_count, 0)                           AS interaction_count,
  i.last_interaction_at,
  i.last_interaction_summary,
  COALESCE(n.note_count, 0)                                  AS note_count,
  GREATEST(
    COALESCE(i.last_interaction_at, c.client_stage_since),
    c.client_stage_since
  )                                                          AS last_touch_at
FROM public.contacts c
LEFT JOIN (
  SELECT
    pr.contact_id,
    COUNT(*)                                                            AS property_count,
    COUNT(*) FILTER (WHERE pr.stage_id = 4)                             AS active_count,
    COUNT(*) FILTER (WHERE pr.stage_id = 2)                             AS quote_count,
    COUNT(*) FILTER (WHERE pr.stage_id = 3)                             AS onboarding_count,
    COUNT(*) FILTER (WHERE pr.stage_id = 6)                             AS offboarded_count,
    SUM(COALESCE(pr.monthly_revenue_estimate, 0))                       AS monthly_value
  FROM public.properties pr
  WHERE pr.contact_id IS NOT NULL AND pr.archived_at IS NULL
  GROUP BY pr.contact_id
) p ON p.contact_id = c.id
LEFT JOIN (
  SELECT
    ci.contact_id,
    COUNT(*) AS interaction_count,
    MAX(COALESCE(ci.occurred_at, ci.created_at)) AS last_interaction_at,
    (ARRAY_AGG(ci.summary ORDER BY COALESCE(ci.occurred_at, ci.created_at) DESC))[1]
      AS last_interaction_summary
  FROM public.contact_interactions ci
  GROUP BY ci.contact_id
) i ON i.contact_id = c.id
LEFT JOIN (
  SELECT cn.contact_id, COUNT(*) AS note_count
  FROM public.contact_notes cn
  WHERE cn.contact_id IS NOT NULL
  GROUP BY cn.contact_id
) n ON n.contact_id = c.id;

COMMENT ON VIEW public.crm_client_360 IS
  'One row per client with property, value, and interaction rollups. Read model shared by the CRM page and the Cowork MCP server.';

-- ─── crm_attention: what has gone quiet ─────────────────────────────────────
-- One row per (client, reason) — a client can be flagged for more than one
-- thing, and collapsing that would hide the second reason.

CREATE OR REPLACE VIEW public.crm_attention
WITH (security_invoker = true) AS
WITH t AS (
  SELECT
    public.crm_setting_int('crm_new_lead_stale_days', 3)        AS new_lead_days,
    public.crm_setting_int('crm_prospect_stale_days', 14)       AS prospect_days,
    public.crm_setting_int('crm_quote_response_days', 7)        AS quote_days,
    public.crm_setting_int('crm_nurture_revisit_days', 90)      AS nurture_days
)
SELECT v.id AS contact_id, v.full_name, v.company, v.client_stage,
       v.days_in_stage, v.monthly_value, v.next_action, v.next_action_date,
       v.last_interaction_at, v.reason, v.detail, v.priority
FROM (
  -- Auto-created leads nobody has looked at
  SELECT c.*, 'unreviewed_lead' AS reason,
         'Auto-created from a meeting ' || c.days_in_stage || ' days ago and not yet reviewed' AS detail,
         1 AS priority
  FROM public.crm_client_360 c, t
  WHERE c.client_stage = 'new' AND c.days_in_stage >= t.new_lead_days

  UNION ALL
  -- Overdue next action, whatever the stage
  SELECT c.*, 'overdue_action' AS reason,
         COALESCE(c.next_action, 'Follow-up') || ' was due ' || c.next_action_date::text AS detail,
         1 AS priority
  FROM public.crm_client_360 c
  WHERE c.next_action_date IS NOT NULL AND c.next_action_date < CURRENT_DATE

  UNION ALL
  -- Quote sent, no answer
  SELECT c.*, 'quote_no_response' AS reason,
         'Quoted ' || c.days_in_stage || ' days ago with no recorded response' AS detail,
         2 AS priority
  FROM public.crm_client_360 c, t
  WHERE c.client_stage = 'quoted' AND c.days_in_stage >= t.quote_days

  UNION ALL
  -- Active prospect who has gone quiet
  SELECT c.*, 'stale_prospect' AS reason,
         CASE WHEN c.last_interaction_at IS NULL
              THEN 'Prospect with no recorded interaction at all'
              ELSE 'No contact in ' || EXTRACT(DAY FROM (now() - c.last_interaction_at))::int || ' days'
         END AS detail,
         2 AS priority
  FROM public.crm_client_360 c, t
  WHERE c.client_stage = 'prospect'
    AND (c.last_interaction_at IS NULL
         OR c.last_interaction_at < now() - (t.prospect_days || ' days')::interval)

  UNION ALL
  -- Nurture list resurfacing
  SELECT c.*, 'nurture_due' AS reason,
         'On long-term nurture for ' || c.days_in_stage || ' days — time to revisit' AS detail,
         3 AS priority
  FROM public.crm_client_360 c, t
  WHERE c.client_stage = 'nurture' AND c.days_in_stage >= t.nurture_days
) v;

COMMENT ON VIEW public.crm_attention IS
  'One row per (client, reason) for anything that has gone quiet. Thresholds live in app_settings under crm_*_days.';

-- ─── crm_stale_quote_properties: the 109-row Quote graveyard ────────────────
-- Property-level, so it stays out of crm_attention's per-client grain.

CREATE OR REPLACE VIEW public.crm_stale_quote_properties
WITH (security_invoker = true) AS
SELECT
  p.id            AS property_id,
  p.name          AS property_name,
  p.contact_id,
  c.full_name     AS client_name,
  p.monthly_revenue_estimate,
  COALESCE(lm.last_moved, p.created_at)                                     AS since,
  EXTRACT(DAY FROM (now() - COALESCE(lm.last_moved, p.created_at)))::int    AS days_stale
FROM public.properties p
LEFT JOIN public.contacts c ON c.id = p.contact_id
LEFT JOIN (
  SELECT st.property_id, MAX(st.created_at) AS last_moved
  FROM public.stage_transitions st GROUP BY st.property_id
) lm ON lm.property_id = p.id
WHERE p.stage_id = 2
  AND p.archived_at IS NULL
  AND COALESCE(lm.last_moved, p.created_at)
      < now() - (public.crm_setting_int('crm_property_quote_stale_days', 30) || ' days')::interval;

COMMENT ON VIEW public.crm_stale_quote_properties IS
  'Properties parked in the Quote stage past the staleness threshold, with days_stale and the client they belong to.';

-- ─── Write RPCs ─────────────────────────────────────────────────────────────
-- Writes go through guarded RPCs rather than raw table access for two reasons:
-- a stage move must write its audit row atomically (a raw PATCH silently
-- skips it), and meeting intake must be idempotent on external_id.

-- Callers: staff sessions (is_staff) and the service role, which is what the
-- API-key gateway and the MCP server authenticate as.
CREATE OR REPLACE FUNCTION public.crm_caller_allowed()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT
    -- A signed-in staff user (browser session through PostgREST).
    COALESCE(public.is_staff(), false)
    -- The service role: how the API-key gateway and the MCP server authenticate.
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR COALESCE(
         (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), ''
       ) = 'service_role'
    -- A direct Postgres connection carrying no JWT at all: the Supabase SQL
    -- editor, pg_cron, psql. PostgREST always sets request.jwt.claims (even for
    -- anon) and never connects as these roles, so the public API surface can
    -- never reach this branch.
    OR (
      current_setting('request.jwt.claims', true) IS NULL
      AND current_user IN ('postgres', 'supabase_admin')
    )
$$;
REVOKE EXECUTE ON FUNCTION public.crm_caller_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_caller_allowed() TO authenticated, service_role;

-- Who to attribute a write to. Falls back to a label rather than NULL so the
-- audit trail always says something.
CREATE OR REPLACE FUNCTION public.crm_actor(p_actor TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT COALESCE(NULLIF(TRIM(COALESCE(p_actor, '')), ''), public.current_auth_email(), 'system')
$$;
REVOKE EXECUTE ON FUNCTION public.crm_actor(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_actor(TEXT) TO authenticated, service_role;

-- crm_set_client_stage: move a client and write the audit row atomically.
CREATE OR REPLACE FUNCTION public.crm_set_client_stage(
  p_contact_id UUID,
  p_to_stage   TEXT,
  p_note       TEXT DEFAULT NULL,
  p_actor      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_from TEXT;
  v_name TEXT;
BEGIN
  IF NOT public.crm_caller_allowed() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT client_stage, full_name INTO v_from, v_name
  FROM public.contacts WHERE id = p_contact_id;

  IF v_from IS NULL THEN
    RAISE EXCEPTION 'contact % not found', p_contact_id;
  END IF;

  IF p_to_stage NOT IN ('new','prospect','quoted','won','nurture','not_interested','churned') THEN
    RAISE EXCEPTION 'invalid client stage: %', p_to_stage;
  END IF;

  -- A no-op move writes no transition row: re-running an intake pass must not
  -- manufacture audit history.
  IF v_from = p_to_stage THEN
    RETURN jsonb_build_object(
      'contact_id', p_contact_id, 'full_name', v_name,
      'from_stage', v_from, 'to_stage', p_to_stage, 'changed', false
    );
  END IF;

  UPDATE public.contacts
  SET client_stage       = p_to_stage,
      client_stage_since = now(),
      -- Winning sets client_since if it was never recorded; the stage move is
      -- the moment we learn it.
      client_since       = CASE WHEN p_to_stage = 'won' AND client_since IS NULL
                                THEN CURRENT_DATE ELSE client_since END,
      -- Terminal stages clear a stale next action so it stops surfacing in
      -- the attention queue for a client who is no longer in play.
      next_action        = CASE WHEN p_to_stage IN ('not_interested','churned')
                                THEN NULL ELSE next_action END,
      next_action_date   = CASE WHEN p_to_stage IN ('not_interested','churned')
                                THEN NULL ELSE next_action_date END,
      updated_at         = now()
  WHERE id = p_contact_id;

  INSERT INTO public.client_stage_transitions (contact_id, from_stage, to_stage, changed_by, notes)
  VALUES (p_contact_id, v_from, p_to_stage, public.crm_actor(p_actor), p_note);

  RETURN jsonb_build_object(
    'contact_id', p_contact_id, 'full_name', v_name,
    'from_stage', v_from, 'to_stage', p_to_stage, 'changed', true
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_set_client_stage(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_set_client_stage(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- crm_move_property_stage: the property-stage equivalent. Accepts a stage name
-- or slug so a caller never has to know the integer ids.
CREATE OR REPLACE FUNCTION public.crm_move_property_stage(
  p_property_id BIGINT,
  p_to_stage    TEXT,
  p_note        TEXT DEFAULT NULL,
  p_actor       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_from_id INT;
  v_to_id   INT;
  v_to_name TEXT;
  v_pname   TEXT;
BEGIN
  IF NOT public.crm_caller_allowed() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT stage_id, name INTO v_from_id, v_pname
  FROM public.properties WHERE id = p_property_id;

  IF v_pname IS NULL THEN
    RAISE EXCEPTION 'property % not found', p_property_id;
  END IF;

  SELECT id, name INTO v_to_id, v_to_name
  FROM public.pipeline_stages
  WHERE lower(name) = lower(TRIM(p_to_stage)) OR lower(slug) = lower(TRIM(p_to_stage))
  LIMIT 1;

  IF v_to_id IS NULL THEN
    RAISE EXCEPTION 'unknown pipeline stage: %', p_to_stage;
  END IF;

  IF v_from_id IS NOT DISTINCT FROM v_to_id THEN
    RETURN jsonb_build_object(
      'property_id', p_property_id, 'property_name', v_pname,
      'to_stage', v_to_name, 'changed', false
    );
  END IF;

  UPDATE public.properties SET stage_id = v_to_id WHERE id = p_property_id;

  INSERT INTO public.stage_transitions
    (property_id, from_stage_id, to_stage_id, transitioned_by, notes)
  VALUES (p_property_id, v_from_id, v_to_id, public.crm_actor(p_actor), p_note);

  RETURN jsonb_build_object(
    'property_id', p_property_id, 'property_name', v_pname,
    'from_stage', (SELECT name FROM public.pipeline_stages WHERE id = v_from_id),
    'to_stage', v_to_name, 'changed', true
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_move_property_stage(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_move_property_stage(BIGINT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- crm_log_interaction: record a call/email/note against a known client, and
-- optionally set the next action in the same call.
CREATE OR REPLACE FUNCTION public.crm_log_interaction(
  p_contact_id       UUID,
  p_summary          TEXT,
  p_interaction_type TEXT DEFAULT 'note',
  p_occurred_at      TIMESTAMPTZ DEFAULT NULL,
  p_next_action      TEXT DEFAULT NULL,
  p_next_action_date DATE DEFAULT NULL,
  p_source           TEXT DEFAULT 'manual',
  p_external_id      TEXT DEFAULT NULL,
  p_actor            TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_existing UUID;
  v_id       UUID;
BEGIN
  IF NOT public.crm_caller_allowed() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_contact_id) THEN
    RAISE EXCEPTION 'contact % not found', p_contact_id;
  END IF;

  IF p_external_id IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.contact_interactions
    WHERE external_id = p_external_id;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('interaction_id', v_existing, 'contact_id', p_contact_id,
                                'already_logged', true);
    END IF;
  END IF;

  INSERT INTO public.contact_interactions
    (contact_id, interaction_type, summary, created_by, source, external_id, occurred_at)
  VALUES (p_contact_id, COALESCE(NULLIF(TRIM(p_interaction_type), ''), 'note'),
          p_summary, public.crm_actor(p_actor), p_source, p_external_id,
          COALESCE(p_occurred_at, now()))
  RETURNING id INTO v_id;

  -- Only overwrite the next action when the caller actually supplied one, so
  -- logging a call doesn't silently erase a pending follow-up.
  IF p_next_action IS NOT NULL OR p_next_action_date IS NOT NULL THEN
    UPDATE public.contacts
    SET next_action      = COALESCE(p_next_action, next_action),
        next_action_date = COALESCE(p_next_action_date, next_action_date),
        updated_at       = now()
    WHERE id = p_contact_id;
  END IF;

  RETURN jsonb_build_object('interaction_id', v_id, 'contact_id', p_contact_id,
                            'already_logged', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_log_interaction(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_log_interaction(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, DATE, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- crm_log_meeting: the intake entry point. Idempotent on external_id, matches
-- an existing client by email then name, and creates one at stage `new` when
-- nothing matches. Deliberately does NOT advance the client stage — that is a
-- separate, explicit decision (crm_set_client_stage).
CREATE OR REPLACE FUNCTION public.crm_log_meeting(
  p_external_id      TEXT,
  p_title            TEXT,
  p_occurred_at      TIMESTAMPTZ,
  p_summary          TEXT DEFAULT NULL,
  p_contact_id       UUID DEFAULT NULL,
  p_contact_name     TEXT DEFAULT NULL,
  p_contact_email    TEXT DEFAULT NULL,
  p_contact_phone    TEXT DEFAULT NULL,
  p_company          TEXT DEFAULT NULL,
  p_next_action      TEXT DEFAULT NULL,
  p_next_action_date DATE DEFAULT NULL,
  p_source           TEXT DEFAULT 'granola',
  p_actor            TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_contact_id UUID;
  v_created    BOOLEAN := false;
  v_existing   UUID;
  v_iid        UUID;
  v_name       TEXT;
BEGIN
  IF NOT public.crm_caller_allowed() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_external_id IS NULL OR TRIM(p_external_id) = '' THEN
    RAISE EXCEPTION 'p_external_id is required for idempotent meeting intake';
  END IF;

  -- Already seen: return the existing linkage rather than erroring, so a
  -- re-run of the daily pass is a cheap no-op.
  SELECT id, contact_id INTO v_existing, v_contact_id
  FROM public.contact_interactions WHERE external_id = TRIM(p_external_id);
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('interaction_id', v_existing, 'contact_id', v_contact_id,
                              'created_contact', false, 'already_logged', true);
  END IF;

  v_contact_id := p_contact_id;

  -- Match by email first (exact identity), then by name. Name matching is
  -- case-insensitive and exact — never fuzzy, because a wrong match silently
  -- attributes a meeting to the wrong client.
  IF v_contact_id IS NULL AND NULLIF(TRIM(COALESCE(p_contact_email, '')), '') IS NOT NULL THEN
    SELECT id INTO v_contact_id FROM public.contacts
    WHERE lower(email) = lower(TRIM(p_contact_email)) LIMIT 1;
  END IF;

  IF v_contact_id IS NULL AND NULLIF(TRIM(COALESCE(p_contact_name, '')), '') IS NOT NULL THEN
    SELECT id INTO v_contact_id FROM public.contacts
    WHERE lower(full_name) = lower(TRIM(p_contact_name)) LIMIT 1;
  END IF;

  IF v_contact_id IS NULL THEN
    IF NULLIF(TRIM(COALESCE(p_contact_name, '')), '') IS NULL THEN
      RAISE EXCEPTION 'no contact matched and p_contact_name not supplied — cannot create a lead without a name';
    END IF;
    INSERT INTO public.contacts
      (full_name, email, phone, company, source, client_stage, client_stage_since, is_active)
    VALUES (TRIM(p_contact_name), NULLIF(TRIM(COALESCE(p_contact_email, '')), ''),
            NULLIF(TRIM(COALESCE(p_contact_phone, '')), ''),
            NULLIF(TRIM(COALESCE(p_company, '')), ''),
            'Meeting', 'new', COALESCE(p_occurred_at, now()), true)
    RETURNING id INTO v_contact_id;
    v_created := true;

    INSERT INTO public.client_stage_transitions
      (contact_id, from_stage, to_stage, changed_by, notes)
    VALUES (v_contact_id, NULL, 'new', public.crm_actor(p_actor),
            'Created from meeting: ' || COALESCE(p_title, p_external_id));
  END IF;

  INSERT INTO public.contact_interactions
    (contact_id, interaction_type, summary, created_by, source, external_id, occurred_at)
  VALUES (v_contact_id, 'meeting',
          COALESCE(NULLIF(TRIM(COALESCE(p_summary, '')), ''), p_title),
          public.crm_actor(p_actor), p_source, TRIM(p_external_id),
          COALESCE(p_occurred_at, now()))
  RETURNING id INTO v_iid;

  IF p_next_action IS NOT NULL OR p_next_action_date IS NOT NULL THEN
    UPDATE public.contacts
    SET next_action      = COALESCE(p_next_action, next_action),
        next_action_date = COALESCE(p_next_action_date, next_action_date),
        updated_at       = now()
    WHERE id = v_contact_id;
  END IF;

  SELECT full_name INTO v_name FROM public.contacts WHERE id = v_contact_id;

  RETURN jsonb_build_object(
    'interaction_id', v_iid, 'contact_id', v_contact_id, 'full_name', v_name,
    'created_contact', v_created, 'already_logged', false
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_log_meeting(TEXT, TEXT, TIMESTAMPTZ, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_log_meeting(TEXT, TEXT, TIMESTAMPTZ, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT) TO authenticated, service_role;

-- ─── Grants on the views ────────────────────────────────────────────────────
GRANT SELECT ON public.crm_client_360             TO authenticated, service_role;
GRANT SELECT ON public.crm_attention              TO authenticated, service_role;
GRANT SELECT ON public.crm_stale_quote_properties TO authenticated, service_role;
