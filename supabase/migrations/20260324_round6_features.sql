-- Round 6: Contact notes, inspection photos, property photos, property supplies

-- Contact notes (chronological feed per contact)
CREATE TABLE IF NOT EXISTS contact_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  created_by text
);

-- Inspection photos (linked to inspection records)
CREATE TABLE IF NOT EXISTS inspection_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid REFERENCES inspections(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  section text,
  created_at timestamptz DEFAULT now()
);

-- Property photos (gallery per property, sortable)
CREATE TABLE IF NOT EXISTS property_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id bigint REFERENCES properties(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Property supplies (par-level tracking per property)
CREATE TABLE IF NOT EXISTS property_supplies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id bigint REFERENCES properties(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  par_level int DEFAULT 1,
  current_qty int DEFAULT 0,
  last_restocked timestamptz
);
