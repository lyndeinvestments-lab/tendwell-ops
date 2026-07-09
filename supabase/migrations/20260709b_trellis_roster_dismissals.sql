-- Dismissals for the /trellis-tasks "In Trellis, not in Ops" roster-gap panel.
-- Dismissing hides a Trellis roster member (e.g. Trellis/Haven admins who will
-- never be Tendwell cleaners) from the panel; rows can be deleted to restore.
create table if not exists public.trellis_roster_dismissals (
  user_id      text primary key,          -- trellis_roster.user_id
  name         text,
  email        text,
  dismissed_by text,
  dismissed_at timestamptz not null default now()
);

alter table public.trellis_roster_dismissals enable row level security;

-- Admin-only, matching trellis_roster (the panel is admin-only).
drop policy if exists trellis_roster_dismissals_admin on public.trellis_roster_dismissals;
create policy trellis_roster_dismissals_admin on public.trellis_roster_dismissals
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
