-- Issues Tracker overhaul, part 2: per-user read state ("Catch-up") and the
-- issue_catchup_feed view the issues page reads instead of raw cleaning_issues.
--
-- Design: one read-cursor row per (issue, user). An issue is unread for a user
-- when they have no row, they explicitly marked it unread, or the issue's
-- latest activity (its own updated_at, or the newest comment/photo) is newer
-- than their cursor. Freshness is derived from the child tables in the view —
-- no updated_at-bump triggers needed.

-- ── Read cursors ─────────────────────────────────────────────────────────────
create table if not exists issue_reads (
  issue_id      uuid        not null references cleaning_issues(id) on delete cascade,
  user_id       bigint      not null references app_users(id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  marked_unread boolean     not null default false,
  updated_at    timestamptz not null default now(),
  primary key (issue_id, user_id)
);
create index if not exists idx_issue_reads_user on issue_reads (user_id);

-- ── Current user's app_users.id ──────────────────────────────────────────────
-- Mirrors current_auth_email()/is_staff() from 20260623_owner_portal.sql.
create or replace function public.current_app_user_id()
returns bigint language sql stable security definer
set search_path = public, auth as $$
  select id from public.app_users where google_email = public.current_auth_email() limit 1
$$;
revoke execute on function public.current_app_user_id() from public, anon;
grant execute on function public.current_app_user_id() to authenticated;

alter table issue_reads enable row level security;
drop policy if exists issue_reads_self on issue_reads;
create policy issue_reads_self on issue_reads for all to authenticated
  using (public.is_staff() and user_id = public.current_app_user_id())
  with check (public.is_staff() and user_id = public.current_app_user_id());

-- ── Catch-up feed ────────────────────────────────────────────────────────────
-- security_invoker so the view runs under the caller's RLS: cleaning_issues
-- stays staff-only, and the issue_reads join is self-scoped per row.
create or replace view public.issue_catchup_feed
with (security_invoker = true) as
select
  ci.*,
  greatest(
    ci.updated_at,
    coalesce(lc.max_created, ci.updated_at),
    coalesce(lp.max_created, ci.updated_at)
  ) as activity_at,
  ir.last_read_at,
  coalesce(ir.marked_unread, false) as marked_unread,
  (
    ir.user_id is null
    or ir.marked_unread
    or greatest(
         ci.updated_at,
         coalesce(lc.max_created, ci.updated_at),
         coalesce(lp.max_created, ci.updated_at)
       ) > ir.last_read_at
  ) as is_unread
from cleaning_issues ci
left join issue_reads ir
  on ir.issue_id = ci.id and ir.user_id = public.current_app_user_id()
left join (
  select issue_id, max(created_at) as max_created from issue_comments group by issue_id
) lc on lc.issue_id = ci.id
left join (
  select issue_id, max(created_at) as max_created from issue_photos group by issue_id
) lp on lp.issue_id = ci.id;

grant select on public.issue_catchup_feed to authenticated;
