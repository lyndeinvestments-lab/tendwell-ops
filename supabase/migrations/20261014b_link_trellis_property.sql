-- 20261014b_link_trellis_property.sql
--
-- API Sync → "In Trellis, not in Ops": link a Trellis property to an existing
-- Ops property from the UI (Jordan: "Porchlight Retreat has a name... it's in
-- Trellis not in Ops. There's no way for me to manually change that.").
--
-- link_trellis_property(p_trellis_id, p_property_id, p_alias)
--   * Ops property has no trellis_id  -> sets properties.trellis_id (primary link).
--   * Ops property already linked     -> inserts a property_aliases row
--     (alias = Trellis name, trellis_id, note, created_by) and re-points the
--     EXISTING snapshot rows from the aliased Trellis id to the property's
--     primary trellis_id: trellis_task_snapshot, trellis_reservation_snapshot
--     and (when it exists) trellis_review_snapshot. The
--     trg_trellis_task_canonicalize BEFORE trigger only rewrites rows the sync
--     writes from now on, and trellis_task_snapshot has no UPDATE policy, so
--     existing rows have to be moved here (the same fix done by hand for
--     Porchlight Retreat). trellis_reservation_snapshot has no alias trigger
--     (invoicing maps reservations through property_aliases), so the next
--     sync writes the original id back there.
--   * Every change is audited to activity_log + property_edit_log, attributed
--     to the caller's app_users.label (what logPropertyEdit writes).
--
-- unlink_trellis_alias(p_alias_id)
--   Deletes one property_aliases row (and the vendor_property_aliases mirror
--   row its insert trigger created). Snapshot rows re-pointed earlier are NOT
--   moved back: the original Trellis id is no longer known per row. The next
--   Trellis sync rewrites tasks it still returns with their real id.
--
-- Both are SECURITY DEFINER (properties is finance-gated RLS and the vendor
-- mirror needs the invoicing grant), check current_user_role() = 'admin'
-- themselves, run atomically, and are executable by authenticated only.
--
-- property_aliases RLS: was read/write for every staff login (crews too).
-- Reads stay staff-wide; insert/update/delete are now admin-only. The app
-- creates and removes aliases only through the two RPCs above.

create or replace function public.link_trellis_property(
  p_trellis_id uuid,
  p_property_id bigint,
  p_alias text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor       text;
  v_prop        public.properties%rowtype;
  v_alias       text;
  v_other_name  text;
  v_existing    public.property_aliases%rowtype;
  v_alias_id    uuid;
  v_tasks       int := 0;
  v_res         int := 0;
  v_reviews     int := 0;
  v_review_type text;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only admins can link Trellis properties' using errcode = '42501';
  end if;
  if p_trellis_id is null or p_property_id is null then
    raise exception 'A Trellis property and an Ops property are required' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(u.label), ''), public.current_auth_email(), 'admin')
    into v_actor
    from (select 1) one
    left join public.app_users u on u.google_email = public.current_auth_email();

  select * into v_prop from public.properties where id = p_property_id for update;
  if not found or v_prop.deleted_at is not null then
    raise exception 'Ops property % not found', p_property_id using errcode = 'P0002';
  end if;

  -- Already this property's primary link: nothing to do.
  if v_prop.trellis_id = p_trellis_id::text then
    return jsonb_build_object('mode', 'noop', 'property_id', v_prop.id, 'property_name', v_prop.name);
  end if;

  -- Never take a Trellis record another Ops property already owns.
  select name into v_other_name from public.properties
   where trellis_id = p_trellis_id::text and id <> p_property_id and deleted_at is null
   limit 1;
  if found then
    raise exception 'That Trellis property is already linked to %', v_other_name using errcode = '23505';
  end if;

  select * into v_existing from public.property_aliases where trellis_id = p_trellis_id;
  if found then
    if v_existing.property_id = p_property_id then
      return jsonb_build_object('mode', 'noop', 'property_id', v_prop.id, 'property_name', v_prop.name, 'alias_id', v_existing.id);
    end if;
    select name into v_other_name from public.properties where id = v_existing.property_id;
    raise exception 'That Trellis property is already an alias of %', coalesce(v_other_name, '#' || v_existing.property_id)
      using errcode = '23505';
  end if;

  -- ── Primary link ────────────────────────────────────────────────────────
  if v_prop.trellis_id is null or btrim(v_prop.trellis_id) = '' then
    update public.properties set trellis_id = p_trellis_id::text where id = p_property_id;

    insert into public.activity_log (entity_type, entity_id, entity_name, action, field_name, old_value, new_value, changed_by, metadata)
    values ('property', p_property_id::text, v_prop.name, 'update', 'trellis_id', null, p_trellis_id::text, v_actor,
            jsonb_build_object('source', 'api_sync_link', 'trellis_name', p_alias));
    insert into public.property_edit_log (property_id, field_name, old_value, new_value, changed_by)
    values (p_property_id, 'trellis_id', null, p_trellis_id::text, v_actor);

    return jsonb_build_object('mode', 'primary', 'property_id', v_prop.id, 'property_name', v_prop.name);
  end if;

  -- ── Alias link ──────────────────────────────────────────────────────────
  if v_prop.trellis_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Ops property % has an invalid Trellis id (%); fix it on the mapping table first', v_prop.name, v_prop.trellis_id
      using errcode = '22023';
  end if;

  v_alias := nullif(btrim(coalesce(p_alias, '')), '');
  if v_alias is null then
    select nullif(btrim(name), '') into v_alias from public.trellis_property_snapshot where trellis_id = p_trellis_id limit 1;
  end if;
  if v_alias is null then
    raise exception 'An alias name is required' using errcode = '22023';
  end if;

  -- Alias text is unique (case-insensitive). Reuse a name-only alias that
  -- already points at this property; refuse one that points elsewhere.
  select * into v_existing from public.property_aliases where lower(btrim(alias)) = lower(v_alias);
  if found then
    if v_existing.property_id <> p_property_id then
      select name into v_other_name from public.properties where id = v_existing.property_id;
      raise exception 'The name "%" is already an alias of %', v_alias, coalesce(v_other_name, '#' || v_existing.property_id)
        using errcode = '23505';
    end if;
    if v_existing.trellis_id is not null then
      raise exception 'The name "%" is already linked to another Trellis record', v_alias using errcode = '23505';
    end if;
    update public.property_aliases set trellis_id = p_trellis_id where id = v_existing.id;
    v_alias_id := v_existing.id;
  else
    insert into public.property_aliases (property_id, alias, trellis_id, note, created_by)
    values (p_property_id, v_alias, p_trellis_id, 'Linked from API Sync', v_actor)
    returning id into v_alias_id;
  end if;

  update public.trellis_task_snapshot
     set trellis_property_id = v_prop.trellis_id::uuid
   where trellis_property_id = p_trellis_id;
  get diagnostics v_tasks = row_count;

  update public.trellis_reservation_snapshot
     set trellis_property_id = v_prop.trellis_id
   where trellis_property_id = p_trellis_id::text;
  get diagnostics v_res = row_count;

  -- trellis_review_snapshot arrives with another workstream; re-point it only
  -- when present, casting to whatever type its trellis_property_id has.
  if to_regclass('public.trellis_review_snapshot') is not null then
    select format_type(a.atttypid, a.atttypmod) into v_review_type
      from pg_attribute a
     where a.attrelid = 'public.trellis_review_snapshot'::regclass
       and a.attname = 'trellis_property_id' and not a.attisdropped;
    if v_review_type is not null then
      execute format(
        'update public.trellis_review_snapshot set trellis_property_id = %L::%s where trellis_property_id::text = %L',
        v_prop.trellis_id, v_review_type, p_trellis_id::text);
      get diagnostics v_reviews = row_count;
    end if;
  end if;

  insert into public.activity_log (entity_type, entity_id, entity_name, action, field_name, old_value, new_value, changed_by, metadata)
  values ('property', p_property_id::text, v_prop.name, 'update', 'trellis_alias', null, v_alias, v_actor,
          jsonb_build_object('source', 'api_sync_link', 'alias_id', v_alias_id, 'trellis_id', p_trellis_id,
                             'tasks_repointed', v_tasks, 'reservations_repointed', v_res, 'reviews_repointed', v_reviews));
  insert into public.property_edit_log (property_id, field_name, old_value, new_value, changed_by)
  values (p_property_id, 'trellis_alias', null, v_alias, v_actor);

  return jsonb_build_object('mode', 'alias', 'property_id', v_prop.id, 'property_name', v_prop.name,
                            'alias_id', v_alias_id, 'alias', v_alias,
                            'tasks_repointed', v_tasks, 'reservations_repointed', v_res, 'reviews_repointed', v_reviews);
end
$$;

create or replace function public.unlink_trellis_alias(p_alias_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text;
  v_row   public.property_aliases%rowtype;
  v_name  text;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only admins can remove property aliases' using errcode = '42501';
  end if;

  select coalesce(nullif(btrim(u.label), ''), public.current_auth_email(), 'admin')
    into v_actor
    from (select 1) one
    left join public.app_users u on u.google_email = public.current_auth_email();

  delete from public.property_aliases where id = p_alias_id returning * into v_row;
  if not found then
    raise exception 'Alias not found' using errcode = 'P0002';
  end if;

  -- Drop the vendor-invoice mirror row the insert trigger created for it, so a
  -- removed (wrong) alias stops routing vendor CSV lines too.
  delete from public.vendor_property_aliases
   where vendor_id is null
     and property_id = v_row.property_id
     and lower(btrim(alias_raw)) = lower(btrim(v_row.alias));

  select name into v_name from public.properties where id = v_row.property_id;

  insert into public.activity_log (entity_type, entity_id, entity_name, action, field_name, old_value, new_value, changed_by, metadata)
  values ('property', v_row.property_id::text, v_name, 'update', 'trellis_alias', v_row.alias, null, v_actor,
          jsonb_build_object('source', 'api_sync_unlink', 'alias_id', v_row.id, 'trellis_id', v_row.trellis_id,
                             'note', v_row.note, 'created_by', v_row.created_by));
  insert into public.property_edit_log (property_id, field_name, old_value, new_value, changed_by)
  values (v_row.property_id, 'trellis_alias', v_row.alias, null, v_actor);

  return jsonb_build_object('property_id', v_row.property_id, 'property_name', v_name, 'alias', v_row.alias);
end
$$;

revoke all on function public.link_trellis_property(uuid, bigint, text) from public, anon;
revoke all on function public.unlink_trellis_alias(uuid) from public, anon;
grant execute on function public.link_trellis_property(uuid, bigint, text) to authenticated;
grant execute on function public.unlink_trellis_alias(uuid) to authenticated;

-- ── property_aliases RLS: staff read, admin-only writes ──────────────────────
drop policy if exists property_aliases_all_staff on public.property_aliases;
drop policy if exists property_aliases_select_staff on public.property_aliases;
drop policy if exists property_aliases_insert_admin on public.property_aliases;
drop policy if exists property_aliases_update_admin on public.property_aliases;
drop policy if exists property_aliases_delete_admin on public.property_aliases;

create policy property_aliases_select_staff on public.property_aliases
  for select to authenticated using ((select public.is_staff()));
create policy property_aliases_insert_admin on public.property_aliases
  for insert to authenticated with check ((select public.current_user_role()) = 'admin');
create policy property_aliases_update_admin on public.property_aliases
  for update to authenticated using ((select public.current_user_role()) = 'admin')
  with check ((select public.current_user_role()) = 'admin');
create policy property_aliases_delete_admin on public.property_aliases
  for delete to authenticated using ((select public.current_user_role()) = 'admin');
