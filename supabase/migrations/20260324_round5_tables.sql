-- Round 5: New tables for Onboarding, Inspections, Cleaners, and Assignments

-- Onboarding task templates (default checklist items)
CREATE TABLE IF NOT EXISTS onboarding_task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);

INSERT INTO onboarding_task_templates (task_name, sort_order) VALUES
  ('Contract signed', 1),
  ('Linen inventory recorded', 2),
  ('Access codes entered', 3),
  ('AC filter size recorded', 4),
  ('First clean scheduled', 5),
  ('Property photos taken', 6),
  ('Client payment method confirmed', 7),
  ('Inspection walkthrough complete', 8)
ON CONFLICT DO NOTHING;

-- Onboarding tasks per property
CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  is_complete BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Inspections with quality scores
CREATE TABLE IF NOT EXISTS inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  inspected_by TEXT DEFAULT 'ops-user',
  inspected_at TIMESTAMPTZ DEFAULT now(),
  overall_score INTEGER CHECK (overall_score BETWEEN 1 AND 10),
  cleanliness_score INTEGER CHECK (cleanliness_score BETWEEN 1 AND 10),
  linens_score INTEGER CHECK (linens_score BETWEEN 1 AND 10),
  supplies_score INTEGER CHECK (supplies_score BETWEEN 1 AND 10),
  exterior_score INTEGER CHECK (exterior_score BETWEEN 1 AND 10),
  notes TEXT,
  photos_url TEXT[]
);

-- Cleaner roster
CREATE TABLE IF NOT EXISTS cleaners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  pay_rate NUMERIC(10,2),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Clean assignments (links cleaners to properties on specific dates)
CREATE TABLE IF NOT EXISTS clean_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  cleaner_id UUID NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'scheduled',
  pay_amount NUMERIC(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
