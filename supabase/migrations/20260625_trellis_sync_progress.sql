-- Add nullable progress column to trellis_sync_log for live sync tracking.
-- Shape: { phase, current, total, pct, eta_seconds, message }
-- Backward compatible — nullable, no NOT NULL.

alter table public.trellis_sync_log
  add column if not exists progress jsonb;

comment on column public.trellis_sync_log.progress is
  'Live sync progress snapshot. Shape: {phase text, current int, total int, pct float, eta_seconds float, message text}. Null until sync-now populates it; ignored by the legacy cron path.';
