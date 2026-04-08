-- Property verification tracking
-- Stores the most recent verification for each property
CREATE TABLE IF NOT EXISTS property_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  verified_by TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  fields_updated JSONB,  -- which fields were changed during verification
  UNIQUE(property_id)    -- one record per property, upserted on each verification
);

CREATE INDEX IF NOT EXISTS idx_property_verifications_property_id ON property_verifications(property_id);
CREATE INDEX IF NOT EXISTS idx_property_verifications_verified_at ON property_verifications(verified_at);

ALTER TABLE property_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "property_verifications_authenticated"
  ON property_verifications FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
