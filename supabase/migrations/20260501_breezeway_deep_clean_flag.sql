-- Deep cleans have separate pricing from regular cleans (different cost AND
-- different income), so they're designated with their own boolean instead of
-- being lumped into is_clean. Mutually exclusive with is_clean — a row is
-- either is_clean=true OR is_deep_clean=true (or neither, for inspections).

ALTER TABLE breezeway_tasks
  ADD COLUMN IF NOT EXISTS is_deep_clean boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_breezeway_tasks_is_deep_clean
  ON breezeway_tasks (is_deep_clean)
  WHERE is_deep_clean = true;

-- Mirror column on the import log so the dashboard pill can show counts
-- per category at a glance.
ALTER TABLE breezeway_import_log
  ADD COLUMN IF NOT EXISTS deep_cleans_in_batch integer NOT NULL DEFAULT 0;
