-- ─── Step 1: Remove existing duplicates ───────────────────────────────────────
-- Keep the earliest-created record per (property_id, clean_date).
-- DISTINCT ON requires ORDER BY to match, so we use a subquery.
DELETE FROM cleaning_history
WHERE id NOT IN (
  SELECT DISTINCT ON (property_id, clean_date) id
  FROM cleaning_history
  ORDER BY property_id, clean_date, created_at ASC, id ASC
);

-- ─── Step 2: Unique constraint ────────────────────────────────────────────────
-- Matches the app's upsert: onConflict: 'property_id,clean_date'
ALTER TABLE cleaning_history
  ADD CONSTRAINT cleaning_history_property_date_unique
  UNIQUE (property_id, clean_date);

-- ─── Step 3: CSV import audit log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS csv_import_log (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name          TEXT        NOT NULL,
  source_table       TEXT        NOT NULL DEFAULT 'cleaning_history',
  imported_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  rows_attempted     INTEGER     NOT NULL DEFAULT 0,
  rows_inserted      INTEGER     NOT NULL DEFAULT 0,
  rows_skipped       INTEGER     NOT NULL DEFAULT 0,
  rows_errored       INTEGER     NOT NULL DEFAULT 0,
  properties_updated INTEGER     NOT NULL DEFAULT 0,
  import_status      TEXT        NOT NULL DEFAULT 'success'
                       CHECK (import_status IN ('success', 'partial', 'failed')),
  error_details      JSONB,
  imported_by        TEXT
);

ALTER TABLE csv_import_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_csv_import_log"
  ON csv_import_log FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS csv_import_log_imported_at_idx
  ON csv_import_log (imported_at DESC);

CREATE INDEX IF NOT EXISTS csv_import_log_status_idx
  ON csv_import_log (import_status);
