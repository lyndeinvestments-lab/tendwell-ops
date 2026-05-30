-- Restore the Client modal's Activity tab.
--
-- ContactModal.tsx has always queried and inserted into `contact_interactions`,
-- but the table was never created. Every load of an existing client throws a
-- 400 on the interactions query; every "Log Interaction" submit silently
-- errors via the destructive toast. This migration creates the table the
-- client code already expects.
--
-- Schema mirrors what ContactModal inserts (contact_id, interaction_type,
-- summary). Adds created_at + created_by for parity with contact_notes.

CREATE TABLE IF NOT EXISTS contact_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact
  ON contact_interactions (contact_id, created_at DESC);

ALTER TABLE contact_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_interactions_authenticated" ON contact_interactions;
CREATE POLICY "contact_interactions_authenticated"
  ON contact_interactions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
