-- Add google_email to app_users for Google OAuth login
-- password_hash made nullable since password login is being removed

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS google_email text UNIQUE;

ALTER TABLE app_users
  ALTER COLUMN password_hash DROP NOT NULL;
