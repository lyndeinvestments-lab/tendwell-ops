-- Cleaning Issues Tracker
CREATE TABLE IF NOT EXISTS cleaning_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
  property_name TEXT,
  category TEXT NOT NULL DEFAULT 'Other',
  last_touch TEXT,
  details TEXT,
  assessment TEXT,
  resolution TEXT,
  coverage TEXT,
  status TEXT NOT NULL DEFAULT 'In Progress',
  reference TEXT,
  remarks TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleaning_issues_report_date ON cleaning_issues(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_cleaning_issues_status ON cleaning_issues(status);
CREATE INDEX IF NOT EXISTS idx_cleaning_issues_property_id ON cleaning_issues(property_id);

ALTER TABLE cleaning_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cleaning_issues_authenticated" ON cleaning_issues FOR ALL TO authenticated USING (true) WITH CHECK (true);
