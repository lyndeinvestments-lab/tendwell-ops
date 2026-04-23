-- One-time backfill: move existing properties.notes / properties.linen_notes
-- values into the new threaded property_notes feed so history isn't lost when
-- the UI switches to the unified feed. Idempotent via NOT EXISTS guard.

INSERT INTO property_notes (property_id, content, context, created_by, created_at)
SELECT id, notes, NULL, 'Legacy (pre-feed)', COALESCE(created_at, now())
FROM properties
WHERE notes IS NOT NULL AND btrim(notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM property_notes pn
    WHERE pn.property_id = properties.id
      AND pn.content = properties.notes
      AND pn.context IS NULL
  );

INSERT INTO property_notes (property_id, content, context, created_by, created_at)
SELECT id, linen_notes, 'linen', 'Legacy (pre-feed)', COALESCE(created_at, now())
FROM properties
WHERE linen_notes IS NOT NULL AND btrim(linen_notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM property_notes pn
    WHERE pn.property_id = properties.id
      AND pn.content = properties.linen_notes
      AND pn.context = 'linen'
  );
