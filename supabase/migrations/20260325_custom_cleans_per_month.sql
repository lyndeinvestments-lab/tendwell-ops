-- Add avg_cleans_per_month to properties so CSV import can store exact values
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS avg_cleans_per_month NUMERIC(10, 2);

-- Create cleaning_history table with open RLS so the anon key can insert
CREATE TABLE IF NOT EXISTS cleaning_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  clean_date DATE NOT NULL,
  cleaner_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE cleaning_history ENABLE ROW LEVEL SECURITY;

-- Allow all operations via anon and authenticated roles
CREATE POLICY IF NOT EXISTS "allow_all_cleaning_history"
  ON cleaning_history
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Recreate operational_properties view to use stored avg_cleans_per_month when
-- available (set by CSV import), falling back to frequency-based defaults.
CREATE OR REPLACE VIEW operational_properties AS
SELECT
  p.id,
  p.name,
  p.ce_charged,
  p.total_estimated_cost,
  (p.ce_charged - p.total_estimated_cost)                                    AS estimated_profit,
  CASE
    WHEN p.ce_charged > 0
    THEN ROUND(((p.ce_charged - p.total_estimated_cost) / p.ce_charged * 100)::NUMERIC, 1)
    ELSE NULL
  END                                                                         AS profit_percentage,
  p.cleaning_frequency,
  p.first_clean_date,
  -- Use stored value when available, otherwise derive from frequency bucket
  COALESCE(
    p.avg_cleans_per_month,
    CASE p.cleaning_frequency
      WHEN 'weekly'    THEN 4.33
      WHEN 'biweekly'  THEN 2.17
      WHEN 'monthly'   THEN 1.0
      ELSE 2.0
    END
  )                                                                           AS avg_cleans_per_month,
  ps.name                                                                     AS stage_name,
  -- Monthly estimates use the resolved CPM
  ROUND((p.ce_charged * COALESCE(
    p.avg_cleans_per_month,
    CASE p.cleaning_frequency
      WHEN 'weekly'    THEN 4.33
      WHEN 'biweekly'  THEN 2.17
      WHEN 'monthly'   THEN 1.0
      ELSE 2.0
    END
  ))::NUMERIC, 2)                                                             AS monthly_revenue_estimate,
  ROUND((p.total_estimated_cost * COALESCE(
    p.avg_cleans_per_month,
    CASE p.cleaning_frequency
      WHEN 'weekly'    THEN 4.33
      WHEN 'biweekly'  THEN 2.17
      WHEN 'monthly'   THEN 1.0
      ELSE 2.0
    END
  ))::NUMERIC, 2)                                                             AS monthly_cost_estimate,
  ROUND(((p.ce_charged - p.total_estimated_cost) * COALESCE(
    p.avg_cleans_per_month,
    CASE p.cleaning_frequency
      WHEN 'weekly'    THEN 4.33
      WHEN 'biweekly'  THEN 2.17
      WHEN 'monthly'   THEN 1.0
      ELSE 2.0
    END
  ))::NUMERIC, 2)                                                             AS monthly_profit_estimate
FROM properties p
JOIN pipeline_stages ps ON ps.id = p.stage_id;
