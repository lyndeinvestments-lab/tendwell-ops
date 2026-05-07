-- Grant view + edit on the new `laundry-weigh-ins` view to admin and operations
-- roles by mutating the JSON stored in `app_settings.role_permissions`.
-- The Settings page reads this row at login to build each role's resolved
-- views; without it, even an admin sees "no access" because the stored
-- permission set predates the new view id.

DO $$
DECLARE
  cfg jsonb;
  role_name text;
  new_perm jsonb := jsonb_build_object('view', true, 'edit', true);
BEGIN
  SELECT value::jsonb INTO cfg FROM app_settings WHERE key = 'role_permissions';
  IF cfg IS NULL THEN
    RAISE NOTICE 'role_permissions not set; nothing to update';
    RETURN;
  END IF;

  FOREACH role_name IN ARRAY ARRAY['admin','operations'] LOOP
    IF cfg ? role_name THEN
      IF NOT (cfg -> role_name -> 'views') @> '["laundry-weigh-ins"]'::jsonb THEN
        cfg := jsonb_set(
          cfg,
          ARRAY[role_name, 'views'],
          (cfg -> role_name -> 'views') || '["laundry-weigh-ins"]'::jsonb
        );
      END IF;
      cfg := jsonb_set(
        cfg,
        ARRAY[role_name, 'permissions', 'laundry-weigh-ins'],
        new_perm,
        true
      );
    END IF;
  END LOOP;

  UPDATE app_settings SET value = cfg::text WHERE key = 'role_permissions';
END $$;
