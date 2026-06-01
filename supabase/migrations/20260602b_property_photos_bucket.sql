-- Create the property-photos storage bucket that PropertyDetailModal has
-- been trying to upload to since the "Photos" tab feature shipped. Without
-- it, every upload attempt returned "Bucket not found" and silently
-- failed in the UI.
--
-- Mirrors the existing `inspections` bucket pattern:
--   - public = true so getPublicUrl(...) returns a usable URL for <img src>
--   - public SELECT (anyone with the URL can view a thumbnail)
--   - authenticated INSERT / UPDATE / DELETE (only signed-in users manage)

INSERT INTO storage.buckets (id, name, public)
VALUES ('property-photos', 'property-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "property_photos_public_read" ON storage.objects;
CREATE POLICY "property_photos_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'property-photos');

DROP POLICY IF EXISTS "property_photos_auth_insert" ON storage.objects;
CREATE POLICY "property_photos_auth_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'property-photos');

DROP POLICY IF EXISTS "property_photos_auth_update" ON storage.objects;
CREATE POLICY "property_photos_auth_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'property-photos')
  WITH CHECK (bucket_id = 'property-photos');

DROP POLICY IF EXISTS "property_photos_auth_delete" ON storage.objects;
CREATE POLICY "property_photos_auth_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'property-photos');
