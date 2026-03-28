-- ─── activity_log ─────────────────────────────────────────────────────────────
-- Central audit log for all changes across the Tendwell Ops app.
-- Replaces the property_edit_log-only approach so every entity type
-- (properties, pipeline, contacts, inspections, cleaners, etc.) gets logged.

CREATE TABLE IF NOT EXISTS activity_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   TEXT NOT NULL,           -- 'property' | 'pipeline' | 'contact' | 'inspection' | 'cleaner' | ...
  entity_id     TEXT,                    -- stringified PK of the changed record
  entity_name   TEXT,                    -- human-readable name (property name, contact name, etc.)
  action        TEXT NOT NULL DEFAULT 'update', -- 'create' | 'update' | 'delete' | 'stage_change' | 'note' | 'other'
  field_name    TEXT,                    -- for 'update' actions: which field changed
  old_value     TEXT,                    -- previous value (stringified)
  new_value     TEXT,                    -- new value (stringified)
  changed_by    TEXT,                    -- user label / email if available
  metadata      JSONB,                   -- arbitrary extra context
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the activity feed query (newest first, filtered by date)
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at  ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity_type ON activity_log (entity_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity_id   ON activity_log (entity_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- The app uses the anon key with no Supabase Auth users, so we allow full
-- access to the anon role. Adjust once you add row-level user auth.

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_activity_log" ON activity_log;
CREATE POLICY "allow_all_activity_log" ON activity_log
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ─── Keep property_edit_log RLS open too ──────────────────────────────────────
-- The legacy table must also be readable/writable by the anon key or the
-- activity feed falls back to 0 rows.

ALTER TABLE property_edit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_property_edit_log" ON property_edit_log;
CREATE POLICY "allow_all_property_edit_log" ON property_edit_log
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);
