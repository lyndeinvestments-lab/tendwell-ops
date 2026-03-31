-- Add custom_views to app_users for per-user view access overrides
-- null = use role defaults from role_permissions settings or hardcoded ROLE_VIEWS
-- []   = intentionally no access (empty array)
-- [...] = explicit list of view IDs the user can access

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS custom_views jsonb;
