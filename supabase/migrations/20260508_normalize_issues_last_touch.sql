-- Backfill / data-hygiene pass for cleaning_issues.last_touch.
--
-- The column is free text. Rows whose value case-insensitively + trim-equals
-- a cleaner's full_name are updated to use the canonical full_name (matching
-- the casing/whitespace stored in the cleaners table). This locks in the
-- invariant the new-issue dropdown and CSV importer maintain going forward.
--
-- Rows whose last_touch does not exact-match a cleaner are left untouched —
-- this includes ambiguous prefixes (e.g. "Oniel Norma Portillo"), names not
-- in the cleaners roster, and sentinel values like "Other". The
-- cleaner-metrics page already handles partial-substring fallbacks at read
-- time, so leaving these alone preserves current behavior without losing
-- information from the source rows.
--
-- Idempotent: re-running this migration is a no-op once normalization has
-- been applied.

UPDATE cleaning_issues AS i
SET last_touch = c.full_name
FROM cleaners AS c
WHERE i.last_touch IS NOT NULL
  AND lower(btrim(i.last_touch)) = lower(c.full_name)
  AND i.last_touch IS DISTINCT FROM c.full_name;
