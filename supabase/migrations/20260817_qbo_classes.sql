-- QBO Class list snapshot, refreshed nightly by api/cron/qbo-classes-sync.ts.
-- The invoicing QBO/Ramp exporters fill the "Class" column only when the
-- property's class actually exists here — an unknown value would fail or
-- auto-create classes on QBO import. Nina's own hand-built sheets leave Class
-- blank for unmapped properties (see invoice #1085), which this reproduces.

create table if not exists public.qbo_classes (
  qbo_id text primary key,
  name text not null,
  fully_qualified_name text not null,
  active boolean not null default true,
  synced_at timestamptz not null default now()
);

alter table public.qbo_classes enable row level security;

-- Admin-only (the cron writes via the service role, which bypasses RLS).
create policy qbo_classes_admin_all on public.qbo_classes
  for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
