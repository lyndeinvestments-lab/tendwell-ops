-- Notification system: per-user email preferences + send log
-- Keyed by app_users.id (system users only). Admins can edit any user's prefs.

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  notify_task_assigned BOOLEAN NOT NULL DEFAULT true,
  notify_task_overdue BOOLEAN NOT NULL DEFAULT true,
  notify_issue_logged BOOLEAN NOT NULL DEFAULT true,
  notify_verification_due BOOLEAN NOT NULL DEFAULT false,
  notify_onboarding_submitted BOOLEAN NOT NULL DEFAULT true,
  notify_follow_up_due BOOLEAN NOT NULL DEFAULT false,
  digest_frequency TEXT NOT NULL DEFAULT 'instant', -- instant | daily | off
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  recipient_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL, -- sent | failed | skipped
  error TEXT,
  meta JSONB,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_sent_at ON notification_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_event_type ON notification_log(event_type);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read prefs (UI shows recipient list); only admins write.
-- Each user can update their own row.
CREATE POLICY "notif_prefs_read_auth" ON notification_preferences
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "notif_prefs_self_write" ON notification_preferences
  FOR ALL TO authenticated
  USING (user_id IN (SELECT id FROM app_users WHERE google_email = (auth.jwt() ->> 'email')))
  WITH CHECK (user_id IN (SELECT id FROM app_users WHERE google_email = (auth.jwt() ->> 'email')));

CREATE POLICY "notif_prefs_admin_write" ON notification_preferences
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- Log: admins read, service role inserts (edge function uses service role)
CREATE POLICY "notif_log_admin_read" ON notification_log
  FOR SELECT TO authenticated USING (current_user_role() = 'admin');

-- Seed default prefs for all existing users
INSERT INTO notification_preferences (user_id)
SELECT id FROM app_users
ON CONFLICT (user_id) DO NOTHING;
