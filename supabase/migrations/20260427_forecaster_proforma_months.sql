-- proforma_months: monthly P&L actuals + tasks/properties counts that feed the
-- Forecaster page (live proforma + variance vs estimates).
--
-- One row per YYYY-MM month. Categories mirror the QBO P&L groups Tendwell
-- already uses, plus inspections + trash so per-property estimates from
-- cost-tracking can be reconciled against actuals.

CREATE TABLE IF NOT EXISTS proforma_months (
  month               TEXT PRIMARY KEY,             -- 'YYYY-MM'
  cleaning_fee        NUMERIC(12,2) DEFAULT 0,
  services            NUMERIC(12,2) DEFAULT 0,
  onboarding_revenue  NUMERIC(12,2) DEFAULT 0,
  other_income        NUMERIC(12,2) DEFAULT 0,
  contractor_pay      NUMERIC(12,2) DEFAULT 0,
  laundry             NUMERIC(12,2) DEFAULT 0,
  leadership          NUMERIC(12,2) DEFAULT 0,
  supplies            NUMERIC(12,2) DEFAULT 0,
  inspections         NUMERIC(12,2) DEFAULT 0,
  trash               NUMERIC(12,2) DEFAULT 0,
  other_cogs          NUMERIC(12,2) DEFAULT 0,
  opex                NUMERIC(12,2) DEFAULT 0,
  tasks               INTEGER DEFAULT 0,
  properties          INTEGER DEFAULT 0,
  source              TEXT DEFAULT 'manual',        -- manual | upload | qbo
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT proforma_month_format CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE INDEX IF NOT EXISTS idx_proforma_months_month ON proforma_months(month);

-- Standard RLS: visible to authenticated users, write requires admin via the
-- existing policy pattern (mirrors app_settings).
ALTER TABLE proforma_months ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proforma_months_read ON proforma_months;
CREATE POLICY proforma_months_read ON proforma_months FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS proforma_months_write ON proforma_months;
CREATE POLICY proforma_months_write ON proforma_months FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Seed historical months migrated from tendwellforecaster's seed JSON so the
-- Forecaster page renders meaningfully on first load. Idempotent — ON CONFLICT
-- DO NOTHING leaves existing rows alone.
INSERT INTO proforma_months
  (month, cleaning_fee, contractor_pay, laundry, leadership, supplies, other_cogs, opex, tasks, properties, source)
VALUES
  ('2025-06', 43104,    23924,    1883.40, 2916.67, 2491.11,  480.57,    0,       33,  8,  'seed'),
  ('2025-07', 59778.37, 32210,    3782.13, 2903.21, 4157.04, 5333.57,  368.87,   57, 14,  'seed'),
  ('2025-08', 58840.43, 38130.43, 6522.84, 3269.87, 5071.04,  390.00, 1002.45,   82, 18,  'seed'),
  ('2025-09', 58668,    33637,    3101.50, 3269.87, 2731.94,    0.00,  484.29,  114, 28,  'seed'),
  ('2025-10', 85414,    47998,    4991.90, 3269.87, 3000.23, 2028.10,  706.78,  221, 40,  'seed'),
  ('2025-11', 96410,    39872,   12470.57, 3269.87, 3868.00,    0.00, 1826.59,  201, 44,  'seed'),
  ('2025-12', 96180,    46344,   11650.23, 3275.77, 2190.83,  170.00, 1272.85,  253, 77,  'seed'),
  ('2026-01', 70849.75, 42242.45,25653.47, 3281.67, 3966.27,  120.00, 1281.19,  188, 69,  'seed')
ON CONFLICT (month) DO NOTHING;
