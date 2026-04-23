-- One-time backfill: copy existing contacts.notes into the contact_notes
-- threaded feed so history isn't lost when the UI switches to the shared
-- ContactNotesFeed component. Idempotent via NOT EXISTS guard.

INSERT INTO contact_notes (contact_id, content, created_by, created_at)
SELECT id, notes, 'Legacy (pre-feed)', COALESCE(created_at, now())
FROM contacts
WHERE notes IS NOT NULL AND btrim(notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM contact_notes cn
    WHERE cn.contact_id = contacts.id
      AND cn.content = contacts.notes
  );
