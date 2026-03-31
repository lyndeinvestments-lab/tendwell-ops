-- Add per-user custom view overrides
-- null = use role defaults; string[] = custom override; [] = no access to anything
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS custom_views jsonb;
