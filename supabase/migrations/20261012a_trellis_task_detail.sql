-- Service detail for invoice lines (Jordan 2026-10-12: "a basic thing like
-- extra cleaning isn't good enough" — line 679 on I261009823 said only "Trip
-- Fee $50"; the Trellis task behind it said what, when, who and why).
--
-- The sync used to keep 11 fields per task and drop the rest. These columns
-- keep what a reviewer needs to judge a charge. All operational: the task's
-- money field (`cost`) is deliberately NOT stored, because this table is
-- readable by every staff login (crew lockdown rule, 20261008g).

alter table public.trellis_task_snapshot
  add column if not exists description text,
  add column if not exists summary text,
  add column if not exists reservation_id text,
  add column if not exists task_created_at timestamptz,
  add column if not exists scheduled_time text,
  add column if not exists task_source text,
  add column if not exists external_id text,
  add column if not exists external_provider text,
  add column if not exists assignees jsonb,
  add column if not exists checklist_total integer,
  add column if not exists checklist_completed integer,
  add column if not exists linked_issue_count integer,
  add column if not exists is_no_charge boolean;

comment on column public.trellis_task_snapshot.description is
  'Trellis task description as written by the requester. May contain access codes: redact before showing on an invoice (shared/service-detail.ts).';
comment on column public.trellis_task_snapshot.reservation_id is
  'The reservation Trellis linked the task to. Often the PREVIOUS stay, not who was on site that day.';

-- Breezeway-matched invoice lines find their Trellis twin by property + day.
create index if not exists trellis_task_snapshot_property_day_idx
  on public.trellis_task_snapshot (trellis_property_id, scheduled_date);
