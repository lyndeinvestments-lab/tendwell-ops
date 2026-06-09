-- Cleaner coaching flags.
--
-- Lets a supervisor flag a cleaner for coaching from the Cleaner Metrics page
-- when their issue rate warrants follow-up. Stores a snapshot of the metrics at
-- flag time so the record stays meaningful even as cleans/issues accumulate.
-- Flags are resolvable (status open -> resolved) rather than deleted, so the
-- coaching history is auditable. Pay is never modified here — recommendations
-- in the UI are advisory only.

create table if not exists cleaner_coaching_flags (
  id           uuid primary key default gen_random_uuid(),
  cleaner_id   uuid not null references cleaners(id) on delete cascade,
  reason       text,
  issue_rate   numeric,
  total_cleans integer,
  issue_count  integer,
  status       text not null default 'open',  -- 'open' | 'resolved'
  flagged_by   text,
  resolved_by  text,
  resolved_at  timestamptz,
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists cleaner_coaching_flags_cleaner_idx on cleaner_coaching_flags (cleaner_id);
create index if not exists cleaner_coaching_flags_status_idx on cleaner_coaching_flags (status);

alter table cleaner_coaching_flags enable row level security;

-- Read: any authenticated user. Write: admin or operations only (mirrors the
-- cleaner-metrics view access). current_user_role() is defined in
-- 20260401_security_rls.sql.
drop policy if exists coaching_flags_read on cleaner_coaching_flags;
create policy coaching_flags_read on cleaner_coaching_flags
  for select to authenticated using (true);

drop policy if exists coaching_flags_write on cleaner_coaching_flags;
create policy coaching_flags_write on cleaner_coaching_flags
  for all to authenticated
  using (current_user_role() in ('admin', 'operations'))
  with check (current_user_role() in ('admin', 'operations'));
