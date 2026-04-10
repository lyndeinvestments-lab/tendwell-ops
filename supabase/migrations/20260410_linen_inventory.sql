-- Linen Inventory: periodic shelf-count tracking with historical records

ALTER TABLE properties ADD COLUMN IF NOT EXISTS target_par_sets INTEGER DEFAULT 3;

CREATE TABLE IF NOT EXISTS linen_inventory_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  counted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  counted_by TEXT,
  clean_complete_sets INTEGER NOT NULL DEFAULT 0,
  king_sets INTEGER,
  queen_sets INTEGER,
  full_sets INTEGER,
  twin_sets INTEGER,
  bath_towels INTEGER,
  washcloths INTEGER,
  hand_towels INTEGER,
  bathmats INTEGER,
  pool_towels INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lic_property_id ON linen_inventory_counts(property_id);
CREATE INDEX IF NOT EXISTS idx_lic_counted_at ON linen_inventory_counts(counted_at DESC);

ALTER TABLE linen_inventory_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lic_authenticated"
  ON linen_inventory_counts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- View: latest count per property (uses DISTINCT ON for efficiency)
CREATE OR REPLACE VIEW linen_inventory_latest AS
  SELECT DISTINCT ON (property_id) *
  FROM linen_inventory_counts
  ORDER BY property_id, counted_at DESC;
