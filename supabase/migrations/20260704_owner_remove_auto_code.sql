-- 20260704_owner_remove_auto_code.sql
-- Drop auto_code from the owner field-permission model.
-- The auto_code COLUMN stays on properties (staff Access tab still uses it).
-- Only owner access (visibility + editability) is removed.
-- Reproduces the three function bodies from 20260702_owner_beds_notes.sql
-- with ONLY the auto_code handling removed. Everything else is identical.

-- a. owner_field_permissions_default: 6 keys (drop auto_code).
CREATE OR REPLACE FUNCTION public.owner_field_permissions_default()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "address":        {"visible": true, "editable": true},
    "bed_sizes":      {"visible": true, "editable": true},
    "square_footage": {"visible": true, "editable": true},
    "door_code":      {"visible": true, "editable": true},
    "other_codes":    {"visible": true, "editable": true},
    "wifi_info":      {"visible": true, "editable": true}
  }'::jsonb
$$;

-- b. get_owner_properties: reproduced verbatim from 20260702_owner_beds_notes.sql
--    with only the auto_code visibility block removed.
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
    out   := out || jsonb_build_object('stage', (SELECT name FROM public.pipeline_stages WHERE id = r.stage_id));

    IF (perms->'address'->>'visible')::boolean THEN
      out := out || jsonb_build_object('address', r.address);
    END IF;
    IF (perms->'bed_sizes'->>'visible')::boolean THEN
      out := out || jsonb_build_object(
        'king_beds',  r.king_beds,
        'queen_beds', r.queen_beds,
        'full_beds',  r.full_beds,
        'twin_beds',  r.twin_beds
      );
    END IF;
    IF (perms->'square_footage'->>'visible')::boolean THEN
      out := out || jsonb_build_object('square_footage', r.square_footage);
    END IF;
    IF (perms->'door_code'->>'visible')::boolean THEN
      out := out || jsonb_build_object('door_code', r.door_code);
    END IF;
    -- auto_code block removed: owners no longer see or receive auto_code.
    IF (perms->'other_codes'->>'visible')::boolean THEN
      out := out || jsonb_build_object('other_codes', r.other_codes);
    END IF;
    IF (perms->'wifi_info'->>'visible')::boolean THEN
      out := out || jsonb_build_object('wifi_info', r.wifi_info);
    END IF;

    RETURN NEXT out;
  END LOOP;
END $$;

-- c. properties_owner_update_guard: reproduced verbatim from 20260702_owner_beds_notes.sql
--    with only the auto_code overlay branch removed.
CREATE OR REPLACE FUNCTION public.properties_owner_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE
  v_owner UUID;
  perms   JSONB;
  result  public.properties%ROWTYPE;
  new_sum INT;
  old_sum INT;
  sleep   INT;
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
    result.king_beds  := NEW.king_beds;
    result.queen_beds := NEW.queen_beds;
    result.full_beds  := NEW.full_beds;
    result.twin_beds  := NEW.twin_beds;
  END IF;
  IF COALESCE((perms->'square_footage'->>'editable')::boolean, true) THEN
    result.square_footage := NEW.square_footage;
  END IF;
  IF COALESCE((perms->'door_code'->>'editable')::boolean, true) THEN
    result.door_code := NEW.door_code;
  END IF;
  -- auto_code overlay removed: owner writes to auto_code are always dropped.
  IF COALESCE((perms->'other_codes'->>'editable')::boolean, true) THEN
    result.other_codes := NEW.other_codes;
  END IF;
  IF COALESCE((perms->'wifi_info'->>'editable')::boolean, true) THEN
    result.wifi_info := NEW.wifi_info;
  END IF;

  -- Derived logic: only when bed columns actually changed.
  IF (result.king_beds  IS DISTINCT FROM OLD.king_beds
   OR result.queen_beds IS DISTINCT FROM OLD.queen_beds
   OR result.full_beds  IS DISTINCT FROM OLD.full_beds
   OR result.twin_beds  IS DISTINCT FROM OLD.twin_beds) THEN

    new_sum := coalesce(result.king_beds,0)::int + coalesce(result.queen_beds,0)::int
             + coalesce(result.full_beds,0)::int  + coalesce(result.twin_beds,0)::int;
    old_sum := coalesce(OLD.king_beds,0)::int + coalesce(OLD.queen_beds,0)::int
             + coalesce(OLD.full_beds,0)::int  + coalesce(OLD.twin_beds,0)::int;

    result.number_of_beds := new_sum;

    IF new_sum > old_sum THEN
      sleep := CASE WHEN coalesce(result.guest_count,0) > 0 THEN result.guest_count::int
                    ELSE coalesce(result.king_beds,0)::int*2 + coalesce(result.queen_beds,0)::int*2
                       + coalesce(result.full_beds,0)::int*2 + coalesce(result.twin_beds,0)::int*1
               END;
      result.hand_towels := sleep;
      result.washcloths  := sleep;
      result.bath_towels := sleep + coalesce(result.full_baths,0)::int;
      result.bathmats    := coalesce(result.full_baths,0)::int;
      result.pool_towels := CASE WHEN coalesce(result.hot_tub, false) THEN sleep ELSE 0 END;
      IF coalesce(result.guest_count,0) = 0 AND sleep > 0 THEN
        result.guest_count := sleep;
      END IF;
    END IF;
  END IF;

  result.updated_at := now();
  RETURN result;
END $$;

-- Re-assert trigger (safe to re-drop/create).
DROP TRIGGER IF EXISTS trg_properties_owner_update_guard ON properties;
CREATE TRIGGER trg_properties_owner_update_guard
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION public.properties_owner_update_guard();
