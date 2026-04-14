CREATE TABLE IF NOT EXISTS stage_workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  default_assignee_name TEXT,
  due_offset_days INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  checklist_items JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_swt_transition ON stage_workflow_templates(from_stage, to_stage);
ALTER TABLE stage_workflow_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "swt_authenticated" ON stage_workflow_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_template_id UUID REFERENCES stage_workflow_templates(id) ON DELETE SET NULL;

INSERT INTO stage_workflow_templates (from_stage, to_stage, title, description, default_assignee_name, due_offset_days, sort_order, checklist_items) VALUES
  ('Quote', 'Onboarding', 'Get access codes for {property_name}', 'Collect all door codes, lockbox combos, garage codes', NULL, 2, 1, '["Door code", "Lockbox combo", "Garage code", "Gate code"]'::jsonb),
  ('Quote', 'Onboarding', 'Verify property details for {property_name}', 'Confirm bedroom/bath count, sq ft, amenities', NULL, 3, 2, '["Bedroom count", "Bathroom count", "Square footage", "Hot tub", "Pet policy"]'::jsonb),
  ('Quote', 'Onboarding', 'Schedule first clean for {property_name}', 'Coordinate with cleaning team for initial walkthrough', NULL, 5, 3, '[]'::jsonb),
  ('Quote', 'Onboarding', 'Get linen counts for {property_name}', 'Count all beds, record linen par levels', NULL, 3, 4, '["King beds", "Queen beds", "Full beds", "Twin beds", "Bath towels", "Hand towels"]'::jsonb),
  ('Quote', 'Onboarding', 'Confirm pricing for {property_name}', 'Verify final pricing matches quote and contract', NULL, 1, 5, '[]'::jsonb),
  ('Active', 'Offboarding', 'Cancel upcoming tasks for {property_name}', 'Cancel or reassign any scheduled cleans and inspections', NULL, 1, 1, '["Cancel scheduled cleans", "Cancel inspections", "Notify cleaners"]'::jsonb),
  ('Active', 'Offboarding', 'Complete linen pull for {property_name}', 'Retrieve all Tendwell-owned linens from property', NULL, 3, 2, '["Schedule linen pickup", "Verify linen counts", "Update inventory"]'::jsonb),
  ('Active', 'Offboarding', 'Notify cleaners about {property_name}', 'Inform cleaning team this property is being offboarded', NULL, 1, 3, '[]'::jsonb);
