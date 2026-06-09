-- Auto-archive stale quotes.
--
-- Quotes are `properties` rows in the "Quote" stage. The quote-sheet already
-- supports a soft archive (archived_at / archived_reason / archived_by, added
-- in 20260501_quote_archive_fields.sql) with a restore action. This function
-- archives any non-archived Quote-stage property whose created_at (the "quote
-- added" date shown on the sheet) is older than max_age_days. It is reversible:
-- archived quotes still appear under the Archived/All views and can be restored.
--
-- SECURITY DEFINER + revoked from public so only the service-role cron
-- (/api/cron/archive-stale-quotes) can invoke it. Mirrors purge_deleted_properties.

create or replace function archive_stale_quotes(max_age_days int default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with updated as (
    update properties p
    set archived_at = now(),
        archived_reason = 'Auto-archived: quote older than ' || max_age_days || ' days',
        archived_by = 'system'
    from pipeline_stages s
    where p.stage_id = s.id
      and s.name = 'Quote'
      and p.archived_at is null
      and p.created_at < now() - make_interval(days => max_age_days)
    returning 1
  )
  select count(*) into n from updated;
  return n;
end;
$$;

revoke all on function archive_stale_quotes(int) from public;
