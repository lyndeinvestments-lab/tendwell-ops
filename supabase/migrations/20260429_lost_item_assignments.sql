-- Local-only assignment table for Haven-OS lost item cases.
--
-- Haven owns the canonical case data (case_number, status, item_description,
-- guest fields, etc.) and exposes its own assigned_to. Tendwell needs a
-- separate, *local* assignment so we can assign Tendwell team members
-- (cleaners, ops staff) to a case without writing to Haven's user pool.
--
-- One assignment per Haven case — assignment is overwritten on reassign.

CREATE TABLE IF NOT EXISTS lost_item_assignments (
  haven_case_id        uuid PRIMARY KEY,
  assigned_user_id     integer REFERENCES app_users(id) ON DELETE SET NULL,
  assigned_by_user_id  integer REFERENCES app_users(id) ON DELETE SET NULL,
  assigned_at          timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  notes                text
);

CREATE INDEX IF NOT EXISTS idx_lost_item_assignments_user
  ON lost_item_assignments (assigned_user_id);

ALTER TABLE lost_item_assignments ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read assignments. View-level gating happens at
-- the API layer (requireLostItemsAccess).
CREATE POLICY "lost_item_assignments_select_authenticated"
  ON lost_item_assignments FOR SELECT
  TO authenticated
  USING (true);

-- Only admin/operations may insert/update/delete (mirrors the API gate).
CREATE POLICY "lost_item_assignments_insert_writable"
  ON lost_item_assignments FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() IN ('admin', 'operations'));

CREATE POLICY "lost_item_assignments_update_writable"
  ON lost_item_assignments FOR UPDATE
  TO authenticated
  USING      (current_user_role() IN ('admin', 'operations'))
  WITH CHECK (current_user_role() IN ('admin', 'operations'));

CREATE POLICY "lost_item_assignments_delete_writable"
  ON lost_item_assignments FOR DELETE
  TO authenticated
  USING (current_user_role() IN ('admin', 'operations'));

-- Auto-bump updated_at on row updates.
CREATE OR REPLACE FUNCTION set_lost_item_assignment_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lost_item_assignments_set_updated_at ON lost_item_assignments;
CREATE TRIGGER lost_item_assignments_set_updated_at
  BEFORE UPDATE ON lost_item_assignments
  FOR EACH ROW
  EXECUTE FUNCTION set_lost_item_assignment_updated_at();
