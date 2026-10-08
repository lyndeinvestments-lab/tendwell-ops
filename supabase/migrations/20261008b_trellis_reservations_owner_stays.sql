-- Haven reservation calendar snapshot, so invoicing can tell an owner's stay
-- from a guest's (Christine, 2026-10-08): the first clean after an OWNER
-- checks out is an owner charge and must read "Owner Stay - Departure Clean"
-- / "Owner Stay - Turn Clean" so Haven's QBO class rules book it to the owner.
--
-- Written nightly by api/trellis/_sync-core.ts (Workspace B = Haven's
-- Trellis, which mirrors Hostaway). An owner block in Hostaway is a DIRECT
-- booking with a $0 total: the owner, family/friends they comp, or a block
-- they asked for ("Mark urban - OWNER BLOCK NO CLEANING"). Paid direct
-- bookings carry a total and are guests.

create table if not exists public.trellis_reservation_snapshot (
  trellis_reservation_id text primary key,
  workspace text not null default 'B',
  trellis_property_id text,
  property_name text,
  guest_name text,
  checkin_date date,
  checkout_date date,
  status text,
  source text,
  total_amount numeric,
  is_owner_block boolean generated always as (
    upper(coalesce(source, '')) = 'DIRECT' and coalesce(total_amount, 0) = 0
  ) stored,
  synced_at timestamptz not null default now()
);

alter table public.trellis_reservation_snapshot enable row level security;

create index if not exists trellis_reservation_snapshot_prop_checkout_idx
  on public.trellis_reservation_snapshot (trellis_property_id, checkout_date);

-- Staff read; the service role (sync + invoicing endpoints) bypasses RLS.
drop policy if exists trellis_reservation_snapshot_staff_select on public.trellis_reservation_snapshot;
create policy trellis_reservation_snapshot_staff_select
  on public.trellis_reservation_snapshot for select to authenticated
  using (public.is_staff());

revoke all on public.trellis_reservation_snapshot from anon;
