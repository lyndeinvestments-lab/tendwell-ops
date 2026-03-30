-- Prevent duplicate cleaning records per property per date
ALTER TABLE cleaning_history
  ADD CONSTRAINT cleaning_history_property_date_unique
  UNIQUE (property_id, clean_date);

-- CSV import audit log: tracks every file upload with counts
CREATE TABLE IF NOT EXISTS csv_import_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name     TEXT NOT NULL,
  imported_at   TIMESTAMPTZ DEFAULT now(),
  records_imported  INTEGER DEFAULT 0,
  records_skipped   INTEGER DEFAULT 0,
  properties_updated INTEGER DEFAULT 0,
  imported_by   TEXT
);

ALTER TABLE csv_import_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_csv_import_log"
  ON csv_import_log FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
