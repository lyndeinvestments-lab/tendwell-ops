-- Onboarding submissions from client portal
CREATE TABLE IF NOT EXISTS onboarding_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  client_name TEXT,
  property_name TEXT,
  address TEXT,
  bedrooms INTEGER,
  full_baths INTEGER,
  half_baths INTEGER,
  square_footage NUMERIC,
  number_of_beds INTEGER,
  guest_count INTEGER,
  kitchens INTEGER DEFAULT 1,
  hot_tub BOOLEAN DEFAULT false,
  pet_friendly TEXT,
  wifi_info TEXT,
  auto_code TEXT,
  door_code TEXT,
  other_codes TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE onboarding_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "onboarding_submissions_anon_insert" ON onboarding_submissions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "onboarding_submissions_auth_all" ON onboarding_submissions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Recurring task templates
CREATE TABLE IF NOT EXISTS recurring_task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'Medium',
  category TEXT DEFAULT 'General',
  assignee_name TEXT,
  recurrence TEXT NOT NULL DEFAULT 'monthly',
  next_run DATE,
  enabled BOOLEAN DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE recurring_task_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recurring_tasks_auth" ON recurring_task_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
