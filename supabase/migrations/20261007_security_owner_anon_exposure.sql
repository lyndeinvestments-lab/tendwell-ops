-- Close owner and anonymous access to internal data (2026-10-07 audit).
--
-- Verified live before this migration (anon = the public key shipped in the client bundle):
--   * anon could SELECT operational_properties (290 door codes), pipeline_view (notes, cleaner pay)
--     and property_proforma (profit) for every property. These views are SECURITY DEFINER-style
--     (owned by postgres, no security_invoker), so table RLS never applied.
--   * any signed-in user (owners included) could call add_cleaner_app_user() on their own email and
--     become staff, which passes every is_staff() policy.
--   * owners could read their own properties rows in full (team notes, cleaner_pay, profit) with a
--     direct REST select, bypassing get_owner_properties() masking.
--   * anon could run archive_stale_quotes() (archives every quote) and the reconcile_* snapshot
--     functions; any signed-in user could read/write proforma_months.
--
-- Views are NOT switched to security_invoker: with per-row is_staff() RLS the financial views time
-- out (tested). Instead each view is wrapped in a one-time staff-or-server filter, which Postgres
-- evaluates once per query, so staff performance is unchanged.

-- 1. Gate helper. SECURITY INVOKER on purpose: current_user must be the caller's role
--    (anon / authenticated / service_role / postgres), not the function owner.
create or replace function public.is_staff_or_server()
returns boolean
language sql
stable
set search_path = public
as $$
  select current_user not in ('anon', 'authenticated') or public.is_staff()
$$;
revoke all on function public.is_staff_or_server() from public;
grant execute on function public.is_staff_or_server() to anon, authenticated, service_role;

-- 2. Wrap the internal views. Idempotent: a view that already carries the gate is skipped.
do $$
declare
  v   text;
  def text;
  views text[] := array[
    'financial_breezeway_property_ids',
    'operational_properties', 'pipeline_view', 'property_proforma', 'property_month_financials',
    'v_haven_ops', 'linen_inventory_latest', 'property_breezeway_stats', 'property_clean_stats',
    'property_monthly_cleans', 'breezeway_exceptions', 'breezeway_property_coverage',
    'financial_monthly_cleans', 'financial_task_load', 'trellis_exceptions'
  ];
begin
  foreach v in array views loop
    def := pg_get_viewdef(format('public.%I', v)::regclass);
    if position('is_staff_or_server()' in def) > 0 then
      continue;
    end if;
    def := rtrim(btrim(def), ';');
    execute format(
      'create or replace view public.%I as select * from (%s) _gated where public.is_staff_or_server()',
      v, def);
  end loop;
end $$;

-- No public page reads any view; staff read them signed in, server code uses the service role.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('v', 'm') loop
    execute format('revoke all on public.%I from anon', r.relname);
  end loop;
end $$;

-- 3. add_cleaner_app_user: only admin/operations staff (the Cleaners page roles) may add users.
create or replace function public.add_cleaner_app_user(p_email text, p_name text, p_role text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF coalesce(public.current_user_role(), '') NOT IN ('admin', 'operations') THEN
    RAISE EXCEPTION 'Only admin or operations staff can add team members' USING ERRCODE = '42501';
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

-- 4. Owners no longer read or write properties rows directly. Reads go through
--    get_owner_properties() (masked); writes go through owner_update_property() below, and the
--    existing properties_owner_update_guard trigger still enforces per-field permissions.
drop policy if exists properties_select_staff_or_owner on public.properties;
drop policy if exists properties_select_staff on public.properties;
create policy properties_select_staff on public.properties
  for select to authenticated using ((select public.is_staff()));
drop policy if exists properties_update_owner on public.properties;

create or replace function public.owner_update_property(p_property_id bigint, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  c jsonb := coalesce(p_changes, '{}'::jsonb);
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

-- 5. Cron-only functions: service role only (callers: api/cron/* with SUPABASE_SERVICE_ROLE_KEY).
revoke execute on function public.archive_stale_quotes(integer)        from public, anon, authenticated;
revoke execute on function public.purge_old_laundry_photos(integer)    from public, anon, authenticated;
revoke execute on function public.reconcile_monthly_snapshot(date)     from public, anon, authenticated;
revoke execute on function public.reconcile_recent_snapshots(integer)  from public, anon, authenticated;
revoke execute on function public.mcp_oauth_purge()                    from public, anon, authenticated;
grant  execute on function public.archive_stale_quotes(integer)       to service_role;
grant  execute on function public.purge_old_laundry_photos(integer)   to service_role;
grant  execute on function public.reconcile_monthly_snapshot(date)    to service_role;
grant  execute on function public.reconcile_recent_snapshots(integer) to service_role;
grant  execute on function public.mcp_oauth_purge()                   to service_role;

-- 6. proforma_months: staff only (was any signed-in user, owners included).
drop policy if exists proforma_months_read   on public.proforma_months;
drop policy if exists proforma_months_insert on public.proforma_months;
drop policy if exists proforma_months_update on public.proforma_months;
drop policy if exists proforma_months_delete on public.proforma_months;
create policy proforma_months_read   on public.proforma_months for select to authenticated using ((select public.is_staff()));
create policy proforma_months_insert on public.proforma_months for insert to authenticated with check ((select public.is_staff()));
create policy proforma_months_update on public.proforma_months for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy proforma_months_delete on public.proforma_months for delete to authenticated using ((select public.is_staff()));

-- 7. get_owner_quotes: stop returning estimated_deep_clean_cost (an internal Tendwell cost).
drop function if exists public.get_owner_quotes();
create function public.get_owner_quotes()
returns table(id bigint, name text, ce_charged numeric, deep_clean_3x_ce numeric, linen_program boolean,
              linen_program_cost numeric, bedrooms integer, number_of_beds integer, full_baths integer,
              half_baths integer, quote_sent_at timestamptz, quote_owner_response text, quote_responded_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $function$
BEGIN
  IF public.current_owner_id() IS NULL THEN
    RAISE EXCEPTION 'Not an owner';
  END IF;
  RETURN QUERY
  SELECT p.id, p.name, p.ce_charged, p.deep_clean_3x_ce,
         p.linen_program, p.linen_program_cost, p.bedrooms, p.number_of_beds,
         p.full_baths, p.half_baths, p.quote_sent_at, p.quote_owner_response, p.quote_responded_at
  FROM public.properties p
  JOIN public.pipeline_stages st ON st.id = p.stage_id
  WHERE st.name = 'Quote'
    AND p.quote_sent_at IS NOT NULL
    AND public.owner_owns_property(p.id)
  ORDER BY p.quote_sent_at DESC;
END $function$;
revoke all on function public.get_owner_quotes() from public, anon;
grant execute on function public.get_owner_quotes() to authenticated, service_role;

-- 8. portal_profiles (legacy portal): a user may edit their own profile but not make themselves admin.
drop policy if exists portal_profiles_update on public.portal_profiles;
create policy portal_profiles_update on public.portal_profiles for update
  using ((id = auth.uid()) or public.portal_is_admin())
  with check (public.portal_is_admin() or (id = auth.uid() and role = 'owner'));
