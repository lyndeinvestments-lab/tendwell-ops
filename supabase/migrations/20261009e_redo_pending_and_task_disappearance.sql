-- 20261009e_redo_pending_and_task_disappearance.sql
--
-- MUST BE REVIEWED AND APPLIED BY JORDAN. Not applied by the PR that adds it.
--
-- Breezeway tasks that vanish from a FULL re-export of their window.
--
-- Breezeway has no API we consume; tasks arrive as CSV exports upserted on a
-- content hash (api/tasks/breezeway-import.ts). A task Haven deletes or
-- cancels in Breezeway simply stops appearing in the export, and its row in
-- breezeway_tasks lives on as if it still existed, so invoicing could take it
-- as evidence that a clean happened. The import endpoint now has an OPT-IN
-- full-export mode (full_export=true + window_start/window_end): tasks in that
-- due-date window that are absent from the export are marked
--   status = 'deleted_or_canceled', disappeared_at = now()
-- and their previous status is kept here. Rows are never deleted. The daily
-- incremental import never marks anything.
--
-- Strictly additive and idempotent: three nullable columns, one partial
-- index, and a trigger that clears the disappearance marks when a later
-- import brings the task back with a real Breezeway status.
--
-- No RLS change: breezeway_tasks keeps its existing policies (these are
-- operational task rows, not client money). Writes come only from the
-- service-role import endpoint.
--
-- The "redo_pending" invoicing flag that ships alongside this needs no schema
-- change: the flag lives in invoice_lines.flags and the bill / no-charge
-- decision in invoice_lines.review_note (shared/invoice-redo.ts).

alter table public.breezeway_tasks
  add column if not exists disappeared_at timestamptz,
  add column if not exists disappeared_prev_status text,
  add column if not exists disappeared_batch text;

comment on column public.breezeway_tasks.disappeared_at is
  'Set by a full-export Breezeway import when this task was missing from a full re-export of its due-date window (status is then deleted_or_canceled). Cleared when a later import brings the task back.';
comment on column public.breezeway_tasks.disappeared_prev_status is
  'The Breezeway status the task had before it was marked deleted_or_canceled.';
comment on column public.breezeway_tasks.disappeared_batch is
  'import_batch of the full-export import that marked the task as disappeared (for audit or undo).';

create index if not exists idx_breezeway_tasks_disappeared
  on public.breezeway_tasks (disappeared_at)
  where disappeared_at is not null;

-- A task that reappears in any later export gets its real Breezeway status
-- back from the upsert; clear the disappearance marks with it so the row
-- never reads as both live and deleted.
create or replace function public.breezeway_tasks_clear_disappeared()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.disappeared_at is not null
     and new.status is distinct from 'deleted_or_canceled' then
    new.disappeared_at := null;
    new.disappeared_prev_status := null;
    new.disappeared_batch := null;
  end if;
  return new;
end;
$$;

revoke all on function public.breezeway_tasks_clear_disappeared() from public, anon;

drop trigger if exists trg_breezeway_tasks_clear_disappeared on public.breezeway_tasks;
create trigger trg_breezeway_tasks_clear_disappeared
  before update on public.breezeway_tasks
  for each row
  execute function public.breezeway_tasks_clear_disappeared();
