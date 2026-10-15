-- WS3 (Trellis API expansion): Cleaners + Cleaner Metrics on Trellis.
--
-- 1. Cleaner pay is finance-only in the DATABASE, not just the UI.
--    `cleaners.pay_rate` was readable (and writable) by every staff login,
--    including the crew roles (inspector, supervisor) that hold the Cleaners
--    view. Finance staff read pay through `cleaner_pay_rates()` and write it
--    through `cleaner_set_pay_rate()`. The column privileges that hide
--    pay_rate from every other login are in 20261014e2, applied only after
--    the client that stops selecting `*` from cleaners is deployed.
--
-- 2. Status / Trellis-link / source columns change only through definer RPCs
--    so `offboarded_by` is always the real staff member's name (the sync only
--    reactivates cleaners it offboarded itself, keyed on offboarded_by =
--    'trellis-sync') and roster links are admin-only (the roster is admin-read).
--
-- 3. Admin RPC to create a cleaner from an unlinked Trellis roster member
--    (source = 'trellis', so cleaner_grant_app_access never gives it a login).
--
-- Every function: SECURITY DEFINER, explicit role check, search_path pinned,
-- no anon/public execute. Applied live 2026-10-14 via Supabase MCP.

-- ── Pay rate read / write (finance only) ────────────────────────────────────
create or replace function public.cleaner_pay_rates()
returns table (cleaner_id uuid, pay_rate numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- staff_has_financial_view() resolves the CALLER by JWT email. Do not use
  -- can_view_financials() here: inside a definer function current_user is the
  -- owner, which that helper treats as the server and always lets through.
  select c.id, c.pay_rate
  from public.cleaners c
  where public.staff_has_financial_view()
$$;

create or replace function public.cleaner_set_pay_rate(p_cleaner_id uuid, p_pay_rate numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
  v_name text;
  v_old numeric;
begin
  if not (public.staff_has_financial_view() and coalesce(public.current_user_can_edit('cleaners'), false)) then
    raise exception 'You do not have permission to set cleaner pay' using errcode = '42501';
  end if;
  if p_pay_rate is not null and (p_pay_rate < 0 or p_pay_rate > 10000) then
    raise exception 'Pay rate must be between 0 and 10000' using errcode = '22023';
  end if;
  select full_name, pay_rate into v_name, v_old from public.cleaners where id = p_cleaner_id for update;
  if not found then
    raise exception 'Cleaner not found' using errcode = 'P0002';
  end if;
  if v_old is not distinct from p_pay_rate then
    return;
  end if;
  update public.cleaners set pay_rate = p_pay_rate where id = p_cleaner_id;
  select label into v_label from public.app_users where google_email = public.current_auth_email() limit 1;
  insert into public.activity_log (entity_type, entity_id, entity_name, action, field_name, old_value, new_value, changed_by)
  values ('cleaner', p_cleaner_id::text, v_name, 'update', 'pay_rate', v_old::text, p_pay_rate::text, v_label);
end
$$;

-- ── 2. Offboard / reactivate ────────────────────────────────────────────────
create or replace function public.cleaner_set_status(p_cleaner_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
  v_actor text;
  v_name text;
  v_old text;
begin
  if not coalesce(public.current_user_can_edit('cleaners'), false) then
    raise exception 'You do not have permission to change cleaners' using errcode = '42501';
  end if;
  if p_status not in ('active', 'offboarded') then
    raise exception 'Invalid status: %', p_status using errcode = '22023';
  end if;
  select status, full_name into v_old, v_name from public.cleaners where id = p_cleaner_id for update;
  if not found then
    raise exception 'Cleaner not found' using errcode = 'P0002';
  end if;
  if v_old = p_status then
    return;
  end if;
  select label into v_label from public.app_users where google_email = public.current_auth_email() limit 1;
  v_actor := coalesce(nullif(trim(v_label), ''), public.current_auth_email(), 'staff');
  -- 'trellis-sync' is reserved: the sync reactivates only rows it offboarded.
  if lower(v_actor) = 'trellis-sync' then
    v_actor := coalesce(public.current_auth_email(), 'staff');
  end if;
  if p_status = 'offboarded' then
    update public.cleaners
       set status = 'offboarded', offboarded_at = now(), offboarded_by = v_actor
     where id = p_cleaner_id;
  else
    -- cleaners_status_consistency clears offboarded_at / offboarded_by.
    update public.cleaners set status = 'active' where id = p_cleaner_id;
  end if;
  insert into public.activity_log (entity_type, entity_id, entity_name, action, field_name, old_value, new_value, changed_by)
  values ('cleaner', p_cleaner_id::text, v_name, 'update', 'status', v_old, p_status, v_actor);
end
$$;

-- ── Link / unlink a cleaner to a Trellis roster member (admin) ──────────────
create or replace function public.cleaner_link_trellis(p_cleaner_id uuid, p_trellis_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
  v_name text;
  v_old uuid;
  v_other text;
  v_member text;
begin
  if coalesce(public.current_user_role(), '') <> 'admin' then
    raise exception 'Only admins can link cleaners to Trellis' using errcode = '42501';
  end if;
  select full_name, trellis_user_id into v_name, v_old from public.cleaners where id = p_cleaner_id for update;
  if not found then
    raise exception 'Cleaner not found' using errcode = 'P0002';
  end if;
  if p_trellis_user_id is not null then
    if p_trellis_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
      raise exception 'The Trellis AI agent cannot be linked to a cleaner' using errcode = '22023';
    end if;
    select name into v_member from public.trellis_roster
     where user_id = p_trellis_user_id and workspace = 'A' limit 1;
    if not found then
      raise exception 'That person is not on the Tendwell Trellis roster' using errcode = 'P0002';
    end if;
    select full_name into v_other from public.cleaners
     where trellis_user_id = p_trellis_user_id and id <> p_cleaner_id limit 1;
    if v_other is not null then
      raise exception 'That Trellis member is already linked to %', v_other using errcode = '23505';
    end if;
  end if;
  if v_old is not distinct from p_trellis_user_id then
    return;
  end if;
  update public.cleaners set trellis_user_id = p_trellis_user_id where id = p_cleaner_id;
  select label into v_label from public.app_users where google_email = public.current_auth_email() limit 1;
  insert into public.activity_log (entity_type, entity_id, entity_name, action, field_name, old_value, new_value, changed_by)
  values ('cleaner', p_cleaner_id::text, v_name, 'update', 'trellis_user_id',
          v_old::text,
          case when p_trellis_user_id is null then null else coalesce(v_member, '') || ' (' || p_trellis_user_id::text || ')' end,
          v_label);
end
$$;

-- ── 3. Create a cleaner from an unlinked roster member (admin) ──────────────
create or replace function public.cleaner_create_from_roster(p_trellis_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
  m record;
  v_email text;
  v_id uuid;
  v_other text;
begin
  if coalesce(public.current_user_role(), '') <> 'admin' then
    raise exception 'Only admins can create cleaners from the Trellis roster' using errcode = '42501';
  end if;
  select user_id, name, email into m from public.trellis_roster
   where user_id = p_trellis_user_id and workspace = 'A' limit 1;
  if not found then
    raise exception 'That person is not on the Tendwell Trellis roster' using errcode = 'P0002';
  end if;
  -- Same hard exclusions as rosterExclusionReason() in shared/trellis-sync-rules.ts.
  if m.user_id = '00000000-0000-0000-0000-000000000000'::uuid
     or coalesce(trim(m.name), '') = ''
     or lower(trim(m.name)) in ('ai agent', 'tendwell cleaning co.')
     or lower(coalesce(m.email, '')) ~ '(\.test$|@trellistech\.com$)' then
    raise exception 'This roster account cannot become a cleaner' using errcode = '22023';
  end if;
  select full_name into v_other from public.cleaners where trellis_user_id = p_trellis_user_id limit 1;
  if v_other is not null then
    raise exception 'Already linked to %', v_other using errcode = '23505';
  end if;
  v_email := nullif(lower(trim(coalesce(m.email, ''))), '');
  if v_email is not null and position('@' in v_email) = 0 then
    v_email := null;
  end if;
  if v_email is not null then
    select full_name into v_other from public.cleaners
     where lower(email) = v_email or lower(coalesce(alt_email, '')) = v_email limit 1;
    if v_other is not null then
      raise exception 'A cleaner with this email already exists: %. Link that cleaner instead.', v_other using errcode = '23505';
    end if;
  end if;
  insert into public.cleaners (full_name, email, trellis_user_id, source, status)
  values (trim(m.name), v_email, p_trellis_user_id, 'trellis', 'active')
  returning id into v_id;
  select label into v_label from public.app_users where google_email = public.current_auth_email() limit 1;
  insert into public.activity_log (entity_type, entity_id, entity_name, action, field_name, new_value, changed_by)
  values ('cleaner', v_id::text, trim(m.name), 'create', 'source', 'trellis (' || p_trellis_user_id::text || ')', v_label);
  return v_id;
end
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.cleaner_pay_rates() from public, anon;
revoke all on function public.cleaner_set_pay_rate(uuid, numeric) from public, anon;
revoke all on function public.cleaner_set_status(uuid, text) from public, anon;
revoke all on function public.cleaner_link_trellis(uuid, uuid) from public, anon;
revoke all on function public.cleaner_create_from_roster(uuid) from public, anon;
grant execute on function public.cleaner_pay_rates() to authenticated, service_role;
grant execute on function public.cleaner_set_pay_rate(uuid, numeric) to authenticated, service_role;
grant execute on function public.cleaner_set_status(uuid, text) to authenticated, service_role;
grant execute on function public.cleaner_link_trellis(uuid, uuid) to authenticated, service_role;
grant execute on function public.cleaner_create_from_roster(uuid) to authenticated, service_role;
