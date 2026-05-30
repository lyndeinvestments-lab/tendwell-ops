-- Restore the access-code audit trail.
--
-- pages/access-codes.tsx calls logAccessEvent() on every reveal/update of
-- sensitive fields (door codes, WiFi passwords, etc.) and inserts into
-- `access_audit_log`. That table was never created, so each insert returned
-- a 400. The call site catches errors silently (so the UI never broke),
-- meaning no audit row has ever been written.
--
-- Schema matches what the client already inserts:
--   { property_id, field_name, action, timestamp }
-- and adds an optional revealed_by column for future attribution work.

CREATE TABLE IF NOT EXISTS access_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id BIGINT,
  field_name TEXT NOT NULL,
  action TEXT NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  revealed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_audit_log_property
  ON access_audit_log (property_id, "timestamp" DESC);

ALTER TABLE access_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "access_audit_log_authenticated" ON access_audit_log;
CREATE POLICY "access_audit_log_authenticated"
  ON access_audit_log
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
