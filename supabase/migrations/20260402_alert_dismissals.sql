CREATE TABLE IF NOT EXISTS alert_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key TEXT NOT NULL,
  dismissed_by TEXT,
  dismissed_at TIMESTAMPTZ DEFAULT now(),
  snoozed_until TIMESTAMPTZ,
  UNIQUE(alert_key)
);

ALTER TABLE alert_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alert_dismissals_authenticated"
  ON alert_dismissals FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
