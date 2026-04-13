ALTER TABLE property_verifications ADD COLUMN IF NOT EXISTS assignee_name TEXT;
ALTER TABLE property_verifications ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS verification_property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tasks_verification_property ON tasks(verification_property_id) WHERE verification_property_id IS NOT NULL;
ALTER TABLE property_verifications ALTER COLUMN verified_at DROP NOT NULL;
