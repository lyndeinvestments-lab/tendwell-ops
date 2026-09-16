-- Listing link on a property.
--
-- Every property has a public listing somewhere (Airbnb, VRBO, Zillow for the
-- ones not yet live), and staff were pasting those links into notes or hunting
-- for them in the source spreadsheet. `ical_url` already covers the calendar
-- feed; this is the human-facing listing page, shown in the property modal's
-- Overview tab next to the address.
--
-- Deliberately NOT added to the owner field-permission model: this is a staff
-- reference field, and the owner portal has its own curated field set.

ALTER TABLE properties ADD COLUMN IF NOT EXISTS listing_url TEXT;

COMMENT ON COLUMN properties.listing_url IS
  'Public listing page for the property (Airbnb / VRBO / Zillow). Staff reference only; the calendar feed lives in ical_url.';
