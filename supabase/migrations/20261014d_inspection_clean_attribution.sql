-- 20261014d — Trellis API expansion WS1: inspections rate the previous clean.
--
-- inspections gains
--   trellis_task_id      the Trellis inspection task this Ops inspection rates (nullable, unique)
--   rated_clean_task_id  the Trellis clean being rated
--   cleaner_auto_filled  true only when the trigger filled cleaner_id
--
-- inspections_attribute_clean (BEFORE INSERT/UPDATE, SECURITY DEFINER; sorts
-- before inspections_snapshot_cleaner_name so the snapshot sees the filled
-- cleaner): while rated_clean_task_id is null, on INSERT or when
-- property_id / inspected_at / scheduled_for change, find the last completed
-- clean BY ANYONE at the property within 14 days on/before
-- coalesce(inspected_at, scheduled_for); fill rated_clean_task_id,
-- last_cleaned_on (if null) and cleaner_id (only if null AND the clean is
-- Tendwell's AND its assignee is a linked cleaner). Never overwrites a
-- cleaner someone chose; once rated_clean_task_id is set it never re-runs,
-- so a cleaner a user cleared is not re-filled.
--
-- backfill_inspection_attribution(since, limit): same rule over existing
-- rows that have no rated clean yet (service role; also called by the aux
-- cron for recent inspections logged before their clean was synced).
--
-- trellis_inspection_tasks: Trellis inspection tasks with Ops property, the
-- previous clean, and the Ops inspection that rated it (if any).

alter table public.inspections
  add column if not exists trellis_task_id uuid,
  add column if not exists rated_clean_task_id uuid,
  add column if not exists cleaner_auto_filled boolean not null default false;

create unique index if not exists inspections_trellis_task_id_key
  on public.inspections (trellis_task_id) where trellis_task_id is not null;
create index if not exists inspections_rated_clean_task_idx
  on public.inspections (rated_clean_task_id) where rated_clean_task_id is not null;

comment on column public.inspections.trellis_task_id is 'Trellis inspection task this Ops inspection rates (from the Inspections "From Trellis" panel). Unique.';
comment on column public.inspections.rated_clean_task_id is 'Trellis clean (trellis_task_snapshot.trellis_task_id) this inspection rates; filled by inspections_attribute_clean.';
comment on column public.inspections.cleaner_auto_filled is 'True when inspections_attribute_clean filled cleaner_id from the Trellis clean; false when chosen by a person.';

-- The rated clean for a property + date. TS mirror: pickRatedClean().
create or replace function public.inspection_clean_match(p_property_id bigint, p_anchor date)
returns table (trellis_task_id uuid, clean_date date, is_tendwell boolean, cleaner_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ids as (
    select p.trellis_id::uuid as id
      from public.properties p
     where p.id = p_property_id
       and p.trellis_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union
    select a.trellis_id from public.property_aliases a
     where a.property_id = p_property_id and a.trellis_id is not null
  ), clean as (
    select t.trellis_task_id, t.scheduled_date, coalesce(t.is_tendwell, false) as is_tendwell, t.assigned_to_id, t.assignees
      from public.trellis_task_snapshot t
     where t.trellis_property_id in (select id from ids)
       and t.status = 'COMPLETED'
       and t.clean_kind is not null
       and t.scheduled_date <= p_anchor
       and t.scheduled_date >= p_anchor - 14
     order by t.scheduled_date desc, t.completed_at desc nulls last
     limit 1
  )
  select c.trellis_task_id, c.scheduled_date, c.is_tendwell,
         case when c.is_tendwell then (
           select cl.id from public.cleaners cl
            where cl.trellis_user_id is not null
              and (cl.trellis_user_id = c.assigned_to_id
                   or cl.trellis_user_id::text in (
                        select e->>'assignee_id'
                          from jsonb_array_elements(case when jsonb_typeof(c.assignees) = 'array' then c.assignees else '[]'::jsonb end) e))
            order by (cl.trellis_user_id = c.assigned_to_id) desc, cl.full_name
            limit 1) end
    from clean c
$$;

revoke all on function public.inspection_clean_match(bigint, date) from public, anon, authenticated;
grant execute on function public.inspection_clean_match(bigint, date) to service_role;

create or replace function public.inspections_attribute_clean()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m record;
  v_anchor date;
begin
  -- A person changing the cleaner makes it theirs.
  if tg_op = 'UPDATE'
     and new.cleaner_id is distinct from old.cleaner_id
     and new.cleaner_auto_filled is not distinct from old.cleaner_auto_filled then
    new.cleaner_auto_filled := false;
  end if;

  if new.rated_clean_task_id is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.property_id is not distinct from old.property_id
     and new.inspected_at is not distinct from old.inspected_at
     and new.scheduled_for is not distinct from old.scheduled_for then
    return new;
  end if;

  v_anchor := coalesce(new.inspected_at, new.scheduled_for);
  if new.property_id is null or v_anchor is null then
    return new;
  end if;

  select * into m from public.inspection_clean_match(new.property_id, v_anchor);
  if m.trellis_task_id is null then
    return new;
  end if;

  new.rated_clean_task_id := m.trellis_task_id;
  new.last_cleaned_on := coalesce(new.last_cleaned_on, m.clean_date);
  if new.cleaner_id is null and m.is_tendwell and m.cleaner_id is not null then
    new.cleaner_id := m.cleaner_id;
    new.cleaner_auto_filled := true;
  end if;
  return new;
end
$$;

drop trigger if exists inspections_attribute_clean on public.inspections;
create trigger inspections_attribute_clean
  before insert or update on public.inspections
  for each row execute function public.inspections_attribute_clean();

create or replace function public.backfill_inspection_attribution(p_since date default '2026-04-11', p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  m record;
  v_scanned int := 0;
  v_rated int := 0;
  v_cleaner int := 0;
  v_fill boolean;
begin
  for r in
    select i.id, i.property_id, coalesce(i.inspected_at, i.scheduled_for) as anchor, i.cleaner_id
      from public.inspections i
     where i.rated_clean_task_id is null
       and i.property_id is not null
       and coalesce(i.inspected_at, i.scheduled_for) >= p_since
     order by coalesce(i.inspected_at, i.scheduled_for) desc
     limit greatest(p_limit, 0)
  loop
    v_scanned := v_scanned + 1;
    select * into m from public.inspection_clean_match(r.property_id, r.anchor);
    continue when m.trellis_task_id is null;
    v_fill := r.cleaner_id is null and m.is_tendwell and m.cleaner_id is not null;
    update public.inspections
       set rated_clean_task_id = m.trellis_task_id,
           last_cleaned_on = coalesce(last_cleaned_on, m.clean_date),
           cleaner_id = case when v_fill then m.cleaner_id else cleaner_id end,
           cleaner_auto_filled = case when v_fill then true else cleaner_auto_filled end
     where id = r.id
       and rated_clean_task_id is null;
    v_rated := v_rated + 1;
    if v_fill then v_cleaner := v_cleaner + 1; end if;
  end loop;
  return jsonb_build_object('scanned', v_scanned, 'rated', v_rated, 'cleaner_filled', v_cleaner);
end
$$;

revoke all on function public.backfill_inspection_attribution(date, integer) from public, anon, authenticated;
grant execute on function public.backfill_inspection_attribution(date, integer) to service_role;

-- ── Trellis inspection tasks ───────────────────────────────────────────────
create or replace view public.trellis_inspection_tasks
with (security_invoker = off) as
select t.trellis_task_id,
       t.workspace,
       t.title,
       t.status,
       t.scheduled_date,
       t.completed_at,
       t.assigned_to_id,
       t.assigned_to_name,
       ic.id as inspector_cleaner_id,
       ic.full_name as inspector_name,
       t.trellis_property_id,
       m.property_id,
       p.name as property_name,
       t.property_name as trellis_property_name,
       c.trellis_task_id as prev_clean_task_id,
       c.scheduled_date as prev_clean_date,
       c.clean_kind as prev_clean_kind,
       c.title as prev_clean_title,
       c.is_tendwell as prev_clean_is_tendwell,
       case when c.is_tendwell then c.cleaner_id end as prev_cleaner_id,
       case when c.is_tendwell then c.cleaner_name end as prev_cleaner_name,
       c.crew_label as prev_crew_label,
       i.id as ops_inspection_id,
       i.status as ops_inspection_status,
       i.inspected_at as ops_inspected_at,
       i.overall_score as ops_overall_score,
       i.cleanliness_score as ops_cleanliness_score
  from public.trellis_task_snapshot t
  left join public.trellis_ops_property_map m on m.trellis_id = t.trellis_property_id
  left join public.properties p on p.id = m.property_id
  left join lateral (
    select cl.id, cl.full_name from public.cleaners cl
     where cl.trellis_user_id is not null
       and (cl.trellis_user_id = t.assigned_to_id
            or cl.trellis_user_id::text in (
                 select e->>'assignee_id'
                   from jsonb_array_elements(case when jsonb_typeof(t.assignees) = 'array' then t.assignees else '[]'::jsonb end) e))
     order by (cl.trellis_user_id = t.assigned_to_id) desc, cl.full_name
     limit 1
  ) ic on true
  left join lateral (
    select b.*
      from public.trellis_clean_task_base b
     where b.trellis_property_id = t.trellis_property_id
       and b.status = 'COMPLETED'
       and b.scheduled_date <= coalesce(t.scheduled_date, t.completed_at::date)
       and b.scheduled_date >= coalesce(t.scheduled_date, t.completed_at::date) - 14
     order by b.scheduled_date desc, b.completed_at desc nulls last
     limit 1
  ) c on true
  left join public.inspections i on i.trellis_task_id = t.trellis_task_id
 where t.task_category = 'inspection'
   and public.is_staff_or_server();

comment on view public.trellis_inspection_tasks is
  'Trellis inspection tasks (task_category = inspection; not self-inspections or walkthroughs) with Ops property, inspector (linked cleaner), the previous completed clean by anyone within 14 days (cleaner only when Tendwell''s) and the Ops inspection that rated it (inspections.trellis_task_id), if any.';

revoke all on public.trellis_inspection_tasks from anon;
grant select on public.trellis_inspection_tasks to authenticated, service_role;
