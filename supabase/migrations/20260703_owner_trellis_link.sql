-- ═══════════════════════════════════════════════════════════════════════════════
-- Owner Trellis Portal Link
-- ═══════════════════════════════════════════════════════════════════════════════
-- Adds a per-owner `trellis_portal_url` column to property_owners.
-- Admins set this in Settings → Owners; owners see it in the owner portal with
-- one-click Open and one-click Copy actions.
--
-- RLS: no new policies needed.
--   * Owners can already SELECT their own property_owners row
--     ("property_owners_select" from 20260623_owner_portal.sql).
--   * Admins can already UPDATE any property_owners row
--     ("property_owners_update_admin" from 20260623_owner_portal.sql).
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE property_owners
  ADD COLUMN IF NOT EXISTS trellis_portal_url TEXT;
