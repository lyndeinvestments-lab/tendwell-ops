-- Add covering indexes for foreign-key columns flagged by the Supabase
-- `unindexed_foreign_keys` advisor. Without a covering index, every JOIN
-- against the parent table and every ON DELETE / ON UPDATE cascade check
-- has to do a sequential scan on the child table.
--
-- All 10 are single-column FKs. Each index is additive — no schema or
-- semantic change.

CREATE INDEX IF NOT EXISTS idx_incoming_shipments_received_by
  ON public.incoming_shipments (received_by);

CREATE INDEX IF NOT EXISTS idx_lost_item_assignments_assigned_by_user_id
  ON public.lost_item_assignments (assigned_by_user_id);

CREATE INDEX IF NOT EXISTS idx_notification_log_recipient_user_id
  ON public.notification_log (recipient_user_id);

CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_property_id
  ON public.onboarding_tasks (property_id);

CREATE INDEX IF NOT EXISTS idx_property_notes_created_by_user_id
  ON public.property_notes (created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_stage_transitions_from_stage_id
  ON public.stage_transitions (from_stage_id);

CREATE INDEX IF NOT EXISTS idx_stage_transitions_to_stage_id
  ON public.stage_transitions (to_stage_id);

CREATE INDEX IF NOT EXISTS idx_task_list_members_added_by
  ON public.task_list_members (added_by);

CREATE INDEX IF NOT EXISTS idx_task_lists_created_by
  ON public.task_lists (created_by);

CREATE INDEX IF NOT EXISTS idx_tasks_workflow_template_id
  ON public.tasks (workflow_template_id);
