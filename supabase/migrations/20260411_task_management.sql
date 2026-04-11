-- Task Management System
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'To Do',
  priority TEXT NOT NULL DEFAULT 'Medium',
  due_date DATE,
  assignee_id TEXT,
  assignee_name TEXT,
  property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
  property_name TEXT,
  category TEXT DEFAULT 'General',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_property ON tasks(property_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_authenticated" ON tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "task_comments_authenticated" ON task_comments FOR ALL TO authenticated USING (true) WITH CHECK (true);
