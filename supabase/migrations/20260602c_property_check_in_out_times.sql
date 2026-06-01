-- Add structured check-in / check-out time columns to properties + backfill
-- defaults. Stored as text for display flexibility ("3:00 PM", "10:00 AM").
--
-- Defaults:
--   All properties: check_in_time = '4:00 PM', check_out_time = '10:00 AM'
--   Scenic Stays properties: check_in_time = '3:00 PM' (per onboarding form
--     standard from Scenic Stay Collection)

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS check_in_time  TEXT NOT NULL DEFAULT '4:00 PM',
  ADD COLUMN IF NOT EXISTS check_out_time TEXT NOT NULL DEFAULT '10:00 AM';

-- Backfill: Scenic Stays properties get the 3 PM check-in.
UPDATE properties
SET check_in_time = '3:00 PM'
WHERE name ILIKE 'Scenic Stays %'
  AND check_in_time = '4:00 PM';
