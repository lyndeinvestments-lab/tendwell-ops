-- Add cleaner_id to inspections for quality attribution
ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS cleaner_id UUID REFERENCES cleaners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inspections_cleaner_id ON inspections(cleaner_id);
