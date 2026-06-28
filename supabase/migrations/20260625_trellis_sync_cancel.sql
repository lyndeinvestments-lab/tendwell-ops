-- Add cooperative cancellation support to trellis_sync_log.
-- The running sync checks this column at each checkpoint (between batches/phases).
-- If true, it stops gracefully, marks status='canceled', and returns early.
-- Already-upserted data is retained (idempotent sync design).
--
-- Apply at merge: psql or Supabase dashboard → SQL editor.

alter table public.trellis_sync_log
  add column if not exists cancel_requested boolean not null default false;

comment on column public.trellis_sync_log.cancel_requested is
  'Set to true by POST /api/trellis/sync-cancel to request cooperative cancellation. '
  'The running sync checks this flag at each batch/phase checkpoint. When true it '
  'finalizes status=''canceled'', sets finished_at=now(), and returns early. '
  'Already-upserted snapshot data is retained (idempotent).';
