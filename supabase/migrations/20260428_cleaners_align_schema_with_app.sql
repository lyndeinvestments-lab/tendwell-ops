-- Align prod `cleaners` table with the app code + the original
-- 20260324_round5_tables.sql migration (which was never applied to prod).
-- Prod was created with `name` / `status` (text) but every consumer
-- (cleaners.tsx, cost-tracking.tsx, cleaner-metrics.tsx, inspections.tsx)
-- queries `full_name` and `is_active`. Inserts via the Add Cleaner form
-- failed with "column full_name does not exist" until this migration ran.
-- Table was empty when applied, so this is a clean rename + type swap with
-- no data migration needed.

ALTER TABLE cleaners RENAME COLUMN name TO full_name;

ALTER TABLE cleaners DROP COLUMN status;
ALTER TABLE cleaners ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
