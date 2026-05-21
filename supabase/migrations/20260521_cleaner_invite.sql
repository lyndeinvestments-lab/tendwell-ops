-- Track which type of app user a cleaner is (cleaning or inspector)
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS app_role text CHECK (app_role IN ('cleaning', 'inspector')),
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz;

-- RPC: create / update an app_users entry for a cleaner.
-- Uses SECURITY DEFINER so authenticated ops/admin users can call it
-- without needing direct write access to app_users.
CREATE OR REPLACE FUNCTION add_cleaner_app_user(
  p_email text,
  p_name  text,
  p_role  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_role NOT IN ('cleaning', 'inspector', 'operations', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  INSERT INTO app_users (google_email, role, label)
  VALUES (p_email, p_role, p_name)
  ON CONFLICT (google_email) DO UPDATE
    SET role  = EXCLUDED.role,
        label = EXCLUDED.label
    WHERE app_users.role <> 'admin';
END;
$$;

GRANT EXECUTE ON FUNCTION add_cleaner_app_user(text, text, text) TO authenticated;
