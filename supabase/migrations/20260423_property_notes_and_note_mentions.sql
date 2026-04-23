-- Unified property notes feed + note-mention notification prefs
-- Mirrors the contact_notes pattern so every property surface (modal, quote, pipeline, master list)
-- reads/writes one threaded feed.

-- ───────────────────────────────────────────────────────────────────────────────
-- 1. property_notes: threaded notes per property
-- ───────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id bigint REFERENCES properties(id) ON DELETE CASCADE,
  content text NOT NULL,
  context text,  -- optional tag: 'general' | 'linen' | 'access' | 'financial' etc. Null = general.
  created_at timestamptz DEFAULT now(),
  created_by text,
  created_by_user_id integer REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_property_notes_property_id ON property_notes(property_id, created_at DESC);

ALTER TABLE property_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "property_notes_authenticated"
  ON property_notes FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ───────────────────────────────────────────────────────────────────────────────
-- 2. notification_preferences: two new mention-event toggles
-- ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS notify_property_note_mention BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS notify_contact_note_mention BOOLEAN NOT NULL DEFAULT true;
