-- Incoming shipments submitted by external vendors/partners via public link.
-- Anyone with the link can submit (anon insert). Only authenticated users
-- can read/edit.

CREATE TABLE IF NOT EXISTS incoming_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_name TEXT NOT NULL,
  property_name TEXT NOT NULL,
  tracking_number TEXT,
  estimated_delivery DATE NOT NULL,
  description TEXT NOT NULL,
  delivery_responsible TEXT NOT NULL CHECK (delivery_responsible IN ('Haven', 'Tendwell')),
  user_agent TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incoming_shipments_submitted_at
  ON incoming_shipments (submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_incoming_shipments_property
  ON incoming_shipments (property_name, submitted_at DESC);

ALTER TABLE incoming_shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "incoming_shipments_anon_insert" ON incoming_shipments;
CREATE POLICY "incoming_shipments_anon_insert"
  ON incoming_shipments
  FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "incoming_shipments_auth_all" ON incoming_shipments;
CREATE POLICY "incoming_shipments_auth_all"
  ON incoming_shipments
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
