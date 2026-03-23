-- App-wide configuration key/value store
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed default values (do not overwrite existing rows)
INSERT INTO app_settings (key, value) VALUES
  ('cost_inspection', '15'),
  ('cost_trash', '5'),
  ('cost_consumables', '30'),
  ('profit_tier_high', '30'),
  ('profit_tier_mid', '15'),
  ('ac_filter_interval', '90'),
  ('linen_restock_multiplier', '2'),
  ('break_even_target_margin', '0.20')
ON CONFLICT (key) DO NOTHING;
