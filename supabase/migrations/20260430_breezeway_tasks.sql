-- Imported task rows from Breezeway daily exports.
-- Source of truth for "actual cleans per property per month" used by the
-- Live Pro Forma + Per-Property avg_cleans_per_month derivation.
--
-- Idempotent on `external_id` (sha256 of created_date|property|task_title|due_date)
-- so re-imports of the same export overwrite, and overlapping current/next-month
-- exports never duplicate rows.

CREATE TABLE IF NOT EXISTS breezeway_tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id         text NOT NULL UNIQUE,
  task_title          text NOT NULL,
  property_raw        text,
  property_address    text,
  property_id         bigint REFERENCES properties(id) ON DELETE SET NULL,
  department          text,
  assignees           text,
  due_date            date,
  status              text,
  priority            text,
  completed_date      date,
  completed_by        text,
  created_date        date,
  last_updated_date   date,
  is_clean            boolean NOT NULL DEFAULT false,
  source_label        text,
  imported_at         timestamptz NOT NULL DEFAULT now(),
  import_batch        text,
  raw                 jsonb
);

CREATE INDEX IF NOT EXISTS idx_breezeway_tasks_due_date    ON breezeway_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_breezeway_tasks_property_id ON breezeway_tasks(property_id);
CREATE INDEX IF NOT EXISTS idx_breezeway_tasks_is_clean    ON breezeway_tasks(is_clean) WHERE is_clean = true;
CREATE INDEX IF NOT EXISTS idx_breezeway_tasks_imported_at ON breezeway_tasks(imported_at DESC);

ALTER TABLE breezeway_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "breezeway_tasks_select_authenticated"
  ON breezeway_tasks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "breezeway_tasks_admin_writes"
  ON breezeway_tasks FOR ALL
  TO authenticated
  USING      (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- A small breadcrumb table so the dashboard tile can show "last import N min ago".
CREATE TABLE IF NOT EXISTS breezeway_import_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_at     timestamptz NOT NULL DEFAULT now(),
  source_label    text,
  rows_inserted   integer NOT NULL DEFAULT 0,
  rows_updated    integer NOT NULL DEFAULT 0,
  rows_failed     integer NOT NULL DEFAULT 0,
  cleans_in_batch integer NOT NULL DEFAULT 0,
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_breezeway_import_log_imported_at ON breezeway_import_log(imported_at DESC);

ALTER TABLE breezeway_import_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "breezeway_import_log_select_authenticated"
  ON breezeway_import_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "breezeway_import_log_admin_writes"
  ON breezeway_import_log FOR ALL
  TO authenticated
  USING      (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
