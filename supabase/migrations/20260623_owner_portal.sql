-- ═══════════════════════════════════════════════════════════════════════════════
-- Owner Portal
-- ═══════════════════════════════════════════════════════════════════════════════
-- Adds an owner-facing portal where property owners can:
--   * sign in with email/password (Supabase Auth) and reset their password,
--   * see only the properties assigned to them,
--   * edit a curated set of property fields (bed sizes, codes, Wi-Fi, other
--     codes, bed count, square footage, address, owner contact info,
--     preferred method of payment),
--   * view scheduled tasks (internal inspections + Trellis/Trello snapshot).
--
-- Owners are NOT rows in app_users (which is staff-only). They are tracked in a
-- new `property_owners` table keyed by the same email as their Supabase Auth
-- user, and linked to properties via `owner_properties`.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Owner-editable property columns ──────────────────────────────────────
-- Most owner-editable fields already exist on `properties` (address,
-- bed_sizes_text, square_footage, number_of_beds, door_code, auto_code,
-- other_codes, wifi_info). These add the missing owner contact + payment fields.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS owner_contact_name      TEXT,
  ADD COLUMN IF NOT EXISTS owner_contact_email     TEXT,
  ADD COLUMN IF NOT EXISTS owner_contact_phone     TEXT,
  ADD COLUMN IF NOT EXISTS preferred_payment_method TEXT;

-- ─── 2. property_owners — portal login identities (separate from staff) ───────
CREATE TABLE IF NOT EXISTS property_owners (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  phone      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Store emails lowercased so lookups by auth email are deterministic.
CREATE OR REPLACE FUNCTION public.property_owners_lower_email()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.email := lower(NEW.email);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_property_owners_lower_email ON property_owners;
CREATE TRIGGER trg_property_owners_lower_email
  BEFORE INSERT OR UPDATE ON property_owners
  FOR EACH ROW EXECUTE FUNCTION public.property_owners_lower_email();

-- ─── 3. owner_properties — which owner is assigned to which property ──────────
CREATE TABLE IF NOT EXISTS owner_properties (
  owner_id    UUID NOT NULL REFERENCES property_owners(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_owner_properties_property ON owner_properties(property_id);
CREATE INDEX IF NOT EXISTS idx_owner_properties_owner    ON owner_properties(owner_id);

-- ─── 4. Identity helpers ─────────────────────────────────────────────────────
-- The current Supabase Auth user's email (lowercased).
CREATE OR REPLACE FUNCTION public.current_auth_email()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth AS $$
  SELECT lower(email) FROM auth.users WHERE id = auth.uid()
$$;

-- True when the current user is a staff member (has an app_users row).
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE google_email = public.current_auth_email()
  )
$$;

-- The property_owners.id for the current user, or NULL if they aren't an owner.
CREATE OR REPLACE FUNCTION public.current_owner_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth AS $$
  SELECT id FROM public.property_owners
  WHERE email = public.current_auth_email()
  LIMIT 1
$$;

-- True when the current owner is assigned the given property.
CREATE OR REPLACE FUNCTION public.owner_owns_property(p_property_id INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.owner_properties op
    WHERE op.property_id = p_property_id
      AND op.owner_id = public.current_owner_id()
  )
$$;

-- ─── 5. RLS: property_owners ─────────────────────────────────────────────────
ALTER TABLE property_owners ENABLE ROW LEVEL SECURITY;

-- Owners may read their own record; staff may read all.
CREATE POLICY "property_owners_select"
  ON property_owners FOR SELECT TO authenticated
  USING (public.is_staff() OR email = public.current_auth_email());

-- Only admins manage owner records.
CREATE POLICY "property_owners_insert_admin"
  ON property_owners FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "property_owners_update_admin"
  ON property_owners FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "property_owners_delete_admin"
  ON property_owners FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- ─── 6. RLS: owner_properties ────────────────────────────────────────────────
ALTER TABLE owner_properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_properties_select"
  ON owner_properties FOR SELECT TO authenticated
  USING (public.is_staff() OR owner_id = public.current_owner_id());

CREATE POLICY "owner_properties_insert_admin"
  ON owner_properties FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "owner_properties_update_admin"
  ON owner_properties FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "owner_properties_delete_admin"
  ON owner_properties FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- ─── 7. Tighten properties RLS so owners only see/edit their own ──────────────
-- The previous policies granted every authenticated user full read/write on all
-- properties. With owners now authenticating, that would leak every property to
-- every owner. Replace with staff-full + owner-scoped policies.
DROP POLICY IF EXISTS "properties_select_authenticated" ON properties;
DROP POLICY IF EXISTS "properties_modify_authenticated" ON properties;

-- Read: staff see everything; owners see only assigned properties.
CREATE POLICY "properties_select_staff_or_owner"
  ON properties FOR SELECT TO authenticated
  USING (public.is_staff() OR public.owner_owns_property(id));

-- Staff retain full write access (insert/update/delete).
CREATE POLICY "properties_insert_staff"
  ON properties FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "properties_update_staff"
  ON properties FOR UPDATE TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());
CREATE POLICY "properties_delete_staff"
  ON properties FOR DELETE TO authenticated
  USING (public.is_staff());

-- Owners may update only their own property rows. Column-level restriction is
-- enforced by the guard trigger below (RLS can't scope to columns).
CREATE POLICY "properties_update_owner"
  ON properties FOR UPDATE TO authenticated
  USING (public.owner_owns_property(id))
  WITH CHECK (public.owner_owns_property(id));

-- ─── 8. Guard: owners may only change a whitelisted set of columns ────────────
-- RLS scopes to rows, not columns. This BEFORE UPDATE trigger enforces that an
-- owner edit can only ever alter the whitelisted fields: it starts from the OLD
-- row and overlays just the allowed columns from NEW. Any change an owner tries
-- to make to a non-whitelisted column is silently dropped (the portal never
-- sends them). Staff updates pass through unchanged, so this is also future
-- proof — a column added later is, for owners, frozen at its OLD value by
-- default rather than silently editable.
CREATE OR REPLACE FUNCTION public.properties_owner_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE
  result public.properties%ROWTYPE;
BEGIN
  -- Staff (and anything not an owner) bypass the guard entirely.
  IF public.is_staff() OR public.current_owner_id() IS NULL THEN
    RETURN NEW;
  END IF;

  result := OLD;
  result.address                  := NEW.address;
  result.bed_sizes_text           := NEW.bed_sizes_text;
  result.number_of_beds           := NEW.number_of_beds;
  result.square_footage           := NEW.square_footage;
  result.door_code                := NEW.door_code;
  result.auto_code                := NEW.auto_code;
  result.other_codes              := NEW.other_codes;
  result.wifi_info                := NEW.wifi_info;
  result.owner_contact_name       := NEW.owner_contact_name;
  result.owner_contact_email      := NEW.owner_contact_email;
  result.owner_contact_phone      := NEW.owner_contact_phone;
  result.preferred_payment_method := NEW.preferred_payment_method;
  result.updated_at               := now();

  RETURN result;
END $$;

DROP TRIGGER IF EXISTS trg_properties_owner_update_guard ON properties;
CREATE TRIGGER trg_properties_owner_update_guard
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION public.properties_owner_update_guard();

-- ─── 9. RPC: scheduled tasks for an owner's property ─────────────────────────
-- Owners can't read trellis_task_snapshot directly (admin-only RLS), so this
-- SECURITY DEFINER function returns a unified task feed (title + date + source)
-- for a single property, but only if the caller is staff or the owning owner.
-- Sources:
--   * 'inspection' — internal inspections (scheduled_for, else inspected_at)
--   * 'trellis'    — Trello/Trellis snapshot, matched by trellis_id or name
DROP FUNCTION IF EXISTS public.get_owner_property_tasks(INTEGER);
CREATE OR REPLACE FUNCTION public.get_owner_property_tasks(p_property_id INTEGER)
RETURNS TABLE (
  source     TEXT,
  title      TEXT,
  task_date  TIMESTAMPTZ,
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
    COALESCE(i.scheduled_for::timestamptz, i.inspected_at::timestamptz) AS task_date,
    i.status::TEXT AS status
  FROM public.inspections i
  WHERE i.property_id = p_property_id
    AND COALESCE(i.scheduled_for::timestamptz, i.inspected_at::timestamptz) IS NOT NULL

  UNION ALL

  -- Trellis / Trello snapshot, matched to this property by trellis_id or name
  SELECT
    'trellis'::TEXT AS source,
    COALESCE(NULLIF(t.title, ''), 'Task')::TEXT AS title,
    t.scheduled_date::timestamptz AS task_date,
    t.status::TEXT AS status
  FROM public.trellis_task_snapshot t
  JOIN public.properties p ON p.id = p_property_id
  WHERE t.scheduled_date IS NOT NULL
    AND (
      -- trellis_property_id is uuid; properties.trellis_id is text — compare as text
      (p.trellis_id IS NOT NULL AND t.trellis_property_id::text = p.trellis_id)
      OR (t.property_name IS NOT NULL AND lower(t.property_name) = lower(p.name))
    )

  ORDER BY task_date DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.get_owner_property_tasks(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_auth_email() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_owner_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_owns_property(INTEGER) TO authenticated;
