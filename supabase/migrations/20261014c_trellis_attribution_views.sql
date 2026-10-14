-- 20261014c — Trellis API expansion WS1: property map, clean tasks, review attribution.
--
-- Definer-style views (security_invoker = off) over RLS tables, each gated
-- with a one-time filter: public.is_staff_or_server() (staff session, or the
-- service role / a direct connection), or the 'reviews' view grant for review
-- data. anon has no SELECT. No pay, rate or properties financial columns.
-- (security_invoker views with per-row is_staff() RLS were too slow for
-- financial_task_load; same reason here: these join ~10k-row snapshots.)
--
-- Attribution rule (plan review amendment): the clean a review / inspection
-- rates is the last COMPLETED clean BY ANYONE at the property within 14 days
-- on/before the anchor (a review's check-in date; an inspection's date).
-- Tendwell / a cleaner is credited only when that clean is Tendwell's
-- (is_tendwell). TS mirror: pickRatedClean() in shared/trellis-sync-rules.ts.

-- ── Trellis property → Ops property ────────────────────────────────────────
-- Lookups by uuid go through this partial expression index (the predicate
-- keeps non-uuid legacy values out of the cast).
create index if not exists properties_trellis_uuid_idx
  on public.properties ((trellis_id::uuid))
  where deleted_at is null
    and trellis_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- properties.trellis_id ∪ property_aliases.trellis_id. Snapshot rows are
-- already canonicalized to the primary id by trigger, so the alias rows only
-- matter for ids seen before their alias existed. Deleted properties never map.
create or replace view public.trellis_ops_property_map
with (security_invoker = off) as
select distinct on (m.trellis_id) m.trellis_id, m.property_id, m.link_source
  from (
    select p.trellis_id::uuid as trellis_id, p.id as property_id, 'primary'::text as link_source, 0 as pri
      from public.properties p
     where p.deleted_at is null
       and p.trellis_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union all
    select a.trellis_id, a.property_id, 'alias'::text, 1
      from public.property_aliases a
      join public.properties p on p.id = a.property_id and p.deleted_at is null
     where a.trellis_id is not null
  ) m
 where public.is_staff_or_server()
 order by m.trellis_id, m.pri, m.property_id;

comment on view public.trellis_ops_property_map is
  'Trellis property id → Ops property id (properties.trellis_id ∪ property_aliases.trellis_id). Staff/server only.';

-- ── Clean tasks (all statuses) ─────────────────────────────────────────────
-- One row per Trellis clean task (clean_kind not null) with its Ops property
-- and the linked cleaner(s): cleaners.trellis_user_id on assigned_to_id or
-- any assignees[].assignee_id. cleaner_id prefers the assigned_to_id match.
create or replace view public.trellis_clean_task_base
with (security_invoker = off) as
select t.trellis_task_id,
       t.workspace,
       t.trellis_property_id,
       m.property_id,
       p.name as property_name,
       t.property_name as trellis_property_name,
       t.title,
       t.clean_kind,
       t.status,
       t.scheduled_date,
       t.completed_at,
       t.is_tendwell,
       t.assigned_to_id,
       t.assigned_to_name,
       cl.cleaner_id,
       cl.cleaner_name,
       cl.cleaner_ids,
       case when cl.cleaner_id is not null then cl.cleaner_name
            when t.is_tendwell then 'Tendwell crew (unassigned)'
            else 'Not Tendwell' end as crew_label
  from public.trellis_task_snapshot t
  left join public.trellis_ops_property_map m on m.trellis_id = t.trellis_property_id
  left join public.properties p on p.id = m.property_id
  left join lateral (
    select (array_agg(c.id order by (c.trellis_user_id = t.assigned_to_id) desc, c.full_name))[1] as cleaner_id,
           (array_agg(c.full_name order by (c.trellis_user_id = t.assigned_to_id) desc, c.full_name))[1] as cleaner_name,
           array_agg(c.id order by c.full_name) as cleaner_ids
      from public.cleaners c
     where c.trellis_user_id is not null
       and t.is_tendwell
       and (c.trellis_user_id = t.assigned_to_id
            or c.trellis_user_id::text in (
                 select e->>'assignee_id'
                   from jsonb_array_elements(case when jsonb_typeof(t.assignees) = 'array' then t.assignees else '[]'::jsonb end) e))
  ) cl on true
 where t.clean_kind is not null
   and public.is_staff_or_server();

comment on view public.trellis_clean_task_base is
  'Every Trellis clean task (any status) with Ops property, is_tendwell, linked cleaner(s) and crew_label. Use trellis_clean_tasks (completed) or trellis_cleaner_tasks (Tendwell, any status).';

-- Completed cleans by anyone (is_tendwell says whose). WS3 metrics, WS5 counts.
create or replace view public.trellis_clean_tasks
with (security_invoker = off) as
select * from public.trellis_clean_task_base where status = 'COMPLETED';

comment on view public.trellis_clean_tasks is
  'Completed Trellis cleans (clean_kind not null) by anyone, with Ops property_id, is_tendwell, cleaner_id/cleaner_ids (cleaners.trellis_user_id on assigned_to_id or assignees) and crew_label. Clean date = scheduled_date.';

-- Tendwell cleans of every status (scheduled / in progress / completed): a
-- cleaner's upcoming and past work (WS3).
create or replace view public.trellis_cleaner_tasks
with (security_invoker = off) as
select * from public.trellis_clean_task_base where is_tendwell;

comment on view public.trellis_cleaner_tasks is
  'Tendwell Trellis cleans of any status (SCHEDULED, OPEN, IN_PROGRESS, PAUSED, COMPLETED) with cleaner_id/cleaner_ids and crew_label.';

-- ── Review → prepared-by clean ─────────────────────────────────────────────
create or replace view public.review_clean_attribution
with (security_invoker = off) as
select r.trellis_review_id,
       r.review_date,
       r.source,
       r.reviewer_name,
       r.guest_name,
       r.reservation_id,
       r.checkin_date,
       r.checkout_date,
       r.overall_rating,
       r.max_rating,
       r.normalized_rating,
       r.cleanliness_rating,
       r.cleanliness_5,
       r.category_ratings,
       r.content,
       r.title,
       r.host_response_status,
       r.trellis_property_id,
       r.property_name as trellis_property_name,
       m.property_id,
       p.name as property_name,
       c.trellis_task_id as rated_clean_task_id,
       c.scheduled_date as clean_date,
       c.clean_kind,
       c.title as clean_title,
       c.is_tendwell as clean_is_tendwell,
       case when c.is_tendwell then c.cleaner_id end as cleaner_id,
       case when c.is_tendwell then c.cleaner_ids end as cleaner_ids,
       case when c.is_tendwell then c.cleaner_name end as cleaner_name,
       c.crew_label,
       case when m.property_id is null then 'no_ops_property'
            when r.checkin_date is null then 'no_checkin'
            when c.trellis_task_id is null then 'no_clean_found'
            when not c.is_tendwell then 'not_tendwell'
            when c.cleaner_id is not null then 'cleaner'
            else 'tendwell_crew' end as attribution
  from public.trellis_review_snapshot r
  left join public.trellis_ops_property_map m on m.trellis_id = r.trellis_property_id
  left join public.properties p on p.id = m.property_id
  left join lateral (
    select b.*
      from public.trellis_clean_task_base b
     where b.trellis_property_id = r.trellis_property_id
       and b.status = 'COMPLETED'
       and r.checkin_date is not null
       and b.scheduled_date <= r.checkin_date
       and b.scheduled_date >= r.checkin_date - 14
     order by b.scheduled_date desc, b.completed_at desc nulls last
     limit 1
  ) c on true
 where (current_user not in ('anon', 'authenticated') or public.current_user_can_view('reviews'));

comment on view public.review_clean_attribution is
  'Each Trellis guest review → Ops property → the last completed clean by anyone within 14 days on/before check-in → cleaner when that clean is Tendwell''s. attribution: cleaner | tendwell_crew | not_tendwell | no_clean_found | no_checkin | no_ops_property. Gated on the reviews view grant.';

-- ── Grants ─────────────────────────────────────────────────────────────────
revoke all on public.trellis_ops_property_map, public.trellis_clean_task_base, public.trellis_clean_tasks,
              public.trellis_cleaner_tasks, public.review_clean_attribution from anon;
grant select on public.trellis_ops_property_map, public.trellis_clean_task_base, public.trellis_clean_tasks,
                public.trellis_cleaner_tasks, public.review_clean_attribution to authenticated, service_role;

-- ── is_tendwell from the assignee list ─────────────────────────────────────
-- The bulk sync sees one assignee per task; the assignee list (fetched by the
-- aux job / invoice service detail) can name a Tendwell roster member on a
-- task assigned to someone else. Upgrade is_tendwell then, so a later bulk
-- upsert that only knows assigned_to_* cannot downgrade it. SQL mirror of the
-- assignees branch of isTendwellTask (shared/aux-tasks.ts).
create or replace function public.trellis_task_tendwell_from_assignees()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.workspace = 'B'
     and coalesce(new.is_tendwell, false) = false
     and jsonb_typeof(new.assignees) = 'array'
     and exists (
       select 1 from jsonb_array_elements(new.assignees) e
        where lower(btrim(coalesce(e->>'assignee_name', ''))) = 'tendwell cleaning co.'
           or exists (select 1 from public.trellis_roster r where r.workspace = 'A' and r.user_id::text = e->>'assignee_id'))
  then
    new.is_tendwell := true;
  end if;
  return new;
end
$$;

drop trigger if exists trg_trellis_task_tendwell_from_assignees on public.trellis_task_snapshot;
create trigger trg_trellis_task_tendwell_from_assignees
  before insert or update on public.trellis_task_snapshot
  for each row execute function public.trellis_task_tendwell_from_assignees();
