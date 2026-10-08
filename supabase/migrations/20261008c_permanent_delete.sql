-- Permanent delete for clients, properties and quotes (a quote is a Lead/Quote-stage
-- property), so duplicates can be removed immediately instead of sitting archived.
--
-- Jordan's rules (2026-10-08):
--   * Admin only. The caller must type the record's name; the server re-checks it.
--   * Records with real history may be deleted after a warning that lists what goes
--     with them. Records with INVOICE LINES are always blocked: invoice_lines has a
--     NO ACTION FK and deleting billing history would break invoicing. Archive those.
--   * Deleting a client unlinks its properties (properties.contact_id ON DELETE SET NULL);
--     the properties themselves stay.
--   * Every permanent delete writes the full row plus its impact counts to activity_log,
--     so a mistaken delete can be reconstructed by hand.
--
-- Also fixes a pre-existing hazard in admin_hard_delete_property and
-- purge_deleted_properties: both deleted unlinked tasks matched by property NAME.
-- Duplicates share a name, so removing a duplicate also wiped the surviving
-- property's name-matched tasks. Name-matched tasks are now only removed when no
-- other property carries that name.

-- ---------------------------------------------------------------------------
-- Impact previews
-- ---------------------------------------------------------------------------

create or replace function public.admin_property_delete_impact(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_name   text;
  v_stage  text;
  v_shared boolean;
  v_erased jsonb := '{}'::jsonb;
  v_kept   jsonb := '{}'::jsonb;
  v_n      bigint;
  t        text;
begin
  if coalesce(public.current_user_role(), '') <> 'admin' then
    raise exception 'Only admins can permanently delete properties';
  end if;

  select p.name, s.name into v_name, v_stage
    from properties p left join pipeline_stages s on s.id = p.stage_id
   where p.id = p_id;
  if not found then
    return null;
  end if;

  -- Child rows removed with the property (ON DELETE CASCADE).
  foreach t in array array[
    'cleaning_history', 'cleaning_logs', 'inspections', 'clean_assignments',
    'onboarding_tasks', 'property_notes', 'property_photos', 'property_supplies',
    'property_verifications', 'owner_properties', 'owner_property_permissions',
    'property_aliases', 'vendor_property_aliases', 'stage_transitions', 'property_edit_log'
  ] loop
    execute format('select count(*) from %I where property_id = $1', t) into v_n using p_id;
    if v_n > 0 then v_erased := v_erased || jsonb_build_object(t, v_n); end if;
  end loop;

  select count(*) into v_n from tasks where property_id = p_id or verification_property_id = p_id;
  v_shared := exists (select 1 from properties where name = v_name and id <> p_id);
  if not v_shared then
    v_n := v_n + (select count(*) from tasks where property_id is null and property_name = v_name);
  end if;
  if v_n > 0 then v_erased := v_erased || jsonb_build_object('tasks', v_n); end if;

  -- Rows that survive but lose their link (ON DELETE SET NULL).
  foreach t in array array[
    'breezeway_tasks', 'cleaning_issues', 'damaged_linens', 'onboarding_submissions',
    'task_audit_observations'
  ] loop
    execute format('select count(*) from %I where property_id = $1', t) into v_n using p_id;
    if v_n > 0 then v_kept := v_kept || jsonb_build_object(t, v_n); end if;
  end loop;

  select count(*) into v_n from invoice_lines where property_id = p_id;

  return jsonb_build_object(
    'kind', 'property',
    'id', p_id,
    'name', v_name,
    'stage', v_stage,
    'erased', v_erased,
    'unlinked', v_kept,
    'name_shared_with_other_property', v_shared,
    'blocked_by_invoices', v_n
  );
end;
$function$;

create or replace function public.admin_contact_delete_impact(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_name   text;
  v_erased jsonb := '{}'::jsonb;
  v_kept   jsonb := '{}'::jsonb;
  v_props  jsonb;
  v_n      bigint;
  t        text;
begin
  if coalesce(public.current_user_role(), '') <> 'admin' then
    raise exception 'Only admins can permanently delete clients';
  end if;

  select coalesce(nullif(trim(full_name), ''), nullif(trim(company), ''), email)
    into v_name from contacts where id = p_id;
  if not found then
    return null;
  end if;

  foreach t in array array[
    'contact_notes', 'contact_interactions', 'client_stage_transitions', 'client_fee_overrides'
  ] loop
    execute format('select count(*) from %I where contact_id = $1', t) into v_n using p_id;
    if v_n > 0 then v_erased := v_erased || jsonb_build_object(t, v_n); end if;
  end loop;

  foreach t in array array['property_owners', 'website_leads'] loop
    execute format('select count(*) from %I where contact_id = $1', t) into v_n using p_id;
    if v_n > 0 then v_kept := v_kept || jsonb_build_object(t, v_n); end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'stage', s.name) order by p.name), '[]'::jsonb)
    into v_props
    from properties p left join pipeline_stages s on s.id = p.stage_id
   where p.contact_id = p_id;

  return jsonb_build_object(
    'kind', 'contact',
    'id', p_id,
    'name', v_name,
    'erased', v_erased,
    'unlinked', v_kept,
    'linked_properties', v_props,
    'blocked_by_invoices', 0
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Deletes
-- ---------------------------------------------------------------------------

create or replace function public.admin_delete_property_permanently(p_id bigint, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_row    properties%rowtype;
  v_impact jsonb;
  v_by     text;
begin
  if coalesce(public.current_user_role(), '') <> 'admin' then
    raise exception 'Only admins can permanently delete properties';
  end if;

  select * into v_row from properties where id = p_id for update;
  if not found then
    raise exception 'Property % no longer exists', p_id;
  end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(v_row.name)) then
    raise exception 'Confirmation name does not match "%"', v_row.name;
  end if;

  v_impact := public.admin_property_delete_impact(p_id);
  if (v_impact->>'blocked_by_invoices')::bigint > 0 then
    raise exception '"%" has % invoice line(s). Invoiced properties cannot be deleted; archive it instead.',
      v_row.name, v_impact->>'blocked_by_invoices';
  end if;

  select label into v_by from app_users
   where google_email = (select email from auth.users where id = auth.uid()) limit 1;

  insert into activity_log (entity_type, entity_id, entity_name, action, field_name, changed_by, metadata)
  values ('property', p_id::text, v_row.name, 'delete', 'permanent_delete', v_by,
          jsonb_build_object('snapshot', to_jsonb(v_row), 'impact', v_impact));

  delete from tasks where property_id = p_id or verification_property_id = p_id;
  if not (v_impact->>'name_shared_with_other_property')::boolean then
    delete from tasks where property_id is null and property_name = v_row.name;
  end if;
  delete from trellis_reconciliation_dismissals where ops_property_id = p_id;
  delete from properties where id = p_id;

  return v_impact;
end;
$function$;

create or replace function public.admin_delete_contact_permanently(p_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_row    contacts%rowtype;
  v_name   text;
  v_impact jsonb;
  v_by     text;
begin
  if coalesce(public.current_user_role(), '') <> 'admin' then
    raise exception 'Only admins can permanently delete clients';
  end if;

  select * into v_row from contacts where id = p_id for update;
  if not found then
    raise exception 'Client % no longer exists', p_id;
  end if;
  v_name := coalesce(nullif(trim(v_row.full_name), ''), nullif(trim(v_row.company), ''), v_row.email);
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(coalesce(v_name, ''))) then
    raise exception 'Confirmation name does not match "%"', v_name;
  end if;

  v_impact := public.admin_contact_delete_impact(p_id);

  select label into v_by from app_users
   where google_email = (select email from auth.users where id = auth.uid()) limit 1;

  insert into activity_log (entity_type, entity_id, entity_name, action, field_name, changed_by, metadata)
  values ('contact', p_id::text, v_name, 'delete', 'permanent_delete', v_by,
          jsonb_build_object('snapshot', to_jsonb(v_row), 'impact', v_impact));

  delete from contacts where id = p_id;

  return v_impact;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Pre-existing name-match hazard
-- ---------------------------------------------------------------------------

create or replace function public.admin_hard_delete_property(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
DECLARE
  v_name text;
BEGIN
  IF coalesce(public.current_user_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can hard-delete properties';
  END IF;

  SELECT name INTO v_name FROM properties WHERE id = p_id;
  IF v_name IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM tasks WHERE property_id = p_id;
  -- Unlinked tasks matched by name belong to this property only if no other
  -- property shares the name (a duplicate always does).
  IF NOT EXISTS (SELECT 1 FROM properties WHERE name = v_name AND id <> p_id) THEN
    DELETE FROM tasks WHERE property_id IS NULL AND property_name = v_name;
  END IF;

  DELETE FROM properties WHERE id = p_id;
END;
$function$;

create or replace function public.purge_deleted_properties(retention_days integer default 30)
returns table(purged_id bigint, purged_name text)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
DECLARE
  v_cutoff timestamptz := now() - make_interval(days => retention_days);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the service role may purge properties';
  END IF;

  RETURN QUERY
  WITH doomed AS (
    SELECT id, name FROM properties
    WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff
  ),
  -- Names still carried by a property that is NOT being purged keep their tasks.
  doomed_names AS (
    SELECT d.name FROM doomed d
    WHERE NOT EXISTS (
      SELECT 1 FROM properties p WHERE p.name = d.name AND p.id NOT IN (SELECT id FROM doomed)
    )
  ),
  del_tasks AS (
    DELETE FROM tasks
    WHERE property_id IN (SELECT id FROM doomed)
       OR (property_id IS NULL AND property_name IN (SELECT name FROM doomed_names))
    RETURNING 1
  ),
  del_props AS (
    DELETE FROM properties WHERE id IN (SELECT id FROM doomed)
    RETURNING id, name
  )
  SELECT id AS purged_id, name AS purged_name FROM del_props;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Grants: never anon/public (see 20261007b_security_followups).
-- ---------------------------------------------------------------------------

revoke all on function public.admin_property_delete_impact(bigint)              from public, anon;
revoke all on function public.admin_contact_delete_impact(uuid)                 from public, anon;
revoke all on function public.admin_delete_property_permanently(bigint, text)   from public, anon;
revoke all on function public.admin_delete_contact_permanently(uuid, text)      from public, anon;
revoke all on function public.admin_hard_delete_property(bigint)                from public, anon;
revoke all on function public.purge_deleted_properties(integer)                 from public, anon, authenticated;

grant execute on function public.admin_property_delete_impact(bigint)            to authenticated, service_role;
grant execute on function public.admin_contact_delete_impact(uuid)               to authenticated, service_role;
grant execute on function public.admin_delete_property_permanently(bigint, text) to authenticated, service_role;
grant execute on function public.admin_delete_contact_permanently(uuid, text)    to authenticated, service_role;
grant execute on function public.admin_hard_delete_property(bigint)              to authenticated, service_role;
grant execute on function public.purge_deleted_properties(integer)               to service_role;
