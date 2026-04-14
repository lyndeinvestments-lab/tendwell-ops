-- Task Lists: private, shared, public with per-user colors
-- Multiple assignees (primary/secondary) and watchers per task

CREATE TABLE IF NOT EXISTS task_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'shared',
  created_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_list_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  color TEXT DEFAULT '#6366f1',
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE(list_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'secondary',
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_watchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, user_id)
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS list_id UUID REFERENCES task_lists(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_task ON task_assignees(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id);
CREATE INDEX IF NOT EXISTS idx_task_watchers_task ON task_watchers(task_id);
CREATE INDEX IF NOT EXISTS idx_task_watchers_user ON task_watchers(user_id);
CREATE INDEX IF NOT EXISTS idx_task_list_members_user ON task_list_members(user_id);

ALTER TABLE task_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_watchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_lists_auth" ON task_lists FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "task_list_members_auth" ON task_list_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "task_assignees_auth" ON task_assignees FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "task_watchers_auth" ON task_watchers FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS notify_watcher_update BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS notify_list_added BOOLEAN NOT NULL DEFAULT true;
