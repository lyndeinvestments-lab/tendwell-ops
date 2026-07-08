-- Accepted Hostaway↔Ops differences. Accepting a difference records the exact
-- (hostaway value, ops value) pair; the UI hides the flag only while the pair
-- still matches, so a later change on either side re-surfaces it. One row per
-- (listing, field) — re-accepting upserts the new pair. Rows die with the
-- listing (cascade) so stale acceptances never linger.
create table if not exists public.hostaway_diff_dismissals (
  id           uuid primary key default gen_random_uuid(),
  hostaway_id  bigint not null references public.hostaway_listing_snapshot(hostaway_id) on delete cascade,
  field        text not null check (field in ('bedrooms','bathrooms','beds','guests','address')),
  ha_value     text,
  ops_value    text,
  dismissed_by text,
  created_at   timestamptz not null default now(),
  unique (hostaway_id, field)
);

alter table public.hostaway_diff_dismissals enable row level security;

drop policy if exists hostaway_diff_dismissals_admin_all on public.hostaway_diff_dismissals;
create policy hostaway_diff_dismissals_admin_all on public.hostaway_diff_dismissals
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
