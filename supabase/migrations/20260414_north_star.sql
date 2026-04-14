CREATE TABLE IF NOT EXISTS north_star_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL,
  name TEXT NOT NULL,
  metric_type TEXT NOT NULL DEFAULT 'Total',
  monthly_target NUMERIC,
  owner_name TEXT,
  source TEXT,
  sort_order INTEGER DEFAULT 0,
  section_order INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS north_star_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id UUID NOT NULL REFERENCES north_star_metrics(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  week1 NUMERIC,
  week2 NUMERIC,
  week3 NUMERIC,
  week4 NUMERIC,
  week5 NUMERIC,
  monthly_actual NUMERIC,
  status TEXT DEFAULT 'Green',
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(metric_id, period)
);

CREATE INDEX IF NOT EXISTS idx_nsv_period ON north_star_values(period);
CREATE INDEX IF NOT EXISTS idx_nsm_section ON north_star_metrics(section, sort_order);

ALTER TABLE north_star_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE north_star_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nsm_auth" ON north_star_metrics FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "nsv_auth" ON north_star_values FOR ALL TO authenticated USING (true) WITH CHECK (true);
