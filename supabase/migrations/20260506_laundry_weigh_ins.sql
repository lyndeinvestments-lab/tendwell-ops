-- Daily laundry weigh-ins submitted by cleaners via public QR/link.
-- Anyone with the link can submit (anon insert). Only authenticated users
-- can read/edit. Photos go to a public storage bucket so URLs are usable
-- in the dashboard without signed-URL plumbing.

CREATE TABLE IF NOT EXISTS laundry_weigh_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_name TEXT NOT NULL,
  pounds NUMERIC(8,2) NOT NULL CHECK (pounds > 0 AND pounds < 10000),
  laundry_type TEXT NOT NULL CHECK (laundry_type IN ('clean', 'dirty')),
  photo_url TEXT,
  photo_path TEXT,
  language TEXT DEFAULT 'en' CHECK (language IN ('en', 'es')),
  user_agent TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_laundry_weigh_ins_submitted_at
  ON laundry_weigh_ins (submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_laundry_weigh_ins_type
  ON laundry_weigh_ins (laundry_type, submitted_at DESC);

ALTER TABLE laundry_weigh_ins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "laundry_weigh_ins_anon_insert" ON laundry_weigh_ins;
CREATE POLICY "laundry_weigh_ins_anon_insert"
  ON laundry_weigh_ins
  FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "laundry_weigh_ins_auth_all" ON laundry_weigh_ins;
CREATE POLICY "laundry_weigh_ins_auth_all"
  ON laundry_weigh_ins
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Public storage bucket for weigh-in photos.
INSERT INTO storage.buckets (id, name, public)
VALUES ('laundry-weigh-ins', 'laundry-weigh-ins', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "laundry_weigh_ins_anon_upload" ON storage.objects;
CREATE POLICY "laundry_weigh_ins_anon_upload"
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'laundry-weigh-ins');

DROP POLICY IF EXISTS "laundry_weigh_ins_public_read" ON storage.objects;
CREATE POLICY "laundry_weigh_ins_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'laundry-weigh-ins');

DROP POLICY IF EXISTS "laundry_weigh_ins_auth_manage" ON storage.objects;
CREATE POLICY "laundry_weigh_ins_auth_manage"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'laundry-weigh-ins')
  WITH CHECK (bucket_id = 'laundry-weigh-ins');
