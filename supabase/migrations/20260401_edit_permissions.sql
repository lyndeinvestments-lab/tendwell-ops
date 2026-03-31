-- Per-user edit permission overrides (view+edit per page)
-- null = inherit from role; object = per-view { view: bool, edit: bool }
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS custom_permissions jsonb;
