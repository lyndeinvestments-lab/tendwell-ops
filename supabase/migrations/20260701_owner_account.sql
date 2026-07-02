-- 20260701_owner_account.sql
-- Owner portal account management: owner-wide contact/payment on property_owners,
-- self-service contact RPC, remove the now-owner-wide field-permission keys, and
-- drop the dead per-property owner-contact columns.

-- 1. New owner-level payment column (name, phone, email already exist on property_owners).
ALTER TABLE property_owners
  ADD COLUMN IF NOT EXISTS preferred_payment_method TEXT;

-- 2. Backfill owner-level values from the per-property columns before dropping them.
--    Pick a deterministic non-null value per owner (lowest property id wins).
WITH ranked AS (
  SELECT op.owner_id,
         p.owner_contact_name,
         p.owner_contact_phone,
         p.preferred_payment_method,
         row_number() OVER (PARTITION BY op.owner_id ORDER BY p.id) AS rn
    FROM owner_properties op
    JOIN properties p ON p.id = op.property_id
),
agg AS (
  SELECT owner_id,
         (array_remove(array_agg(owner_contact_name    ORDER BY rn), NULL))[1] AS name,
         (array_remove(array_agg(owner_contact_phone   ORDER BY rn), NULL))[1] AS phone,
         (array_remove(array_agg(preferred_payment_method ORDER BY rn), NULL))[1] AS pay
    FROM ranked
   GROUP BY owner_id
)
UPDATE property_owners po
   SET preferred_payment_method = COALESCE(po.preferred_payment_method, agg.pay),
       name  = CASE WHEN po.name  IS NULL OR po.name  = '' THEN agg.name  ELSE po.name  END,
       phone = CASE WHEN po.phone IS NULL OR po.phone = '' THEN agg.phone ELSE po.phone END
  FROM agg
 WHERE po.id = agg.owner_id;

-- 3. Self-service contact/payment RPC (whitelisted columns, caller-scoped).
CREATE OR REPLACE FUNCTION public.owner_update_self_contact(
  p_name TEXT, p_phone TEXT, p_payment_method TEXT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE oid UUID;
BEGIN
  oid := current_owner_id();
  IF oid IS NULL THEN RAISE EXCEPTION 'Not an active owner'; END IF;
  UPDATE property_owners
     SET name = p_name, phone = p_phone, preferred_payment_method = p_payment_method
   WHERE id = oid;
END $$;

REVOKE ALL ON FUNCTION public.owner_update_self_contact(TEXT, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.owner_update_self_contact(TEXT, TEXT, TEXT) TO authenticated;

-- 4. Trim the field-permission model: drop 'owner_contact' and 'payment_method'.
--    Bodies copied verbatim from 20260623c_owner_field_permissions.sql with
--    only the owner_contact and payment_method keys/branches removed.

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
    "wifi_info":      {"visible": true, "editable": true}
  }'::jsonb
$$;

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

    RETURN NEXT out;
  END LOOP;
END $$;

-- Guard trigger: drop the two fields from the editability overlay.
-- Body copied verbatim from 20260623c_owner_field_permissions.sql with only
-- the owner_contact_* and preferred_payment_method branches removed.
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

  result.updated_at := now();
  RETURN result;
END $$;

-- Re-assert trigger (unchanged from prior migration, but safe to re-drop/create).
DROP TRIGGER IF EXISTS trg_properties_owner_update_guard ON properties;
CREATE TRIGGER trg_properties_owner_update_guard
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION public.properties_owner_update_guard();

-- 5. Drop the now-dead per-property columns (destructive, pre-approved).
ALTER TABLE properties
  DROP COLUMN IF EXISTS owner_contact_name,
  DROP COLUMN IF EXISTS owner_contact_email,
  DROP COLUMN IF EXISTS owner_contact_phone,
  DROP COLUMN IF EXISTS preferred_payment_method;
