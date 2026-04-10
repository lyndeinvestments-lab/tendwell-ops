-- Linen Inventory: company-wide linen count tracking
-- Each row = one count session (snapshot of total inventory on hand)
-- NOT property-specific — tracks total linens owned across the company

ALTER TABLE properties ADD COLUMN IF NOT EXISTS target_par_sets INTEGER DEFAULT 3;

CREATE TABLE IF NOT EXISTS linen_inventory_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  counted_by TEXT,
  -- Rolls (each roll = 1 fitted + 1 flat + pillowcases bundled)
  king_rolls INTEGER DEFAULT 0,
  queen_rolls INTEGER DEFAULT 0,
  full_rolls INTEGER DEFAULT 0,
  twin_rolls INTEGER DEFAULT 0,
  -- Top sheets (separate from rolls, tracked by size)
  king_top_sheets INTEGER DEFAULT 0,
  queen_top_sheets INTEGER DEFAULT 0,
  full_top_sheets INTEGER DEFAULT 0,
  twin_top_sheets INTEGER DEFAULT 0,
  -- Towels
  bath_towels INTEGER DEFAULT 0,
  washcloths INTEGER DEFAULT 0,
  hand_towels INTEGER DEFAULT 0,
  bathmats INTEGER DEFAULT 0,
  pool_towels INTEGER DEFAULT 0,
  -- Individual extras (one-off pieces not bundled in rolls)
  king_fitted_extras INTEGER DEFAULT 0,
  king_flat_extras INTEGER DEFAULT 0,
  king_pillowcase_extras INTEGER DEFAULT 0,
  queen_fitted_extras INTEGER DEFAULT 0,
  queen_flat_extras INTEGER DEFAULT 0,
  queen_pillowcase_extras INTEGER DEFAULT 0,
  full_fitted_extras INTEGER DEFAULT 0,
  full_flat_extras INTEGER DEFAULT 0,
  full_pillowcase_extras INTEGER DEFAULT 0,
  twin_fitted_extras INTEGER DEFAULT 0,
  twin_flat_extras INTEGER DEFAULT 0,
  twin_pillowcase_extras INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lic_counted_at ON linen_inventory_counts(counted_at DESC);

ALTER TABLE linen_inventory_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lic_authenticated" ON linen_inventory_counts FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW linen_inventory_latest AS
  SELECT * FROM linen_inventory_counts ORDER BY counted_at DESC LIMIT 1;
