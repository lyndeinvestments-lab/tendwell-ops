-- Follow-ups from the independent review of 20261007_security_owner_anon_exposure.
--
-- 1. CRITICAL (pre-existing): admin_hard_delete_property / admin_restore_property /
--    admin_list_deleted_properties were executable by anon, and their guard
--    `IF public.current_user_role() <> 'admin'` is NULL (so skipped) for anyone without an
--    app_users row. Anyone with the public key could hard-delete a property by id.
-- 2. add_cleaner_app_user: allow anyone holding edit on the `cleaners` view (live supervisor
--    role has it), not just admin/operations.
-- 3. owner_update_property: reject negative / absurd counts and oversized text.

-- 1. NULL-safe admin guard + no anon/public execute.
do $$
declare r record; def text;
begin
  for r in select p.oid from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('admin_hard_delete_property', 'admin_restore_property', 'admin_list_deleted_properties') loop
    def := pg_get_functiondef(r.oid);
    def := replace(def,
      'IF public.current_user_role() <> ''admin'' THEN',
      'IF coalesce(public.current_user_role(), '''') <> ''admin'' THEN');
    execute def;
  end loop;
end $$;
revoke all on function public.admin_hard_delete_property(bigint)  from public, anon;
revoke all on function public.admin_restore_property(bigint)      from public, anon;
revoke all on function public.admin_list_deleted_properties()     from public, anon;
grant execute on function public.admin_hard_delete_property(bigint)  to authenticated, service_role;
grant execute on function public.admin_restore_property(bigint)      to authenticated, service_role;
grant execute on function public.admin_list_deleted_properties()     to authenticated, service_role;

-- 2. add_cleaner_app_user: the Cleaners page's own permission decides.
create or replace function public.add_cleaner_app_user(p_email text, p_name text, p_role text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF NOT (coalesce(public.current_user_role(), '') IN ('admin', 'operations')
          OR coalesce(public.current_user_can_edit('cleaners'), false)) THEN
    RAISE EXCEPTION 'You do not have permission to add team members' USING ERRCODE = '42501';
  END IF;

  IF p_role NOT IN ('cleaning', 'inspector', 'operations', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  INSERT INTO app_users (google_email, role, label)
  VALUES (p_email, p_role, p_name)
  ON CONFLICT (google_email) DO UPDATE
    SET role  = EXCLUDED.role,
        label = EXCLUDED.label
    WHERE app_users.role <> 'admin';
END;
$function$;
revoke all on function public.add_cleaner_app_user(text, text, text) from public, anon;
grant execute on function public.add_cleaner_app_user(text, text, text) to authenticated, service_role;

-- 3. owner_update_property: same column whitelist, plus input bounds.
create or replace function public.owner_update_property(p_property_id bigint, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  c jsonb := coalesce(p_changes, '{}'::jsonb);
  k text;
BEGIN
  IF public.current_owner_id() IS NULL THEN
    RAISE EXCEPTION 'Not an owner' USING ERRCODE = '42501';
  END IF;
  IF public.is_owner_emulating() THEN
    RAISE EXCEPTION 'Owner preview is read-only' USING ERRCODE = '42501';
  END IF;
  IF NOT public.owner_owns_property(p_property_id) THEN
    RAISE EXCEPTION 'Property not found' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(c) <> 'object' THEN
    RAISE EXCEPTION 'Changes must be an object';
  END IF;

  FOREACH k IN ARRAY array['king_beds','queen_beds','full_beds','twin_beds','bedrooms','full_baths','half_baths'] LOOP
    IF c ? k AND jsonb_typeof(c->k) <> 'null' AND ((c->>k)::numeric < 0 OR (c->>k)::numeric > 50) THEN
      RAISE EXCEPTION 'Please enter a number between 0 and 50 for %', replace(k, '_', ' ') USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF c ? 'square_footage' AND jsonb_typeof(c->'square_footage') <> 'null'
     AND ((c->>'square_footage')::numeric < 0 OR (c->>'square_footage')::numeric > 100000) THEN
    RAISE EXCEPTION 'Please enter a square footage between 0 and 100,000' USING ERRCODE = '22023';
  END IF;
  FOREACH k IN ARRAY array['address','door_code','other_codes','wifi_info','check_in_time','check_out_time','filter_size','ical_url'] LOOP
    IF c ? k AND length(coalesce(c->>k, '')) > 2000 THEN
      RAISE EXCEPTION 'That entry is too long' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Only these columns can change. properties_owner_update_guard (BEFORE UPDATE) then keeps
  -- only the ones this owner's permissions allow and writes the owner activity_log rows.
  UPDATE public.properties p SET
    address        = CASE WHEN c ? 'address'        THEN c->>'address'                ELSE p.address END,
    king_beds      = CASE WHEN c ? 'king_beds'      THEN (c->>'king_beds')::int       ELSE p.king_beds END,
    queen_beds     = CASE WHEN c ? 'queen_beds'     THEN (c->>'queen_beds')::int      ELSE p.queen_beds END,
    full_beds      = CASE WHEN c ? 'full_beds'      THEN (c->>'full_beds')::int       ELSE p.full_beds END,
    twin_beds      = CASE WHEN c ? 'twin_beds'      THEN (c->>'twin_beds')::int       ELSE p.twin_beds END,
    square_footage = CASE WHEN c ? 'square_footage' THEN (c->>'square_footage')::numeric ELSE p.square_footage END,
    door_code      = CASE WHEN c ? 'door_code'      THEN c->>'door_code'              ELSE p.door_code END,
    other_codes    = CASE WHEN c ? 'other_codes'    THEN c->>'other_codes'            ELSE p.other_codes END,
    wifi_info      = CASE WHEN c ? 'wifi_info'      THEN c->>'wifi_info'              ELSE p.wifi_info END,
    bedrooms       = CASE WHEN c ? 'bedrooms'       THEN (c->>'bedrooms')::int        ELSE p.bedrooms END,
    full_baths     = CASE WHEN c ? 'full_baths'     THEN (c->>'full_baths')::int      ELSE p.full_baths END,
    half_baths     = CASE WHEN c ? 'half_baths'     THEN (c->>'half_baths')::int      ELSE p.half_baths END,
    hot_tub        = CASE WHEN c ? 'hot_tub'        THEN (c->>'hot_tub')::boolean     ELSE p.hot_tub END,
    pool           = CASE WHEN c ? 'pool'           THEN (c->>'pool')::boolean        ELSE p.pool END,
    check_in_time  = CASE WHEN c ? 'check_in_time'  THEN c->>'check_in_time'          ELSE p.check_in_time END,
    check_out_time = CASE WHEN c ? 'check_out_time' THEN c->>'check_out_time'         ELSE p.check_out_time END,
    filter_size    = CASE WHEN c ? 'filter_size'    THEN c->>'filter_size'            ELSE p.filter_size END,
    ical_url       = CASE WHEN c ? 'ical_url'       THEN c->>'ical_url'               ELSE p.ical_url END
  WHERE p.id = p_property_id;
END;
$function$;
revoke all on function public.owner_update_property(bigint, jsonb) from public, anon;
grant execute on function public.owner_update_property(bigint, jsonb) to authenticated;
