-- Amenity cost unit prices — used to calculate Est Consumables per property
-- Formula: (fullBaths + halfBaths) × (bathroom + toilet_paper)
--        + kitchens × kitchen
--        + beds × trash_bag
--        + hasHotTub × hot_tub
INSERT INTO app_settings (key, value) VALUES
  ('amenity_bathroom', '1.05'),
  ('amenity_toilet_paper', '0.78'),
  ('amenity_kitchen', '2.05'),
  ('amenity_trash_bag', '0.06'),
  ('amenity_hot_tub', '0.88')
ON CONFLICT (key) DO NOTHING;
