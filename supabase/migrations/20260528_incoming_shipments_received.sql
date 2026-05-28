-- Adds "mark as received" state to the incoming_shipments submissions log.
-- Operators check off rows once the physical package arrives. Submissions
-- themselves stay immutable from the public form's perspective; only the
-- received_* columns are written by authenticated users.

ALTER TABLE incoming_shipments
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_incoming_shipments_received_at
  ON incoming_shipments (received_at DESC NULLS FIRST);
