-- ═══════════════════════════════════════════════════════════════════════════════
-- Owner Portal — per-owner/property field permissions
-- ═══════════════════════════════════════════════════════════════════════════════
-- Follow-up to 20260623_owner_portal.sql + 20260623b_owner_admin.sql.
--
-- Adds a granular "visible / editable" permission matrix for the owner portal,
-- scoped per (owner, property). Staff/admins configure, for each property an
-- owner is assigned, which portal fields the owner can SEE and which they can
-- EDIT. Defaults (no row) = every field visible + editable, preserving the
-- original portal behavior for newly assigned properties.
--
-- Enforcement is in the database, not just the UI:
--   * EDITABILITY — the BEFORE UPDATE guard trigger (rewritten below) overlays a
--     column from NEW onto the OLD row only when the owner has edit permission
--     for that field. A crafted client update to a non-editable column is
--     silently dropped (frozen at its OLD value).
--   * VISIBILITY  — owners read their properties through the SECURITY DEFINER
--     RPC get_owner_properties(), which omits any field the owner can't see.
--     The portal uses this RPC instead of a direct SELECT on properties, so
--     hidden field values never leave the database.
--
-- Field keys (10) cover every requested field; some map to >1 property column:
--   address        → address
--   bed_sizes      → bed_sizes_text
--   bed_count      → number_of_beds
--   square_footage → square_footage
--   door_code      → door_code
--   auto_code      → auto_code
--   other_codes    → other_codes
--   wifi_info      → wifi_info
--   owner_contact  → owner_contact_name + owner_contact_email + owner_contact_phone
--   payment_method → preferred_payment_method
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. owner_property_permissions — the matrix ──────────────────────────────
-- One row per (owner, property). `permissions` is a JSONB map of
-- field_key → { "visible": bool, "editable": bool }. Missing keys fall back to
-- the all-true default via owner_field_permissions_default() below.
CREATE TABLE IF NOT EXISTS owner_property_permissions (
  owner_id    UUID    NOT NULL REFERENCES property_owners(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id)      ON DELETE CASCADE,
  permissions JSONB   NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_owner_property_permissions_owner
  ON owner_property_permissions(owner_id);

-- ─── 2. Default permissions (single source of truth) ─────────────────────────
-- Every field visible + editable. Newly assigned properties (no row yet) behave
-- exactly like the original portal until staff customize them.
CREATE OR REPLACE FUNCTION public.owner_field_permissions_default()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "address":        {"visible": true, "editable": true},
    "bed_sizes":      {"visible": true, "editable": true},
    "bed_count":      {"visible": true, "editable": true},
    "square_footage": {"visible": true, "editable": true},
    "door_code":      {"visible": true, "editable": true},
    "auto_code":      {"visible": true, "editable": true},
    "other_codes":    {"visible": true, "editable": true},
    "wifi_info":      {"visible": true, "editable": true},
    "owner_contact":  {"visible": true, "editable": true},
    "payment_method": {"visible": true, "editable": true}
  }'::jsonb
$$;

-- Resolved permissions for one (owner, property): defaults overlaid with any
-- stored row. The UI always writes complete per-field objects, so the top-level
-- jsonb concat (`||`) gives correct per-field resolution.
CREATE OR REPLACE FUNCTION public.owner_property_perms(p_owner_id UUID, p_property_id INTEGER)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT public.owner_field_permissions_default() || COALESCE(
    (SELECT permissions FROM public.owner_property_permissions
       WHERE owner_id = p_owner_id AND property_id = p_property_id),
    '{}'::jsonb)
$$;

-- ─── 3. RLS: owner_property_permissions ──────────────────────────────────────
ALTER TABLE owner_property_permissions ENABLE ROW LEVEL SECURITY;

-- Staff read all; an owner may read their own rows (harmless — the RPC is the
-- real enforcement path, but this keeps direct reads consistent).
CREATE POLICY "owner_property_permissions_select"
  ON owner_property_permissions FOR SELECT TO authenticated
  USING (public.is_staff() OR owner_id = public.current_owner_id());

-- Only admins configure the matrix.
CREATE POLICY "owner_property_permissions_insert_admin"
  ON owner_property_permissions FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "owner_property_permissions_update_admin"
  ON owner_property_permissions FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "owner_property_permissions_delete_admin"
  ON owner_property_permissions FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- ─── 4. Guard: enforce per-field EDITABILITY for owner updates ────────────────
-- Replaces the whitelist guard from 20260623_owner_portal.sql. Same principle
-- (start from OLD, overlay only allowed columns) but now each owner-editable
-- column is overlaid only when the owner has edit permission for that field on
-- this specific property. Staff updates bypass entirely.
CREATE OR REPLACE FUNCTION public.properties_owner_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE
  v_owner UUID;
  perms   JSONB;
  result  public.properties%ROWTYPE;
BEGIN
  -- Staff (and anything not an owner) bypass the guard entirely.
  IF public.is_staff() THEN
    RETURN NEW;
  END IF;
  v_owner := public.current_owner_id();
  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  perms  := public.owner_property_perms(v_owner, OLD.id);
  result := OLD;

  IF COALESCE((perms->'address'->>'editable')::boolean, true) THEN
    result.address := NEW.address;
  END IF;
  IF COALESCE((perms->'bed_sizes'->>'editable')::boolean, true) THEN
    result.bed_sizes_text := NEW.bed_sizes_text;
  END IF;
  IF COALESCE((perms->'bed_count'->>'editable')::boolean, true) THEN
    result.number_of_beds := NEW.number_of_beds;
  END IF;
  IF COALESCE((perms->'square_footage'->>'editable')::boolean, true) THEN
    result.square_footage := NEW.square_footage;
  END IF;
  IF COALESCE((perms->'door_code'->>'editable')::boolean, true) THEN
    result.door_code := NEW.door_code;
  END IF;
  IF COALESCE((perms->'auto_code'->>'editable')::boolean, true) THEN
    result.auto_code := NEW.auto_code;
  END IF;
  IF COALESCE((perms->'other_codes'->>'editable')::boolean, true) THEN
    result.other_codes := NEW.other_codes;
  END IF;
  IF COALESCE((perms->'wifi_info'->>'editable')::boolean, true) THEN
    result.wifi_info := NEW.wifi_info;
  END IF;
  IF COALESCE((perms->'owner_contact'->>'editable')::boolean, true) THEN
    result.owner_contact_name  := NEW.owner_contact_name;
    result.owner_contact_email := NEW.owner_contact_email;
    result.owner_contact_phone := NEW.owner_contact_phone;
  END IF;
  IF COALESCE((perms->'payment_method'->>'editable')::boolean, true) THEN
    result.preferred_payment_method := NEW.preferred_payment_method;
  END IF;

  result.updated_at := now();
  RETURN result;
END $$;

-- Trigger itself is unchanged from the prior migration, but re-assert to be safe.
DROP TRIGGER IF EXISTS trg_properties_owner_update_guard ON properties;
CREATE TRIGGER trg_properties_owner_update_guard
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION public.properties_owner_update_guard();

-- ─── 5. RPC: visibility-filtered property payload for the portal ──────────────
-- Owners read their properties through this SECURITY DEFINER function so that
-- non-visible field values never leave the database (a direct SELECT on
-- properties would expose every column under RLS). Each row is a JSONB object
-- with id, name, the visible fields, and the resolved `permissions` map so the
-- portal can render read-only vs editable inputs.
CREATE OR REPLACE FUNCTION public.get_owner_properties()
RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_owner UUID := public.current_owner_id();
  r       RECORD;
  perms   JSONB;
  out     JSONB;
BEGIN
  IF v_owner IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT p.*
    FROM public.properties p
    JOIN public.owner_properties op
      ON op.property_id = p.id AND op.owner_id = v_owner
    ORDER BY p.name
  LOOP
    perms := public.owner_property_perms(v_owner, r.id);
    out   := jsonb_build_object('id', r.id, 'name', r.name, 'permissions', perms);

    IF (perms->'address'->>'visible')::boolean THEN
      out := out || jsonb_build_object('address', r.address);
    END IF;
    IF (perms->'bed_sizes'->>'visible')::boolean THEN
      out := out || jsonb_build_object('bed_sizes_text', r.bed_sizes_text);
    END IF;
    IF (perms->'bed_count'->>'visible')::boolean THEN
      out := out || jsonb_build_object('number_of_beds', r.number_of_beds);
    END IF;
    IF (perms->'square_footage'->>'visible')::boolean THEN
      out := out || jsonb_build_object('square_footage', r.square_footage);
    END IF;
    IF (perms->'door_code'->>'visible')::boolean THEN
      out := out || jsonb_build_object('door_code', r.door_code);
    END IF;
    IF (perms->'auto_code'->>'visible')::boolean THEN
      out := out || jsonb_build_object('auto_code', r.auto_code);
    END IF;
    IF (perms->'other_codes'->>'visible')::boolean THEN
      out := out || jsonb_build_object('other_codes', r.other_codes);
    END IF;
    IF (perms->'wifi_info'->>'visible')::boolean THEN
      out := out || jsonb_build_object('wifi_info', r.wifi_info);
    END IF;
    IF (perms->'owner_contact'->>'visible')::boolean THEN
      out := out || jsonb_build_object(
        'owner_contact_name',  r.owner_contact_name,
        'owner_contact_email', r.owner_contact_email,
        'owner_contact_phone', r.owner_contact_phone);
    END IF;
    IF (perms->'payment_method'->>'visible')::boolean THEN
      out := out || jsonb_build_object('preferred_payment_method', r.preferred_payment_method);
    END IF;

    RETURN NEXT out;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.owner_field_permissions_default()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_property_perms(UUID, INTEGER)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_owner_properties()                      TO authenticated;
