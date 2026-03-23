-- Add follow_up_date column to properties table
-- Required for pipeline cards to display follow-up dates on Lead/Quote/Onboarding stages

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS follow_up_date DATE;
