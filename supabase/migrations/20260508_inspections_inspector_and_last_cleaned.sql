-- Round 2 of inspections build-out:
--   * inspector_id: who actually performed the inspection (FK cleaners,
--     same picker as cleaner_id "previously cleaned by").
--   * last_cleaned_on: the date the property was last cleaned, captured at
--     schedule time so the inspector knows whether it has been freshly
--     cleaned that day.

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS inspector_id uuid REFERENCES cleaners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_cleaned_on date;

CREATE INDEX IF NOT EXISTS idx_inspections_inspector_id
  ON inspections (inspector_id)
  WHERE inspector_id IS NOT NULL;
