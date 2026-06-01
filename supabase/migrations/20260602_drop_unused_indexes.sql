-- Drop 18 secondary indexes that pg_stat_user_indexes confirms have
-- never been scanned. Each one currently costs INSERT/UPDATE overhead
-- on its table for zero query benefit. The largest savings come from
-- the growing tables (activity_log, breezeway_tasks, notification_log).
--
-- Confirmed prerequisites for each (per pg_stat_user_indexes):
--   idx_scan = 0  (never used in any query plan)
--   NOT indisprimary  (not a primary-key index)
--   NOT indisunique   (not a unique-constraint index)
--
-- Excluded from this drop list (still given time to accumulate stats):
--   - 10 FK indexes added in PR #264 (~5 days old)
--   - 4 indexes from PRs #248/255/256 (recently created tables)
--
-- Re-adding any specific one in the future is a one-line CREATE INDEX
-- — original definitions live in earlier migration files (e.g.
-- 20260327_activity_log.sql, 20260411_task_management.sql,
-- 20260430_breezeway_tasks.sql, 20260401_security_rls.sql).

-- Largest savings: write-heavy tables
DROP INDEX IF EXISTS public.idx_activity_log_entity_id;       -- 40 kB
DROP INDEX IF EXISTS public.idx_activity_log_entity_type;     -- 16 kB
DROP INDEX IF EXISTS public.idx_breezeway_tasks_is_clean;     -- 32 kB
DROP INDEX IF EXISTS public.idx_breezeway_tasks_is_deep_clean;-- 16 kB

-- Notification log churns on every email send
DROP INDEX IF EXISTS public.idx_notification_log_sent_at;
DROP INDEX IF EXISTS public.idx_notification_log_event_type;

-- Inspections — 3 indexes none of which have ever been used
DROP INDEX IF EXISTS public.idx_inspections_date;
DROP INDEX IF EXISTS public.idx_inspections_status_scheduled_for;
DROP INDEX IF EXISTS public.idx_inspections_reinspect_urgency;

-- CSV import log writes once per import; index by status/imported_at unused
DROP INDEX IF EXISTS public.csv_import_log_status_idx;
DROP INDEX IF EXISTS public.csv_import_log_imported_at_idx;

-- One-off unused indexes on smaller tables
DROP INDEX IF EXISTS public.idx_cleaning_issues_status;
DROP INDEX IF EXISTS public.idx_contacts_email;
DROP INDEX IF EXISTS public.idx_tasks_assignee;
DROP INDEX IF EXISTS public.idx_nsm_section;
DROP INDEX IF EXISTS public.idx_properties_archived_at;
DROP INDEX IF EXISTS public.idx_cleaning_logs_date;
DROP INDEX IF EXISTS public.idx_laundry_weigh_ins_type;
