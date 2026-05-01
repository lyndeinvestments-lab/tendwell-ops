-- Negative path for the quote sheet: archive (with required reason) instead
-- of letting un-converted quotes accumulate in the Quote stage forever.
-- The columns are stage-agnostic so any future negative path (e.g. archived
-- leads) can reuse them.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS archived_at      timestamptz,
  ADD COLUMN IF NOT EXISTS archived_reason  text,
  ADD COLUMN IF NOT EXISTS archived_by      text;

-- Partial index keeps the active-list query (the default) fast while the
-- archived list grows over time.
CREATE INDEX IF NOT EXISTS idx_properties_archived_at
  ON properties (archived_at)
  WHERE archived_at IS NOT NULL;
