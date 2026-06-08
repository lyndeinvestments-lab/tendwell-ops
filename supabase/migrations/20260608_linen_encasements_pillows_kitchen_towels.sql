-- Linen Inventory: add mattress encasements, pillows, and kitchen towels.
--
-- Encasements (one per bed size) and pillows (king + standard) are tracked
-- as on-hand-only counts — no required target / variance on the snapshot.
--
-- Kitchen towels DO have a requirement: 3 × the total kitchen count across
-- the operational property set (computed client-side in linen-inventory.tsx
-- from operational_properties.kitchens), so it gets a normal column here.

ALTER TABLE linen_inventory_counts ADD COLUMN IF NOT EXISTS king_encasements  INTEGER DEFAULT 0;
ALTER TABLE linen_inventory_counts ADD COLUMN IF NOT EXISTS queen_encasements INTEGER DEFAULT 0;
ALTER TABLE linen_inventory_counts ADD COLUMN IF NOT EXISTS full_encasements  INTEGER DEFAULT 0;
ALTER TABLE linen_inventory_counts ADD COLUMN IF NOT EXISTS twin_encasements  INTEGER DEFAULT 0;

ALTER TABLE linen_inventory_counts ADD COLUMN IF NOT EXISTS king_pillows      INTEGER DEFAULT 0;
ALTER TABLE linen_inventory_counts ADD COLUMN IF NOT EXISTS standard_pillows  INTEGER DEFAULT 0;

ALTER TABLE linen_inventory_counts ADD COLUMN IF NOT EXISTS kitchen_towels    INTEGER DEFAULT 0;
