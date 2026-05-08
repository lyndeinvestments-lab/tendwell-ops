-- Extend the inspections table to support a full create/schedule flow:
--   * scheduled_for: date the inspection is planned (separate from inspected_at,
--     which records when the inspection was actually performed).
--   * status: 'scheduled' | 'completed' | 'skipped' (default 'completed' so the
--     existing "log it now" path keeps working).
--   * reinspect_urgency: how urgent a re-inspection is, set by the inspector.
--   * reinspect_by: optional target date for the re-inspection.
--
-- Switch the score columns to a 1-5 scale via CHECK constraints. NULL is still
-- allowed for unrated/scheduled rows. (Table is currently empty, verified via
-- COUNT(*) = 0, so no data backfill is needed.)
--
-- Also create the `inspections` storage bucket (public, matching the existing
-- PropertyDetailModal pattern that calls getPublicUrl) with INSERT/UPDATE/
-- DELETE restricted to authenticated users. Photos are stored at
-- "<inspection_id>/<random>.<ext>" within the bucket.

-- ─── Schema additions ───────────────────────────────────────────────────────
ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS scheduled_for date,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS reinspect_urgency text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS reinspect_by date;

ALTER TABLE inspections
  DROP CONSTRAINT IF EXISTS inspections_status_check;
ALTER TABLE inspections
  ADD CONSTRAINT inspections_status_check
  CHECK (status IN ('scheduled', 'completed', 'skipped'));

ALTER TABLE inspections
  DROP CONSTRAINT IF EXISTS inspections_reinspect_urgency_check;
ALTER TABLE inspections
  ADD CONSTRAINT inspections_reinspect_urgency_check
  CHECK (reinspect_urgency IN ('none', 'low', 'medium', 'high', 'critical'));

-- 1-5 score range (NULL allowed for scheduled/unrated rows).
DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY['overall_score','cleanliness_score','linens_score','supplies_score','exterior_score'] LOOP
    EXECUTE format(
      'ALTER TABLE inspections DROP CONSTRAINT IF EXISTS inspections_%I_range',
      col
    );
    EXECUTE format(
      'ALTER TABLE inspections ADD CONSTRAINT inspections_%I_range CHECK (%I IS NULL OR (%I >= 1 AND %I <= 5))',
      col, col, col, col
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_inspections_status_scheduled_for
  ON inspections (status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_inspections_reinspect_urgency
  ON inspections (reinspect_urgency)
  WHERE reinspect_urgency <> 'none';

-- ─── Storage bucket for inspection photos ───────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('inspections', 'inspections', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "inspections_public_read" ON storage.objects;
CREATE POLICY "inspections_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'inspections');

DROP POLICY IF EXISTS "inspections_auth_insert" ON storage.objects;
CREATE POLICY "inspections_auth_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'inspections');

DROP POLICY IF EXISTS "inspections_auth_update" ON storage.objects;
CREATE POLICY "inspections_auth_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'inspections')
  WITH CHECK (bucket_id = 'inspections');

DROP POLICY IF EXISTS "inspections_auth_delete" ON storage.objects;
CREATE POLICY "inspections_auth_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'inspections');
