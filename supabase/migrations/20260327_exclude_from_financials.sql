-- Add exclude_from_financials flag to properties
-- Properties with "(SCounty)" in name and $0 CE are auto-flagged
ALTER TABLE properties ADD COLUMN IF NOT EXISTS exclude_from_financials BOOLEAN DEFAULT false;

-- Auto-flag existing SCounty properties
UPDATE properties
SET exclude_from_financials = true
WHERE name ILIKE '%(SCounty)%' AND (ce_charged IS NULL OR ce_charged = 0);

-- Add offboarded_at timestamp
ALTER TABLE properties ADD COLUMN IF NOT EXISTS offboarded_at TIMESTAMPTZ;
