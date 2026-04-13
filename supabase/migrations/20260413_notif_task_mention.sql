ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS notify_task_mention BOOLEAN NOT NULL DEFAULT true;
