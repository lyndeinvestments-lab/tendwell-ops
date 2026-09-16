-- Organizations (company accounts) with points-of-contact under them.
--
-- Why (2026-09-16, Jordan): Scenic Stay Collection / Hostimo Management have
-- multiple people (Mark, Robin, …) who each need their own owner portal, but
-- share one property portfolio. contacts.company was free-text only; properties
-- had a single contact_id. This migration adds a real org entity, hangs people
-- and properties on it, and grants org properties to every linked portal.

-- ─── organizations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  notes           text,
  billing_channel text NOT NULL DEFAULT 'none'
                  CHECK (billing_channel IN ('qbo_haven', 'bill_com', 'none')),
  payment_method  text,
  payment_notes   text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_name_unique
  ON public.organizations (lower(btrim(name)));

CREATE INDEX IF NOT EXISTS organizations_active_idx
  ON public.organizations (is_active) WHERE is_active;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_all_staff ON public.organizations;
CREATE POLICY organizations_all_staff
  ON public.organizations FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

COMMENT ON TABLE public.organizations IS
  'Company / management accounts (e.g. Scenic Stay Collection). People live on contacts.organization_id; portfolio on properties.organization_id.';

-- ─── FKs on contacts + properties ────────────────────────────────────────────
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS organization_id uuid
    REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contacts_organization_id_idx
  ON public.contacts (organization_id) WHERE organization_id IS NOT NULL;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS organization_id uuid
    REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS properties_organization_id_idx
  ON public.properties (organization_id) WHERE organization_id IS NOT NULL;

-- ─── Backfill from legacy contacts.company text ──────────────────────────────
INSERT INTO public.organizations (name)
SELECT DISTINCT btrim(c.company)
FROM public.contacts c
WHERE c.company IS NOT NULL
  AND btrim(c.company) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE lower(btrim(o.name)) = lower(btrim(c.company))
  );

UPDATE public.contacts c
SET organization_id = o.id
FROM public.organizations o
WHERE c.organization_id IS NULL
  AND c.company IS NOT NULL
  AND btrim(c.company) <> ''
  AND lower(btrim(c.company)) = lower(btrim(o.name));

UPDATE public.properties p
SET organization_id = c.organization_id
FROM public.contacts c
WHERE p.organization_id IS NULL
  AND p.contact_id = c.id
  AND c.organization_id IS NOT NULL;

-- ─── Grant helpers: org properties → owner portal ────────────────────────────
-- Internal (triggers / migration): no JWT check. Public RPC: staff-only.
CREATE OR REPLACE FUNCTION public._grant_org_properties_to_owner(
  p_owner_id uuid,
  p_organization_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_owner_id IS NULL OR p_organization_id IS NULL THEN
    RETURN 0;
  END IF;
  INSERT INTO public.owner_properties (owner_id, property_id)
  SELECT p_owner_id, pr.id
  FROM public.properties pr
  WHERE pr.organization_id = p_organization_id
    AND pr.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.owner_properties op
      WHERE op.owner_id = p_owner_id AND op.property_id = pr.id
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._grant_org_properties_to_owner(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.grant_org_properties_to_owner(
  p_owner_id uuid,
  p_organization_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Match owner_properties insert policy: staff only (not owner JWTs).
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN public._grant_org_properties_to_owner(p_owner_id, p_organization_id);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_org_properties_to_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_org_properties_to_owner(uuid, uuid) TO authenticated, service_role;

-- ─── When a property joins an org, grant every portal under that org ─────────
CREATE OR REPLACE FUNCTION public.properties_org_grant_portals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.owner_properties (owner_id, property_id)
  SELECT po.id, NEW.id
  FROM public.property_owners po
  JOIN public.contacts c ON c.id = po.contact_id
  WHERE c.organization_id = NEW.organization_id
    AND po.active IS TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.owner_properties op
      WHERE op.owner_id = po.id AND op.property_id = NEW.id
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_properties_org_grant_portals ON public.properties;
CREATE TRIGGER trg_properties_org_grant_portals
  AFTER INSERT OR UPDATE OF organization_id ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.properties_org_grant_portals();

-- ─── Contact link → inherit org onto property when unset ─────────────────────
CREATE OR REPLACE FUNCTION public.properties_contact_inherit_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.contact_id IS NOT DISTINCT FROM NEW.contact_id
     AND NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT organization_id INTO v_org
  FROM public.contacts
  WHERE id = NEW.contact_id;

  IF v_org IS NOT NULL AND NEW.organization_id IS NULL THEN
    NEW.organization_id := v_org;
  ELSIF v_org IS NOT NULL
        AND (TG_OP = 'INSERT' OR OLD.contact_id IS DISTINCT FROM NEW.contact_id) THEN
    -- Contact changed: adopt that contact's org (portfolio follows the company).
    NEW.organization_id := v_org;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_properties_contact_inherit_org ON public.properties;
CREATE TRIGGER trg_properties_contact_inherit_org
  BEFORE INSERT OR UPDATE OF contact_id ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.properties_contact_inherit_org();

-- ─── Contact joins/leaves an org → stamp properties + grant/revoke portals ───
CREATE OR REPLACE FUNCTION public.contacts_org_sync_portfolio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id THEN
    RETURN NEW;
  END IF;

  -- Stamp this contact's directly-linked properties onto the new org (or clear).
  IF NEW.organization_id IS NOT NULL THEN
    UPDATE public.properties
    SET organization_id = NEW.organization_id
    WHERE contact_id = NEW.id
      AND (organization_id IS DISTINCT FROM NEW.organization_id);
  ELSIF OLD.organization_id IS NOT NULL THEN
    -- Left the company: only clear org on properties that still point at the old org
    -- and are tied to this contact (don't strip siblings' shared rows).
    UPDATE public.properties
    SET organization_id = NULL
    WHERE contact_id = NEW.id
      AND organization_id = OLD.organization_id;
  END IF;

  -- Grant new org portfolio to this contact's portals.
  IF NEW.organization_id IS NOT NULL THEN
    FOR r IN
      SELECT id FROM public.property_owners
      WHERE contact_id = NEW.id AND active IS TRUE
    LOOP
      PERFORM public._grant_org_properties_to_owner(r.id, NEW.organization_id);
    END LOOP;
  END IF;

  -- Revoke old org portfolio rows that are not also assigned via contact_id.
  IF TG_OP = 'UPDATE'
     AND OLD.organization_id IS NOT NULL
     AND OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    DELETE FROM public.owner_properties op
    USING public.property_owners po, public.properties pr
    WHERE op.owner_id = po.id
      AND po.contact_id = NEW.id
      AND op.property_id = pr.id
      AND pr.organization_id = OLD.organization_id
      AND (pr.contact_id IS DISTINCT FROM NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_org_grant_portal ON public.contacts;
DROP TRIGGER IF EXISTS trg_contacts_org_sync_portfolio ON public.contacts;
CREATE TRIGGER trg_contacts_org_sync_portfolio
  AFTER INSERT OR UPDATE OF organization_id ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.contacts_org_sync_portfolio();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;

-- ─── CRM 360: count properties via contact_id OR shared organization ─────────
CREATE OR REPLACE VIEW public.crm_client_360
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.full_name,
  c.company,
  c.organization_id,
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
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                                            AS property_count,
    COUNT(*) FILTER (WHERE pr.stage_id = 4)                             AS active_count,
    COUNT(*) FILTER (WHERE pr.stage_id = 2)                             AS quote_count,
    COUNT(*) FILTER (WHERE pr.stage_id = 3)                             AS onboarding_count,
    COUNT(*) FILTER (WHERE pr.stage_id = 6)                             AS offboarded_count,
    SUM(COALESCE(pr.monthly_revenue_estimate, 0))                       AS monthly_value
  FROM public.properties pr
  WHERE pr.archived_at IS NULL
    AND (
      pr.contact_id = c.id
      OR (c.organization_id IS NOT NULL AND pr.organization_id = c.organization_id)
    )
) p ON true
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
  'One row per client with property, value, and interaction rollups. Property counts include the contact''s org portfolio when organization_id is set.';

-- One-shot: existing portals under orgs get the shared portfolio now
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT po.id AS owner_id, c.organization_id
    FROM public.property_owners po
    JOIN public.contacts c ON c.id = po.contact_id
    WHERE c.organization_id IS NOT NULL
      AND po.active IS TRUE
  LOOP
    PERFORM public._grant_org_properties_to_owner(r.owner_id, r.organization_id);
  END LOOP;
END $$;
