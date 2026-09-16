-- Harden CRM read-model views + agreement_config admin gate.
--
-- 1. crm_client_360 / crm_attention / crm_stale_quote_properties: add
--    WHERE public.crm_caller_allowed() so owners (authenticated but not staff)
--    cannot read the full CRM pipeline via PostgREST, while staff sessions and
--    the service role (MCP / API gateway) keep access. Matches the write-RPC
--    gate in the same feature.
--    (Bounty: .bounty-sweep/crm-views-no-staff-guard.md)
--
-- 2. agreement_config: tighten SELECT/INSERT/UPDATE from is_staff() to
--    current_user_role() = 'admin'. Signature PNG must not be readable by
--    operations/viewer roles. Signing endpoint uses service role.
--    (Bounty: .bounty-sweep/agreement-config-signature-rls.md)

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
) n ON n.contact_id = c.id
WHERE public.crm_caller_allowed();

COMMENT ON VIEW public.crm_client_360 IS
  'One row per client with property, value, and interaction rollups. Read model shared by the CRM page and the Cowork MCP server.';

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
) v
WHERE public.crm_caller_allowed();

COMMENT ON VIEW public.crm_attention IS
  'One row per (client, reason) for anything that has gone quiet. Thresholds live in app_settings under crm_*_days.';

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
      < now() - (public.crm_setting_int('crm_property_quote_stale_days', 30) || ' days')::interval
  AND public.crm_caller_allowed();

COMMENT ON VIEW public.crm_stale_quote_properties IS
  'Properties parked in the Quote stage past the staleness threshold, with days_stale and the client they belong to.';

-- ─── agreement_config admin-only ────────────────────────────────────────────
DROP POLICY IF EXISTS "agreement_config_select_staff" ON public.agreement_config;
CREATE POLICY "agreement_config_select_staff"
  ON public.agreement_config FOR SELECT TO authenticated
  USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "agreement_config_insert_staff" ON public.agreement_config;
CREATE POLICY "agreement_config_insert_staff"
  ON public.agreement_config FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "agreement_config_update_staff" ON public.agreement_config;
CREATE POLICY "agreement_config_update_staff"
  ON public.agreement_config FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');
