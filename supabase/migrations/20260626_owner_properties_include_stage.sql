-- Add the pipeline stage name to get_owner_properties output so the owner
-- portal can surface onboarding status. Additive (non-sensitive); everything
-- else unchanged from the prior definition.
CREATE OR REPLACE FUNCTION public.get_owner_properties()
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
END $function$;
